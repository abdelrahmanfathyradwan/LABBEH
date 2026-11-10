# إنشاء المدير والحسابات التشغيلية

> **الحالة الحالية (2026-11-10):** أول حساب مدير أُنشئ بالفعل، ودوره `admin`، ولوحة `/admin`
> تعمل. **لا تُعد إنشاء المدير ولا ترقيته ولا تُنفّذ أي استعلام أدوار من SQL Editor.**
> هذا القسم مخصص فقط لتثبيت جديد أو استعادة كاملة.

هذا الدليل يفترض أن `schema.sql` و`email-auth-migration.sql` نُفّذا. الملف
`production-hardening.sql` يمنع تغيير الأدوار من SQL Editor لأن `auth.uid()` فارغ فيه،
لذلك رتّب خطوات أول مدير كما يلي.

## المسار الموصى به لتثبيت جديد: قبل تنفيذ hardening

1. نفّذ `schema.sql` ثم `email-auth-migration.sql`.
2. أنشئ حسابًا عاديًا من صفحة `/login` ببريد إلكتروني تستطيع الوصول إليه، وأكمل رمز OTP.
3. من Supabase Dashboard افتح Authentication > Users وانسخ UUID للحساب.
4. عيّن أول مدير من SQL Editor **قبل** تنفيذ `production-hardening.sql`:

```sql
update public.profiles
set role = 'admin', full_name = 'مدير لبيه'
where id = 'PUT_AUTH_USER_UUID_HERE';
```

5. سجّل الخروج ثم الدخول مجددًا. ستظهر لوحة `/admin`.
6. نفّذ `production-hardening.sql` (الإصدار `2026-11-10.3`) — وهو الترحيل النهائي الوحيد
   ويحتوي كل إصلاحات الأمان السابقة.
7. `labbeh-security-patch.sql` اختياري: حارس تحقق لا ينفّذ أي DDL. لا تضف إليه سياسات.
8. أنشئ حسابي التاجر والسائق من `/login`، ثم غيّر أدوارهما من `/admin` > تبويب المستخدمين.
9. من `/admin` > تبويب المتاجر أنشئ المتجر واربطه بحساب التاجر، ثم فعّله.
10. أدخل إحداثيات المتجر من مصدر موثوق حتى يمكن احتساب المسافة ورسم التوصيل. عند غياب الإحداثيات يُستخدم رسم الأساس فقط.
11. من `/admin` > الإعدادات راجع العمولة ورسم الأساس ورسم الكيلومتر وبيانات التواصل.

بعد تنفيذ `production-hardening.sql` لا تستخدم SQL Editor لتغيير الأدوار؛ استخدم
`/admin`. الحماية `guard_profile_role_change` سترفض أي تعديل بلا جلسة مدير.

## إذا كان hardening مطبقًا بالفعل ولا يوجد أي مدير

هذه حالة استثنائية. لا تحاول تعطيل الحمايات بشكل دائم ولا ترفع `service_role` إلى المتصفح.
بموافقة صريحة من مالك المنصة، وبعد نسخة احتياطية، استخدم معاملة صيانة قصيرة تعطّل trigger
واحدًا فقط ثم تعيد تفعيله في نفس المعاملة:

```sql
begin;
alter table public.profiles disable trigger guard_profile_role_change;

update public.profiles
set role = 'admin', full_name = 'مدير لبيه'
where id = 'PUT_AUTH_USER_UUID_HERE';

alter table public.profiles enable trigger guard_profile_role_change;
commit;
```

بعدها تحقق فورًا:

```sql
select id, role from public.profiles where id = 'PUT_AUTH_USER_UUID_HERE';
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.profiles'::regclass
  and tgname in ('guard_profile_role_change','aa_prevent_active_driver_demotion');
```

يجب أن يعود `tgenabled` إلى `O` للحمايتين (`guard_profile_role_change` و
`aa_prevent_active_driver_demotion`) بعد تطبيق `production-hardening.sql`. لا تعطّل حمايات الطلبات أو المتاجر في أي حال،
ولا تكرر هذا الإجراء إلا لإنشاء أول مدير. إن لم يكن الحساب موجودًا أصلًا، أنشئه من `/login`
وأكمل OTP قبل تنفيذ المعاملة.

## تنبيهات

- لا تنشئ كلمة مرور ثابتة في قاعدة البيانات.
- لا تمنح `admin` إلا بموافقة مالك المنصة.
- لا تستخدم `service_role` داخل التطبيق أو المتصفح.
- تغيير الدور بعد hardening يتم من `/admin` فقط؛ لا توجد واجهة تسجيل مفتوحة للتاجر أو السائق.
- بعد تطبيق `production-hardening.sql` لا يمكن خفض دور سائق لديه طلب غير منتهٍ
  (`assigned/on_delivery/processing`). أنهِ الطلبات أو أعد إسنادها أولًا.
- لا يمكن تعديل طلب `delivered` أو `cancelled` من التطبيق حتى بحساب مدير؛ التصحيح يتطلب
  إجراء صيانة موثّقًا بموافقة مالك المنصة.
- الحسابات التي أنشأها trigger `handle_new_user` تبدأ دائمًا بدور `customer` حتى لو أرسل
  المستخدم بيانات دور في metadata؛ لا تعتمد على metadata لترقية الصلاحيات.
