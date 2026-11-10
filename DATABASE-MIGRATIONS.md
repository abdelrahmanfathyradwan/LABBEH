# ترحيلات قاعدة البيانات

كل التغييرات **إضافية وغير هدّامة**: لا حذف جداول، ولا حذف صفوف، ولا إعادة إنشاء بيانات. نفّذ الملفات مرة واحدة بالترتيب في Supabase SQL Editor.

## الترتيب الإلزامي

| # | الملف | متى يُنفَّذ | الغرض |
|---|---|---|---|
| 1 | `schema.sql` | على مشروع جديد | الجداول، الفهارس، الدوال، RLS، التخزين، Realtime |
| 2 | `email-auth-migration.sql` | بعد `schema.sql` وقبل أول تسجيل مستخدم | حفظ الاسم والجوال الاختياريين مع Email OTP |
| 3 | `production-hardening.sql` | بعد الملفين السابقين | **الترحيل النهائي الوحيد**: الحقول، السياسات، الحمايات، آلات الحالة، السائق، التاجر، المخزون، Storage، الجوال المكرر |
| 4 | `labbeh-security-patch.sql` | اختياري بعد الملف 3 | حارس توافق فقط: لا ينفّذ أي DDL ولا يغيّر أي سياسة |

> لا تنفّذ `production-hardening.sql` قبل `schema.sql`؛ يعتمد على الجداول والدوال الموجودة فيه.
>
> **الملف 3 هو المصدر الوحيد لتغييرات DDL.** أُدمجت كل إصلاحات الملف 4 فيه بتاريخ 2026-11-10 (الإصدار `2026-11-10.3`).
> الملف 4 أصبح واجهة تحقق: إن نُفّذ قبل الملف 3 يرفع استثناءً واضحًا، وإن نُفّذ بعده يطبع notice فقط.
> لذلك **لم يعد ممكنًا** أن يؤدي تشغيل الملف 4 إلى إضعاف السياسات أو تكرارها. لا تُعِد تعريف أي سياسة أو trigger في الملف 4.
>
> لا تفترض أن SQL Editor يتجاوز الحمايات؛ بعد الملف 3 تصبح تعديلات الأدوار من SQL Editor مرفوضة ما لم يوجد `auth.uid()` مدير.

### ترتيب إنشاء أول مدير (مهم)

**الحالة الحالية: أول حساب مدير أُنشئ بالفعل ودوره `admin`، ولوحة `/admin` تعمل. لا تُعد إنشاء المدير ولا ترقيته، ولا تُنفّذ أي استعلام أدوار من SQL Editor.**

حماية `guard_profile_role_change` في الملف 3 تمنع تغيير الدور عندما يكون `auth.uid()` فارغًا (SQL Editor). لذلك على أي تثبيت جديد:

1. نفّذ الملفين 1 و2.
2. أنشئ أول حساب من `/login` وأكمل OTP.
3. رقِّ الحساب إلى `admin` من SQL Editor **قبل** تنفيذ الملف 3.
4. نفّذ الملف 3. الملف 4 اختياري ولا يغيّر شيئًا.
5. أنشئ بقية الحسابات ورقِّها من `/admin` > المستخدمون، وليس من SQL Editor.

إذا كان الملف 3 مطبقًا بالفعل ولا يوجد مدير، فلا تحاول تعديل الدور مباشرة؛ استخدم إجراء صيانة موثّقًا بموافقة مالك المنصة يعطّل trigger الحماية داخل معاملة ويعيد تفعيله فورًا. راجع `supabase/ADMIN-SETUP.md`.

## 1. schema.sql

ينشئ:

- الجداول: `profiles`، `settings`، `stores`، `products`، `orders`، `custom_orders`، `global_orders`.
- الفهارس الأساسية للمتاجر والطلبات.
- `handle_new_user` لإنشاء ملف عميل عند التسجيل، ودالة `is_admin`.
- `delivery_quote` و`place_market_order` و`submit_custom_request` و`submit_global_request` و`update_driver_location`.
- سياسات RLS لكل الجداول.
- حماية تحديث الطلبات المسندة `guard_assigned_order_update`.
- حاوية `request-images` العامة للقراءة مع رفع للمسجلين فقط.
- إضافة جداول الطلبات و`profiles` إلى `supabase_realtime`.
- إعدادات افتراضية: عمولة 15%، رسم أساس 1000، رسم كيلومتر 300.

