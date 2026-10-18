import {dimensionText,priceText} from './store';
import {config,setConfig,put,maps,list,type Cloud,type Site} from './store';
type Token={access_token:string;expires_in:number;error?:string};
declare global {interface Window {google?:{accounts:{oauth2:{initTokenClient:(c:{client_id:string;scope:string;callback:(t:Token)=>void;error_callback:()=>void})=>{requestAccessToken:(options?:{prompt:string})=>void}}}}}}
let token='',expires=0,account='';
export const connected=()=>!!token&&Date.now()<expires;
export async function login(client:string,silent=false){
if(!client.endsWith('.apps.googleusercontent.com'))throw Error('أدخل معرّف عميل OAuth صالحاً.');
if(!window.google){await new Promise<void>((resolve,reject)=>{const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.onload=()=>resolve();s.onerror=()=>reject(Error('تعذر تحميل تسجيل Google؛ تحقق من الاتصال.'));document.head.append(s);});}
const t=await new Promise<Token>((resolve,reject)=>window.google!.accounts.oauth2.initTokenClient({client_id:client,scope:'openid email https://www.googleapis.com/auth/drive.file',callback:r=>r.error?reject(Error(r.error)):resolve(r),error_callback:()=>reject(Error('أُغلقت نافذة Google أو رُفض الإذن.'))}).requestAccessToken(silent?{prompt:''}:undefined));
token=t.access_token;expires=Date.now()+(t.expires_in-60)*1000;
const u=await api('https://www.googleapis.com/oauth2/v3/userinfo');account=u.sub;return u.email as string;
}
let renewing:Promise<string>|undefined;
export function resume(client=''):Promise<string>{
if(renewing)return renewing;
renewing=(async()=>{
const response=await fetch('/api/google/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'}});
if(response.status===401)throw Error('GOOGLE_CONSENT_REQUIRED');
if(response.status===503||response.status===404){if(client){try{return await login(client,true);}catch{throw Error('GOOGLE_LEGACY_CONFIRM_REQUIRED');}}throw Error('GOOGLE_SETUP_REQUIRED');}
if(!response.ok)throw Error('تعذر استعادة جلسة Google؛ ستبقى البيانات محفوظة على الجهاز.');
const data=await response.json() as Token;token=data.access_token;expires=Date.now()+(data.expires_in-60)*1000;
const u=await api('https://www.googleapis.com/oauth2/v3/userinfo');account=u.sub;return u.email as string;
})().finally(()=>{renewing=undefined;});return renewing;
}
export function logout(){token='';expires=0;account='';}
async function api(url:string,init:RequestInit={}){
if(!connected())throw Error('انتهت جلسة Google؛ أعد الاتصال. مسوداتك محفوظة.');
const r=await fetch(url,{...init,headers:{Authorization:`Bearer ${token}`,...init.headers}});
if(r.status===401){logout();throw Error('انتهت جلسة Google؛ أعد الاتصال.');}
if(!r.ok)throw Error(`تعذرت المزامنة (${r.status}). أعد المحاولة؛ النسخة المحلية محفوظة.`);
return r.status===204?{}:r.json();
}
const drive='https://www.googleapis.com/drive/v3/files';
async function find(key:string,parent?:string){const q=`trashed = false and appProperties has { key='raneenKey' and value='${key}' }${parent?` and '${parent}' in parents`:''}`;return(await api(`${drive}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1000`)).files as {id:string;name:string}[];}
async function ensure(key:string,name:string,mime:string,parent?:string){const old=await find(key,parent);if(old.length>1)throw Error('وُجد تعارض في ملفات Google؛ يلزم فحصه قبل المتابعة.');if(old[0])return old[0].id;return(await api(drive,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,mimeType:mime,parents:parent?[parent]:undefined,appProperties:{raneenKey:key}})})).id as string;}
const folder='application/vnd.google-apps.folder';
export async function cloud(){let c=await config<Cloud>(`cloud:${account}`);if(c)return c;const root=await ensure('root','الرنين — الإعلانات الخارجية',folder);const field=await ensure('field','الكشف الميداني',folder,root);const sites=await ensure('sites','المواقع',folder,field);const sheet=await ensure('register','سجل المواقع','application/vnd.google-apps.spreadsheet',field);c={account,root,field,sites,sheet};await setConfig(`cloud:${account}`,c);return c;}
const headers=['المعرف','الاسم','المنطقة أو الشارع','تاريخ الكشف','خط العرض','خط الطول','الخرائط','نوع العقار','موضع الإعلان','الأبعاد','الوضوح','الملاحظات','المالك','الصفة','الهاتف','التواصل','المقابل','الأولوية','الخطوة التالية','المجلد','الصور','آخر تعديل'];
export async function sync(s:Site){
if(s.account&&s.account!==account)throw Error('هذا العقار مرتبط بحساب Google آخر؛ اتصل بالحساب الأصلي.');
const c=await cloud();s.account=account;await put(s);
s.folderId=await ensure(`site:${s.id}`,`${s.id} — ${s.name||'مسودة'}`,folder,c.sites);await put(s);
await api(`${drive}/${s.folderId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:`${s.id} — ${s.name||'مسودة'}`})});
s.photoFolderId=await ensure(`photos:${s.id}`,'الصور',folder,s.folderId);await put(s);
for(const p of s.photos){if(p.driveId)continue;p.driveId=await ensure(`photo:${s.id}:${p.id}`,p.name,p.blob.type||'application/octet-stream',s.photoFolderId);await put(s);
// Retry also updates the reserved file after an interrupted content upload.
}
for(const p of s.photos){const done=await config<boolean>(`uploaded:${account}:${p.driveId}`);if(done)continue;await api(`https://www.googleapis.com/upload/drive/v3/files/${p.driveId}?uploadType=media`,{method:'PATCH',headers:{'Content-Type':p.blob.type||'application/octet-stream'},body:p.blob});await setConfig(`uploaded:${account}:${p.driveId}`,true);}
s.dataId=await ensure(`data:${s.id}`,'بيانات العقار.json','application/json',s.folderId);await put(s);
const data={...s,photos:s.photos.map(p=>({id:p.id,name:p.name,driveId:p.driveId,url:`https://drive.google.com/file/d/${p.driveId}/view`}))};
await api(`https://www.googleapis.com/upload/drive/v3/files/${s.dataId}?uploadType=media`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data,null,2)});
const sheet=await api(`https://sheets.googleapis.com/v4/spreadsheets/${c.sheet}?fields=sheets.properties`);const title=sheet.sheets[0].properties.title as string;const base=`https://sheets.googleapis.com/v4/spreadsheets/${c.sheet}/values/`;const range=(r:string)=>encodeURIComponent(`'${title.replaceAll("'","''")}'!${r}`);
await api(`${base}${range('A1:V1')}?valueInputOption=RAW`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:[headers]})});
const ids=(await api(`${base}${range('A:A')}`)).values as string[][]||[];const matches=ids.flatMap((v,i)=>v[0]===s.id?[i+1]:[]);if(matches.length>1)throw Error('يوجد أكثر من صف لهذا المعرف؛ يلزم إصلاح السجل.');
const row=[s.id,s.name,s.street,s.date,s.lat??'',s.lng??'',maps(s),s.kind,s.position,dimensionText(s),s.visibility,s.notes,s.owner,s.role,s.phone,s.contact,priceText(s),s.priority,s.next,`https://drive.google.com/drive/folders/${s.folderId}`,s.photos.map(p=>`https://drive.google.com/file/d/${p.driveId}/view`).join('\n'),s.updated];
const n=matches[0]||Math.max(ids.length+1,2);await api(`${base}${range(`A${n}:V${n}`)}?valueInputOption=RAW`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:[row]})});
// Drive sync is a personal backup mirror, not the team record — never touch s.dirty/s.error here; that belongs to Supabase team sync.
await put(s);return c;
}
export async function restore(){
const c=await cloud();const existing=await list();let page='';
do {const q="trashed = false and mimeType = 'application/json' and appProperties has { key='raneenKey' }";const result=await api(`${drive}?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,appProperties)&pageSize=1000${page?`&pageToken=${encodeURIComponent(page)}`:''}`);
for(const f of result.files){if(!f.appProperties?.raneenKey?.startsWith('data:'))continue;const r=await fetch(`${drive}/${f.id}?alt=media`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw Error('تعذر استعادة بيانات العقارات.');const s=await r.json() as Site;if(s.account!==account)continue;const local=existing.find(x=>x.id===s.id);if(local?.dirty||local&&local.updated>=s.updated)continue;
for(const p of s.photos){const old=local?.photos.find(x=>x.id===p.id);if(old){p.blob=old.blob;continue;}const photo=await fetch(`${drive}/${p.driveId}?alt=media`,{headers:{Authorization:`Bearer ${token}`}});if(!photo.ok)throw Error('تعذر استعادة إحدى الصور.');p.blob=await photo.blob();}s.dirty=false;s.error=undefined;await put(s);
}page=result.nextPageToken||'';}while(page);return c;
}
