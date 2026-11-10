-- email-auth-migration.sql
-- يحافظ على بيانات الملف الشخصي الموجودة، ويضيف رقم الهاتف عند توفره.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_full_name text;
begin
  v_phone := nullif(
    trim(coalesce(new.phone, new.raw_user_meta_data ->> 'phone', '')),
    ''
  );

  v_full_name := nullif(
    trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')),
    ''
  );

  -- لا تسمح بتسجيل رقم هاتف مرتبط بحساب آخر.
  -- نترك الهاتف فارغًا بدلًا من إفشال إنشاء حساب البريد بالكامل.
  if v_phone is not null and exists (
    select 1
    from public.profiles p
    where p.phone = v_phone
      and p.id <> new.id
  ) then
    v_phone := null;
  end if;

  insert into public.profiles (id, phone, full_name, role)
  values (
    new.id,
    v_phone,
    coalesce(v_full_name, ''),
    'customer'
  )
  on conflict (id) do update
  set
    full_name = coalesce(
      nullif(public.profiles.full_name, ''),
      excluded.full_name
    ),
    phone = coalesce(
      public.profiles.phone,
      excluded.phone
    );

  return new;
end;
$$;