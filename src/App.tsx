import {Plus, SquaresFour, Camera, Images, MapPin, Check, Table, PencilSimple, SignOut, ArrowsClockwise, Phone, Trash} from '@phosphor-icons/react';
import React, {useEffect,useRef,useState} from 'react';
import {fresh,list,put,maps,dimensionText,priceText,type Site} from './store';
import {synchronizeTeam,deleteSite,resolveConflict,type Member} from './team';
import Map from './Map';
import {prepareImage} from './images';
import InstallApp from './InstallApp';
import Photo from './Photo';
import * as google from './google';

const toLatin=(s:string)=>s.replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const normalizeSearch=(s:string)=>toLatin(s).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').trim();
const phoneOk=(v:string)=>{const d=toLatin(v).replace(/[\s-]/g,'');return d===''||/^(07\d{9}|\+9647\d{9}|009647\d{9})$/.test(d);};
const numOk=(v:string)=>{const d=toLatin(v).trim();return d===''||/^\d+(\.\d+)?$/.test(d);};
const errorsOf=(s:Site):Partial<Record<keyof Site,string>>=>{const e:Partial<Record<keyof Site,string>>={};if(!s.name.trim())e.name='اسم العقار مطلوب.';if(!s.street.trim())e.street='حدد المنطقة أو الشارع.';if(!phoneOk(s.phone))e.phone='رقم هاتف عراقي غير صحيح (مثال: 07xxxxxxxxx).';if(!numOk(s.height||''))e.height='أدخل رقماً صحيحاً للارتفاع.';if(!numOk(s.width||''))e.width='أدخل رقماً صحيحاً للعرض.';if(!numOk(s.price))e.price='أدخل رقماً صحيحاً للتوقع المالي.';return e;};

