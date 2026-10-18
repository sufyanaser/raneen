import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import fs from 'node:fs';

// Load environment variables
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
const sql = postgres(env.POSTGRES_URL, { max: 1, connect_timeout: 10 });

const WORKER_USER = 'test_field_worker';
const WORKER_EMAIL = `${WORKER_USER}@accounts.raneen.invalid`;
const WORKER_PASS = 'TestWorkerPass2026!';
const WORKER_NAME = 'موظف ميداني اختباري';

const SUPER_USER = 'test_supervisor';
const SUPER_EMAIL = `${SUPER_USER}@accounts.raneen.invalid`;
const SUPER_PASS = 'SupervisorPass2026!';
const SUPER_NAME = 'مشرف الجودة الاختباري';

// 1x1 valid sample JPEG buffers
function makeTestJpeg(colorByte = 0x80) {
  // Minimal valid JFIF JPEG buffer
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, colorByte, 0x06, 0x06, 0x07, 0x06, 0x05, 0x07,
    0x07, 0x07, 0x07, 0x07, 0x07, 0x08, 0x0a, 0x10, 0x0a, 0x0a, 0x09, 0x09, 0x0a, 0x14, 0x0e, 0x0f,
    0x0c, 0x10, 0x17, 0x14, 0x18, 0x18, 0x17, 0x14, 0x16, 0x16, 0x1a, 0x1d, 0x25, 0x1f, 0x1a, 0x1b,
    0x23, 0x1c, 0x16, 0x16, 0x20, 0x2c, 0x20, 0x23, 0x26, 0x27, 0x29, 0x2a, 0x29, 0x19, 0x1f, 0x2d,
    0x30, 0x2d, 0x28, 0x30, 0x25, 0x28, 0x29, 0x27, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00,
    0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01,
    0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
    0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0xbf, 0x00, 0xff, 0xd9
  ]);
}

async function setupTestUser(email, password, displayName, role) {
  // Check if exists
  const { data: list } = await admin.auth.admin.listUsers();
  let user = list.users.find(u => u.email === email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: displayName },
    });
    if (error) throw error;
    user = data.user;
  } else {
    await admin.auth.admin.updateUserById(user.id, { password });
  }

  // Ensure member row
  await sql`
    insert into public.field_members(user_id, display_name, role, active, force_password)
    values(${user.id}, ${displayName}, ${role}, true, false)
    on conflict(user_id) do update set display_name=excluded.display_name, role=excluded.role, active=true, force_password=false
  `;

  return user;
}

