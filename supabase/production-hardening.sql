-- LABBEH | Final production hardening migration (single source of truth)
-- Version: 2026-11-10.3
--
-- Run ONCE in the Supabase SQL Editor AFTER supabase/schema.sql and
-- supabase/email-auth-migration.sql.
--
-- This file supersedes supabase/labbeh-security-patch.sql. The old patch file
-- is kept only as a guard stub; running it after this file changes nothing.
--
-- Additive and non-destructive: adds columns, functions, triggers and
-- policies. It never drops tables, columns, buckets or rows.
--
-- Role model enforced here:
--   customer : create own orders/requests via RPC, read own rows, never update.
--   merchant : role='merchant' AND owns the store; market orders only.
--   driver   : role='driver', assigned rows, delivery transitions only.
--   admin    : full administrative access, finalized orders stay finalized.
--
-- Trigger naming controls firing order (PostgreSQL fires same-timing triggers
-- in name order): aa_ -> enforce_ -> guard_ -> restock_ -> validate_ -> zz_.

begin;

-- ---------------------------------------------------------------------------
-- 0. Version marker (used by the legacy patch guard and by verification)
-- ---------------------------------------------------------------------------
create or replace function public.labbeh_hardening_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '2026-11-10.3'::text; $$;

-- ---------------------------------------------------------------------------
-- 1. Additive columns
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists notes text;
alter table public.orders add column if not exists restocked_at timestamptz;

alter table public.custom_orders add column if not exists title text;
alter table public.custom_orders add column if not exists image_url text;
alter table public.custom_orders add column if not exists admin_response text;
alter table public.custom_orders add column if not exists admin_response_at timestamptz;

alter table public.stores add column if not exists cover_url text;
alter table public.stores add column if not exists category text;
alter table public.stores add column if not exists phone text;
alter table public.stores add column if not exists is_open boolean not null default true;

create index if not exists idx_products_category on public.products(category);
create index if not exists idx_stores_category on public.stores(category);

-- Cover the filters used by dashboards and RLS ownership checks.
create index if not exists idx_stores_owner on public.stores(owner_id);
create index if not exists idx_orders_store_created on public.orders(store_id, created_at desc);
create index if not exists idx_custom_driver on public.custom_orders(driver_id, status);
create index if not exists idx_global_driver on public.global_orders(driver_id, status);

-- ---------------------------------------------------------------------------
-- 2. Role helper
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER avoids RLS recursion on profiles and fails closed when
-- there is no authenticated user.
create or replace function public.is_merchant()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'merchant'
  );
$$;

revoke all on function public.is_merchant() from public;
revoke all on function public.is_merchant() from anon;
grant execute on function public.is_merchant() to authenticated;

-- Same helper as schema.sql, but with an empty search_path so no caller can
-- hijack name resolution inside a SECURITY DEFINER function.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Profiles: self-service edit without privilege escalation
-- ---------------------------------------------------------------------------
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.guard_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The auth user id is the primary key and must never change, even for admins.
  if new.id is distinct from old.id then
    raise exception 'لا يمكن تغيير معرف الحساب.';
  end if;

  if public.is_admin() then
    return new;
  end if;

  if auth.uid() is null or new.id is distinct from auth.uid() then
    raise exception 'غير مصرح بتعديل هذا الحساب.';
  end if;

  if new.role is distinct from old.role then
    raise exception 'لا يمكنك تغيير صلاحية الحساب.';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'لا يمكن تغيير تاريخ إنشاء الحساب.';
  end if;

  -- Location is written only by update_driver_location(), which sets this
  -- transaction-local flag after verifying the driver role.
  if (new.lat is distinct from old.lat
      or new.lng is distinct from old.lng
      or new.location_updated_at is distinct from old.location_updated_at)
     and coalesce(current_setting('labbeh.allow_location_update', true), '') <> 'on' then
    raise exception 'لا يمكن تعديل الموقع إلا عبر تطبيق السائق.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_role_change on public.profiles;
create trigger guard_profile_role_change
  before update on public.profiles
  for each row execute function public.guard_profile_role_change();

-- A driver holding a live order cannot be demoted. Delivered/cancelled rows
-- may keep pointing at a former driver for history.
create or replace function public.prevent_active_driver_demotion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'driver' and new.role is distinct from 'driver' then
    if exists (
      select 1 from public.orders
      where driver_id = old.id and status not in ('delivered', 'cancelled')
    ) or exists (
      select 1 from public.custom_orders
      where driver_id = old.id and status not in ('delivered', 'cancelled')
    ) or exists (
      select 1 from public.global_orders
      where driver_id = old.id and status not in ('delivered', 'cancelled')
    ) then
      raise exception 'لا يمكن تغيير صلاحية سائق لديه طلبات نشطة. أنهِ الطلبات أو أعد إسنادها أولًا.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists aa_prevent_active_driver_demotion on public.profiles;
create trigger aa_prevent_active_driver_demotion
  before update on public.profiles
  for each row execute function public.prevent_active_driver_demotion();

-- Safe bootstrap for authenticated users whose trigger-created profile is
-- missing. The role is always forced to customer.
create or replace function public.ensure_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_meta jsonb;
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'سجل الدخول أولاً.';
  end if;

  select coalesce(raw_user_meta_data, '{}'::jsonb) into v_meta
  from auth.users
  where id = v_uid;

  if not found then
    raise exception 'تعذر قراءة بيانات الحساب.';
  end if;

  if not exists (select 1 from public.profiles where id = v_uid) then
    begin
      insert into public.profiles (id, full_name, phone, role)
      values (
        v_uid,
        coalesce(v_meta ->> 'full_name', ''),
        nullif(v_meta ->> 'phone', ''),
        'customer'
      )
      on conflict (id) do nothing;
    exception when unique_violation then
      -- The phone is already linked to another profile; create without phone.
      insert into public.profiles (id, full_name, role)
      values (v_uid, coalesce(v_meta ->> 'full_name', ''), 'customer')
      on conflict (id) do nothing;
    end;
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    raise exception 'تعذر تجهيز الملف الشخصي.';
  end if;

  -- Only expose the fields the client needs. Location columns are written
  -- exclusively by update_driver_location() and never returned from here.
  return jsonb_build_object(
    'id', v_profile.id,
    'full_name', v_profile.full_name,
    'phone', v_profile.phone,
    'role', v_profile.role,
    'created_at', v_profile.created_at
  );