### ملاحظات تنفيذ
- إذا أعاد SQL Editor إنشاء trigger موجود مسبقًا، فالملف يستخدم `drop trigger if exists` قبل الإنشاء.
- إذا ظهر خطأ `relation "supabase_realtime" does not exist`، تحقق من أن Realtime مفعّل في المشروع ثم أعد تنفيذ سطور `alter publication`.
- إذا ظهر `already member of publication`، فهذا يعني أن الجدول مضاف مسبقًا ويمكن تجاهل الخطأ.

## 2. email-auth-migration.sql

يستبدل `handle_new_user` بنسخة:

- تقرأ `full_name` و`phone` من `raw_user_meta_data`.
- تنشئ الدور `customer` فقط.
- تحافظ على الجوال الموجود عند تعارض البريد مع حساب سابق.
- تستخدم `set search_path = ''` لتقليل سطح الهجوم.

> إذا كان الجوال مسجلًا لحساب آخر، فالملف 3 يعالج `unique_violation` كي لا يفشل إنشاء الحساب. الملف 2 وحده لا يضمن ذلك.

## 3. production-hardening.sql

### الحقول المضافة
| الجدول | الحقول |
|---|---|
| `orders` | `notes`، `restocked_at` |
| `custom_orders` | `title`، `image_url`، `admin_response`، `admin_response_at` |
| `stores` | `cover_url`، `category`، `phone`، `is_open` |

مع فهرسين على تصنيف المنتجات والمتاجر، و4 فهارس إضافية لتغطية استعلامات اللوحات وفحوص الملكية في RLS
(`stores.owner_id` و`orders(store_id, created_at)` و`custom_orders(driver_id, status)` و`global_orders(driver_id, status)`)،
ودالة إصدار `labbeh_hardening_version()` تعيد `2026-11-10.3`.

### السياسات والحمايات
- `profiles_self_update`: المستخدم يعدّل ملفه فقط. `guard_profile_role_change` يمنع تغيير `id` أو `role` أو `created_at` أو `lat/lng/location_updated_at`؛ الموقع يُكتب فقط عبر `update_driver_location` التي تضع علامة معاملة محلية `labbeh.allow_location_update`.
- `profiles_admin_update`: المدير يعدّل أي ملف لتعيين الأدوار.
- `stores_public_read` (لـ`anon`): المتاجر النشطة فقط. `stores_authenticated_read`: النشطة، أو متجر التاجر صاحب الدور `merchant`، أو المدير.
- `stores_owner_update`: `owner_id = auth.uid() AND is_merchant()`، و`guard_store_owner_update` يمنع تغيير `owner_id` أو `status` أو `created_at`؛ `is_open` يبقى قابلًا للتعديل من لوحة التاجر.
- `enforce_store_merchant_role`: يمنع مالكًا خُفّض إلى عميل من تعديل متجره حتى لو تجاوز RLS، ويتحقق من الملكية عند `INSERT`/`UPDATE`/`DELETE` أيضًا (وليس الدور فقط).
- `products_public_read` (لـ`anon`) و`products_authenticated_read`: يعرضان المنتجات النشطة من متجر نشط، ويضيفان للتاجر صاحب الدور منتجات متجره غير النشطة، وللمدير الكل.
- `products_owner_insert/update/delete`: `is_admin()` أو (`is_merchant()` AND ملكية المتجر).
- `orders_read`: العميل صاحب الطلب، السائق المسند، المدير، أو تاجر يملك المتجر **وبدور `merchant`**.
- `orders_merchant_update`: `is_merchant()` + ملكية المتجر.
- استُبدلت السياسات الفضفاضة القديمة من `schema.sql` صراحةً: يسقط الملف 3 `orders_update` و`custom_orders_update` و`global_orders_update` (كانت تسمح للسائق أو المدير بتحديث كل الأعمدة) وينشئ بدلًا منها `orders_driver_update` و`orders_admin_update` و`custom_orders_driver_update` و`custom_orders_admin_update` و`global_orders_driver_update` و`global_orders_admin_update`. لا تتراكم سياسات متساهلة عند إعادة التنفيذ.
- `ensure_profile`: لا يعيد `lat/lng/location_updated_at` إطلاقًا؛ يعيد `id/full_name/phone/role/created_at` فقط، والموقع يبقى محصورًا بدالة السائق.
- `enforce_order_actor_role`: المدير، أو سائق مسند لا يزال دوره `driver`، أو تاجر؛ وهذا يمنع حسابًا فقد دور السائق من استخدام صلاحيات السائق.
- `validate_order_driver_state`: `driver_id` الجديد/المتغيّر يجب أن يشير إلى `role='driver'`، والحالات `assigned/on_delivery/delivered` تتطلب سائقًا.
- `aa_prevent_active_driver_demotion`: يمنع خفض دور سائق لديه طلب غير منتهٍ في الجداول الثلاثة.
- استُبدلت الحماية العامة `guard_assigned_order_update` بثلاث حمايات مستقلة: `guard_market_order_update` و`guard_custom_order_update` و`guard_global_order_update`.

