import postgres from 'postgres';
import {createClient} from '@supabase/supabase-js';
import {put,list,del} from '@vercel/blob';
import {createHash,timingSafeEqual} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest();
export default async function handler(req,res){
res.setHeader('Cache-Control','no-store');
if(!process.env.CRON_SECRET||!timingSafeEqual(digest(req.headers.authorization||''),digest('Bearer '+process.env.CRON_SECRET)))return res.status(401).json({error:'Unauthorized'});
if(req.method!=='GET')return res.status(405).end();
const sql=postgres(process.env.POSTGRES_URL,{max:1,connect_timeout:15});
try{
const report=await sql.begin('isolation level repeatable read',async tx=>{
const acquired=await tx`select pg_try_advisory_xact_lock(174174174) as ok`;
if(!acquired[0].ok)return {locked:true};
const sites=await tx`select * from public.field_sites order by id`;
const history=await tx`select * from field_private.history order by site_id,version`;
const members=await tx`select user_id,display_name,role,active from public.field_members`;
const admin=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const paths=[...new Set([...sites,...history].flatMap(s=>(s.data.photos||[]).map(p=>(s.id||s.site_id)+'/'+p.id)))];
const existing=new Set();let cursor;
do{const page=await list({prefix:'photos/',limit:1000,cursor});page.blobs.forEach(b=>existing.add(b.pathname));cursor=page.hasMore?page.cursor:undefined;}while(cursor);
const pending=paths.filter(path=>!existing.has('photos/'+path));let copied=0,missing=0,index=0;
async function worker(){
while(index<pending.length){const path=pending[index++];const {data,error}=await admin.storage.from('field-photos').download(path);if(error){missing++;continue;}
const bytes=Buffer.from(await data.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==path.split('/')[1])throw Error('Photo checksum mismatch');
await put('photos/'+path,bytes,{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:data.type});copied++;
}
}
await Promise.all(Array.from({length:Math.min(4,pending.length)},()=>worker()));
const snapshot={schema:1,date:new Date().toISOString(),photosComplete:missing===0,sites,history,members,photos:paths};
const pathname='snapshots/'+snapshot.date.replace(/[:.]/g,'-')+'.json';
await put(pathname,JSON.stringify(snapshot),{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'});
if(!missing){do{const page=await list({prefix:'snapshots/',cursor,limit:1000});const cutoff=Date.now()-30*86400000;const expired=page.blobs.filter(b=>new Date(b.uploadedAt).getTime()<cutoff);if(expired.length)await del(expired.map(b=>b.url));cursor=page.hasMore?page.cursor:undefined;}while(cursor);}
return {ok:missing===0,sites:sites.length,photos:paths.length,copied,missing,snapshot:pathname};
});
return res.status(report.locked?409:200).json(report);
}catch(e){console.error('Raneen backup failed',e.code||e.constructor.name);return res.status(500).json({error:'Backup failed; primary data remains intact'});}finally{await sql.end({timeout:2});}
}