end;
$$;

-- Admin-only user directory. Non-admins receive zero rows.
create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  full_name text,
  phone text,
  role text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, u.email::text, p.full_name, p.phone, p.role, p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_admin()
  order by p.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- 4. Stores: merchant role + ownership, sensitive fields immutable
-- ---------------------------------------------------------------------------
drop policy if exists stores_public_read on public.stores;
create policy stores_public_read on public.stores
  for select to anon
  using (status = 'active');

drop policy if exists stores_authenticated_read on public.stores;
create policy stores_authenticated_read on public.stores
  for select to authenticated
  using (
    status = 'active'
    or (public.is_merchant() and owner_id = auth.uid())
    or public.is_admin()
  );

drop policy if exists stores_owner_update on public.stores;
create policy stores_owner_update on public.stores
  for update to authenticated
  using (owner_id = auth.uid() and public.is_merchant())
  with check (owner_id = auth.uid() and public.is_merchant());

create or replace function public.enforce_store_merchant_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_admin() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if not public.is_merchant() then
    raise exception 'هذا الإجراء متاح لحسابات التجار فقط.';
  end if;

  -- Ownership is checked here as well as in RLS so the rule still holds if a
  -- future policy is written too broadly.
  if tg_op = 'INSERT' then
    if new.owner_id is distinct from auth.uid() then
      raise exception 'لا يمكنك إنشاء متجر لحساب آخر.';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.owner_id is distinct from auth.uid()
       or new.owner_id is distinct from old.owner_id then
      raise exception 'لا يمكنك تعديل متجر لا تملكه أو تغيير مالكه.';
    end if;
    return new;
  end if;

  if old.owner_id is distinct from auth.uid() then
    raise exception 'لا يمكنك حذف متجر لا تملكه.';
  end if;
  return old;
end;
$$;

create or replace function public.guard_store_owner_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'لا يمكن تغيير معرف المتجر.';
  end if;

  if public.is_admin() then
    return new;
  end if;

  if auth.uid() is null or old.owner_id is distinct from auth.uid() then
    raise exception 'غير مصرح بتعديل هذا المتجر.';
  end if;

  if new.owner_id is distinct from old.owner_id then
    raise exception 'لا يمكنك تغيير مالك المتجر.';
  end if;

  if new.status is distinct from old.status then
    raise exception 'تغيير حالة المتجر متاح لإدارة المنصة فقط.';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'لا يمكن تغيير تاريخ إنشاء المتجر.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_store_merchant_role on public.stores;
create trigger enforce_store_merchant_role
  before insert or update or delete on public.stores
  for each row execute function public.enforce_store_merchant_role();

drop trigger if exists guard_store_owner_update on public.stores;
create trigger guard_store_owner_update
  before update on public.stores
  for each row execute function public.guard_store_owner_update();

-- ---------------------------------------------------------------------------
-- 5. Products: merchant role + store ownership (no triggers on this table)
-- ---------------------------------------------------------------------------
-- place_market_order() and the restock trigger update products as SECURITY
-- DEFINER with the customer/merchant auth.uid(). A role trigger here would
-- break checkout, so product RBAC stays in the policies.
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon
  using (
    is_active = true
    and exists (
      select 1 from public.stores s
      where s.id = products.store_id and s.status = 'active'
    )
  );

drop policy if exists products_authenticated_read on public.products;
create policy products_authenticated_read on public.products
  for select to authenticated
  using (
    (is_active = true and exists (
      select 1 from public.stores s
      where s.id = products.store_id and s.status = 'active'
    ))
    or (public.is_merchant() and exists (
      select 1 from public.stores s
      where s.id = products.store_id and s.owner_id = auth.uid()
    ))
    or public.is_admin()
  );

drop policy if exists products_owner_insert on public.products;
create policy products_owner_insert on public.products
  for insert to authenticated
  with check (
    public.is_admin()
    or (public.is_merchant() and exists (
      select 1 from public.stores s
      where s.id = products.store_id and s.owner_id = auth.uid()
    ))
  );

drop policy if exists products_owner_update on public.products;
create policy products_owner_update on public.products
  for update to authenticated
  using (
    public.is_admin()
    or (public.is_merchant() and exists (
      select 1 from public.stores s
      where s.id = products.store_id and s.owner_id = auth.uid()
    ))
  )
  with check (
    public.is_admin()
    or (public.is_merchant() and exists (
      select 1 from public.stores s
      where s.id = products.store_id and s.owner_id = auth.uid()
    ))
  );

drop policy if exists products_owner_delete on public.products;
create policy products_owner_delete on public.products
  for delete to authenticated
  using (
    public.is_admin()
    or (public.is_merchant() and exists (
      select 1 from public.stores s
      where s.id = products.store_id and s.owner_id = auth.uid()
    ))
  );

-- ---------------------------------------------------------------------------
-- 6. Orders: read scope and merchant update scope
-- ---------------------------------------------------------------------------
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders
  for select to authenticated
  using (
    customer_id = auth.uid()
    or driver_id = auth.uid()
    or public.is_admin()
    or (public.is_merchant() and exists (
      select 1 from public.stores s
      where s.id = orders.store_id and s.owner_id = auth.uid()
    ))
  );