export default function App({account,onLogout}:{account:Member;onLogout:()=>Promise<void>}){
const [sites,setSites]=useState<Site[]>([]),[site,setSite]=useState<Site|null>(null),[view,setView]=useState<'home'|'list'|'edit'|'details'>('home'),[message,setMessage]=useState(''),[busy]=useState(false),[online,setOnline]=useState(navigator.onLine),[query,setQuery]=useState('');
const [layout,setLayout]=useState<'cards'|'table'>('cards');
const [filterTab,setFilterTab]=useState<'all'|'pending'|'high'|'mine'>('all');
const [surveyorFilter,setSurveyorFilter]=useState('');
const [touched,setTouched]=useState<Partial<Record<keyof Site,boolean>>>({});
const [submitAttempted,setSubmitAttempted]=useState(false);
const [isSyncing,setIsSyncing]=useState(false);

useEffect(()=>{setTouched({});setSubmitAttempted(false);},[site?.id]);
const errors=site?errorsOf(site):{};
const storageFailed=useRef(false),syncing=useRef(false);
const autoSync=useRef<()=>void>(()=>{});
const syncTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
function scheduleSync(){clearTimeout(syncTimer.current);syncTimer.current=setTimeout(()=>autoSync.current(),2000);}
const current=useRef<Site|null>(null);current.current=site;const saveQueue=useRef(Promise.resolve());
const refresh=async()=>setSites(await list());
const [googleStatus,setGoogleStatus]=useState<'checking'|'disconnected'|'connected'|'unavailable'>('checking');
const [googleEmail,setGoogleEmail]=useState('');
const [googleBusy,setGoogleBusy]=useState(false);
function connectGoogle(){location.assign('/api/google/start');}
async function disconnectGoogle(){google.logout();try{await fetch('/api/google/logout',{method:'POST',credentials:'same-origin'});}catch{/* local state already cleared */}setGoogleStatus('disconnected');setGoogleEmail('');}
async function syncGoogleNow(){setGoogleBusy(true);try{const all=await list();let ok=0,fail=0;for(const s of all){try{await google.sync(s);ok++;}catch{fail++;}}setMessage(`نسخة Google Drive الشخصية: ${ok} موقع${fail?`، تعذر ${fail}`:''}.`);}catch(e){setMessage((e as Error).message);}finally{setGoogleBusy(false);}}

useEffect(()=>{const params=new URLSearchParams(location.search);const g=params.get('google');if(g){setMessage(g==='denied'?'رُفض إذن الاتصال بـ Google.':g==='invalid'?'انتهت صلاحية طلب الاتصال بـ Google؛ حاول مجدداً.':'تعذر الاتصال بـ Google Drive؛ حاول لاحقاً.');history.replaceState(null,'',location.pathname);}void google.resume().then(email=>{setGoogleEmail(email);setGoogleStatus('connected');}).catch(e=>setGoogleStatus((e as Error).message==='GOOGLE_SETUP_REQUIRED'?'unavailable':'disconnected'));},[]);
useEffect(()=>{void list().then(setSites);void navigator.storage?.persist?.();const change=()=>setOnline(navigator.onLine);window.addEventListener('online',change);window.addEventListener('offline',change);return()=>{window.removeEventListener('online',change);window.removeEventListener('offline',change);};},[]);

function save(s:Site){saveQueue.current=saveQueue.current.then(()=>put(s)).then(()=>{storageFailed.current=false;scheduleSync();}).catch(()=>{storageFailed.current=true;setMessage('تعذر الحفظ المحلي؛ مساحة الجهاز قد تكون ممتلئة. أبقِ الصفحة مفتوحة.');});return saveQueue.current;}
function update(p:Partial<Site>){if(!current.current)return;const s={...current.current,...p,revision:(current.current.revision||0)+1,updated:new Date().toISOString(),dirty:true,error:undefined};current.current=s;setSite(s);void save(s);}
async function open(s:Site,v:'edit'|'details'){await saveQueue.current;setSite(s);setView(v);setMessage('');}
async function back(){await saveQueue.current;if(storageFailed.current)return;await refresh();setView('list');setSite(null);}

async function addPhotos(files:FileList|null){
if(!files||!current.current)return;
const target=current.current.id;
try{
if(current.current!.photos.length+files.length>100)throw Error('الحد الأقصى 100 صورة للموقع.');
const photos=[];
for(const f of Array.from(files)){
const blob=await prepareImage(f);
const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');
photos.push({id:hash,blob,name:blob.type==='image/jpeg'?f.name.replace(/\.[^.]+$/,'')+'.jpg':f.name});
}
if(current.current?.id!==target)throw Error('أعد اختيار الصور من داخل سجل الموقع المقصود.');
const old=current.current.photos;
const seen=new Set(old.map(p=>p.id));
update({photos:[...old,...photos.filter(p=>{if(seen.has(p.id))return false;seen.add(p.id);return true;})]});
}catch(e){setMessage(String(e));}
}

function removePhoto(photoId:string){
if(!current.current)return;
const old=current.current.photos;
update({photos:old.filter(p=>p.id!==photoId)});
setMessage('تم حذف الصورة من المسودة.');
}

async function locate(){
const target=current.current?.id;
if(!navigator.geolocation){setMessage('الموقع غير متاح؛ حدد الدبوس على الخريطة.');return;}
setMessage('جارٍ تحديد الموقع عبر GPS…');
navigator.geolocation.getCurrentPosition(p=>{
if(current.current?.id!==target)return;
update({lat:p.coords.latitude,lng:p.coords.longitude});
setMessage(`تم تحديد الموقع بدقة نحو ${Math.round(p.coords.accuracy)} متر؛ يمكنك تصحيح الدبوس على الخريطة عند الحاجة.`);
},()=>setMessage('تعذر تحديد الموقع تلقائياً أو رُفض الإذن؛ اضغط على الخريطة لتحديده يدوياً.'),{enableHighAccuracy:true,timeout:20000,maximumAge:0});
}

autoSync.current=()=>{
if(syncing.current||!navigator.onLine)return;
if(account.force_password)return;
syncing.current=true;
setIsSyncing(true);
void saveQueue.current.then(()=>{
if(storageFailed.current)throw Error('تعذر الحفظ المحلي؛ أبقِ الصفحة مفتوحة.');
return synchronizeTeam(s=>{
if(current.current?.id===s.id){
if(s.deletedAt){current.current=null;setSite(null);setView('list');return;}
const active=current.current;
const next=active.dirty&&(active.revision||0)!==(s.revision||0)?{...active,version:s.version,conflict:s.conflict}:s;
current.current=next;
setSite(next);
}
});
}).then(()=>{setMessage('');return refresh();}).catch(e=>setMessage((e as Error).message)).finally(()=>{syncing.current=false;setIsSyncing(false);});
};

useEffect(()=>{const timer=window.setInterval(()=>autoSync.current(),15000);const resume=()=>autoSync.current();window.addEventListener('online',resume);window.addEventListener('focus',resume);return()=>{clearInterval(timer);clearTimeout(syncTimer.current);window.removeEventListener('online',resume);window.removeEventListener('focus',resume);};},[]);
useEffect(()=>{autoSync.current();},[]);

function triggerManualSync(){
if(!navigator.onLine){setMessage('لا يوجد اتصال بالإنترنت حالياً؛ البيانات محفوظة محلياً وستُزامن تلقائياً فور عودة الاتصال.');return;}
setMessage('جارٍ المزامنة مع الفريق…');
autoSync.current();
}

const allSurveyors=Array.from(new Set(sites.map(s=>s.createdName).filter(Boolean))) as string[];

const filteredSites=sites.filter(s=>{
if(filterTab==='pending'&&!s.dirty&&!s.remotePending)return false;
if(filterTab==='high'&&s.priority!=='عالية')return false;
if(filterTab==='mine'&&s.createdBy!==account.user_id)return false;
if(surveyorFilter&&s.createdName!==surveyorFilter)return false;
if(!query.trim())return true;
const q=normalizeSearch(query);
const text=normalizeSearch([s.name,s.street,s.owner,s.phone,s.createdName,s.kind,s.position,s.notes].filter(Boolean).join(' '));
return text.includes(q);
});

const input=(key:keyof Site,label:string,type:'text'|'tel'|'decimal'='text')=>{
const id=`f-${key}`;
const err=errors[key];
const show=!!err&&(touched[key]||submitAttempted);
return <div className={`field${show?' field-error':''}`}><input id={id} type={type==='decimal'?'text':type} inputMode={type==='decimal'?'decimal':type==='tel'?'tel':undefined} autoComplete={type==='tel'?'tel':undefined} value={String(site?.[key]??'')} placeholder=" " onChange={e=>update({[key]:e.target.value})} onBlur={()=>setTouched(t=>({...t,[key]:true}))} dir={type==='tel'||type==='decimal'?'ltr':undefined} aria-invalid={show||undefined} aria-describedby={show?`${id}-msg`:undefined}/><label htmlFor={id} className="flabel">{label}</label>{show&&<p id={`${id}-msg`} className="fieldMsg" role="alert">{err}</p>}</div>;
};

const select=(key:keyof Site,label:string,choices:string[])=>{
const id=`f-${key}`;
const value=String(site?.[key]??'');
const err=errors[key];
const show=!!err&&(touched[key]||submitAttempted);
return <div className={`field field-select${show?' field-error':''}`}><label htmlFor={id} className="flabel flabel-static">{label}</label><select id={id} aria-label={label} value={value} onChange={e=>update({[key]:e.target.value})} onBlur={()=>setTouched(t=>({...t,[key]:true}))} aria-invalid={show||undefined} aria-describedby={show?`${id}-msg`:undefined}>{Array.from(new Set([...choices,...(value?[value]:[])])).map(c=><option key={c||'—'} value={c}>{c||'—'}</option>)}</select>{show&&<p id={`${id}-msg`} className="fieldMsg" role="alert">{err}</p>}</div>;
};

return <>
<header>
<div className="brand">
<img className="brandSymbol" src="/ooh/field/brand/raneen-symbol.svg" alt=""/>
<div>
<img className="brandWordmark" src="/ooh/field/brand/raneen-lockup.svg" alt="الرنين — RANEEN"/>
<small>الكشف الميداني للعقارات</small>
</div>
</div>
</header>
<main>
<div className="statusRow">
<div className="status">
<span className={online?'dot':'dot offline'}/>
<span>{online?'متصل بالإنترنت':'دون إنترنت — الحفظ المحلي نشط'}</span>
</div>
{online&&<button type="button" className="syncNowBtn" disabled={isSyncing} onClick={triggerManualSync} title="تحديث ومزامنة فورية مع قاعدة البيانات"><ArrowsClockwise size={15} className={isSyncing?'spin':''}/> {isSyncing?'جارٍ المزامنة…':'مزامنة الآن'}</button>}
</div>

<div className="accountBar">
<div className="accountInfo">
<strong>{account.display_name}</strong>
<span>{account.role==='admin'?'مشرف الفريق':'عضو ميداني'}</span>
</div>
<button className="smallButton logoutBtn" aria-label="تسجيل الخروج" title="تسجيل الخروج" onClick={()=>{void saveQueue.current.then(()=>{if(!storageFailed.current)return onLogout();});}}>
<SignOut size={16}/> خروج
</button>
{account.role==='admin'&&<button className="smallButton backupBtn" onClick={()=>{setMessage('جارٍ إعداد الأرشيف الشامل للمواقع والصور…');void import('./backup').then(m=>m.downloadBackup()).then(()=>setMessage('تم تنزيل الأرشيف بنجاح.')).catch(e=>setMessage((e as Error).message));}}>نسخة احتياطية (ZIP)</button>}
</div>

{googleStatus==='connected'?<div className="accountBar driveBar"><span dir="ltr">Drive: {googleEmail}</span><button className="smallButton" disabled={googleBusy} onClick={()=>void syncGoogleNow()}>{googleBusy?'جارٍ المزامنة…':'نسخة Drive'}</button><button className="smallButton secondary" onClick={()=>void disconnectGoogle()}>قطع الاتصال</button></div>:googleStatus==='disconnected'?<div className="accountBar driveBar"><button className="smallButton secondary" onClick={connectGoogle}>ربط Google Drive للنسخ الشخصي</button></div>:null}

<InstallApp/>
{message&&<p role="status" className="notice">{message}</p>}

{view==='home'?<div className="home">
<div className="brandSeal"><img src="/ooh/field/brand/raneen-symbol.svg" alt="شعار الرنين"/></div>
<small>الرنين · الأنبار</small>
<h1>الكشف الميداني</h1>
<p>توثيق مواقع العقارات الخارجية، قياسات اللوحات، وبيانات التواصل للمتابعة والتعاقد.</p>
<div className="homeActions">
<button className="homeAction" aria-label="إضافة موقع جديد" disabled={busy} onClick={()=>{const s={...fresh(),createdName:account.display_name,createdBy:account.user_id};setSite(s);setView('edit');setMessage('');void save(s);}}>
<Plus size={22} aria-hidden="true"/><strong>إضافة موقع</strong>
</button>
<button className="homeAction secondary" aria-label="استعراض المواقع" disabled={busy} onClick={()=>{void refresh().then(()=>{setView('list');setMessage('');});}}>
<SquaresFour size={22} aria-hidden="true"/><strong>المواقع ({sites.length})</strong>
</button>
</div>
</div>:view==='list'?<>
<button className="back" onClick={()=>{setView('home');setMessage('');}}>→ الرئيسية</button>
<div className="title">
<div>
<h1>سجل المواقع</h1>
<p>{sites.length} عقار مسجل للفريق</p>
</div>
<button disabled={busy} className="primaryTitleBtn" onClick={()=>{const s={...fresh(),createdName:account.display_name,createdBy:account.user_id};setSite(s);setView('edit');setMessage('');void save(s);}} aria-label="إضافة موقع جديد">
<Plus size={18} aria-hidden="true"/> إضافة عقار
</button>
</div>

<div className="metricsBar">
<div className="metricCard">
<strong>{sites.length}</strong>
<span>إجمالي العقارات</span>
</div>
<div className="metricCard">
<strong>{sites.filter(s=>!s.dirty&&!s.remotePending).length}</strong>
<span>متزامن للفريق</span>
</div>
<div className="metricCard">
<strong className={sites.some(s=>s.dirty||s.remotePending)?'highlight':''}>{sites.filter(s=>s.dirty||s.remotePending).length}</strong>
<span>معلق محلياً</span>
</div>
<div className="metricCard">
<strong>{sites.filter(s=>s.priority==='عالية').length}</strong>
<span>أولوية عالية</span>
</div>
</div>

<div className="filterTabs" role="tablist" aria-label="تصفية المواقع">
<button role="tab" aria-selected={filterTab==='all'} className={`filterTab${filterTab==='all'?' active':''}`} onClick={()=>setFilterTab('all')}>الكل ({sites.length})</button>
<button role="tab" aria-selected={filterTab==='pending'} className={`filterTab${filterTab==='pending'?' active':''}`} onClick={()=>setFilterTab('pending')}>⏳ معلق ({sites.filter(s=>s.dirty||s.remotePending).length})</button>
<button role="tab" aria-selected={filterTab==='high'} className={`filterTab${filterTab==='high'?' active':''}`} onClick={()=>setFilterTab('high')}>⭐ عالية ({sites.filter(s=>s.priority==='عالية').length})</button>
<button role="tab" aria-selected={filterTab==='mine'} className={`filterTab${filterTab==='mine'?' active':''}`} onClick={()=>setFilterTab('mine')}>👤 عقاراتي ({sites.filter(s=>s.createdBy===account.user_id).length})</button>
</div>

<div className="toolbar">
<input aria-label="البحث عن موقع" placeholder="ابحث بالاسم، الشارع، المالك، الهاتف، أو الموظف…" value={query} onChange={e=>setQuery(e.target.value)}/>
</div>

{allSurveyors.length>1&&<div className="surveyorFilter">
<label htmlFor="f-surveyor">تصفية بحسب الموظف:</label>
<select id="f-surveyor" value={surveyorFilter} onChange={e=>setSurveyorFilter(e.target.value)}>
<option value="">جميع الموظفين ({allSurveyors.length})</option>
{allSurveyors.map(name=><option key={name} value={name}>{name}</option>)}
</select>
</div>}

<div className="viewToggle" role="group" aria-label="طريقة عرض المواقع">
<button aria-pressed={layout==='cards'} onClick={()=>setLayout('cards')}><SquaresFour size={18} aria-hidden="true"/> بطاقات</button>
<button aria-pressed={layout==='table'} onClick={()=>setLayout('table')}><Table size={18} aria-hidden="true"/> جدول</button>
</div>

{sites.length===0?<section className="empty">
<MapPin size={40} aria-hidden="true"/>
<h2>لا توجد مواقع مسجلة بعد</h2>
<p>اضغط على زر «إضافة عقار» لبدء توثيق أول موقع ميداني.</p>
</section>:filteredSites.length===0?<section className="empty">
<p>لا توجد نتائج تطابق خيارات البحث والتصفية المحددة.</p>
</section>:layout==='cards'?<div className="siteCards">
{filteredSites.map(s=><button className="card siteCard" key={s.id} disabled={busy} onClick={()=>void open(s,'details')}>
<div className="cover">
{s.photos[0]?<Photo key={s.photos[0].id} photo={s.photos[0]}/>:<span className="noPhoto">لا توجد صورة</span>}
<div className="cardSyncBadge">
{s.conflict?<span className="badge badgeConflict">⚠️ تعارض</span>:s.dirty?<span className="badge badgePending">⏳ حفظ محلي</span>:s.remotePending?<span className="badge badgeUploading">☁️ رفع الصور</span>:<span className="badge badgeSynced">✓ متزامن</span>}
</div>
</div>
<div className="cardBody">
<h2>{s.name||'مسودة بلا اسم'}</h2>
<p className="cardSurveyor">أضافه: <strong>{s.createdName||'غير محدد'}</strong></p>
<p className="cardStreet">{s.street||'لم تُحدد المنطقة'}</p>
<div className="meta">
<span>📷 {s.photos.length} صور</span>
<span className={`priorityTag priority-${s.priority}`}>{s.priority}</span>
</div>
</div>
</button>)}
</div>:<div className="tableScroll">
<table className="sitesTable">
<thead>
<tr>
<th>الموقع</th>
<th>المنطقة</th>
<th>الأولوية</th>
<th>الحالة</th>
<th>تاريخ الكشف</th>
<th>أضافه</th>
</tr>
</thead>
<tbody>
{filteredSites.map(s=><tr key={s.id}>
<td>
<button disabled={busy} className="tableSite" aria-label={s.name||'مسودة بلا اسم'} onClick={()=>void open(s,'details')}>
{s.photos[0]&&<Photo key={s.photos[0].id} photo={s.photos[0]}/>}
<span>{s.name||'مسودة بلا اسم'}</span>
</button>
</td>
<td>{s.street||'—'}</td>
<td><span className={`priorityTag priority-${s.priority}`}>{s.priority}</span></td>
<td>{s.dirty?'⏳ معلق':s.remotePending?'☁️ رفع الصور':'✓ متزامن'}</td>
<td>{new Date(s.date).toLocaleDateString('ar-IQ')}</td>
<td>{s.createdName||'غير محدد'}</td>
</tr>)}
</tbody>
</table>
</div>}
</>:site&&<>
<button className="back" disabled={busy} onClick={()=>void back()}>→ العودة للمواقع</button>
<h1>{view==='edit'?'بيانات الكشف الميداني':site.name||'مسودة بلا اسم'}</h1>
<p className="id" dir="ltr">ID: {site.id}</p>
<div className="syncStatusNotice">
{site.conflict?<span className="badge badgeConflict">⚠️ يوجد تعديل من زميل آخر يحتاج اعتماد أحد الخيارين</span>:site.remotePending?<span className="badge badgeUploading">☁️ البيانات محفوظة للفريق؛ بانتظار اكتمال رفع الصور</span>:site.dirty?<span className="badge badgePending">⏳ محفوظ على الجهاز — بانتظار المزامنة مع خادم الفريق</span>:<span className="badge badgeSynced">✓ تم حفظ البيانات والصور بنجاح في قاعدة بيانات الفريق</span>}
</div>

{!!site.conflict&&<section className="notice conflictNotice">
<h2>عدّل زميل هذا الموقع في نفس الوقت</h2>
<p>لن يُستبدل أي تعديل تلقائياً لحماية عملك وعمل زملائك. اختر النسخة التي تريد اعتمادها؛ تُحفظ نسخة احتياطية من التعديلين تلقائياً.</p>
<pre>{JSON.stringify((site.conflict as {data:unknown}).data,null,2)}</pre>
<div className="conflictActions">
<button onClick={()=>{void resolveConflict(site,'remote').then(s=>{setSite(s);current.current=s;void refresh();});}}>اعتماد نسخة الفريق السحابية</button>
<button className="secondary" onClick={()=>{void resolveConflict(site,'local').then(s=>{setSite(s);current.current=s;scheduleSync();});}}>اعتماد تعديلاتي المحلية بدلاً منها</button>
</div>
</section>}

{view==='edit'?<fieldset disabled={busy}>
{submitAttempted&&Object.keys(errors).length>0&&<section className="errSummary" role="alert">
<h2>يرجى تصحيح الحقول التالية قبل الحفظ:</h2>
<ul>
{Object.entries(errors).map(([k,v])=><li key={k}><a href={`#f-${k}`} onClick={e=>{e.preventDefault();document.getElementById(`f-${k}`)?.focus();}}>{v as string}</a></li>)}
</ul>
</section>}

<section>
<h2><b>١</b> الموقع والإحداثيات</h2>
{input('name','اسم العقار أو المعلم الرئيسي *')}
{input('street','المنطقة أو الشارع أو الحي *')}
<div className="gpsActionRow">
<button type="button" className="gpsBtn" onClick={()=>void locate()}>
<MapPin size={20} aria-hidden="true"/> تحديد موقعي الحالي عبر GPS
</button>
</div>
<p className="hint">انقر على الخريطة في أي مكان لتحريك الدبوس بدقة وتصحيح الموقع.</p>
<Map lat={site.lat} lng={site.lng} onChange={(lat,lng)=>update({lat,lng})}/>
<p className="coordDisplay" dir="ltr">{site.lat?`${site.lat.toFixed(6)}, ${site.lng?.toFixed(6)}`:'لم يتم تحديد الإحداثيات بعد'}</p>
</section>

<section>
<h2><b>٢</b> صور العقار ({site.photos.length} / 100)</h2>
<div className="photoActions">
<label className="fileButton">
<Camera size={22} aria-hidden="true"/> التقاط بالكاميرا
<input type="file" accept="image/*" capture="environment" onChange={e=>{void addPhotos(e.target.files);e.target.value='';}}/>
</label>
<label className="fileButton secondary">
<Images size={22} aria-hidden="true"/> اختيار من الألبوم
<input type="file" accept="image/*" multiple onChange={e=>{void addPhotos(e.target.files);e.target.value='';}}/>
</label>
</div>
{site.photos.length>0?<div className="photos">
{site.photos.map(p=><div key={p.id} className="photoItem">
<Photo photo={p} interactive onRemove={()=>removePhoto(p.id)}/>
<button type="button" className="removePhotoBadge" title="حذف هذه الصورة" aria-label="حذف الصورة" onClick={()=>removePhoto(p.id)}>
<Trash size={14}/>
</button>
</div>)}
</div>:<p className="noPhotosHint">التقط صوراً واضحة للواجهة وزاوية الرؤية وحركة المرور.</p>}
</section>

<section>
<h2><b>٣</b> تفاصيل العقار وموقع الإعلان</h2>
<div className="grid">
{select('kind','نوع العقار',['تجاري','سكني','مختلط','حكومي / عام','أرض فضاء / موقع مفتوح','طريق سريع'])}
{select('position','موضع الإعلان',['واجهة','جانب (جدارية)','سطح','عمود أحادي (يونيبول)','جسر مشاة','شاشة رقمية','سياج'])}
</div>
<div className="dimensionsGrid">
{input('height','الارتفاع التقريبي (متر) — اختياري','decimal')}
{input('width','العرض التقريبي (متر) — اختياري','decimal')}
</div>
{site.dimensions&&<p className="legacyDimensions">القياس المسجل سابقاً: {site.dimensions}</p>}
{select('visibility','وضوح الإعلان والرؤية',['','واضح جداً (مواجه للمرور)','جيد جداً','جيد','متوسط','ضعيف / محجوب جزئياً'])}
<label>
العوائق والملاحظات الميدانية
<textarea value={site.notes} placeholder="أشجار، أعمدة كهرباء، اتجاه السير، كثافة المارة، ملاحظات خاصة…" onChange={e=>update({notes:e.target.value})}/>
</label>
</section>

<section>
<h2><b>٤</b> بيانات المالك أو المخوّل <small>(اختياري)</small></h2>
{input('owner','اسم المالك أو الشخص المخوّل')}
{select('role','الصفة القانونية',['','مالك العقار','مخوّل بالإدارة','وكيل أو وسيط','مستأجر الموقع','جهة حكومية / بلدية','أخرى'])}
{input('phone','رقم الهاتف (عراقي: 07xxxxxxxxx)','tel')}
{select('contact','حالة التواصل والمفاوضة',['لم يتم التواصل','تم التواصل الأولي','بانتظار الرد أو السعر','موافقة مبدئية','تم الاتفاق / التعاقد','تم الرفض'])}
<div className="grid amountGrid">
{input('price','التوقع المالي للإيجار السنوي — اختياري','decimal')}
{select('priceCurrency','العملة',['','دينار عراقي','دولار أمريكي'])}
</div>
</section>

<section>
<h2><b>٥</b> قرار المتابعة والتقييم</h2>
<div className="grid">
{select('priority','أولوية الموقع',['عالية','متوسطة','استبعاد'])}
{select('next','الخطوة التالية',['','الاتصال بالمالك','إعادة زيارة الموقع','رفع قياسات هندسية','طلب عرض مالي','إعداد مسودة عقد','مراجعة المشرف','استبعاد / لا متابعة','أخرى'])}
</div>
</section>

<div className="sticky">
<button type="button" className="primary saveBtn" onClick={()=>{
setSubmitAttempted(true);
if(site&&Object.keys(errorsOf(site)).length>0){setMessage('يرجى تصحيح الحقول المظللة باللون الأحمر قبل الحفظ.');return;}
void saveQueue.current.then(()=>{
if(storageFailed.current)return;
setView('details');
setMessage('تم حفظ العقار بنجاح على هذا الجهاز؛ وتجري المزامنة التلقائية مع الفريق فور توفر الاتصال.');
});
}}>
<Check size={20} aria-hidden="true"/> حفظ واعتماد الكشف
</button>
</div>
</fieldset>:<>
<section className="detailsSection">
<div className="detailActions">
<button disabled={busy} onClick={()=>setView('edit')} className="primary">
<PencilSimple size={18} aria-hidden="true"/> تعديل وإضافة صور
</button>
{account.role==='admin'&&<button className="secondary deleteBtn" onClick={()=>{if(!window.confirm('هل أنت متأكد من حذف موقع «'+(site.name||'مسودة بلا اسم')+'» من قاعدة بيانات الفريق نهائياً؟'))return;void saveQueue.current.then(()=>deleteSite(current.current!)).then(()=>back()).catch(e=>setMessage((e as Error).message));}}>
<Trash size={18} aria-hidden="true"/> حذف الموقع
</button>}
</div>

<dl className="detailsList">
<div><dt>المسؤول الميداني</dt><dd><strong>{site.createdName||'غير محدد'}</strong></dd></div>
<div><dt>المنطقة والشارع</dt><dd>{site.street||'—'}</dd></div>
<div><dt>تاريخ الكشف</dt><dd>{new Date(site.date).toLocaleString('ar-IQ')}</dd></div>
<div><dt>تصنيف العقار</dt><dd>{site.kind} · {site.position}</dd></div>
<div><dt>الأبعاد المقدرة</dt><dd>{dimensionText(site)||'—'}</dd></div>
<div><dt>وضوح الرؤية</dt><dd>{site.visibility||'—'}</dd></div>
<div><dt>الملاحظات الميدانية</dt><dd>{site.notes||'—'}</dd></div>
<div><dt>المالك / المخوّل</dt><dd>{site.owner||'—'}</dd></div>
<div><dt>الصفة</dt><dd>{site.role||'—'}</dd></div>
<div>
<dt>رقم الهاتف</dt>
<dd>
{site.phone?(
<div className="phoneActions">
<a href={`tel:${toLatin(site.phone).replace(/[\s-]/g,'')}`} className="phoneBtn" title="اتصال هاتفي">
<Phone size={15}/> {site.phone}
</a>
<a href={`https://wa.me/${toLatin(site.phone).replace(/[\s-]/g,'').replace(/^0/,'964').replace(/^\+/,'')}`} target="_blank" rel="noreferrer" className="whatsappBtn" title="محادثة واتساب">
💬 واتساب
</a>
</div>
):'—'}
</dd>
</div>
<div><dt>حالة التواصل</dt><dd>{site.contact||'—'}</dd></div>
<div><dt>التوقع المالي</dt><dd>{priceText(site)||'—'}</dd></div>
<div><dt>الأولوية</dt><dd><span className={`priorityTag priority-${site.priority}`}>{site.priority}</span></dd></div>
<div><dt>الخطوة التالية</dt><dd>{site.next||'—'}</dd></div>
</dl>

{maps(site)&&<div className="mapDetailBlock">
<h3>موقع العقار على الخريطة:</h3>
<Map lat={site.lat} lng={site.lng}/>
<a href={maps(site)} target="_blank" rel="noreferrer" className="mapsExternalLink">
فتح في تطبيق Google Maps ↗
</a>
</div>}

{site.folderId&&<p className="driveLink">
<a href={`https://drive.google.com/drive/folders/${site.folderId}`} target="_blank" rel="noreferrer">
فتح مجلد العقار في Google Drive ↗
</a>
</p>}

<h3>صور العقار المرفقة ({site.photos.length}):</h3>
{site.photos.length>0?<div className="photos">
{site.photos.map(p=><Photo key={p.id} photo={p} interactive/>)}
</div>:<p className="noPhotosHint">لا توجد صور مرفقة لهذا العقار.</p>}
</section>
</>}
</>}
<footer>
الرنين · منظومة الكشف الميداني للعقارات الخارجية (OOH)<br/>
البيانات محفوظة على هذا الجهاز بشكل دائم ومحمية من الضياع.
</footer>
</main>
</>;
}
