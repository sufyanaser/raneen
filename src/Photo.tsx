import {memo,useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {photoBlob} from './team';
import type {Photo as PhotoType} from './store';

function Photo({photo,interactive=false,onRemove}:{photo:PhotoType;interactive?:boolean;onRemove?:()=>void}){
const [url,setUrl]=useState(''),[opened,setOpened]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
const {id,remotePath,blob,name}=photo;
useEffect(()=>{
let active=true,objectUrl='';
setUrl('');setError('');
void photoBlob({id,remotePath,blob,name}).then(data=>{if(active){objectUrl=URL.createObjectURL(data);setUrl(objectUrl);}}).catch(()=>{if(active)setError('تعذر تحميل الصورة. تحقق من الاتصال وأعد المحاولة.');});
return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
},[id,remotePath,blob,name,retry]);
useEffect(()=>{if(!opened)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpened(false);};window.addEventListener('keydown',close);return()=>{document.body.style.overflow=previous;window.removeEventListener('keydown',close);};},[opened]);
async function share(){try{const data=await photoBlob(photo);const file=new File([data],name||'صورة.jpg',{type:data.type||photo.mime||'image/jpeg'});if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'صورة الموقع'});}else setError('المشاركة غير مدعومة في هذا المتصفح؛ استخدم حفظ الصورة.');}catch(e){if((e as Error).name!=='AbortError')setError('تعذرت المشاركة؛ يمكنك حفظ الصورة.');}}
const image=url?<img src={url} alt="صورة العقار" loading="lazy"/>:<span className="noPhoto">{error||'جارٍ تحميل الصورة…'}</span>;
return <>{interactive?<button type="button" className="photoThumbnail" aria-label="فتح الصورة بالحجم الكامل" onClick={()=>setOpened(true)}>{image}</button>:image}{opened&&createPortal(<div className="photoViewer" role="dialog" aria-modal="true" aria-label="عرض صورة الموقع"><div className="photoViewerActions"><button autoFocus onClick={()=>setOpened(false)}>إغلاق ×</button>{url&&<a href={url} download={name||'صورة.jpg'}>حفظ الصورة</a>}<button disabled={!url} onClick={()=>void share()}>مشاركة</button>{onRemove&&<button type="button" className="photoDeleteBtn" onClick={()=>{setOpened(false);onRemove();}}>حذف الصورة</button>}</div>{url&&<img className="fullPhoto" src={url} alt="صورة الموقع بالحجم الكامل"/>}{error&&<p role="status">{error} <button onClick={()=>setRetry(n=>n+1)}>إعادة المحاولة</button></p>}<small>على iPhone يمكنك أيضاً الضغط مطولاً على الصورة لحفظها في الصور.</small></div>,document.body)}</>;
}

// Photo IDs are content hashes: identical content must keep its live object URL across sync refreshes.
export default memo(Photo,(a,b)=>a.interactive===b.interactive&&a.photo.id===b.photo.id&&a.photo.remotePath===b.photo.remotePath&&a.photo.name===b.photo.name&&a.photo.blob.size===b.photo.blob.size&&(a.onRemove===undefined)===(b.onRemove===undefined));