### آلات الحالة المفروضة في قاعدة البيانات

| النوع | التاجر | السائق | المدير |
|---|---|---|---|
| طلبات المتاجر `orders` | `pending → processing` أو `pending → cancelled` فقط، وتغيير الحالة فقط | `assigned → on_delivery → delivered` فقط، وتغيير الحالة فقط | `pending → processing`، وأي حالة غير نهائية `→ assigned`، والإلغاء، و`assigned → on_delivery → delivered` |
| الطلبات الخاصة `custom_orders` | — | `assigned` أو `processing → on_delivery → delivered` فقط | `pending → processing`، وأي حالة غير نهائية `→ assigned`، والإلغاء، والتسليم من `on_delivery` |
| طلبات شي إن `global_orders` | — | `assigned` أو `processing → on_delivery → delivered` فقط | `pending_review → quoted → approved`، و`assigned → processing`، وأي حالة غير نهائية `→ assigned`، والإلغاء، والتسليم من `on_delivery` |

قواعد مشتركة لكل الحمايات:
- `id` و`customer_id` (و`store_id` في طلبات المتاجر) غير قابلة للتغيير من أي دور.
- **الطلب `delivered` أو `cancelled` مجمّد بالكامل**: `zz_freeze_final_orders` يمنع أي تعديل على أي حقل، بما في ذلك من المدير. حمايات المدير ترفض أيضًا أي تحديث لصف نهائي.
- الانتقالات مقيّدة بـ`validate_order_status_transition`: لا قفز بين المراحل ولا رجوع للخلف. الاستثناءان المقصودان: أي حالة غير نهائية `→ cancelled`، وأي حالة غير نهائية `→ assigned` (مع سائق صالح).
- لا يمكن الانتقال إلى `assigned` أو `on_delivery` أو `delivered` دون `driver_id` يشير إلى حساب `driver`.
- التاجر والسائق يستطيعان تغيير `status` فقط؛ أي حقل آخر (customer/address/financial/driver) يرفع استثناءً.
- المدير يصحّح الحقول في الحالات غير النهائية فقط، وفق المصفوفة أعلاه.

### إعادة المخزون عند الإلغاء
- `orders.restocked_at` يُسجّل لحظة الإلغاء، و`restock_cancelled_market_order` يعيد كميات `items` إلى `products` **مرة واحدة فقط**.
- إعادة المحاولة على طلب ملغى، أو تعديل طلب `delivered`، لا يعيد المخزون (الحمايات والـfreeze تمنعها).
- الطلبات الملغاة **قبل** الترحيل تبقى `restocked_at = null` ولا يُعاد مخزونها بأثر رجعي.
- الطلبات الخاصة وشي إن لا تملك منتجات مرتبطة، فلا إعادة مخزون لها.

### الدوال
- `delivery_quote`: أصبحت `SECURITY INVOKER` مع `search_path = ''`، تتحقق من الإحداثيات، وتعيد نفس الصيغة: 1000 لأول 2 كم + 300 لكل كم إضافي (تقريب لأعلى)، مع `null` للمسافة عند غياب الإحداثيات.
- `place_market_order` (8 معاملات مع `p_notes`): يتحقق من الجلسة والمدخلات، يرفض المتجر غير النشط أو المغلق، يقفل صفوف المنتجات، يحسب المجموع والرسوم على الخادم، ويحدّ السلة بـ50 عنصرًا.
- `submit_custom_request` (8 معاملات مع `p_title` و`p_image_url`): تحقق من الأطوال وأن رابط الصورة `http/https` فقط.
- `submit_global_request` (9 معاملات): تحقق من الأطوال وأن رابطي المنتج والصورة `http/https` فقط.
- `update_driver_location`: للسائقين فقط، مع التحقق من نطاق الإحداثيات.
- `ensure_profile`: إنشاء ملف آمن بدور `customer` إذا فُقد ملف المستخدم بعد التحقق.
- `admin_list_users`: دالة `security definer` تعيد قائمة المستخدمين مع البريد **للمدير فقط**؛ غير المدير يحصل على صفر صفوف.
- جميع دوال `SECURITY DEFINER` تستخدم `search_path = ''` وتؤهل أسماء الجداول والمخططات.

