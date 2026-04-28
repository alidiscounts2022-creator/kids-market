# إعداد Supabase لمشروع طفلي ماركت

هذا الدليل ينفذ أول إعداد فعلي للـ Backend: قاعدة البيانات، الأسرار، ودوال Edge Functions.

## 1. إنشاء مشروع Supabase

1. افتح `https://supabase.com/dashboard`.
2. أنشئ Project جديد.
3. اختر اسم مثل `kids-market`.
4. اختر منطقة قريبة من ليبيا إن توفرت.
5. احفظ `Project Ref` من رابط المشروع أو من الإعدادات.

## 2. تشغيل قاعدة البيانات

1. افتح مشروع Supabase.
2. اذهب إلى `SQL Editor`.
3. افتح ملف `supabase/schema.sql` من هذا الريبو.
4. انسخ محتواه بالكامل.
5. الصقه في SQL Editor.
6. اضغط `Run`.

هذا ينشئ الجداول:

- `merchants`
- `facebook_connections`
- `import_jobs`
- `product_drafts`
- `products`

## 3. إضافة الأسرار إلى Supabase

مهم: لا تضف أي Secret يبدأ بـ `SUPABASE_`. هذه القيم موجودة تلقائياً داخل Supabase Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`

من إعدادات المشروع أو عبر CLI أضف القيم المخصصة فقط:

```bash
FACEBOOK_APP_ID=YOUR_FACEBOOK_APP_ID
FACEBOOK_APP_SECRET=YOUR_FACEBOOK_APP_SECRET
FACEBOOK_REDIRECT_URI=https://qtfqbtymouzcjgsbupcf.supabase.co/functions/v1/facebook-oauth/callback
FACEBOOK_GRAPH_VERSION=v20.0
ADMIN_API_KEY=CHANGE_THIS_TO_A_LONG_RANDOM_SECRET
```

في البداية، قبل إنشاء Meta App، يكفي أن تضيف:

```bash
FACEBOOK_GRAPH_VERSION=v20.0
ADMIN_API_KEY=CHANGE_THIS_TO_A_LONG_RANDOM_SECRET
```

لا تضع أي مفاتيح سرية داخل `index.html` أو `admin.html`.

## 4. نشر دوال Supabase

### خيار A: من جهازك عبر Supabase CLI

بعد تثبيت Supabase CLI وتسجيل الدخول:

```powershell
cd "C:\Users\HP\Documents\Codex\2026-04-27\landing-page-rtl-marketplace-mobile-app"
supabase login
supabase link --project-ref qtfqbtymouzcjgsbupcf
supabase functions deploy admin-review --no-verify-jwt
supabase functions deploy facebook-import --no-verify-jwt
supabase functions deploy facebook-oauth --no-verify-jwt
```

استخدام `--no-verify-jwt` مقصود هنا لأن:

- `admin-review` و `facebook-import` محميتان بـ `ADMIN_API_KEY`.
- `facebook-oauth` تحتاج استقبال callback من Facebook.

### خيار B: من GitHub Actions

تمت إضافة Workflow جاهز في:

`.github/workflows/deploy-supabase-functions.yml`

لاستخدامه:

1. افتح GitHub repo.
2. اذهب إلى `Settings` ثم `Secrets and variables` ثم `Actions`.
3. أضف Secret باسم `SUPABASE_ACCESS_TOKEN`.
4. افتح تبويب `Actions`.
5. شغل Workflow باسم `Deploy Supabase Functions` يدويا.

ملاحظة: `Project Ref` الخاص بهذا المشروع محفوظ داخل ملف الـ workflow لأنه قيمة عامة وليست كلمة سر:
`qtfqbtymouzcjgsbupcf`.

هذا الخيار ينشر الدوال فقط. الأسرار مثل `FACEBOOK_APP_SECRET` و `ADMIN_API_KEY` يجب أن تكون محفوظة داخل Supabase Function secrets.

## 5. اختبار لوحة الإدارة

1. افتح `admin.html`.
2. أدخل رابط الدالة:
   `https://qtfqbtymouzcjgsbupcf.supabase.co/functions/v1/admin-review`
3. أدخل قيمة `ADMIN_API_KEY`.
4. اضغط `حفظ وجلب المسودات`.

لو لم تكن هناك مسودات، ستظهر رسالة فارغة وهذا طبيعي.

## 6. اختبار إدخال تاجر يدوي

قبل ربط فيسبوك، يمكنك إدخال تاجر تجريبي من Supabase Table Editor داخل جدول `merchants`:

- `store_name`: محل تجريبي
- `city`: طرابلس
- `whatsapp_phone`: 218912345678
- `status`: active

بعدها نستخدم هذا التاجر عند تجربة ربط Facebook Page.
