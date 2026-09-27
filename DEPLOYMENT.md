# 🚀 دليل النشر الكامل — SIP OF DEATH

دليل خطوة بخطوة لرفع المتجر على الإنترنت **مجانًا بالكامل** مع لوحة تحكم سهلة لإدارة المنتجات والأسعار وطرق الدفع.

| الخدمة | الاستخدام | المجاني؟ |
|---|---|---|
| **Render.com** | استضافة الموقع + السيرفر | ✅ (750 ساعة/شهر) |
| **Supabase** | قاعدة بيانات Postgres + تخزين صور المنتجات | ✅ (500MB قاعدة + 1GB صور) |
| **GitHub** | تخزين الكود والتحديث التلقائي | ✅ |

---

## الخطوة 1 — ارفع الكود على GitHub

1. اعمل حساب مجاني على [github.com](https://github.com) لو معندكش.
2. اعمل Repository جديد (اسمه مثلاً `sip-of-death-store`) وخليه **Private**.
3. ارفع ملفات المشروع عليه (من برنامج GitHub Desktop، أو من التيرمنال):

```bash
cd sip-of-death-store
git init
git add .
git commit -m "SIP OF DEATH store"
git remote add origin https://github.com/USERNAME/sip-of-death-store.git
git push -u origin main
```

---

## الخطوة 2 — جهّز Supabase (قاعدة البيانات + الصور)

### أ) اعمل مشروع جديد
1. سجّل دخول على [supabase.com](https://supabase.com) بحساب GitHub.
2. اضغط **New project** → اختار اسم (مثلاً `sod-store`) وباسورد للداتابيز (احفظه!) → أقرب ريجون: **Frankfurt (eu-central-1)**.
3. استنى دقيقة لحد ما المشروع يجهز.

### ب) هات رابط الاتصال
1. من فوق: **Project Settings** (⚙️) → **Database**.
2. انزل لقسم **Connection string** → اختار تاب **Connection pooling** (مهم! ده port 6543).
3. انسخ الرابط وحط مكانه الباسورد اللي اخترته، هيبقى شكله كده:
   ```
   postgres://postgres.xxxx:الباسورد@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
   ```
4. احفظ الرابط ده في مكان آمن — هتحتاجه في الخطوة 3.

### ج) جهّز تخزين الصور
1. من القايمة اليمين: **Storage** → **New bucket**.
2. اسم الباكت: `product-images` — ولاّم **Public bucket** ✅ — اضغط Create.
3. روح **Project Settings** → **API**:
   - انسخ **Project URL** (شكله `https://xxxx.supabase.co`)
   - انسخ مفتاح **service_role** (⚠️ سرّي جدًا — متنشرهوش في أي حتة)
4. احفظ الاتنين — هتحتاجهم في الخطوة 3.

---

## الخطوة 3 — انشر على Render

1. سجّل دخول على [render.com](https://render.com) بحساب GitHub.
2. اضغط **New +** → **Blueprint** → اختار مستودع `sip-of-death-store`.
3. Render هيقرأ ملف `render.yaml` ويظهرلك الحقول. املأ القيم اللي حفظتها:
   - `DATABASE_URL` → رابط الاتصال من Supabase (خطوة 2-ب)
   - `SUPABASE_URL` → رابط المشروع (خطوة 2-ج)
   - `SUPABASE_SERVICE_KEY` → مفتاح service_role (خطوة 2-ج)
   - `ADMIN_PASSWORD` → اكتب أي حاجة مؤقتة (هتغيرها من لوحة التحكم)
   - `STORE_URL` → اكتب `https://sip-of-death-store` مؤقتًا (هنظبطه بعد ما نعرف الرابط النهائي)
4. اضغط **Apply** واستنى 3-5 دقائق.
5. هتلاقي موقعك على رابط شكله: `https://sip-of-death-store.onrender.com`
6. **مهم:** روح **Settings** → **Environment** وعدّل `STORE_URL` للرابط الكامل النهائي (`https://sip-of-death-store.onrender.com`) واضغط Save.

### أول تشغيل بيعمل إيه تلقائيًا؟
- بيعمل كل الجداول في قاعدة البيانات.
- بينسخ المنتجات الـ 10 الافتراضية.
- بيعمل حساب أدمن باسم `admin` والباسورد اللي كتبته.
- **مفيش خطوات setup يدوية.**

---

## الخطوة 4 — غيّر كلمة سر الأدمن (إجباري!)

1. افتح `https://موقعك.onrender.com/admin`
2. سجّل دخول:
   - **Username:** `admin`
   - **Password:** الباسورد اللي كتبته في Render
3. افتح تاب **SETTINGS** → قسم **CHANGE PASSWORD**.
4. اكتب الباسورد الحالي، والباسورد الجديد (8 حروف على الأقل) مرتين → **UPDATE PASSWORD**.
5. ✅ خلاص — السيشن بيتحدث تلقائيًا ومحتاجش تسجل خروج.

> ⚠️ لو نسيت الباسورد: من Render → **Environment** غيّر `ADMIN_PASSWORD` لقيمة جديدة واضغط **Save** — ده بيرست الحساب على القيمة الجديدة عند إعادة التشغيل.

---

## الخطوة 5 — استخدم لوحة التحكم

ادخل على `/admin` من أي جهاز (كمبيوتر أو موبايل):

| التاب | بيعمل إيه |
|---|---|
| **ORDERS** | كل الطلبات — غيّر حالة الطلب بضغطة (تم الدفع / بيتبني / اتشحن / اتسلم) |
| **PRODUCTS** | إضافة منتج جديد ✚ / تعديل منتج (اسم، سعر، وصف، صور) / حذف منتج |
| **STOCK & PRICES** | تعديل سريع: زرار − / + للمخزون، وكتابة السعر الجديد = حفظ فوري |
| **SHIPPING ZONES** | رسوم الشحن لكل منطقة ومدة التوصيل |
| **PAYMENTS** | تفعيل/إيقاف طرق الدفع: كارت، كاش عند الاستلام، تحويل بنكي، فودافون كاش — وتعديل نص التعليمات اللي بتظهر للعميل |
| **SETTINGS** | تغيير الباسورد + قواعد المتجر (حد الشحن المجاني، رسوم الكاش، تنبيه المخزون القليل) |

### رفع صور المنتج
من داخل محرر المنتج (PRODUCTS → EDIT):
- **من جهازك:** اختار صورة (PNG/JPG/WebP — حتى 5 ميجا) وهتترفع تلقائيًا على Supabase وتظهر في المتجر فورًا.
- **أو بالرابط:** الصق رابط صورة جاهزة واضغط **ADD URL**.

### طرق التحويل (بنكي / فودافون كاش)
لما تفعّلها من تاب PAYMENTS:
- بتظهر للعميل كخيار في صفحة الدفع.
- بعد تأكيد الطلب بيفتحله صفحة فيها **رقم الطلب والمبلغ المطلوب تحويله**.
- العميل بيحوّل ويبعت الإيصال واتساب، وأنت بتأكد الطلب من تاب ORDERS (تحول حالته لـ PAID).

---

## حدود الخطة المجانية (مهم تعرفها)

- **Render Free:** السيرفر "بينام" بعد 15 دقيقة من عدم الاستخدام؛ أول زائر بعدها يستنى ~50 ثانية. لو عايز السيرفر صاحي دايمًا: ترقية $7/شهر.
- **متجدد كل شهر**، متحسبش عليه لسيرفر إنتاج ضخم — لكنه ممتاز لمتجر متوسط.
- **Supabase Free:** 500MB داتابيز + 1GB صور + 2GB باندويث — كفاية لآلاف الطلبات.
- **الدومين:** مممن تربط دومينك الخاص من Render → Settings → Custom Domains (مجانًا، الدومين نفسه بيتدفع برّه).

---

## التحديثات القادمة (بعد النشر)

أي تعديل على الكود وترفعه لـ GitHub → Render بيعمل deploy تلقائي خلال دقائق. مش محتاج تعمل أي حاجة تانية.

للصيانة الصغيرة (أسعار، مخزون، منتجات، طرق دفع) **متعدلش كود خالص** — كله من لوحة التحكم `/admin`.

---

## استكشاف الأخطاء

| المشكلة | الحل |
|---|---|
| الموقع بيرندر صفحة "service unavailable" | أول طلب بعد النوم بياخد وقت — حدّث الصفحة بعد دقيقة |
| لوحة الأدمن بتقول "API error" | راجع متغيرات البيئة في Render (خصوصًا DATABASE_URL) |
| رفع الصور فاشل | اتأكد إن SUPABASE_URL و SUPABASE_SERVICE_KEY مظبوطين وإن الباكت `product-images` عامر (Public) |
| الطلبات مش بتوصل | راجع LOGS من صفحة الخدمة في Render |

---

# 🇬🇧 Quick English Reference

**Architecture:** Single Express server (Node ≥18) serving the SPA + REST API, PostgreSQL via Supabase (`pg` pool, SSL auto-enabled), images on Supabase Storage (bucket `product-images`, falls back to `api/data/uploads` locally).

**Deploy (one-click):** Push to GitHub → Render → New → Blueprint → fill `render.yaml` env vars → Apply. `/api/health` is the health check. Schema + seed + first admin are created automatically on boot.

**Admin:** `/admin` — first login `admin` / `$ADMIN_PASSWORD` (default `ChangeMe123!`) → **change it from SETTINGS → CHANGE PASSWORD** (sessions are HMAC-signed, 12h TTL, invalidated by password change; login rate-limited 5 tries / 10 min).

**Env vars:** `DATABASE_URL` (required — use Supabase pooler :6543), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `STORE_URL`, `NODE_ENV=production`, optional `PAYMOB_*` / `STRIPE_*` for real card payments (mock gateway is disabled in production).

**Local dev:** `cd api && npm install && npm run dev` — needs a `DATABASE_URL` (any Postgres; embedded Postgres used automatically by the test suite). Smoke test: `npm run smoke` (89 assertions, boots its own scratch Postgres on :5433).