### التخزين
- إنشاء `request-images` و`product-images` العامتين للقراءة فقط.
- حد **5 ميجابايت** وأنواع `image/jpeg` و`image/png` و`image/webp` و`image/gif` على مستوى الحاوية (`file_size_limit` و`allowed_mime_types`) وعلى مستوى سياسة الإدراج/التحديث. SVG مستبعد.
- رفع/تعديل/حذف صور المنتجات لتاجر يملك المتجر **وبدور `merchant`** داخل مجلد `store_id/` أو للمدير.
- رفع `request-images` للمسجلين داخل `shein-requests` أو `custom-requests` فقط، دون سياسات تعديل أو حذف.
- إن لم تتوفر أعمدة حدود الحاوية في إصدار Storage الحالي، يطبع الترحيل notice ويبقى التحقق في السياسات؛ اضبط الحدود من Dashboard.

### Realtime
- إضافة `orders` و`custom_orders` و`global_orders` و`profiles` إلى `supabase_realtime` بشكل تكرار آمن (لا يضيف الجدول مرتين)، مع ملاحظة فقط إن كانت منشورة Realtime غير موجودة.

### الصلاحيات
- إلغاء `EXECUTE` الافتراضي من `PUBLIC` و`anon` و`authenticated` عن دوال `SECURITY DEFINER` وحمايات triggers.
- `is_admin()` متاحة لـ`anon` و`authenticated` لأن سياسات RLS العامة تعتمد عليها.
- `is_merchant()` متاحة لـ`authenticated` فقط؛ سياسات `anon` لا تستدعيها.
- `delivery_quote` متاحة لـ`anon` و`authenticated`.
- دوال الطلب والموقع و`ensure_profile` و`admin_list_users` و`labbeh_hardening_version` متاحة لـ`authenticated` فقط.
- `handle_new_user` (دالة trigger) غير قابلة للاستدعاء المباشر من `anon` أو `authenticated`.

## 4. labbeh-security-patch.sql

**حالة الملف: مُدمج ومُلغى فعليًا (2026-11-10).** يحتوي الآن على `begin; ... commit;` مع فحص
وجود `labbeh_hardening_version()` ثم notice فقط. **لا ينفّذ أي DDL**، لذلك:

- إن نُفّذ بعد الملف 3: لا يغيّر أي سياسة أو trigger ولا يضعف الأمان.
- إن نُفّذ قبل الملف 3: يرفع استثناءً يطلب تنفيذ `production-hardening.sql` أولًا.
- لا تُعِد إلى هذا الملف أي `drop policy` أو `create policy` أو triggers؛ عدّل الملف 3 فقط وحدّث رقم الإصدار.

### لماذا لا توجد triggers على `products`

`place_market_order` وtrigger إعادة المخزون يعدّلان `products` بدور `SECURITY DEFINER` بينما
`auth.uid()` هو العميل/التاجر. إضافة trigger لدور التاجر على `products` كانت ستعطّل إتمام
الطلب. لذلك تُفرض صلاحيات المنتجات في السياسات فقط، بينما تُفرض أدوار المتاجر والطلبات
بـ triggers إضافية.

### مخاطر وتغييرات سلوكية يجب اعتمادها قبل التنفيذ

- المدير يفقد القدرة على تصحيح الحالة **للخلف** (مثل `processing → pending` أو `on_delivery → processing`). التصحيح المتاح هو الإلغاء أو إعادة الإسناد.
- الطلب `delivered` أو `cancelled` يصبح غير قابل للتعديل نهائيًا حتى للمدير. أي تصحيح يتطلب إجراء صيانة موثّقًا.
- كتابات SQL Editor على المتاجر والطلبات والملفات الشخصية تظل مرفوضة بسبب الحمايات (لا يوجد `auth.uid()`).
- أي أداة داخلية تستخدم `service_role` دون جلسة مستخدم ستُرفض من triggers الأدوار الجديدة؛ التطبيق لا يستخدم `service_role`.
- الطلبات الملغاة **قبل** التطبيق لا يُعاد مخزونها بأثر رجعي (`restocked_at` يبدأ فارغًا).
- الملفات المرفوعة سابقًا بحجم >5MB أو بصيغة غير مدعومة تبقى كما هي؛ القيود تسري على الرفع الجديد.
- لا يوجد سجل تاريخي للحالات؛ المصفوفة تمنع الانتقالات غير الصالحة لكنها لا تضيف audit trail.

