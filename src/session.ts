import {team,type Member} from './team';
import {config,setConfig} from './store';
const cacheKey='verified-team-member';
const authKey='sb-'+new URL(import.meta.env.VITE_PUBLIC_SUPABASE_URL).hostname.split('.')[0]+'-auth-token';
function storedUser(){try{return JSON.parse(localStorage.getItem(authKey)||'null')?.user?.id as string|undefined;}catch{return undefined;}}
export async function restoreAccount():Promise<Member|null>{
const cached=await config<Member>(cacheKey);
const offlineAccount=()=>cached?.active&&cached.user_id===storedUser()?cached:null;
if(!navigator.onLine)return offlineAccount();
const {data:{session},error:sessionError}=await team.auth.getSession();
if(sessionError){if(offlineAccount())return offlineAccount();throw Error('تعذر استعادة الجلسة. ستُعاد المحاولة تلقائياً.');}
if(!session){await setConfig(cacheKey,null);return null;}
const {data,error,status}=await team.from('field_members').select('*').eq('user_id',session.user.id).single();
if(error){if(status===401||status===403||error.code==='PGRST116'||error.code==='42501'){await setConfig(cacheKey,null);throw Object.assign(Error('الحساب غير مخوّل لدخول فريق الرنين.'),{denied:true});}if(cached?.active&&cached.user_id===session.user.id)return cached;throw Error('تعذر التحقق من الدخول. ستُعاد المحاولة تلقائياً.');}
if(!data?.active){await setConfig(cacheKey,null);throw Object.assign(Error('الحساب معطل. تواصل مع المشرف.'),{denied:true});}
await setConfig(cacheKey,data);return data as Member;
}
export async function forgetAccount(){
await setConfig(cacheKey,null);
if(!navigator.onLine){localStorage.removeItem(authKey);void team.auth.signOut({scope:'local'}).catch(()=>{});return;}
try{if(navigator.onLine)await team.auth.signOut({scope:'local'});}finally{localStorage.removeItem(authKey);await team.auth.signOut({scope:'local'});}
}
