# raneen-field — سجل عمليات النشر والتطوير

Oct 18, 2026 · @SUFYAN NASER

## ملخص تنفيذي

جلسة متابعة لمشروع **raneen-field** (React 19 / TypeScript / Vite، منشور على Vercel تحت team **nasai** بمشروع **raneen-ooh**). بدأت الجلسة بطلب "كمل" بدون سياق محادثة سابق، فتم فحص المجلد المرتبط على الجهاز (`raneen-field-reconstructed`) لتحديد آخر نقطة توقف فعلية.

أربع عمليات متسلسلة:

1. فحص بناء محلي كامل (build check)
2. أول نشر production فعلي
3. اكتشاف وإصلاح bug حقيقي كان يكسر Google OAuth session resume/logout بشكل دائم
4. ميزة جديدة: تفعيل Google Drive كمسار نسخ احتياطي شخصي موازي لـ Supabase، مع إصلاح تعارض حقيقي بالبيانات قبل ما يحصل

الدومين الحي: `https://raneen-ooh.vercel.app/ooh/field/`

## القسم 1 — فحص البناء المحلي الكامل

رفعت المشروع كاملاً من الجهاز (`C:\Users\sufya\Downloads\raneen-field-reconstructed`) لبيئة العمل السحابية وشغلت سلسلة البناء الكاملة:

```
npm install                        → 222 package، clean
node scripts/provision-team.mjs    → no-op (RANEEN_APPLY_SCHEMA غير مضبوط)
tsc -b                             → 0 أخطاء
vite build                         → 4633 modules، 5.67s
scripts/package-path.mjs           → dist/ooh/field/ محزّم صحيح
```

الناتج: `dist` بحجم 2.6MB، تحذير غير حرج واحد (chunk `index.js` 672KB — يحتاج code-splitting مستقبلاً، مو عاجل).

ثغرات لوحظتها بالمجلد المعاد بناؤه (موضّحة بالقسم 8):

- `eslint.config.js` مفقود → `npm run lint` يفشل فوراً
- لا توجد test specs لـ Playwright → `npm test` بلا شي يشغّله
- `server-tests/oauth.test.mjs` مفقود → `npm run test:auth` يفشل
- `supabase/migrations/` مفقود → خطوة schema provisioning بـ `provision-team.mjs` معطّلة فعلياً
- لا `.git`، لا `.vercel`، لا `.env` محلياً

## القسم 2 — أول نشر Production

```
npx vercel link    → team: nasai · project: raneen-ooh
npx vercel --prod   → Ready in 22s
```

النتيجة:

- Production alias: `https://raneen-ooh.vercel.app`
- Deployment URL: `https://raneen-375dvydxf-nasai.vercel.app`

ملاحظة: أول `vercel --prod` أنشأ `VERCEL_OIDC_TOKEN` وملف `.env.local` تلقائياً (أضافه لـ `.gitignore`) — هذا سلوك طبيعي من Vercel CLI الحديث، ليس نسخة من الأسرار الفعلية المضبوطة على Vercel dashboard.

## القسم 3 — اكتشاف وإصلاح bug حقيقي: دومين Google OAuth

فحصت endpoints الإنتاج مباشرة بالمتصفح (طلبات same-origin):

```
/api/backup                 → 401 Unauthorized   (متوقع، بدون CRON_SECRET صحيح)
/api/google/session  (POST) → 403 forbidden       ← مشكلة
/api/google/logout   (POST) → 403 forbidden       ← مشكلة
```

**السبب:** ملف `api/google/[action].js` كان فيه دومين مكتوب hardcoded:

```js
const APP='https://raneen-field.vercel.app';
```

وهذا دومين قديم لا يطابق الـ production alias الفعلي `raneen-ooh.vercel.app`. الكود يتحقق من `req.headers.origin !== APP` لأي POST على `/session` أو `/logout`، فكان يفشل دائماً بالإنتاج.

**الأثر:** تسجيل الدخول عبر Google (`/start` → `/callback`) كان ينجح، لكن تجديد الجلسة (`resume()`) وتسجيل الخروج كانا يفشلان دائماً بعد ذلك — هذا على الأرجح هو سبب "repeated failures" المذكورة سابقاً واللي خلت Google Drive sync متخلى عنه لصالح Supabase.

**الإصلاح:** غيّرت `APP` إلى `'https://raneen-ooh.vercel.app'`، وتأكدت (عبر بحث شامل بالمشروع) أنه لا توجد مراجع أخرى لهذا الدومين hardcoded بأي ملف آخر. التعديل مكتوب مباشرة على الجهاز، بانتظار إعادة deploy.

## القسم 4 — ميزة جديدة: Google Drive كنسخة احتياطية شخصية موازية