### تحقق ما بعد التطبيق

استعلامات التحقق موجودة في نهاية `supabase/labbeh-security-patch.sql` (معطّلة كتعليقات):
الإصدار، الدوال و`prosecdef`، السياسات، triggers، وحدود الحاويات. نفّذها منفصلة وبقراءة فقط
بعد التطبيق، ثم اختبر P1–P16 وG7–G13 في `TEST-CHECKLIST.md` بجلسات حقيقية. ابدأ دائمًا بـ:

```sql
select public.labbeh_hardening_version();
-- المتوقع: 2026-11-10.3
```

## التحقق بعد التنفيذ

نفّذ الاستعلامات التالية في SQL Editor وتأكد من النتائج:

```sql
-- الأعمدة الجديدة
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'orders' and column_name in ('notes','restocked_at')) or
    (table_name = 'custom_orders' and column_name in ('title','image_url','admin_response','admin_response_at')) or
    (table_name = 'stores' and column_name in ('cover_url','category','phone','is_open'))
  )
order by table_name, column_name;
-- المتوقع: 10 صفوف

-- السياسات
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and policyname in (
    'profiles_self_update','profiles_admin_update',
    'stores_public_read','stores_authenticated_read','stores_owner_update',
    'products_public_read','products_authenticated_read',
    'products_owner_insert','products_owner_update','products_owner_delete',
    'orders_read','orders_merchant_update',
    'orders_driver_update','orders_admin_update',
    'custom_orders_driver_update','custom_orders_admin_update',
    'global_orders_driver_update','global_orders_admin_update'
  )
order by tablename, policyname;
-- المتوقع: 18 صفًا

-- يجب ألا تظهر السياسات الفضفاضة القديمة
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and policyname in ('orders_update','custom_orders_update','global_orders_update');
-- المتوقع: 0 صفوف

-- الحمايات الجديدة، ويجب ألا تظهر guard_assigned_order_update
select tgname, tgrelid::regclass
from pg_trigger
where not tgisinternal
  and tgname in (
    'guard_profile_role_change','guard_store_owner_update',
    'guard_orders_update','guard_custom_orders_update','guard_global_orders_update'
  )
order by 2, 1;
-- المتوقع: 5 صفوف على profiles/stores/orders/custom_orders/global_orders

select proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in (
    'guard_market_order_update','guard_custom_order_update',
    'guard_global_order_update','guard_assigned_order_update'
  )
order by 1;
-- المتوقع: 3 صفوف، دون guard_assigned_order_update

-- إعدادات البحث والأمان للدوال
select p.proname, p.prosecdef, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'is_admin','is_merchant','ensure_profile','admin_list_users','delivery_quote',
    'place_market_order','submit_custom_request','submit_global_request',
    'update_driver_location','labbeh_hardening_version',
    'guard_profile_role_change','guard_store_owner_update',
    'guard_market_order_update','guard_custom_order_update','guard_global_order_update',
    'enforce_store_merchant_role','enforce_order_actor_role',
    'restock_cancelled_market_order','validate_order_driver_state',
    'validate_order_status_transition','freeze_final_order',
    'prevent_active_driver_demotion'
  )
order by p.proname;
-- المتوقع: proconfig يحتوي search_path="" لكل الدوال،
-- وprosecdef=false فقط لـdelivery_quote وlabbeh_hardening_version

-- الصلاحيات: يجب ألا يظهر أي سطر grantee = PUBLIC
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'is_admin','is_merchant','ensure_profile','admin_list_users','delivery_quote',
    'place_market_order','submit_custom_request','submit_global_request',
    'update_driver_location','handle_new_user','labbeh_hardening_version'
  )
order by routine_name, grantee;
-- المتوقع: لا grantee = PUBLIC، وis_merchant لـauthenticated فقط

-- الحاويات
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id in ('request-images','product-images');
-- المتوقع: صفان، public = true، file_size_limit = 5242880، أربعة أنواع MIME

-- Realtime
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
order by tablename;
-- المتوقع: orders, custom_orders, global_orders, profiles
```

> إذا لم تظهر الدوال الجديدة في PostgREST بعد التنفيذ، أعد تحميل مخطط API من
> Dashboard → Project Settings → API → Reload schema cache.

## اختبارات SQL للصلاحيات (بعد إنشاء حسابات تجريبية)

