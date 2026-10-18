import {zip} from 'fflate';
import {team,photoBlob} from './team';
import {list,type Photo} from './store';
export async function downloadBackup(){
const {data,error}=await team.from('field_sites').select('*').order('id');if(error)throw error;
if(data.length>=1000)throw Error('السجل كبير؛ اطلب تصديراً كاملاً من مسؤول قاعدة البيانات.');
const files:Record<string,Uint8Array>={};const encoder=new TextEncoder();files['cloud-records.json']=encoder.encode(JSON.stringify(data,null,2));
const drafts=await list();files['local-drafts.json']=encoder.encode(JSON.stringify(drafts.map(s=>({...s,photos:s.photos.map(p=>({id:p.id,name:p.name,remotePath:p.remotePath}))})),null,2));
let bytes=0;
const manifest=new Set<string>();
for(const s of [...drafts,...data.map(row=>({id:row.id,photos:(row.data.photos as {id:string;name:string;mime:string}[]).map(p=>({...p,blob:new Blob([]),remotePath:row.id+'/'+p.id}))}))]){
for(const p of s.photos){const path=s.id+'/'+p.id;if(manifest.has(path))continue;const blob=await photoBlob(p as Photo);bytes+=blob.size;if(bytes>250*1024*1024)throw Error('يتجاوز الأرشيف 250 ميغابايت؛ يلزم تصدير من الخادم لتجنب امتلاء ذاكرة الهاتف.');files['photos/'+path]=new Uint8Array(await blob.arrayBuffer());manifest.add(path);}
}
const archive=await new Promise<Uint8Array>((resolve,reject)=>zip(files,{level:0},(error,data)=>error?reject(error):resolve(data)));
const url=URL.createObjectURL(new Blob([archive as BlobPart],{type:'application/zip'}));const a=document.createElement('a');a.href=url;a.download='raneen-backup-'+new Date().toISOString().slice(0,10)+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