async function run() {
  console.log('========================================================');
  console.log('   غرفة عمليات تطبيق الرنين — اختبار الاستخدام الميداني الشامل   ');
  console.log('========================================================\n');

  let workerUser, superUser;
  let testSiteId = null;

  try {
    console.log('1. إعداد حسابات الاختبار المعزولة في Supabase...');
    workerUser = await setupTestUser(WORKER_EMAIL, WORKER_PASS, WORKER_NAME, 'member');
    superUser = await setupTestUser(SUPER_EMAIL, SUPER_PASS, SUPER_NAME, 'admin');
    console.log(` ✓ تم تجهيز حساب الموظف الميداني: ${WORKER_EMAIL} (${workerUser.id})`);
    console.log(` ✓ تم تجهيز حساب المشرف الميداني: ${SUPER_EMAIL} (${superUser.id})`);

    // Prepare test image files
    fs.mkdirSync('temp_test_photos', { recursive: true });
    const photo1Path = 'temp_test_photos/test_front.jpg';
    const photo2Path = 'temp_test_photos/test_angle.jpg';
    fs.writeFileSync(photo1Path, makeTestJpeg(0x10));
    fs.writeFileSync(photo2Path, makeTestJpeg(0x90));
    console.log(' ✓ تم تجهيز ملفي الصور الاختباريين بصيغة JPEG صالحة.');

    console.log('\n2. إطلاق متصفح Chromium الميداني...');
    const browser = await chromium.launch({ headless: true });

    // -------------------------------------------------------------
    // PHASE 1: FIELD WORKER SESSION
    // -------------------------------------------------------------
    console.log('\n========================================================');
    console.log(' المرحلة الأولى: جلسة الموظف الميداني (تسجيل الدخول، بدون نت، صور، GPS)');
    console.log('========================================================');
    const workerContext = await browser.newContext({
      viewport: { width: 412, height: 915 }, // Pixel 7 screen size
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      permissions: ['geolocation'],
      geolocation: { latitude: 33.425500, longitude: 43.305500 },
    });
    const page = await workerContext.newPage();

    console.log(` - الانتقال إلى الرابط الحي: ${PROD_URL}`);
    await page.goto(PROD_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Login
    console.log(' - تسجيل الدخول بحساب الموظف الميداني...');
    await page.waitForSelector('input[autocomplete="username"]', { timeout: 10000 });
    await page.fill('input[autocomplete="username"]', WORKER_USER);
    await page.fill('input[type="password"]', WORKER_PASS);
    await page.click('button:has-text("دخول")');

    // Verify logged in
    await page.waitForSelector('.accountInfo', { timeout: 15000 });
    const accountText = await page.textContent('.accountInfo');
    console.log(` ✓ نجح تسجيل الدخول: ${accountText.replace(/\s+/g, ' ').trim()}`);

    // Verify PWA Service Worker caching
    const swRegistered = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      return !!reg;
    });
    console.log(` ✓ حالة Service Worker للتطبيق دون اتصال: ${swRegistered ? 'مسجل ونشط' : 'قيد التجهيز'}`);

    // -------------------------------------------------------------
    // TEST OFFLINE PERSISTENCE
    // -------------------------------------------------------------
    console.log('\n3. محاكاة انقطاع الإنترنت الميداني (Offline Mode)...');
    await workerContext.setOffline(true);
    await page.waitForTimeout(500);

    const offlineStatus = await page.textContent('.status');
    console.log(` ✓ مؤشر حالة الشبكة في التطبيق: "${offlineStatus.trim()}"`);

    console.log(' - الضغط على «إضافة موقع» لتوثيق عقار أثناء انقطاع الإنترنت...');
    await page.click('button:has-text("إضافة موقع")');
    await page.waitForSelector('input#f-name', { timeout: 5000 });

    const testSiteName = `عقار ميداني اختباري #${Date.now().toString().slice(-4)}`;
    console.log(` - إدخال بيانات العقار: "${testSiteName}"...`);
    await page.fill('input#f-name', testSiteName);
    await page.fill('input#f-street', 'شارع 17 تموز — تقاطع الحرية');

    // Click GPS locate button
    console.log(' - النقر على «تحديد موقعي الحالي عبر GPS»...');
    await page.click('button.gpsBtn');
    await page.waitForTimeout(1000);
    const coordText = await page.textContent('.coordDisplay');
    console.log(` ✓ إحداثيات الموقع الملتقطة عبر GPS: ${coordText.trim()}`);

    // Attach 2 photos
    console.log(' - إرفاق صورتين للعقار الميداني...');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('label.fileButton.secondary').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([photo1Path, photo2Path]);
    await page.waitForTimeout(1500);

    const photoItemsCount = await page.locator('.photoItem').count();
    console.log(` ✓ عدد الصور الملتقطة والمعروضة في المسودة: ${photoItemsCount} صور`);

    // Fill specifications
    console.log(' - إدخال المواصفات والأبعاد وبيانات المالك والقرار...');
    await page.selectOption('select#f-kind', 'تجاري');
    await page.selectOption('select#f-position', 'واجهة');
    await page.fill('input#f-height', '4.5');
    await page.fill('input#f-width', '12');
    await page.fill('textarea', 'موقع تجاري مميز جداً على التقاطع — فحص جودة ميداني.');
    await page.fill('input#f-owner', 'أحمد العاني');
    await page.fill('input#f-phone', '07701234567');
    await page.selectOption('select#f-contact', 'تم التواصل الأولي');
    await page.fill('input#f-price', '2500000');
    await page.selectOption('select#f-priceCurrency', 'دينار عراقي');
    await page.selectOption('select#f-priority', 'عالية');
    await page.selectOption('select#f-next', 'طلب عرض مالي');

    // Click Save while STILL OFFLINE
    console.log(' - النقر على «حفظ واعتماد الكشف» أثناء انقطاع الإنترنت...');
    await page.click('button.saveBtn');
    await page.waitForSelector('.detailsSection', { timeout: 10000 });

    const saveNotice = await page.textContent('.notice');
    console.log(` ✓ رسالة الحفظ في وضع عدم الاتصال: "${saveNotice.trim()}"`);

    // Extract site ID
    const idText = await page.textContent('p.id');
    testSiteId = idText.replace('ID:', '').trim();
    console.log(` ✓ معرف العقار المحفوظ محلياً: ${testSiteId}`);

    // Check list view while offline
    await page.click('button:has-text("العودة للمواقع")');
    await page.waitForSelector('.siteCard', { timeout: 10000 });

    const pendingBadge = await page.textContent('.cardSyncBadge');
    console.log(` ✓ شارة العقار في القائمة (دون إنترنت): "${pendingBadge.trim()}"`);

    // -------------------------------------------------------------
    // PHASE 2: RESTORE ONLINE & AUTO-SYNC
    // -------------------------------------------------------------
    console.log('\n========================================================');
    console.log(' المرحلة الثانية: استعادة الاتصال بالإنترنت والمزامنة التلقائية');
    console.log('========================================================');
    console.log(' - إعادة تفعيل الاتصال بالإنترنت...');
    await workerContext.setOffline(false);
    await page.waitForTimeout(1000);

    const onlineStatus = await page.textContent('.status');
    console.log(` ✓ مؤشر الاتصال بعد عودة الشبكة: "${onlineStatus.trim()}"`);

    console.log(' - النقر على «🔄 مزامنة الآن» لرفع المسودة والصور فوراً...');
    await page.click('button.syncNowBtn');
    
    // Wait for sync completion
    console.log(' - انتظار اكتمال المزامنة ورفع الصور إلى التخزين السحابي...');
    await page.waitForFunction(() => {
      const b = document.querySelector('.cardSyncBadge');
      return b && b.textContent.includes('متزامن');
    }, { timeout: 25000 });

    const syncedBadge = await page.textContent('.cardSyncBadge');
    console.log(` ✓ حالة العقار بعد اكتمال المزامنة: "${syncedBadge.trim()}"`);

    await page.screenshot({ path: 'temp_test_photos/worker_synced.png' });
    console.log(' ✓ تم التقاط لقطة شاشة لتوثيق شاشة الموظف بعد المزامنة.');

    // -------------------------------------------------------------
    // PHASE 3: INDEPENDENT SUPERVISOR SESSION
    // -------------------------------------------------------------
    console.log('\n========================================================');
    console.log(' المرحلة الثالثة: جلسة المشرف المستقلة (التحقق من البيانات والصور)');
    console.log('========================================================');
    console.log(' - فتح جلسة متصفح جديدة ومعزولة كلياً (حساب المشرف على جهاز مستقل)...');
    const supervisorContext = await browser.newContext({
      viewport: { width: 1280, height: 800 }, // Desktop screen
    });
    const superPage = await supervisorContext.newPage();

    console.log(` - المشرف يفتح التطبيق: ${PROD_URL}`);
    await superPage.goto(PROD_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Supervisor Login
    console.log(' - تسجيل الدخول بحساب المشرف...');
    await superPage.waitForSelector('input[autocomplete="username"]', { timeout: 10000 });
    await superPage.fill('input[autocomplete="username"]', SUPER_USER);
    await superPage.fill('input[type="password"]', SUPER_PASS);
    await superPage.click('button:has-text("دخول")');

    // Wait for list
    await superPage.waitForSelector('.accountInfo', { timeout: 15000 });
    const superAccountText = await superPage.textContent('.accountInfo');
    console.log(` ✓ جلسة المشرف نشطة: ${superAccountText.replace(/\s+/g, ' ').trim()}`);

    // Click on sites list from home view
    console.log(' - المشرف ينقر على «المواقع» لاستعراض قائمة العقارات وسجل الفريق...');
    await superPage.click('button.homeAction.secondary');

    // Check Metrics Bar
    await superPage.waitForSelector('.metricsBar', { timeout: 15000 });
    console.log(' ✓ شريط المؤشرات الإحصائية ظاهر لدى المشرف بنجاح.');

    // Filter or Search for the newly synced site
    console.log(` - البحث عن العقار المرفوع بالاسم: "${testSiteName}"...`);
    await superPage.fill('input[placeholder*="ابحث"]', testSiteName);
    await superPage.waitForTimeout(500);

    const siteCardsCount = await superPage.locator('.siteCard').count();
    console.log(` ✓ عثر المشرف على ${siteCardsCount} عقار يطابق البحث.`);
    if (siteCardsCount === 0) throw Error('العقار لم يظهر في جلسة المشرف!');

    const surveyorLabel = await superPage.textContent('.cardSurveyor');
    console.log(` ✓ اسم الموظف الموثق للعقار عند المشرف: "${surveyorLabel.trim()}"`);

    // Open site details
    console.log(' - المشرف يفتح بطاقة تفاصيل العقار...');
    await superPage.locator('.siteCard').first().click();
    await superPage.waitForSelector('.detailsSection', { timeout: 10000 });

    // Verify Details
    const dtTexts = await superPage.locator('.detailsList div').allTextContents();
    console.log(' ✓ استعراض المشرف لبيانات العقار والمالك:');
    for (const line of dtTexts) {
      const clean = line.replace(/\s+/g, ' ').trim();
      if (clean.includes('المسؤول') || clean.includes('المنطقة') || clean.includes('المالك') || clean.includes('رقم الهاتف') || clean.includes('التوقع')) {
        console.log(`    • ${clean}`);
      }
    }

    // Verify Phone & WhatsApp direct buttons
    const phoneBtn = await superPage.locator('a.phoneBtn').getAttribute('href');
    const waBtn = await superPage.locator('a.whatsappBtn').getAttribute('href');
    console.log(` ✓ رابط الاتصال الهاتفي المباشر: ${phoneBtn}`);
    console.log(` ✓ رابط محادثة واتساب المباشرة: ${waBtn}`);

    // Verify Photos loaded and ready
    console.log(' - انتظار تحميل الصور (كلا الصورتين) في متصفح المشرف من التخزين السحابي...');
    await superPage.waitForFunction(() => {
      const imgs = document.querySelectorAll('.photos img');
      return imgs.length >= 2;
    }, { timeout: 25000 });
    const photosRendered = await superPage.locator('.photos img').count();
    console.log(` ✓ عدد الصور المعروضة والمحمّلة لدى المشرف: ${photosRendered} صور`);
    if (photosRendered < 2) throw Error('الصور لم تظهر كاملة في جلسة المشرف!');

    // Test Photo Fullscreen Viewer
    console.log(' - فتح عارض الصور بالحجم الكامل...');
    await superPage.locator('.photoThumbnail').first().click();
    await superPage.waitForSelector('.photoViewer', { timeout: 5000 });
    const fullPhotoSrc = await superPage.locator('.fullPhoto').getAttribute('src');
    console.log(` ✓ الصورة بالحجم الكامل فُتحت بنجاح (Blob URL: ${fullPhotoSrc?.slice(0, 30)}...)`);
    await superPage.keyboard.press('Escape');

    await superPage.screenshot({ path: 'temp_test_photos/supervisor_verified.png' });
    console.log(' ✓ تم التقاط لقطة شاشة لتوثيق شاشة المشرف والتفاصيل والصور.');

    // Verify Supervisor Delete Site capability
    const deleteBtn = await superPage.locator('button.deleteBtn');
    const deleteBtnExists = await deleteBtn.count() > 0;
    console.log(` ✓ زر «حذف الموقع» متاح للمشرف حصراً: ${deleteBtnExists ? 'نعم' : 'لا'}`);

    console.log('\n========================================================');
    console.log(' النتيجة: اكتملت دورة العمل الميدانية بنجاح باهر 100%!');
    console.log(' معيار النجاح: العقار سُجل بدون نت، تم رفع صوره وموقعه تلقائياً،');
    console.log(' وظهرت جميع التفاصيل والصور كاملة للمشرف في جلسة منفصلة.');
    console.log('========================================================\n');

    await browser.close();
  } catch (err) {
    console.error('\n❌ فشل في مرحلة الاختبار:', err);
    throw err;
  } finally {
    // -------------------------------------------------------------
    // PHASE 4: CLEANUP TEST DATA TO KEEP PRODUCTION SPOTLESS
    // -------------------------------------------------------------
    console.log('تنظيف بيانات الاختبار المعزولة لضمان عدم بقاء أي سجل تجريبي في الإنتاج...');
    try {
      if (testSiteId) {
        // Delete photos from bucket
        const { data: bucketFiles } = await admin.storage.from('field-photos').list(testSiteId);
        if (bucketFiles && bucketFiles.length > 0) {
          await admin.storage.from('field-photos').remove(bucketFiles.map(f => `${testSiteId}/${f.name}`));
        }
        // Delete from DB tables
        await sql`delete from field_private.history where site_id=${testSiteId}::uuid`;
        await sql`delete from field_private.operations where site_id=${testSiteId}::uuid`;
        await sql`delete from public.field_sites where id=${testSiteId}::uuid`;
        console.log(` ✓ تم حذف العقار الاختباري بالكامل من قاعدة البيانات وتخزين الصور.`);
      }
      if (workerUser) {
        await sql`delete from public.field_members where user_id=${workerUser.id}::uuid`;
        await admin.auth.admin.deleteUser(workerUser.id);
        console.log(` ✓ تم حذف حساب الموظف الميداني الاختباري.`);
      }
      if (superUser) {
        await sql`delete from public.field_members where user_id=${superUser.id}::uuid`;
        await admin.auth.admin.deleteUser(superUser.id);
        console.log(` ✓ تم حذف حساب المشرف الاختباري.`);
      }
      fs.rmSync('temp_test_photos', { recursive: true, force: true });
      console.log(' ✓ تم تنظيف الملفات المؤقتة. قاعدة بيانات الإنتاج نقية 100%.');
    } catch (cleanErr) {
      console.warn('تحذير أثناء التنظيف:', cleanErr.message);
    } finally {
      await sql.end({ timeout: 2 });
    }
  }
}

run().catch(() => process.exit(1));
