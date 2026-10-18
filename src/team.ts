import {createClient} from '@supabase/supabase-js';
import {config,setConfig,list,put,mutate,getSite,type Site,type Photo} from './store';
export const team=createClient(import.meta.env.VITE_PUBLIC_SUPABASE_URL,import.meta.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY||import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
export type Member={user_id:string;display_name:string;role:string;active:boolean;force_password:boolean};
type Row={created_by?:string;created_name?:string;deleted_at?:string;id:string;version:number;data:Record<string,unknown>;photos_ready:boolean;updated_at:string};
type Operation={id:string;site:Site};
export async function member(){const {data:{session}}=await team.auth.getSession();if(!session)return null;const {data,error}=await team.from('field_members').select('*').eq('user_id',session.user.id).single();if(error)throw Error(error.code==='PGRST116'?'هذا الحساب غير مضاف إلى فريق الرنين.':'تعذر التحقق من جلسة الفريق؛ المسودات محفوظة وستُعاد المحاولة.');if(!data?.active)throw Error('هذا الحساب غير مضاف إلى فريق الرنين أو معطل.');return data as Member;}
export async function signIn(username:string,password:string){const {error}=await team.auth.signInWithPassword({email:username.trim().toLowerCase()+'@accounts.raneen.invalid',password});if(error)throw Error('تعذر الدخول؛ تحقق من اسم المستخدم وكلمة المرور والاتصال.');return member();}
export async function changePassword(password:string){if(password.length<12)throw Error('استخدم كلمة مرور من 12 حرفاً على الأقل.');const {error}=await team.auth.updateUser({password});if(error)throw error;const {data:{user}}=await team.auth.getUser();const result=await team.from('field_members').update({force_password:false}).eq('user_id',user!.id);if(result.error)throw result.error;}
const keys=['name','street','date','updated','lat','lng','kind','position','dimensions','height','width','visibility','notes','owner','role','phone','contact','price','priceCurrency','priority','next'] as const;
function payload(s:Site){return {...Object.fromEntries(keys.filter(k=>s[k]!==undefined).map(k=>[k,s[k]])),photos:s.photos.map(p=>({id:p.id,name:p.name,mime:p.blob.type||p.mime||'image/jpeg'}))};}

export const photoBlobCache=new Map<string,Blob>();
export const photoUrlCache=new Map<string,string>();
const photoInflight=new Map<string,Promise<Blob>>();

export function getCachedPhotoUrl(id:string,remotePath?:string):string|undefined{
return photoUrlCache.get(id)||(remotePath?photoUrlCache.get(remotePath):undefined);
}

export function cachePhotoBlob(id:string,blob:Blob,remotePath?:string):string{
if(blob.size>0){
photoBlobCache.set(id,blob);
if(remotePath)photoBlobCache.set(remotePath,blob);
}
let url=photoUrlCache.get(id)||(remotePath?photoUrlCache.get(remotePath):undefined);
if(!url&&blob.size>0){
url=URL.createObjectURL(blob);
photoUrlCache.set(id,url);
if(remotePath)photoUrlCache.set(remotePath,url);
}
return url||'';
}

function local(row:Row,previous?:Site):Site{
const remotePhotos=(row.data.photos as {id:string;name:string;mime:string}[])||[];
let photos:Photo[];
let healDirty=false;
if(remotePhotos.length===0&&previous?.photos&&previous.photos.length>0&&previous.photos.some(p=>p.blob&&p.blob.size>0)){
photos=previous.photos;
healDirty=true;
}else{
photos=remotePhotos.map(p=>{
const prevBlob=previous?.photos.find(old=>old.id===p.id)?.blob;
const memBlob=photoBlobCache.get(p.id)||(row.id?photoBlobCache.get(row.id+'/'+p.id):undefined);
const blob=(prevBlob&&prevBlob.size>0)?prevBlob:(memBlob&&memBlob.size>0)?memBlob:new Blob([],{type:p.mime});
if(blob.size>0)cachePhotoBlob(p.id,blob,row.id+'/'+p.id);
return {...p,blob,remotePath:row.id+'/'+p.id};
});
}
return {...row.data,createdBy:row.created_by,createdName:row.created_name,deletedAt:row.deleted_at,id:row.id,version:row.version,remotePending:!row.photos_ready,dirty:healDirty||false,photos} as Site;
}

export async function photoBlob(photo:Photo):Promise<Blob>{
const key=photo.remotePath||photo.id;
const inMemory=photoBlobCache.get(photo.id)||(photo.remotePath?photoBlobCache.get(photo.remotePath):undefined);
if(inMemory&&inMemory.size>0){
cachePhotoBlob(photo.id,inMemory,photo.remotePath);
return inMemory;
}
if(photo.blob&&photo.blob.size>0){
cachePhotoBlob(photo.id,photo.blob,photo.remotePath);
return photo.blob;
}
const inflight=photoInflight.get(key)||(photo.id?photoInflight.get(photo.id):undefined);
if(inflight)return inflight;
const remotePath=photo.remotePath;
if(!remotePath)throw Error('الصورة غير متاحة');

const task=(async()=>{
try{
const cached=await config<Blob>('photo:'+remotePath);
if(cached&&cached.size>0){
cachePhotoBlob(photo.id,cached,remotePath);
return cached;
}
const {data,error}=await team.storage.from('field-photos').download(remotePath);
if(!error&&data&&data.size>0){
cachePhotoBlob(photo.id,data,remotePath);
try{await setConfig('photo:'+remotePath,data);}catch{/* Display still works if optional image cache is full. */}
return data;
}
const {data:signedData,error:signError}=await team.storage.from('field-photos').createSignedUrl(remotePath,3600);
if(!signError&&signedData?.signedUrl){
const res=await fetch(signedData.signedUrl);
if(res.ok){
const signedBlob=await res.blob();
if(signedBlob&&signedBlob.size>0){
cachePhotoBlob(photo.id,signedBlob,remotePath);
try{await setConfig('photo:'+remotePath,signedBlob);}catch{/* Display still works if optional image cache is full. */}
return signedBlob;
}
}
}
throw error||signError||Error('تعذر تنزيل الصورة من التخزين السحابي');
}finally{
photoInflight.delete(key);
if(photo.id)photoInflight.delete(photo.id);
}
})();

photoInflight.set(key,task);
if(photo.id)photoInflight.set(photo.id,task);
return task;
}
export async function synchronizeTeam(onChange:(s:Site)=>void){
const m=await member();if(!m||m.force_password)return;
const run=async()=>{
for(const original of await list()){
if(!original.dirty){if(original.remotePending&&original.version){const completion=await team.rpc('field_complete_photos',{p_id:original.id,p_version:original.version});if(!completion.error&&completion.data){const completed=await mutate(original.id,latest=>({...latest,remotePending:false}));if(completed)onChange(completed);}}continue;}if(original.conflict)continue;
const key='team-operation:'+original.id;
let op=await config<Operation>(key);
if(!op||(op.site.revision||0)!==(original.revision||0)||op.site.photos.length!==original.photos.length){op={id:crypto.randomUUID(),site:original};await setConfig(key,op);}
const s=op.site;
const {data,error}=await team.rpc('field_save',{p_id:s.id,p_version:s.version||0,p_operation:op.id,p_data:payload(s)});
if(error)throw Error('تعذر الحفظ للفريق. النسخة المحلية محفوظة؛ ستُعاد المحاولة تلقائياً.');
if(data.deleted){if(!await config('deleted-backup:'+s.id))await setConfig('deleted-backup:'+s.id,await getSite(s.id));const archived=await mutate(s.id,x=>({...x,deletedAt:new Date().toISOString(),dirty:false}));if(archived)onChange(archived);await setConfig(key,null);continue;}
if(data.conflict){const latest=(await list()).find(x=>x.id===s.id)!;latest.conflict=data.remote;await put(latest);onChange(latest);await setConfig(key,null);continue;}
for(const photo of s.photos){if(!photo.blob.size)continue;const path=s.id+'/'+photo.id;const {error:uploadError}=await team.storage.from('field-photos').upload(path,photo.blob,{contentType:photo.blob.type||'image/jpeg',upsert:false});if(uploadError){if(String(uploadError.statusCode)!=='409'&& !/already exists|duplicate/i.test(uploadError.message))throw Error('لم يكتمل رفع الصور؛ محفوظة على الجهاز وستُعاد المحاولة.');const {data:exists,error:readError}=await team.storage.from('field-photos').download(path);if(readError||exists.size!==photo.blob.size)throw Error('تعذر التحقق من الصورة المرفوعة.');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await exists.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==photo.id)throw Error('محتوى الصورة المرفوعة غير مطابق؛ النسخة الأصلية باقية على الجهاز.');}}
const completion=await team.rpc('field_complete_photos',{p_id:s.id,p_version:data.version});if(completion.error)throw Error('تعذر تأكيد اكتمال الصور؛ ستُعاد المحاولة تلقائياً.');
const updated=await mutate(s.id,latest=>({...latest,createdName:data.created_name,createdBy:data.created_by,version:data.version,remotePending:!completion.data,dirty:(latest.revision||0)!==(s.revision||0),error:undefined,photos:latest.photos.map(p=>({...p,remotePath:s.photos.some(x=>x.id===p.id)?s.id+'/'+p.id:p.remotePath}))}));
await setConfig(key,null);if(updated)onChange(updated);
}
let offset=0;
while(true){const {data,error}=await team.from('field_sites').select('*').order('id').range(offset,offset+99);if(error)throw Error('تعذر جلب مواقع الفريق.');const cached=await list();for(const row of data as Row[]){const prev=cached.find(s=>s.id===row.id);if(row.deleted_at){const existing=prev||await getSite(row.id);if(existing?.deletedAt)continue;if(existing)await setConfig('deleted-backup:'+row.id,existing);const archived=local(row,existing);await put(archived);onChange(archived);continue;}if(prev?.dirty||prev?.conflict)continue;const s=local(row,prev);if(prev){const saved=await mutate(s.id,latest=>latest.dirty||latest.conflict?latest:local(row,latest));if(saved)onChange(saved);}else{await put(s);onChange(s);}}if(data.length<100)break;offset+=100;}
};
if(navigator.locks)await navigator.locks.request('raneen-team-sync',{ifAvailable:true},async lock=>{if(lock)await run();});else await run();
}
export async function resolveConflict(site:Site,choice:'local'|'remote'){
const remote=site.conflict as Row;if(!remote)return site;
await setConfig('conflict-backup:'+site.id+':'+Date.now(),site);
const result=choice==='remote'?local(remote,site):{...site,version:remote.version,conflict:undefined,dirty:true,updated:new Date().toISOString()};
await put(result);return result;
}

export async function deleteSite(site:Site){
if(!navigator.onLine)throw Error('الحذف يحتاج اتصالاً للتحقق من صلاحية المشرف.');
await synchronizeTeam(()=>{});const latest=(await list()).find(x=>x.id===site.id);if(!latest)return;if(latest.conflict||latest.dirty)throw Error('راجع التعديلات المعلقة قبل حذف الموقع.');
const run=async()=>{const {data,error}=await team.rpc('field_delete',{p_id:site.id,p_version:latest.version||0});if(error)throw Error('تعذر الحذف؛ تأكد من حفظ الموقع للفريق وعدم وجود تعديل أحدث ثم أعد المحاولة.');await setConfig('deleted-backup:'+site.id,site);await put(local(data,site));await setConfig('team-operation:'+site.id,null);};
if(navigator.locks)await navigator.locks.request('raneen-team-sync',run);else await run();
}