**الاكتشاف الأول:** `src/google.ts` (كل منطق login/resume/sync/restore) كان **orphaned بالكامل** — غير مستورد بأي مكان من `App.tsx` أو `SessionGate.tsx`. التطبيق يعتمد بالكامل على Supabase (`team.ts`/`session.ts`) كمصدر وحيد للحقيقة، زائد نسخة ZIP احتياطية client-side (`backup.ts`) و cron backup إلى Postgres/Vercel Blob (`api/backup.js`).

**القرار** (بعد توضيح مع المستخدم): تفعيل Drive كمسار موازي اختياري للنسخ الشخصي، بدون ما يستبدل Supabase أو يتداخل معه.

**أهم إصلاح:** دالة `sync()` بـ `google.ts` كانت تحط `s.dirty=false` بعد كل رفع ناجح لـ Drive. هذا الحقل `dirty` هو نفسه اللي يعتمد عليه `synchronizeTeam()` بـ `team.ts` ليقرر أي المواقع تحتاج رفع لـ Supabase. لو ضلت كما هي، أول مزامنة Drive كانت ستخلي `synchronizeTeam` يتجاهل مواقع لم تصل لـ Supabase أبداً — فقدان بيانات فعلي. التعديل: Drive sync الحين يحفظ فقط حقوله الخاصة (`folderId`، `photoFolderId`، `dataId`) ولا يلمس `dirty`/`error` إطلاقاً.

**التغييرات بـ `App.tsx`:** شريط جديد تحت accountBar، متاح لكل عضو مسجل دخول (مو admin بس):

- غير متصل → زر يودي لـ `/api/google/start` (PKCE server flow)
- متصل → يعرض الإيميل + زر "نسخة شخصية إلى Drive" (يرفع كل المواقع المحلية) + زر "قطع الاتصال" (يدمّر الجلسة فعلاً عبر `POST /api/google/logout`)
- معالجة query params من الـ callback (`?google=denied/invalid/failed`)

**قصدياً لم أربط** دالة `restore()` (سحب بيانات من Drive للجهاز) بالواجهة — خطر الكتابة فوق بيانات فريق أحدث بنسخة Drive أقدم. موجودة بالكود لاستخدام مستقبلي تحت إشراف.

**Build:** `tsc -b` صفر أخطاء، `vite build` نجح (679.91 kB index chunk). الملفات المعدّلة كُتبت مباشرة على الجهاز، بانتظار إعادة deploy.

## الملفات المعدّلة فعلياً

| الملف | التغيير |
| --- | --- |
| `api/google/[action].js` | تصحيح دومين OAuth hardcoded (`raneen-field.vercel.app` → `raneen-ooh.vercel.app`) |
| `src/google.ts` | فصل Drive sync عن حقلي `dirty`/`error` التابعين لـ Supabase team-sync |
| `src/App.tsx` | إضافة شريط ربط/مزامنة/قطع اتصال Google Drive لكل عضو مسجل |

كل التعديلات كُتبت مباشرة على المجلد المرتبط بالجهاز (`device_commit_files`)، وتم التحقق من البناء بعد كل تعديل قبل الكتابة.

## الخطوات المتبقية عليك فعلاً

1. **ضبط env vars على Vercel** (Project Settings → Environment Variables → Production):

```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
OAUTH_COOKIE_SECRET        (≥ 32 حرف عشوائي)
CRON_SECRET
POSTGRES_URL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
VITE_PUBLIC_SUPABASE_URL
VITE_PUBLIC_SUPABASE_ANON_KEY   (أو VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
```

2. **Google Cloud Console** (OAuth 2.0 Client): Authorized redirect URI = `https://raneen-ooh.vercel.app/api/google/callback`، Authorized JavaScript origin = `https://raneen-ooh.vercel.app`
3. **إعادة النشر:**

```
cd "C:\Users\sufya\Downloads\raneen-field-reconstructed"
npx vercel --prod
```

4. **إجراء احترازي:** روتييش/إلغاء Vercel personal access token اللي انلصق بالمحادثة سابقاً (vercel.com/account/tokens) — احتياط لأنه انكتب بالنص، رغم أنه ما استعمل فعلاً (شبكة البيئة السحابية منعت `api.vercel.com`).

## ثغرات معروفة غير مُصلحة

لوحظتها أثناء الفحص، غير متعلقة بشغل هذي الجلسة:

- `eslint.config.js` مفقود → `npm run lint` يفشل فوراً (ESLint v9 يحتاج flat config)
- `server-tests/oauth.test.mjs` مفقود → `npm run test:auth` يفشل
- لا توجد test specs لـ Playwright → `npm test` بلا شي يشغّله
- `supabase/migrations/` مفقود → خطوة schema provisioning بـ `scripts/provision-team.mjs` معطّلة فعلياً
- لا `.git` ولا GitHub remote مربوط — يطابق ملاحظة سابقة: المشروع غير مرفوع لـ GitHub لحد الآن