drop policy if exists orders_merchant_update on public.orders;
create policy orders_merchant_update on public.orders
  for update to authenticated
  using (
    public.is_merchant()
    and exists (
      select 1 from public.stores s
      where s.id = orders.store_id and s.owner_id = auth.uid()
    )
  )
  with check (
    public.is_merchant()
    and exists (
      select 1 from public.stores s
      where s.id = orders.store_id and s.owner_id = auth.uid()
    )
  );

-- Replace the broad legacy policies from schema.sql (driver OR admin, all
-- columns) with explicit per-actor policies. Leaving both in place would keep
-- permissive OR semantics and make future audits unreliable; the column-level
-- rules live in the guards, but the row scope must be explicit here.
drop policy if exists orders_update on public.orders;
drop policy if exists custom_orders_update on public.custom_orders;
drop policy if exists global_orders_update on public.global_orders;

drop policy if exists orders_driver_update on public.orders;
create policy orders_driver_update on public.orders
  for update to authenticated
  using (driver_id = auth.uid())
  with check (driver_id = auth.uid());

drop policy if exists orders_admin_update on public.orders;
create policy orders_admin_update on public.orders
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists custom_orders_driver_update on public.custom_orders;
create policy custom_orders_driver_update on public.custom_orders
  for update to authenticated
  using (driver_id = auth.uid())
  with check (driver_id = auth.uid());

drop policy if exists custom_orders_admin_update on public.custom_orders;
create policy custom_orders_admin_update on public.custom_orders
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists global_orders_driver_update on public.global_orders;
create policy global_orders_driver_update on public.global_orders
  for update to authenticated
  using (driver_id = auth.uid())
  with check (driver_id = auth.uid());

drop policy if exists global_orders_admin_update on public.global_orders;
create policy global_orders_admin_update on public.global_orders
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 7. Per-order-type update guards
--
-- Marketplace (orders):
--   merchant : pending -> processing | cancelled
--   driver   : assigned -> on_delivery -> delivered
--   admin    : corrects non-final rows; delivered only from on_delivery;
--              finalized rows are immutable.
--
-- Custom orders:
--   driver   : assigned|processing -> on_delivery -> delivered
--   admin    : same administrative rules as above
--
-- Global orders:
--   driver   : assigned|processing -> on_delivery -> delivered
--   admin    : keeps business states (pending_review/quoted/approved)
--
-- The per-table status matrix is enforced by
-- validate_order_status_transition() below; these guards enforce actor scope.
-- ---------------------------------------------------------------------------
drop trigger if exists guard_orders_update on public.orders;
drop trigger if exists guard_custom_orders_update on public.custom_orders;
drop trigger if exists guard_global_orders_update on public.global_orders;
drop function if exists public.guard_assigned_order_update();

create or replace function public.guard_market_order_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_merchant boolean := false;
begin
  if new.id is distinct from old.id then
    raise exception 'لا يمكن تغيير معرف الطلب.';
  end if;

  if new.customer_id is distinct from old.customer_id
     or new.store_id is distinct from old.store_id then
    raise exception 'لا يمكن تغيير العميل أو المتجر المرتبط بالطلب.';
  end if;

  if public.is_admin() then
    if old.status in ('delivered', 'cancelled') then
      raise exception 'لا يمكن تعديل طلب منتهٍ أو ملغى.';
    end if;
    if new.status is distinct from old.status then
      if new.status = 'delivered' and old.status <> 'on_delivery' then
        raise exception 'لا يمكن تسليم الطلب قبل بدء التوصيل.';
      end if;
      if new.status = 'assigned' and new.driver_id is null then
        raise exception 'يجب إسناد الطلب إلى سائق قبل تفعيل حالة الإسناد.';
      end if;
    end if;
    new.updated_at := now();
    return new;
  end if;

  if v_uid is null then
    raise exception 'غير مصرح بتعديل هذا الطلب.';
  end if;

  -- Assigned driver: status only, delivery transitions only.
  if old.driver_id = v_uid then
    if new.driver_id is distinct from old.driver_id then
      raise exception 'لا يمكنك تغيير السائق المسند للطلب.';
    end if;
    if (to_jsonb(new) - 'status' - 'updated_at')
       is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'السائق يستطيع تحديث حالة الطلب فقط.';
    end if;
    if new.status is distinct from old.status then
      if old.status in ('delivered', 'cancelled') then
        raise exception 'لا يمكن تعديل طلب منتهٍ.';
      end if;
      if not (
        (old.status = 'assigned' and new.status = 'on_delivery')
        or (old.status = 'on_delivery' and new.status = 'delivered')
      ) then
        raise exception 'الحالة غير مسموحة للسائق.';
      end if;
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- Store owner: accept or reject new market orders only.
  select exists (
    select 1 from public.stores s
    where s.id = old.store_id and s.owner_id = v_uid
  ) into v_is_merchant;

  if v_is_merchant then
    if (to_jsonb(new) - 'status' - 'updated_at')
       is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'التاجر يستطيع تحديث حالة الطلب فقط.';
    end if;
    if new.status is distinct from old.status then
      if old.status <> 'pending' or new.status not in ('processing', 'cancelled') then
        raise exception 'التاجر يستطيع قبول أو رفض الطلبات الجديدة فقط.';
      end if;
    end if;
    new.updated_at := now();
    return new;
  end if;

  raise exception 'غير مصرح بتعديل هذا الطلب.';
end;
$$;

