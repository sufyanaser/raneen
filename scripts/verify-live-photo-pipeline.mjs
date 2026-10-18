import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
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

const PROD_URL = 'https://raneen-ooh.vercel.app/ooh/field/';
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const sql = postgres(env.POSTGRES_URL, { max: 1 });

// Account 1: Clean Session Viewer (Supervisor role)
const USER1_NAME = 'مشرف الجلسة 1';
const USER1_EMAIL = `viewer1_${Date.now()}@accounts.raneen.invalid`;
const USER1_PASS = 'TestPass123456!';

// Account 2: Clean Session Viewer (Member role)
const USER2_NAME = 'فاحص الجلسة 2';
const USER2_EMAIL = `viewer2_${Date.now()}@accounts.raneen.invalid`;
const USER2_PASS = 'TestPass654321!';

let user1Id = null;
let user2Id = null;

try {
  console.log('1. إنشاء حسابي اختبار معزولين للجلستين المستقلتين...');
  const { data: u1, error: e1 } = await admin.auth.admin.createUser({
    email: USER1_EMAIL,
    password: USER1_PASS,
    email_confirm: true,
    user_metadata: { name: USER1_NAME },
  });
  if (e1) throw e1;
  user1Id = u1.user.id;

  const { data: u2, error: e2 } = await admin.auth.admin.createUser({
    email: USER2_EMAIL,
    password: USER2_PASS,
    email_confirm: true,
    user_metadata: { name: USER2_NAME },
  });
  if (e2) throw e2;
  user2Id = u2.user.id;

  await sql`
    insert into public.field_members(user_id, display_name, role, active, force_password)
    values
      (${user1Id}, ${USER1_NAME}, 'admin', true, false),
      (${user2Id}, ${USER2_NAME}, 'member', true, false)
  `;
  console.log(' ✓ تم تسجيل الحسابين في جدول أعضاء الفريق.');

  const browser = await chromium.launch({ headless: true });

  // =========================================================================
  // SESSION 1: Independent Browser Context (No cache, Supervisor)
  // =========================================================================
  console.log('\n========================================================');
  console.log(' الجلسة الأولى: متصفح نظيف تماماً (المشرف) — فحص الغلاف والتفاصيل');
  console.log('========================================================');

  const context1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page1 = await context1.newPage();

  page1.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) {
      console.log(' [Console 1 Error]:', msg.text());
    }
  });

  await page1.goto(PROD_URL, { waitUntil: 'networkidle' });
  await page1.fill('input[autocomplete="username"]', USER1_EMAIL.split('@')[0]);
  await page1.fill('input[type="password"]', USER1_PASS);
  await page1.click('button:has-text("دخول")');

  await page1.waitForSelector('button:has-text("المواقع")', { timeout: 15000 });
  await page1.click('button:has-text("المواقع")'); // Open Sites list
  await page1.waitForSelector('.siteCard, .sitesTable', { timeout: 15000 });

  // Allow images to download and render in cards
  console.log(' - انتظار تحميل الصور في بطاقات المواقع...');
  await page1.waitForTimeout(3000);

  const cards1 = await page1.locator('.siteCard').all();
  console.log(` عدد البطاقات في الجلسة 1: ${cards1.length}`);
  
  let s1RenderedCovers = 0;
  let s1EmptyCovers = 0;
  for (let i = 0; i < cards1.length; i++) {
    const title = (await cards1[i].locator('.cardTitle, h2').textContent())?.trim();
    const imgCount = await cards1[i].locator('.cover img').count();
    const noPhotoText = (await cards1[i].locator('.cover .noPhoto').textContent().catch(() => ''))?.trim();
    if (imgCount > 0) {
      s1RenderedCovers++;
      const src = await cards1[i].locator('.cover img').getAttribute('src');
      console.log(`  ✓ بطاقة #${i + 1} "${title}": ظهرت صورة الغلاف بنجاح! (${src?.slice(0, 40)}...)`);
    } else {
      s1EmptyCovers++;
      console.log(`  - بطاقة #${i + 1} "${title}": ${noPhotoText || 'بدون صورة'}`);
    }
  }

  // Open site with photos: "التاج"
  console.log('\n - فتح صفحة تفاصيل عقار «التاج» في الجلسة 1:');
  const tagCard1 = page1.locator('.siteCard:has-text("التاج")');
  await tagCard1.first().click();
  await page1.waitForSelector('.cardSection, .detailsContainer', { timeout: 10000 });
  await page1.waitForTimeout(2000);

  const tagImgs1 = await page1.locator('.photosGrid img').all();
  console.log(`   ✓ عدد صور عقار «التاج» المعروضة في صفحة التفاصيل: ${tagImgs1.length} من أصل 2`);
  for (let i = 0; i < tagImgs1.length; i++) {
    const src = await tagImgs1[i].getAttribute('src');
    console.log(`     صورة #${i + 1}: ${src?.slice(0, 45)}...`);
  }

  // Open site with photos: "تجربة"
  console.log('\n - فتح صفحة تفاصيل عقار «تجربة» في الجلسة 1:');
  await page1.click('button:has-text("رجوع"), .backBtn');
  await page1.waitForTimeout(500);
  const tajrobaCard1 = page1.locator('.siteCard:has-text("تجربة")');
  await tajrobaCard1.first().click();
  await page1.waitForSelector('.cardSection, .detailsContainer', { timeout: 10000 });
  await page1.waitForTimeout(2000);

  const tajrobaImgs1 = await page1.locator('.photosGrid img').all();
  console.log(`   ✓ عدد صور عقار «تجربة» المعروضة في صفحة التفاصيل: ${tajrobaImgs1.length} من أصل 1`);
  for (let i = 0; i < tajrobaImgs1.length; i++) {
    const src = await tajrobaImgs1[i].getAttribute('src');
    console.log(`     صورة #${i + 1}: ${src?.slice(0, 45)}...`);
  }

  // =========================================================================
  // SESSION 2: Second Independent Context (No cache, Mobile viewport)
  // =========================================================================
  console.log('\n========================================================');
  console.log(' الجلسة الثانية: متصفح هاتف مستقل كلياً (عضو ميداني) — فحص العرض الفوري');
  console.log('========================================================');

  const context2 = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  });
  const page2 = await context2.newPage();

  page2.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) {
      console.log(' [Console 2 Error]:', msg.text());
    }
  });

  await page2.goto(PROD_URL, { waitUntil: 'networkidle' });
  await page2.fill('input[autocomplete="username"]', USER2_EMAIL.split('@')[0]);
  await page2.fill('input[type="password"]', USER2_PASS);
  await page2.click('button:has-text("دخول")');

  await page2.waitForSelector('button:has-text("المواقع")', { timeout: 15000 });
  await page2.click('button:has-text("المواقع")');
  await page2.waitForSelector('.siteCard, .sitesTable', { timeout: 15000 });

  await page2.waitForTimeout(3000);

  const cards2 = await page2.locator('.siteCard').all();
  console.log(` عدد البطاقات في الجلسة 2 (موبايل): ${cards2.length}`);
  
  let s2RenderedCovers = 0;
  for (let i = 0; i < cards2.length; i++) {
    const title = (await cards2[i].locator('.cardTitle, h2').textContent())?.trim();
    const imgCount = await cards2[i].locator('.cover img').count();
    if (imgCount > 0) {
      s2RenderedCovers++;
      console.log(`  ✓ بطاقة #${i + 1} "${title}" (موبايل): ظهرت صورة الغلاف فوراً!`);
    }
  }

  // Test full photo modal viewer in Session 2
  console.log('\n - فتح تفاصيل «التاج» واستعراض الصورة بالحجم الكامل (Modal Viewer) في الجلسة 2...');
  await page2.click('.siteCard:has-text("التاج")');
  await page2.waitForSelector('.cardSection, .detailsContainer', { timeout: 10000 });
  await page2.waitForTimeout(2000);

  const thumbBtn = page2.locator('.photoThumbnail').first();
  await thumbBtn.click();
  await page2.waitForSelector('.photoViewer', { timeout: 5000 });
  const fullImgSrc = await page2.locator('.photoViewer .fullPhoto').getAttribute('src');
  console.log(`   ✓ عارض الصور بالحجم الكامل فُتح بنجاح! src: ${fullImgSrc?.slice(0, 45)}...`);
  
  // Close viewer
  await page2.click('.photoViewerActions button:has-text("إغلاق ×")');
  await page2.waitForSelector('.photoViewer', { state: 'detached', timeout: 5000 });
  console.log('   ✓ تم إغلاق عارض الصور بسلاسة.');

  await browser.close();

  console.log('\n========================================================');
  console.log(' نتيجة الاختبار الميداني للصور:');
  console.log(` - الجلسة 1 (المشرف / شاشة كاملة): صور الغلاف المعروضة = ${s1RenderedCovers} (فارغة = ${s1EmptyCovers})، تفاصيل «التاج» = ${tagImgs1.length}/2، تفاصيل «تجربة» = ${tajrobaImgs1.length}/1`);
  console.log(` - الجلسة 2 (موبايل مستقل كلياً): صور الغلاف المعروضة = ${s2RenderedCovers}، عارض الصور بالحجم الكامل = يعمل 100%`);
  console.log('========================================================');

} finally {
  console.log('\nتنظيف حسابات الاختبار المعزولة...');
  if (user1Id) {
    await admin.auth.admin.deleteUser(user1Id);
    await sql`delete from public.field_members where user_id=${user1Id}::uuid`;
  }
  if (user2Id) {
    await admin.auth.admin.deleteUser(user2Id);
    await sql`delete from public.field_members where user_id=${user2Id}::uuid`;
  }
  await sql.end({ timeout: 2 });
  console.log('✓ تم تنظيف الحسابات بنجاح.');
}
