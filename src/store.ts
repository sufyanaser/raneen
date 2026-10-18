import {openDB} from 'idb';
export type Photo={id:string;blob:Blob;name:string;remotePath?:string;mime?:string;driveId?:string};
export type Site={createdName?:string;createdBy?:string;deletedAt?:string;id:string;name:string;street:string;date:string;updated:string;lat?:number;lng?:number;kind:string;position:string;dimensions:string;height?:string;width?:string;visibility:string;notes:string;owner:string;role:string;phone:string;contact:string;price:string;priceCurrency?:string;priority:string;next:string;photos:Photo[];dirty:boolean;account?:string;folderId?:string;photoFolderId?:string;dataId?:string;remotePending?:boolean;revision?:number;version?:number;conflict?:unknown;error?:string};
export type Cloud={account:string;root:string;field:string;sites:string;sheet:string};
const db=openDB('raneen-field',1,{upgrade(d){d.createObjectStore('sites',{keyPath:'id'});d.createObjectStore('config');}});
export const list=async():Promise<Site[]> =>(await (await db).getAll('sites')).filter(s=>!s.deletedAt).map(s=>!s.version&&!s.dirty?{...s,dirty:true}:s).sort((a,b)=>b.updated.localeCompare(a.updated));
export const put=async(s:Site)=>{const tx=(await db).transaction('sites','readwrite');const old=await tx.store.get(s.id);await tx.store.put({...s,deletedAt:old?.deletedAt||s.deletedAt,version:Math.max(s.version||0,old?.version||0)});await tx.done;};
export const mutate=async(id:string,fn:(s:Site)=>Site)=>{const tx=(await db).transaction('sites','readwrite');const old=await tx.store.get(id);if(!old){await tx.done;return undefined;}const value=fn(old);await tx.store.put(value);await tx.done;return value;};
export const getSite=async(id:string):Promise<Site|undefined>=>(await db).get('sites',id);
export const config=async<T>(k:string):Promise<T|undefined>=>(await db).get('config',k);
export const setConfig=async(k:string,v:unknown)=>{await(await db).put('config',v,k);};
export const fresh=():Site=>({id:crypto.randomUUID(),name:'',street:'',date:new Date().toISOString(),updated:new Date().toISOString(),kind:'تجاري',position:'واجهة',dimensions:'',height:'',width:'',visibility:'',notes:'',owner:'',role:'',phone:'',contact:'لم يتم التواصل',price:'',priceCurrency:'',priority:'متوسطة',next:'',photos:[],dirty:true});
export const maps=(s:Site)=>s.lat!==undefined&&s.lng!==undefined?`https://www.google.com/maps?q=${s.lat},${s.lng}`:'';

export const dimensionText=(s:Site)=>s.height||s.width?`ارتفاع ${s.height||'—'} × عرض ${s.width||'—'} متر`:s.dimensions;
export const priceText=(s:Site)=>[s.price,s.priceCurrency].filter(Boolean).join(' ');