create or replace function public.guard_custom_order_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.id is distinct from old.id then
    raise exception 'لا يمكن تغيير معرف الطلب.';
  end if;

  if new.customer_id is distinct from old.customer_id then
    raise exception 'لا يمكن تغيير العميل المرتبط بالطلب.';
  end if;

  if public.is_admin() then
    if old.status in ('delivered', 'cancelled') then
      raise exception 'لا يمكن تعديل طلب منتهٍ أو ملغى.';
    end if;
    if new.status is distinct from old.status then
      if new.status = 'delivered' and old.status <> 'on_delivery' then
        raise exception 'لا يمكن تسليم الطلب قبل بدء التوصيل.';
      end if;
      if new.status = 'assigned' and new.driver_id is null then
        raise exception 'يجب إسناد الطلب إلى سائق قبل تفعيل حالة الإسناد.';
      end if;
    end if;
    new.updated_at := now();
    return new;
  end if;

  if v_uid is null then
    raise exception 'غير مصرح بتعديل هذا الطلب.';
  end if;

  if old.driver_id = v_uid then
    if new.driver_id is distinct from old.driver_id then
      raise exception 'لا يمكنك تغيير السائق المسند للطلب.';
    end if;
    if (to_jsonb(new) - 'status' - 'updated_at')
       is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'السائق يستطيع تحديث حالة الطلب فقط.';
    end if;
    if new.status is distinct from old.status then
      if old.status in ('delivered', 'cancelled') then
        raise exception 'لا يمكن تعديل طلب منتهٍ.';
      end if;
      if not (
        (old.status in ('assigned', 'processing') and new.status = 'on_delivery')
        or (old.status = 'on_delivery' and new.status = 'delivered')
      ) then
        raise exception 'الحالة غير مسموحة للسائق.';
      end if;
    end if;
    new.updated_at := now();
    return new;
  end if;

  raise exception 'غير مصرح بتعديل هذا الطلب.';
end;
$$;

create or replace function public.guard_global_order_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.id is distinct from old.id then
    raise exception 'لا يمكن تغيير معرف الطلب.';
  end if;

  if new.customer_id is distinct from old.customer_id then
    raise exception 'لا يمكن تغيير العميل المرتبط بالطلب.';
  end if;

  if public.is_admin() then
    if old.status in ('delivered', 'cancelled') then
      raise exception 'لا يمكن تعديل طلب منتهٍ أو ملغى.';
    end if;
    if new.status is distinct from old.status then
      if new.status = 'delivered' and old.status <> 'on_delivery' then
        raise exception 'لا يمكن تسليم الطلب قبل بدء التوصيل.';
      end if;
      if new.status = 'assigned' and new.driver_id is null then
        raise exception 'يجب إسناد الطلب إلى سائق قبل تفعيل حالة الإسناد.';
      end if;
    end if;
    new.updated_at := now();
    return new;
  end if;

  if v_uid is null then
    raise exception 'غير مصرح بتعديل هذا الطلب.';
  end if;

  if old.driver_id = v_uid then
    if new.driver_id is distinct from old.driver_id then
      raise exception 'لا يمكنك تغيير السائق المسند للطلب.';
    end if;
    if (to_jsonb(new) - 'status' - 'updated_at')
       is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'السائق يستطيع تحديث حالة الطلب فقط.';
    end if;
    if new.status is distinct from old.status then
      if old.status in ('delivered', 'cancelled') then
        raise exception 'لا يمكن تعديل طلب منتهٍ.';
      end if;
      if not (
        (old.status in ('assigned', 'processing') and new.status = 'on_delivery')
        or (old.status = 'on_delivery' and new.status = 'delivered')
      ) then
        raise exception 'الحالة غير مسموحة للسائق.';
      end if;
    end if;
    new.updated_at := now();
    return new;
  end if;

  raise exception 'غير مصرح بتعديل هذا الطلب.';
end;
$$;

create trigger guard_orders_update
  before update on public.orders
  for each row execute function public.guard_market_order_update();

create trigger guard_custom_orders_update
  before update on public.custom_orders
  for each row execute function public.guard_custom_order_update();

create trigger guard_global_orders_update
  before update on public.global_orders
  for each row execute function public.guard_global_order_update();

-- ---------------------------------------------------------------------------
-- 8. Driver role and presence
-- ---------------------------------------------------------------------------
-- A new/changed driver_id must reference role='driver'. Statuses that imply
-- delivery work must carry a driver. Legacy rows are not rewritten; the role
-- check only applies when driver_id is inserted or changed.
create or replace function public.validate_order_driver_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver uuid := (to_jsonb(new) ->> 'driver_id')::uuid;
  v_status text := to_jsonb(new) ->> 'status';
begin
  -- Unrelated edits on legacy rows must not be blocked by an old null driver.
  if tg_op = 'UPDATE'
     and v_status is not distinct from old.status
     and v_driver is not distinct from old.driver_id then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if v_driver is not null and not exists (
      select 1 from public.profiles where id = v_driver and role = 'driver'
    ) then
      raise exception 'السائق المحدد ليس حساب سائق صالحًا.';
    end if;
  elsif v_driver is distinct from old.driver_id then
    if v_driver is not null and not exists (
      select 1 from public.profiles where id = v_driver and role = 'driver'
    ) then
      raise exception 'السائق المحدد ليس حساب سائق صالحًا.';
    end if;
  end if;

  if v_status in ('assigned', 'on_delivery', 'delivered') and v_driver is null then
    raise exception 'يجب إسناد الطلب إلى سائق قبل هذه الحالة.';
  end if;

  -- Re-check the current role on delivery-related transitions, so a legacy
  -- row pointing at an account that is no longer a driver cannot advance.
  if v_status in ('assigned', 'on_delivery', 'delivered') and v_driver is not null
     and not exists (
       select 1 from public.profiles where id = v_driver and role = 'driver'
     ) then
    raise exception 'السائق المحدد ليس حساب سائق صالحًا.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_order_driver_state on public.orders;
create trigger validate_order_driver_state
  before insert or update on public.orders
  for each row execute function public.validate_order_driver_state();

drop trigger if exists validate_order_driver_state on public.custom_orders;
create trigger validate_order_driver_state
  before insert or update on public.custom_orders
  for each row execute function public.validate_order_driver_state();

