import { createClient } from '@supabase/supabase-js';
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

// Test 1: Service role client download
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const testPath = 'ebe02e81-81e6-4582-8ef9-3eaf4eb74ebe/94230d3d42a41f6714071c023a06664bfecba5f0d35fb23f24e6a3911ac0ddf8';

console.log('--- اختبار 1: تنزيل الصورة بحساب الخدمة الإداري (Service Role) ---');
const { data: adminBlob, error: adminErr } = await admin.storage.from('field-photos').download(testPath);
if (adminErr) {
  console.error('❌ فشل تنزيل الخدمة الإدارية:', adminErr);
} else {
  console.log(`✓ نجح تنزيل الصورة بحساب الخدمة! الحجم: ${adminBlob.size} bytes, النوع: ${adminBlob.type}`);
}

// Test 2: Authenticated client download (using public anon key + user sign-in)
console.log('\n--- اختبار 2: تنزيل الصورة بعميل التطبيق المصادق (Client Auth) ---');
const anonKey = env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.VITE_PUBLIC_SUPABASE_ANON_KEY;
const userClient = createClient(env.VITE_PUBLIC_SUPABASE_URL, anonKey);

// We need a member user to test authenticated download
// Let's create a temporary member session using admin API or test user
console.log('إنشاء مستخدم اختباري نشط للتحقق من سياسة التخزين...');
const tempEmail = `storage_test_${Date.now()}@accounts.raneen.invalid`;
const tempPass = 'StorageTestPass123!';
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: tempEmail,
  password: tempPass,
  email_confirm: true,
});
if (createErr) throw createErr;

try {
  // Add to field_members
  const postgres = (await import('postgres')).default;
  const sql = postgres(env.POSTGRES_URL, { max: 1 });
  await sql`
    insert into public.field_members(user_id, display_name, role, active, force_password)
    values(${created.user.id}, 'فاحص التخزين', 'member', true, false)
  `;
  await sql.end();

  // Now sign in as this authenticated member
  const { data: sessionData, error: signErr } = await userClient.auth.signInWithPassword({
    email: tempEmail,
    password: tempPass,
  });
  if (signErr) throw signErr;
  console.log(`✓ تم تسجيل دخول العميل بنجاح (UID: ${sessionData.user.id})`);

  // Attempt to download the real photo as this authenticated member!
  const { data: userBlob, error: userErr } = await userClient.storage.from('field-photos').download(testPath);
  if (userErr) {
    console.error('❌ فشل تنزيل الصورة للمستخدم المصادق:', userErr);
  } else {
    console.log(`✓ نجح تنزيل الصورة للمستخدم المصادق! الحجم: ${userBlob.size} bytes, النوع: ${userBlob.type}`);
  }

  // Also test createSignedUrl
  const { data: signedData, error: signUrlErr } = await userClient.storage.from('field-photos').createSignedUrl(testPath, 3600);
  if (signUrlErr) {
    console.error('❌ فشل إصدار رابط موقع (Signed URL):', signUrlErr);
  } else {
    console.log(`✓ نجح إصدار رابط موقع (Signed URL): ${signedData.signedUrl.slice(0, 60)}...`);
    // Test fetching the signed URL via HTTP
    const httpRes = await fetch(signedData.signedUrl);
    console.log(`✓ جلب الصورة عبر Signed URL: Status ${httpRes.status}, Content-Type: ${httpRes.headers.get('content-type')}`);
  }

} finally {
  await admin.auth.admin.deleteUser(created.user.id);
  const postgres = (await import('postgres')).default;
  const sql = postgres(env.POSTGRES_URL, { max: 1 });
  await sql`delete from public.field_members where user_id=${created.user.id}::uuid`;
  await sql.end();
}
