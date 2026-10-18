import postgres from 'postgres';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=');
      const k = l.slice(0, i);
      let v = l.slice(i + 1);
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      return [k, v];
    })
);

const sql = postgres(env.POSTGRES_URL, { max: 1 });

try {
  console.log('=== فحص جميع العقارات في قاعدة بيانات الإنتاج ===');
  const sites = await sql`select * from public.field_sites order by updated_at desc`;
  console.log(`إجمالي عدد العقارات: ${sites.length}`);
  for (const s of sites) {
    const photos = (s.data?.photos || []);
    console.log(`\n• العقار: [${s.id}] "${s.data?.name}" (${s.created_name || 'غير محدد'})`);
    console.log(`  - تاريخ التعديل: ${s.updated_at}`);
    console.log(`  - محذوف؟: ${s.deleted_at ? 'نعم (' + s.deleted_at + ')' : 'لا'}`);
    console.log(`  - photos_ready: ${s.photos_ready}`);
    console.log(`  - عدد الصور المسجلة في data.photos: ${photos.length}`);
    for (const p of photos) {
      console.log(`    * صورة: id=${p.id}, name=${p.name}, mime=${p.mime}`);
    }
  }

  console.log('\n=== فحص الملفات الموجودة فعلياً في Storage bucket "field-photos" ===');
  const storageObjects = await sql`
    select name, bucket_id, created_at, (metadata->>'size') as size, (metadata->>'mimetype') as mime
    from storage.objects 
    where bucket_id='field-photos'
  `;
  console.log(`إجمالي الكائنات في التخزين: ${storageObjects.length}`);
  for (const obj of storageObjects) {
    console.log(`  - ${obj.name} (${obj.size} bytes, ${obj.mime}, created: ${obj.created_at})`);
  }

  // Cross-reference: which photos in sites actually exist in storage?
  console.log('\n=== مطابقة الصور بين قاعدة البيانات والتخزين السحابي ===');
  for (const s of sites) {
    const photos = (s.data?.photos || []);
    if (!photos.length) continue;
    for (const p of photos) {
      const expectedPath = `${s.id}/${p.id}`;
      const found = storageObjects.find(o => o.name === expectedPath);
      if (found) {
        console.log(`  ✓ عقار ${s.id.slice(0, 8)}... - الصورة ${p.id.slice(0, 8)}... موجودة في Storage (${found.size} bytes)`);
      } else {
        console.log(`  ❌ عقار ${s.id.slice(0, 8)}... - الصورة ${p.id.slice(0, 8)}... مفقودة في Storage! (مسار: ${expectedPath})`);
      }
    }
  }

} catch (err) {
  console.error('خطأ أثناء الفحص:', err);
} finally {
  await sql.end({ timeout: 2 });
}
