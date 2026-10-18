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

const prefix = process.argv[2] || 'before';
const PROD_URL = process.argv[3] || 'https://raneen-ooh.vercel.app/ooh/field/';
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const sql = postgres(env.POSTGRES_URL, { max: 1 });

const testEmail = `caps_${Date.now()}@accounts.raneen.invalid`;
const testPass = 'CapsPass123456!';
const { data: user } = await admin.auth.admin.createUser({
  email: testEmail,
  password: testPass,
  email_confirm: true,
  user_metadata: { name: 'مصور الشاشات' },
});

await sql`
  insert into public.field_members(user_id, display_name, role, active, force_password)
  values (${user.user.id}, 'مصور الشاشات', 'admin', true, false)
`;

fs.mkdirSync('screenshots', { recursive: true });

try {
  const browser = await chromium.launch({ headless: true });
  // Mobile viewport (Pixel 7 / iPhone)
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();

  console.log(`فتح الرابط: ${PROD_URL}`);
  await page.goto(PROD_URL, { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="username"]', testEmail.split('@')[0]);
  await page.fill('input[type="password"]', testPass);
  await page.click('button:has-text("دخول")');
  await page.waitForSelector('.homeAction, .homeActionCard', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // 1. Home screen
  await page.screenshot({ path: `screenshots/${prefix}_1_home.png`, fullPage: true });
  console.log(`✓ تم التقاط: screenshots/${prefix}_1_home.png`);

  // 2. Sites List screen
  await page.click('button:has-text("المواقع")');
  await page.waitForSelector('.siteCard, .sitesTable', { timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `screenshots/${prefix}_2_list.png`, fullPage: true });
  console.log(`✓ تم التقاط: screenshots/${prefix}_2_list.png`);

  // 3. Details screen (open "التاج")
  const tag = page.locator('.siteCard:has-text("التاج")');
  if (await tag.count() > 0) {
    await tag.first().click();
    await page.waitForSelector('.cardSection, .detailsContainer', { timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `screenshots/${prefix}_3_details.png`, fullPage: true });
    console.log(`✓ تم التقاط: screenshots/${prefix}_3_details.png`);
  }

  // 4. Edit / Add screen
  await page.click('button:has-text("رجوع"), .backBtn');
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("إضافة عقار")').first().click();
  await page.waitForSelector('input#f-name', { timeout: 15000 });
  await page.screenshot({ path: `screenshots/${prefix}_4_form.png`, fullPage: true });
  console.log(`✓ تم التقاط: screenshots/${prefix}_4_form.png`);

  await browser.close();
} finally {
  await admin.auth.admin.deleteUser(user.user.id);
  await sql`delete from public.field_members where user_id=${user.user.id}::uuid`;
  await sql.end({ timeout: 2 });
}