drop trigger if exists validate_order_driver_state on public.global_orders;
create trigger validate_order_driver_state
  before insert or update on public.global_orders
  for each row execute function public.validate_order_driver_state();

-- ---------------------------------------------------------------------------
-- 9. Actor role (defense in depth behind RLS)
-- ---------------------------------------------------------------------------
create or replace function public.enforce_order_actor_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if public.is_admin() then
    return new;
  end if;

  if v_uid is null then
    raise exception 'غير مصرح بتعديل هذا الطلب.';
  end if;

  if old.driver_id = v_uid then
    if not exists (
      select 1 from public.profiles
      where id = v_uid and role = 'driver'
    ) then
      raise exception 'صلاحية السائق غير فعّالة.';
    end if;
    return new;
  end if;

  if not public.is_merchant() then
    raise exception 'غير مصرح بتعديل هذا الطلب.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_order_actor_role on public.orders;
create trigger enforce_order_actor_role
  before update on public.orders
  for each row execute function public.enforce_order_actor_role();

drop trigger if exists enforce_order_actor_role on public.custom_orders;
create trigger enforce_order_actor_role
  before update on public.custom_orders
  for each row execute function public.enforce_order_actor_role();

drop trigger if exists enforce_order_actor_role on public.global_orders;
create trigger enforce_order_actor_role
  before update on public.global_orders
  for each row execute function public.enforce_order_actor_role();

-- ---------------------------------------------------------------------------
-- 10. Status transition matrix (all three order tables)
-- ---------------------------------------------------------------------------
-- Non-final -> cancelled and non-final -> assigned are always allowed; the
-- driver-role and actor triggers validate who may perform them.
--   orders        : pending -> processing; assigned -> on_delivery -> delivered
--   custom_orders : pending -> processing; assigned|processing -> on_delivery
--   global_orders : pending_review -> quoted -> approved;
--                   assigned -> processing; assigned|processing -> on_delivery
create or replace function public.validate_order_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text := old.status;
  v_new text := new.status;
begin
  if v_new is not distinct from v_old then
    return new;
  end if;

  if v_old in ('delivered', 'cancelled') then
    raise exception 'لا يمكن إعادة فتح طلب منتهٍ أو ملغى.';
  end if;

  if v_new = 'cancelled' then
    return new;
  end if;

  if v_new = 'assigned' then
    return new;
  end if;

  if tg_table_name = 'orders' then
    if (v_old = 'pending' and v_new = 'processing')
       or (v_old = 'assigned' and v_new = 'on_delivery')
       or (v_old = 'on_delivery' and v_new = 'delivered') then
      return new;
    end if;
  elsif tg_table_name = 'custom_orders' then
    if (v_old = 'pending' and v_new = 'processing')
       or (v_old in ('assigned', 'processing') and v_new = 'on_delivery')
       or (v_old = 'on_delivery' and v_new = 'delivered') then
      return new;
    end if;
  elsif tg_table_name = 'global_orders' then
    if (v_old = 'pending_review' and v_new = 'quoted')
       or (v_old = 'quoted' and v_new = 'approved')
       or (v_old = 'assigned' and v_new = 'processing')
       or (v_old in ('assigned', 'processing') and v_new = 'on_delivery')
       or (v_old = 'on_delivery' and v_new = 'delivered') then
      return new;
    end if;
  end if;

  raise exception 'انتقال الحالة غير مسموح: من % إلى %.', v_old, v_new;
end;
$$;

drop trigger if exists validate_order_status_transition on public.orders;
create trigger validate_order_status_transition
  before update on public.orders
  for each row execute function public.validate_order_status_transition();

drop trigger if exists validate_order_status_transition on public.custom_orders;
create trigger validate_order_status_transition
  before update on public.custom_orders
  for each row execute function public.validate_order_status_transition();

drop trigger if exists validate_order_status_transition on public.global_orders;
create trigger validate_order_status_transition
  before update on public.global_orders
  for each row execute function public.validate_order_status_transition();

-- ---------------------------------------------------------------------------
-- 11. Cancellation restock, exactly once (market orders only)
-- ---------------------------------------------------------------------------
-- Rows cancelled before this migration keep restocked_at = null and are never
-- restocked retroactively. The trigger only runs on the transition into
-- cancelled and records restocked_at in the same statement.
create or replace function public.restock_cancelled_market_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_qty integer;
begin
  if old.status in ('delivered', 'cancelled') then
    return new;
  end if;

  if new.status <> 'cancelled' or old.restocked_at is not null then
    return new;
  end if;

  if jsonb_typeof(old.items) = 'array' then
    for v_item in select value from jsonb_array_elements(old.items) loop
      if jsonb_typeof(v_item) = 'object'
         and (v_item ->> 'product_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and (v_item ->> 'quantity') ~ '^[0-9]{1,3}$' then
        v_qty := (v_item ->> 'quantity')::integer;
        if v_qty > 0 then
          update public.products
          set stock = stock + v_qty, updated_at = now()
          where id = (v_item ->> 'product_id')::uuid
            and store_id = old.store_id;
        end if;
      end if;
    end loop;
  end if;

  new.restocked_at := now();
  return new;
end;
$$;

drop trigger if exists restock_cancelled_market_order on public.orders;
create trigger restock_cancelled_market_order
  before update on public.orders
  for each row execute function public.restock_cancelled_market_order();

-- ---------------------------------------------------------------------------
-- 12. Finalized orders are immutable (admin included)
-- ---------------------------------------------------------------------------
-- "zz_" fires last, so it sees every change made by the guards and the restock
-- trigger. Correction of a finalized row requires an owner-approved
-- maintenance procedure outside the application.
create or replace function public.freeze_final_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('delivered', 'cancelled')
     and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'لا يمكن تعديل طلب منتهٍ أو ملغى.';
  end if;

  return new;
end;
$$;

drop trigger if exists zz_freeze_final_orders on public.orders;
create trigger zz_freeze_final_orders
  before update on public.orders
  for each row execute function public.freeze_final_order();

drop trigger if exists zz_freeze_final_orders on public.custom_orders;
create trigger zz_freeze_final_orders
  before update on public.custom_orders
  for each row execute function public.freeze_final_order();

drop trigger if exists zz_freeze_final_orders on public.global_orders;
create trigger zz_freeze_final_orders
  before update on public.global_orders
  for each row execute function public.freeze_final_order();

-- ---------------------------------------------------------------------------
-- 13. Signup: duplicate phone must not abort account creation
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_phone text := nullif(trim(coalesce(new.phone, v_meta ->> 'phone', '')), '');
  v_name text := coalesce(v_meta ->> 'full_name', '');
begin
  begin
    insert into public.profiles (id, phone, full_name, role)
    values (new.id, v_phone, v_name, 'customer')
    on conflict (id) do update
      set full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
          phone = coalesce(public.profiles.phone, excluded.phone);
  exception when unique_violation then
    -- Either the phone belongs to another profile, or an existing profile
    -- would gain a phone that is already taken. Create/update without phone.
    insert into public.profiles (id, full_name, role)
    values (new.id, v_name, 'customer')
    on conflict (id) do update
      set full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name);
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. delivery_quote: public pricing, least privilege (no SECURITY DEFINER)
-- ---------------------------------------------------------------------------
create or replace function public.delivery_quote(
  p_store_id uuid,
  p_customer_lat double precision,
  p_customer_lng double precision
)
returns table (distance_km numeric, fee integer)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lat double precision;
  v_lng double precision;
  base_fee integer;
  per_km integer;
  d double precision;
