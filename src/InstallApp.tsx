import {useEffect,useState} from 'react';
import {DownloadSimple,X} from '@phosphor-icons/react';
interface InstallPrompt extends Event{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>}
let deferredInstall:InstallPrompt|null=null;
const standalone=()=>matchMedia('(display-mode: standalone)').matches||matchMedia('(display-mode: fullscreen)').matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);
export default function InstallApp(){
const [installed,setInstalled]=useState(()=>standalone()||localStorage.getItem('raneen-installed')==='1'),[prompt,setPrompt]=useState<InstallPrompt|null>(()=>deferredInstall),[help,setHelp]=useState(false);
const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
useEffect(()=>{const media=matchMedia('(display-mode: standalone)');const update=()=>{if(standalone()){localStorage.setItem('raneen-installed','1');setInstalled(true);}};update();const capture=(e:Event)=>{e.preventDefault();deferredInstall=e as InstallPrompt;setPrompt(deferredInstall);};const added=()=>{localStorage.setItem('raneen-installed','1');setInstalled(true);deferredInstall=null;setPrompt(null);setHelp(false);};window.addEventListener('beforeinstallprompt',capture);window.addEventListener('appinstalled',added);media.addEventListener('change',update);return()=>{window.removeEventListener('beforeinstallprompt',capture);window.removeEventListener('appinstalled',added);media.removeEventListener('change',update);};},[]);
if(installed||(!mobile&&!prompt))return null;
async function install(){if(!prompt){setHelp(true);return;}await prompt.prompt();const result=await prompt.userChoice;deferredInstall=null;setPrompt(null);if(result.outcome==='accepted')setInstalled(true);}
return <div className="installApp"><button className="secondary" onClick={()=>void install()}><DownloadSimple size={20} aria-hidden="true"/>إضافة التطبيق</button>{help&&<section role="dialog" aria-modal="true" aria-label="تثبيت التطبيق" className="installHelp"><button className="smallButton" aria-label="إغلاق" onClick={()=>setHelp(false)}><X size={18}/></button><h2>إضافة التطبيق للهاتف</h2><p>{ios?'افتح القائمة أو زر المشاركة في Safari، ثم اختر «إضافة إلى الشاشة الرئيسية» وفعّل «فتح كتطبيق ويب» إن ظهر.':'من قائمة المتصفح ⋮ اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».'}</p>{ios&&<p><a href="/ooh/field/install.html">فتح صفحة تثبيت بالشعار المحدّث</a></p>}<p>افتحه من الأيقونة ليظهر كواجهة تطبيق دون شريط المتصفح.</p></section>}</div>;
}
