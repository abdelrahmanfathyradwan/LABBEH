-- ===========================================================================
-- LABBEH | Legacy security patch (SUPERSEDED — DO NOT APPLY AS DDL)
-- ===========================================================================
-- Version: 2026-11-10.3
--
-- All fixes that lived in this file are now part of:
--   supabase/production-hardening.sql
--
-- This file is kept only so existing runbooks do not break. It performs NO
-- schema changes, so it can never downgrade or duplicate the hardening
-- policies. If it runs before hardening, or against an older hardening
-- version, it aborts with a clear message.
--
-- Do not reintroduce policy/trigger definitions here. Change
-- production-hardening.sql instead, then update the version marker there.
-- ===========================================================================

begin;

do $$
declare
  v_version text;
begin
  if to_regprocedure('public.labbeh_hardening_version()') is null then
    raise exception 'طبّق supabase/production-hardening.sql أولًا. هذا الملف لم يعد يحتوي تغييرات مستقلة.';
  end if;

  execute 'select public.labbeh_hardening_version()' into v_version;

  if v_version is distinct from '2026-11-10.3' then
    raise exception 'الترحيل المطبق بالإصدار % وليس 2026-11-10.3. أعد تنفيذ supabase/production-hardening.sql؛ فهو آمن ومتكرر.', v_version;
  end if;

  raise notice 'labbeh-security-patch.sql is superseded; hardening version % is already applied. No changes made.', v_version;
end;
$$;

commit;

-- ===========================================================================
-- Post-apply verification (run separately, read-only)
-- ===========================================================================
-- select public.labbeh_hardening_version();
--
-- select p.proname, p.prosecdef, p.proconfig
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('is_merchant','enforce_store_merchant_role',
--     'enforce_order_actor_role','restock_cancelled_market_order',
--     'validate_order_driver_state','validate_order_status_transition',
--     'freeze_final_order','prevent_active_driver_demotion');
--
-- select tablename, policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname in ('public','storage')
--   and policyname in ('profiles_self_update','profiles_admin_update',
--     'stores_public_read','stores_authenticated_read',
--     'stores_owner_update','products_public_read','products_authenticated_read',
--     'products_owner_insert','products_owner_update','products_owner_delete',
--     'orders_read','orders_merchant_update',
--     'orders_driver_update','orders_admin_update',
--     'custom_orders_driver_update','custom_orders_admin_update',
--     'global_orders_driver_update','global_orders_admin_update',
--     'request_images_public_read','request_images_authenticated_upload',
--     'product_images_public_read','product_images_owner_insert',
--     'product_images_owner_update','product_images_owner_delete');
--
-- Legacy permissive policies must be gone (expect 0 rows):
-- select tablename, policyname from pg_policies
-- where schemaname = 'public'
--   and policyname in ('orders_update','custom_orders_update','global_orders_update');
--
-- select tgname, tgrelid::regclass as table_name, tgtype
-- from pg_trigger
-- where not tgisinternal
--   and tgname in ('guard_profile_role_change','aa_prevent_active_driver_demotion',
--     'enforce_store_merchant_role','guard_store_owner_update',
--     'guard_orders_update','guard_custom_orders_update','guard_global_orders_update',
--     'enforce_order_actor_role','restock_cancelled_market_order',
--     'validate_order_driver_state','validate_order_status_transition',
--     'zz_freeze_final_orders');
--
-- select id, public, file_size_limit, allowed_mime_types
-- from storage.buckets
-- where id in ('request-images','product-images');
