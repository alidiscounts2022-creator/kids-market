# طفلي ماركت

واجهة Landing Page عربية RTL لمشروع "طفلي ماركت"، منصة MVP لعرض منتجات الأطفال في ليبيا وربط الزبائن بالمحلات المحلية عبر واتساب.

## محتويات المشروع

- `index.html`: الواجهة كاملة في ملف واحد، تشمل HTML وCSS وJavaScript.
- `preview-desktop.png`: لقطة معاينة لسطح المكتب.
- `preview-mobile.png`: لقطة معاينة للهاتف.
- `preview-mobile-500.png`: لقطة معاينة لهاتف بعرض أكبر.
- `docs/facebook-import-mvp.md`: خطة ربط فيسبوك واستيراد المنشورات كمسودات.
- `docs/setup-supabase.md`: خطوات إعداد Supabase وتشغيل قاعدة البيانات والدوال.
- `admin.html`: لوحة مراجعة مسودات المنتجات واعتمادها.
- `supabase/schema.sql`: مخطط قاعدة البيانات المقترح.
- `supabase/functions/admin-review`: وظيفة إدارة المسودات واعتماد المنتجات.
- `supabase/functions/facebook-oauth`: وظيفة ربط صفحة فيسبوك.
- `supabase/functions/facebook-import`: وظيفة استيراد منشورات الصفحة.
- `.github/workflows/deploy-supabase-functions.yml`: نشر دوال Supabase عبر GitHub Actions.
- `.env.example`: أسماء المتغيرات المطلوبة لاحقا بدون أي مفاتيح حقيقية.

## التشغيل

افتح ملف `index.html` مباشرة في المتصفح.

## النشر على GitHub Pages

1. ارفع ملفات المشروع إلى Repository جديد في GitHub.
2. افتح إعدادات الريبو.
3. اختر `Pages`.
4. من `Build and deployment` اختر `Deploy from a branch`.
5. اختر الفرع `main` والمجلد `/root`.
6. احفظ الإعدادات وانتظر ظهور رابط الموقع.

## ملاحظة

الموقع للعرض فقط ولا يدير البيع أو الدفع أو التوصيل. التواصل يتم مباشرة بين الزبون والتاجر عبر واتساب.

## مرحلة فيسبوك المقترحة

ابدأ بقراءة `docs/setup-supabase.md` ثم `docs/facebook-import-mvp.md`. الفكرة هي ربط صفحات التجار واستيراد المنشورات إلى جدول `product_drafts` للمراجعة قبل النشر في جدول `products`.

بعد نشر وظائف Supabase، افتح `admin.html` وأدخل:

- رابط دالة الإدارة: `https://qtfqbtymouzcjgsbupcf.supabase.co/functions/v1/admin-review`
- مفتاح الإدارة: نفس قيمة `ADMIN_API_KEY` المحفوظة في Supabase secrets