begin
  if p_customer_lat is not null and (p_customer_lat < -90 or p_customer_lat > 90) then
    raise exception 'إحداثيات الموقع غير صالحة.';
  end if;
  if p_customer_lng is not null and (p_customer_lng < -180 or p_customer_lng > 180) then
    raise exception 'إحداثيات الموقع غير صالحة.';
  end if;

  select lat, lng into v_lat, v_lng
  from public.stores
  where id = p_store_id and status = 'active';

  select delivery_base_fee, delivery_per_km into base_fee, per_km
  from public.settings
  where id = 1;

  if v_lat is null or v_lng is null
     or p_customer_lat is null or p_customer_lng is null then
    return query select null::numeric, coalesce(base_fee, 1000);
    return;
  end if;

  d := 6371 * 2 * asin(sqrt(least(1,
    power(sin(radians(p_customer_lat - v_lat) / 2), 2)
    + cos(radians(v_lat)) * cos(radians(p_customer_lat))
      * power(sin(radians(p_customer_lng - v_lng) / 2), 2)
  )));

  return query
    select round(d::numeric, 2),
           round(coalesce(base_fee, 1000)
                 + ceil(greatest(0, d - 2)) * coalesce(per_km, 300))::integer;
end;
$$;

-- ---------------------------------------------------------------------------
-- 15. Order RPCs
-- ---------------------------------------------------------------------------
drop function if exists public.place_market_order(
  uuid, text, text, text, double precision, double precision, jsonb
);

