export async function prepareImage(file:File):Promise<Blob>{
if(!file.type.startsWith('image/'))throw Error('اختر ملفات صور فقط.');
if(file.size>20971520)throw Error('حجم الصورة يتجاوز 20 ميغابايت. اختر صورة أصغر.');
if(file.size<1024*1024)return file;
try{
const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});const ratio=Math.min(1,1920/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);const ctx=canvas.getContext('2d');if(!ctx){bitmap.close();return file;}ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const compressed=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.84));return compressed&&compressed.size<file.size?compressed:file;
}catch{return file;}
}