تُنفّذ من تطبيق العميل أو من جلسة مصادقة حقيقية (JWT لصاحب الدور)، وليس من SQL Editor
الذي يعمل بصلاحيات عالية. أنشئ على الأقل: عميلين، تاجرين لكل منهما متجر، سائقين، ومديرًا.

| # | الاختبار | المتوقع |
|---|---|---|
| S1 | عميل يقرأ طلب عميل آخر | صفر صفوف |
| S2 | عميل يحدّث حالة طلبه أو حقوله المالية | مرفوض (لا سياسة UPDATE) |
| S3 | تاجر يقرأ طلبات متجر آخر أو يحدّثها | صفر صفوف / مرفوض |
| S4 | تاجر يحوّل `pending → processing` | ناجح |
| S5 | تاجر يحوّل `pending → cancelled` | ناجح |
| S6 | تاجر يحوّل `processing → cancelled` | استثناء من trigger |
| S7 | تاجر يحاول تعيين `delivered` أو تغيير `driver_id` أو `total` | استثناء من trigger |
| S8 | سائق يقرأ طلبًا غير مسند إليه | صفر صفوف |
| S9 | سائق يحوّل `assigned → on_delivery → delivered` | ناجح |
| S10 | سائق يحاول `assigned → delivered` مباشرة | استثناء من trigger |
| S11 | سائق يحاول تعديل الحالة إلى `processing` أو تغيير أي حقل آخر | استثناء من trigger |
| S12 | سائق يحاول تعديل طلب `delivered` أو `cancelled` | استثناء من trigger |
| S13 | مدير يعيّن سائقًا (`assigned` مع `driver_id`) | ناجح |
| S14 | مدير يحول إلى `assigned` دون سائق | استثناء من trigger |
| S15 | مدير يسلم طلبًا من غير `on_delivery` | استثناء من trigger |
| S16 | مدير يعيد فتح `delivered` أو `cancelled` | استثناء من trigger |
| S17 | مستخدم يغيّر `role` في ملفه | استثناء من trigger |
| S18 | مستخدم عادي يستدعي `admin_list_users` | صفر صفوف |
| S19 | تاجر يرفع صورة داخل مجلد متجر آخر | مرفوض من سياسة Storage |
| S20 | مستخدم يرفع صورة طلب خارج `shein-requests/custom-requests` | مرفوض من سياسة Storage |
| S21 | عميل يطلب من متجر مغلق `is_open=false` | استثناء من `place_market_order` |
| S22 | عميل يرسل رابط صورة ببروتوكول غير `http/https` | استثناء من دالة الطلب |
| S23 | إنشاء طلب متجر أو طلب خاص أو طلب شي إن بعد الترحيل | ناجح مع احتفاظ بنفس الحقول والحالات |

## التراجع والاسترداد

- الترحيل كله داخل `begin; ... commit;`؛ أي خطأ أثناء التنفيذ يلغي التغييرات تلقائيًا.
- لا يحذف الترحيل جداول أو أعمدة أو صفوفًا أو حاويات، لذلك لا حاجة لاستعادة بيانات.
- إذا احتجت التراجع يدويًا عن الحمايات فقط، أعد تعريف triggers/دوال الحماية من
  `production-hardening.sql` بالنسخة السابقة (نسخة احتياطية). `schema.sql` لا يحتوي
  النسخة الحالية من `guard_market/custom/global_order_update`. هذا **يُضعف الأمان**
  ولا يُنصح به في الإنتاج.
- للاسترداد الكامل عند خطأ غير متوقع: استخدم نسخة احتياطية/PITR من لوحة Supabase،
  أو أنشئ مشروعًا جديدًا وأعد تنفيذ الملفات بالترتيب (1–3؛ والملف 4 اختياري).
- `labbeh-security-patch.sql` لم يعد ينفّذ DDL، فلا يوجد ما يُتراجع عنه فيه.
- التراجع عن حمايات الملف 3 يتطلب إسقاط triggers/دوال الحماية وإعادة تعريف السياسات
  بالنسخة السابقة من `production-hardening.sql` (نسخة احتياطية)، وهو **تخفيض أمني**
  يتطلب موافقة صريحة. لا تعِد تنفيذ `schema.sql` على قاعدة قائمة.
  العمود `orders.restocked_at` إضافي وآمن، ويمكن إبقاؤه عند التراجع عن الحمايات.
- لا تنفّذ `drop table` أو `truncate` أو حذف صفوف على بيانات حقيقية.