create or replace function public.place_market_order(
  p_store_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_customer_lat double precision,
  p_customer_lng double precision,
  p_items jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  pr record;
  qty integer;
  subtotal integer := 0;
  enriched jsonb := '[]'::jsonb;
  v_fee integer;
  v_distance numeric;
  new_id uuid;
begin
  if uid is null then
    raise exception 'سجل الدخول أولاً لإتمام الطلب.';
  end if;

  if nullif(trim(p_customer_name), '') is null
     or nullif(trim(p_customer_phone), '') is null
     or nullif(trim(p_delivery_address), '') is null then
    raise exception 'أكمل بيانات الاسم والجوال والعنوان.';
  end if;

  if length(p_customer_name) > 80 or length(p_customer_phone) > 20
     or length(p_delivery_address) > 500 or coalesce(length(p_notes), 0) > 1000 then
    raise exception 'أحد الحقول أطول من الحد المسموح.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'السلة فارغة.';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'عدد المنتجات في الطلب كبير جدًا.';
  end if;

  if not exists (
    select 1 from public.stores
    where id = p_store_id and status = 'active' and is_open = true
  ) then
    raise exception 'المتجر غير متاح لاستلام الطلبات حاليًا.';
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) <> 'object'
       or (item ->> 'product_id') is null
       or (item ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (item ->> 'quantity') is null
       or (item ->> 'quantity') !~ '^[0-9]{1,3}$' then
      raise exception 'بيانات الطلب غير صالحة.';
    end if;

    qty := greatest(1, least(99, (item ->> 'quantity')::integer));

    select id, name, price, stock, store_id into pr
    from public.products
    where id = (item ->> 'product_id')::uuid
      and store_id = p_store_id
      and is_active = true
    for update;

    if not found then
      raise exception 'أحد المنتجات لم يعد متاحًا.';
    end if;
    if pr.stock < qty then
      raise exception 'الكمية المطلوبة غير متوفرة للمنتج: %', pr.name;
    end if;

    subtotal := subtotal + pr.price * qty;
    enriched := enriched || jsonb_build_array(
      jsonb_build_object(
        'product_id', pr.id,
        'name', pr.name,
        'price', pr.price,
        'quantity', qty
      )
    );

    update public.products
    set stock = stock - qty, updated_at = now()
    where id = pr.id;
  end loop;

  select fee, distance_km into v_fee, v_distance
  from public.delivery_quote(p_store_id, p_customer_lat, p_customer_lng);

  insert into public.orders (
    customer_id, store_id, customer_name, customer_phone, delivery_address,
    customer_lat, customer_lng, items, subtotal, delivery_fee, total,
    distance_km, notes
  ) values (
    uid, p_store_id, trim(p_customer_name), trim(p_customer_phone),
    trim(p_delivery_address), p_customer_lat, p_customer_lng,
    enriched, subtotal, v_fee, subtotal + v_fee, v_distance,
    nullif(trim(coalesce(p_notes, '')), '')
  ) returning id into new_id;

  return new_id;
end;
$$;

drop function if exists public.submit_custom_request(
  text, text, text, text, double precision, double precision
);

create or replace function public.submit_custom_request(
  p_customer_name text,
  p_customer_phone text,
  p_order_text text,
  p_delivery_address text,
  p_customer_lat double precision default null,
  p_customer_lng double precision default null,
  p_title text default null,
  p_image_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'سجل الدخول أولاً لإرسال الطلب.';
  end if;

  if nullif(trim(p_customer_name), '') is null
     or nullif(trim(p_customer_phone), '') is null
     or nullif(trim(p_order_text), '') is null
     or nullif(trim(p_delivery_address), '') is null then
    raise exception 'أكمل جميع البيانات المطلوبة.';
  end if;

  if length(p_customer_name) > 80 or length(p_customer_phone) > 20
     or length(p_delivery_address) > 500 or length(p_order_text) > 5000
     or coalesce(length(p_title), 0) > 120 then
    raise exception 'أحد الحقول أطول من الحد المسموح.';
  end if;

  if nullif(trim(coalesce(p_image_url, '')), '') is not null
     and trim(p_image_url) !~* '^https?://' then
    raise exception 'رابط الصورة غير صالح.';
  end if;
  if length(coalesce(p_image_url, '')) > 2000 then
    raise exception 'رابط الصورة أطول من الحد المسموح.';
  end if;

  insert into public.custom_orders (
    customer_id, customer_name, customer_phone, order_text, delivery_address,
    customer_lat, customer_lng, title, image_url
  ) values (
    uid, trim(p_customer_name), trim(p_customer_phone), trim(p_order_text),
    trim(p_delivery_address), p_customer_lat, p_customer_lng,
    nullif(trim(coalesce(p_title, '')), ''),
    nullif(trim(coalesce(p_image_url, '')), '')
  ) returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.submit_global_request(
  p_customer_name text,
  p_customer_phone text,
  p_product_link text,
  p_product_image text,
  p_description text,
  p_size text,
  p_color text,
  p_quantity integer,
  p_delivery_address text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'سجل الدخول أولاً لإرسال الطلب.';
  end if;

  if nullif(trim(p_customer_name), '') is null
     or nullif(trim(p_customer_phone), '') is null
     or nullif(trim(p_delivery_address), '') is null then
    raise exception 'أكمل بيانات الاسم والجوال والعنوان.';
  end if;

  if nullif(trim(coalesce(p_product_link, '')), '') is null
     and nullif(trim(coalesce(p_product_image, '')), '') is null then
    raise exception 'أضف رابط المنتج أو صورته.';
  end if;

  if length(p_customer_name) > 80 or length(p_customer_phone) > 20
     or length(p_delivery_address) > 500
     or coalesce(length(p_description), 0) > 500
     or coalesce(length(p_size), 0) > 30
     or coalesce(length(p_color), 0) > 30 then
    raise exception 'أحد الحقول أطول من الحد المسموح.';
  end if;

  if nullif(trim(coalesce(p_product_link, '')), '') is not null then
    if trim(p_product_link) !~* '^https?://' or length(p_product_link) > 2000 then
      raise exception 'رابط المنتج غير صالح.';
    end if;
  end if;

  if nullif(trim(coalesce(p_product_image, '')), '') is not null then
    if trim(p_product_image) !~* '^https?://' or length(p_product_image) > 2000 then
      raise exception 'رابط صورة المنتج غير صالح.';
    end if;
  end if;

  insert into public.global_orders (
    customer_id, customer_name, customer_phone, delivery_address,
    product_link, product_image, description, size, color, quantity
  ) values (
    uid, trim(p_customer_name), trim(p_customer_phone), trim(p_delivery_address),
    nullif(trim(p_product_link), ''),
    nullif(trim(p_product_image), ''),
    trim(coalesce(p_description, '')),
    trim(coalesce(p_size, '')),
    trim(coalesce(p_color, '')),
    greatest(1, least(30, coalesce(p_quantity, 1)))
  ) returning id into new_id;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. Driver location RPC (the only sanctioned location writer)
-- ---------------------------------------------------------------------------
create or replace function public.update_driver_location(
  p_lat double precision,
  p_lng double precision
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'driver'
  ) then
    raise exception 'هذه الخدمة متاحة للسائقين فقط.';
  end if;

  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    raise exception 'إحداثيات الموقع غير صالحة.';
  end if;

  -- Transaction-local permission for the profile guard.
  perform set_config('labbeh.allow_location_update', 'on', true);

  update public.profiles
  set lat = p_lat, lng = p_lng, location_updated_at = now()
  where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- 17. Storage buckets, limits and policies
-- ---------------------------------------------------------------------------
-- Public read is intentional for storefront/customer images. Uploads are for
-- authenticated users only. Bucket limits are the primary control; the policy
-- predicates are a second layer. SVG is excluded because a public SVG can
-- carry script.
insert into storage.buckets (id, name, public)
values ('request-images', 'request-images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets is missing; configure bucket limits in the Dashboard.';
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets'
      and column_name = 'file_size_limit'
  ) then
    update storage.buckets
    set file_size_limit = 5242880
    where id in ('request-images', 'product-images');
  else
    raise notice 'storage.buckets.file_size_limit is missing; set the limit in the Dashboard.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets'
      and column_name = 'allowed_mime_types'
  ) then
    update storage.buckets
    set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
    where id in ('request-images', 'product-images');
  else
    raise notice 'storage.buckets.allowed_mime_types is missing; set MIME types in the Dashboard.';
  end if;
end;
$$;

drop policy if exists request_images_public_read on storage.objects;
create policy request_images_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'request-images');

drop policy if exists request_images_authenticated_upload on storage.objects;
create policy request_images_authenticated_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'request-images'
    and (storage.foldername(name))[1] in ('shein-requests', 'custom-requests')
    and (metadata ->> 'size') ~ '^[0-9]+$'
    and (metadata ->> 'size')::bigint between 1 and 5242880
    and (metadata ->> 'mimetype') in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  );

drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'product-images');

drop policy if exists product_images_owner_insert on storage.objects;
create policy product_images_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (metadata ->> 'size') ~ '^[0-9]+$'
    and (metadata ->> 'size')::bigint between 1 and 5242880
    and (metadata ->> 'mimetype') in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
    and (
      public.is_admin()
      or (public.is_merchant() and exists (
        select 1 from public.stores s
        where s.id::text = (storage.foldername(name))[1]
          and s.owner_id = auth.uid()
      ))
    )
  );

drop policy if exists product_images_owner_update on storage.objects;
create policy product_images_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images'
    and (
      public.is_admin()
      or (public.is_merchant() and exists (
        select 1 from public.stores s
        where s.id::text = (storage.foldername(name))[1]
          and s.owner_id = auth.uid()
      ))
    )
  )
  with check (
    bucket_id = 'product-images'
    and (metadata ->> 'size') ~ '^[0-9]+$'
    and (metadata ->> 'size')::bigint between 1 and 5242880
    and (metadata ->> 'mimetype') in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
    and (
      public.is_admin()
      or (public.is_merchant() and exists (
        select 1 from public.stores s
        where s.id::text = (storage.foldername(name))[1]
          and s.owner_id = auth.uid()
      ))
    )
  );

drop policy if exists product_images_owner_delete on storage.objects;
create policy product_images_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (
      public.is_admin()
      or (public.is_merchant() and exists (
        select 1 from public.stores s
        where s.id::text = (storage.foldername(name))[1]
          and s.owner_id = auth.uid()
      ))
    )
  );

-- ---------------------------------------------------------------------------
-- 18. Realtime publication (idempotent). The app also polls, so a missing
-- publication degrades freshness instead of breaking the page.
-- ---------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['orders', 'custom_orders', 'global_orders', 'profiles'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  else
    raise notice 'Publication supabase_realtime is missing; enable Realtime in the Supabase Dashboard.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 19. Function privileges
-- PostgreSQL grants EXECUTE to PUBLIC by default; revoke it on every
-- SECURITY DEFINER function and grant only to the required role.
-- is_admin() stays callable by anon because anon-facing read policies use it.
-- is_merchant() is authenticated-only; no anon-facing policy references it.
-- ---------------------------------------------------------------------------
revoke all on function public.labbeh_hardening_version() from public;
grant execute on function public.labbeh_hardening_version() to authenticated;

revoke all on function public.is_merchant() from public;
revoke all on function public.is_merchant() from anon, authenticated;
grant execute on function public.is_merchant() to authenticated;

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon, authenticated;

revoke all on function public.is_admin() from public;
revoke all on function public.is_admin() from anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

revoke all on function public.guard_profile_role_change() from public;
revoke all on function public.guard_profile_role_change() from anon, authenticated;
revoke all on function public.guard_store_owner_update() from public;
revoke all on function public.guard_store_owner_update() from anon, authenticated;
revoke all on function public.guard_market_order_update() from public;
revoke all on function public.guard_market_order_update() from anon, authenticated;
revoke all on function public.guard_custom_order_update() from public;
revoke all on function public.guard_custom_order_update() from anon, authenticated;
revoke all on function public.guard_global_order_update() from public;
revoke all on function public.guard_global_order_update() from anon, authenticated;

revoke all on function public.enforce_store_merchant_role() from public;
revoke all on function public.enforce_store_merchant_role() from anon, authenticated;
revoke all on function public.enforce_order_actor_role() from public;
revoke all on function public.enforce_order_actor_role() from anon, authenticated;
revoke all on function public.restock_cancelled_market_order() from public;
revoke all on function public.restock_cancelled_market_order() from anon, authenticated;
revoke all on function public.validate_order_driver_state() from public;
revoke all on function public.validate_order_driver_state() from anon, authenticated;
revoke all on function public.validate_order_status_transition() from public;
revoke all on function public.validate_order_status_transition() from anon, authenticated;
revoke all on function public.freeze_final_order() from public;
revoke all on function public.freeze_final_order() from anon, authenticated;
revoke all on function public.prevent_active_driver_demotion() from public;
revoke all on function public.prevent_active_driver_demotion() from anon, authenticated;

revoke all on function public.delivery_quote(
  uuid, double precision, double precision
) from public;
grant execute on function public.delivery_quote(
  uuid, double precision, double precision
) to anon, authenticated;

revoke all on function public.place_market_order(
  uuid, text, text, text, double precision, double precision, jsonb, text
) from public;
grant execute on function public.place_market_order(
  uuid, text, text, text, double precision, double precision, jsonb, text
) to authenticated;

revoke all on function public.submit_custom_request(
  text, text, text, text, double precision, double precision, text, text
) from public;
grant execute on function public.submit_custom_request(
  text, text, text, text, double precision, double precision, text, text
) to authenticated;

revoke all on function public.submit_global_request(
  text, text, text, text, text, text, text, integer, text
) from public;
grant execute on function public.submit_global_request(
  text, text, text, text, text, text, text, integer, text
) to authenticated;

revoke all on function public.update_driver_location(
  double precision, double precision
) from public;
grant execute on function public.update_driver_location(
  double precision, double precision
) to authenticated;

revoke all on function public.ensure_profile() from public;
grant execute on function public.ensure_profile() to authenticated;

revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

commit;
