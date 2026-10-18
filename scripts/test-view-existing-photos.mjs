import { chromium } from '@playwright/test';
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

const PROD_URL = 'https://raneen-ooh.vercel.app/ooh/field/';
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Create temp viewer account
const testEmail = `viewer_${Date.now()}@accounts.raneen.invalid`;
const testPass = 'ViewerPass123456!';
const { data: created } = await admin.auth.admin.createUser({
  email: testEmail,
  password: testPass,
  email_confirm: true,
  user_metadata: { name: 'فاحص الصور' },
});

const postgres = (await import('postgres')).default;
const sql = postgres(env.POSTGRES_URL, { max: 1 });
await sql`
  insert into public.field_members(user_id, display_name, role, active, force_password)
  values(${created.user.id}, 'فاحص الصور', 'admin', true, false)
`;

try {
  console.log('1. إطلاق متصفح نظيف تماماً بدون أي كاش أو صور سابقة...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Capture console messages & network errors
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.text().includes('Photo') || msg.text().includes('blob')) {
      console.log(`[Browser Console ${msg.type()}]:`, msg.text());
    }
  });
  page.on('pageerror', err => console.log('[Browser Uncaught Error]:', err.message));
  page.on('requestfailed', req => console.log('[Network Failed]:', req.url(), req.failure()?.errorText));

  console.log(`2. الانتقال إلى: ${PROD_URL}`);
  await page.goto(PROD_URL, { waitUntil: 'networkidle' });

  // Login
  await page.fill('input[autocomplete="username"]', testEmail.split('@')[0]);
  await page.fill('input[type="password"]', testPass);
  await page.click('button:has-text("دخول")');

  await page.waitForSelector('.homeAction.secondary');
  await page.click('.homeAction.secondary'); // Click "المواقع"
  await page.waitForSelector('.sitesTable, .siteCard', { timeout: 15000 });

  // Check card covers in list
  console.log('\n3. فحص بطاقات المواقع في القائمة...');
  const cardElements = await page.locator('.siteCard').all();
  console.log(`عدد البطاقات المعروضة: ${cardElements.length}`);
  for (let i = 0; i < cardElements.length; i++) {
    const title = await cardElements[i].locator('h2').textContent();
    const coverImgs = await cardElements[i].locator('.cover img').count();
    const coverNoPhoto = await cardElements[i].locator('.cover .noPhoto').textContent().catch(() => '');
    console.log(`  بطاقة #${i + 1}: "${title.trim()}" -> الصور المعروضة: ${coverImgs}, النص البديل: "${coverNoPhoto.trim()}"`);
  }

  // Find the site with photos: "التاج"
  console.log('\n4. فتح تفاصيل عقار «التاج» الذي يحتوي على صورتين في قاعدة البيانات...');
  const tagCard = page.locator('.siteCard:has-text("التاج")');
  if (await tagCard.count() > 0) {
    await tagCard.first().click();
    await page.waitForSelector('.detailsSection', { timeout: 10000 });

    console.log(' - داخل صفحة التفاصيل لعقار «التاج»، فحص حالة مكوّنات الصور:');
    const photoSpans = await page.locator('.photos span.noPhoto').allTextContents();
    console.log('   حالة spans (قبل التحميل أو الأخطاء):', photoSpans);

    // Wait for images or error
    await page.waitForTimeout(4000);

    const renderedImgs = await page.locator('.photos img').all();
    console.log(`   عدد عناصر <img> في صفحة التفاصيل: ${renderedImgs.length}`);
    for (let i = 0; i < renderedImgs.length; i++) {
      const src = await renderedImgs[i].getAttribute('src');
      console.log(`    صورة #${i + 1}: src=${src?.slice(0, 50)}...`);
    }

    const errorTexts = await page.locator('.photos span.noPhoto').allTextContents();
    if (errorTexts.length) {
      console.log('   نصوص الأخطاء أو عدم التحميل:', errorTexts);
    }
  } else {
    console.log('لم يتم العثور على عقار "التاج" في القائمة!');
  }

  // Find the site "تجربة"
  console.log('\n5. فتح تفاصيل عقار «تجربة»...');
  await page.click('button:has-text("العودة للمواقع")');
  await page.waitForTimeout(500);
  const tajrobaCard = page.locator('.siteCard:has-text("تجربة")');
  if (await tajrobaCard.count() > 0) {
    await tajrobaCard.first().click();
    await page.waitForSelector('.detailsSection', { timeout: 10000 });
    await page.waitForTimeout(4000);
    const renderedImgs = await page.locator('.photos img').all();
    console.log(`   عدد عناصر <img> لعقار «تجربة»: ${renderedImgs.length}`);
    for (let i = 0; i < renderedImgs.length; i++) {
      const src = await renderedImgs[i].getAttribute('src');
      console.log(`    صورة #${i + 1}: src=${src?.slice(0, 50)}...`);
    }
  }

  await browser.close();
} finally {
  await admin.auth.admin.deleteUser(created.user.id);
  await sql`delete from public.field_members where user_id=${created.user.id}::uuid`;
  await sql.end({ timeout: 2 });
}
