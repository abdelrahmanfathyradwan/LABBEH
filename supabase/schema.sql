-- LABBEH MARKETPLACE | Secure initial schema. Run once in Supabase SQL Editor.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text, phone text unique,
 role text not null default 'customer' check(role in ('customer','merchant','driver','admin')),
 lat double precision, lng double precision, location_updated_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.settings (
 id integer primary key default 1 check(id=1), commission_percent numeric(5,2) not null default 15 check(commission_percent between 0 and 100),
 delivery_base_fee integer not null default 1000 check(delivery_base_fee>=0), delivery_per_km integer not null default 300 check(delivery_per_km>=0),
 currency_code text not null default 'YER', currency_label text not null default 'ر.ي', contact_phone text, whatsapp_number text,
 instagram_url text, facebook_url text, updated_at timestamptz not null default now()
);
insert into public.settings(id) values(1) on conflict(id) do nothing;
create table if not exists public.stores (
 id uuid primary key default gen_random_uuid(), owner_id uuid references public.profiles(id) on delete set null,
 name text not null, description text, logo_url text, area text not null default 'عزان', lat double precision, lng double precision,
 status text not null default 'pending' check(status in ('pending','active','suspended')), created_at timestamptz not null default now()
);
create table if not exists public.products (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id) on delete cascade,
 name text not null, description text, price integer not null check(price>0), old_price integer,
 stock integer not null default 0 check(stock>=0), images text[] not null default '{}', category text,
 is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.orders (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id), store_id uuid not null references public.stores(id),
 customer_name text not null, customer_phone text not null, delivery_address text not null, customer_lat double precision, customer_lng double precision,
 items jsonb not null default '[]'::jsonb, subtotal integer not null default 0, delivery_fee integer not null default 0, total integer not null default 0,
 distance_km numeric(8,2), status text not null default 'pending' check(status in ('pending','assigned','processing','on_delivery','delivered','cancelled')),
 driver_id uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.custom_orders (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id), customer_name text not null,
 customer_phone text not null, delivery_address text not null, customer_lat double precision, customer_lng double precision,
 order_text text not null, status text not null default 'pending' check(status in ('pending','assigned','processing','on_delivery','delivered','cancelled')),
 driver_id uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.global_orders (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id), customer_name text not null,
 customer_phone text not null, delivery_address text not null, product_link text, product_image text, description text, size text, color text,
 quantity integer not null default 1 check(quantity between 1 and 30), estimated_price integer,
 status text not null default 'pending_review' check(status in ('pending_review','quoted','approved','assigned','processing','on_delivery','delivered','cancelled')),
 driver_id uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint global_order_has_reference check(nullif(trim(coalesce(product_link,'')),'') is not null or nullif(trim(coalesce(product_image,'')),'') is not null)
);
create index if not exists idx_products_store on public.products(store_id,is_active);
create index if not exists idx_orders_customer on public.orders(customer_id,created_at desc);
create index if not exists idx_orders_driver on public.orders(driver_id,status);
create index if not exists idx_custom_customer on public.custom_orders(customer_id,created_at desc);
create index if not exists idx_global_customer on public.global_orders(customer_id,created_at desc);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,phone,full_name,role) values(new.id,new.phone,coalesce(new.raw_user_meta_data->>'full_name',''),'customer') on conflict(id) do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;

create or replace function public.delivery_quote(p_store_id uuid,p_customer_lat double precision,p_customer_lng double precision)
returns table(distance_km numeric,fee integer) language plpgsql stable security definer set search_path=public as $$
declare s record; base_fee integer; per_km integer; d double precision;
begin
 select lat,lng into s from public.stores where id=p_store_id and status='active';
 select delivery_base_fee,delivery_per_km into base_fee,per_km from public.settings where id=1;
 if s.lat is null or s.lng is null or p_customer_lat is null or p_customer_lng is null then return query select null::numeric,coalesce(base_fee,1000); return; end if;
 d:=6371*2*asin(sqrt(least(1,power(sin(radians(p_customer_lat-s.lat)/2),2)+cos(radians(s.lat))*cos(radians(p_customer_lat))*power(sin(radians(p_customer_lng-s.lng)/2),2))));
 return query select round(d::numeric,2),round(coalesce(base_fee,1000)+ceil(greatest(0,d-2))*coalesce(per_km,300))::integer;
end; $$;

create or replace function public.place_market_order(p_store_id uuid,p_customer_name text,p_customer_phone text,p_delivery_address text,p_customer_lat double precision,p_customer_lng double precision,p_items jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); item jsonb; pr record; qty integer; subtotal integer:=0; enriched jsonb:='[]'::jsonb; q record; new_id uuid;
begin
 if uid is null then raise exception 'سجل الدخول أولاً لإتمام الطلب.'; end if;
 if nullif(trim(p_customer_name),'') is null or nullif(trim(p_customer_phone),'') is null or nullif(trim(p_delivery_address),'') is null then raise exception 'أكمل بيانات الاسم والجوال والعنوان.'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'السلة فارغة.'; end if;
 if not exists(select 1 from public.stores where id=p_store_id and status='active') then raise exception 'المتجر غير متاح.'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  qty:=greatest(1,least(99,(item->>'quantity')::integer));
  select id,name,price,stock,store_id into pr from public.products where id=(item->>'product_id')::uuid and store_id=p_store_id and is_active=true for update;
  if not found then raise exception 'أحد المنتجات لم يعد متاحًا.'; end if;
  if pr.stock<qty then raise exception 'الكمية المطلوبة غير متوفرة للمنتج: %',pr.name; end if;
  subtotal:=subtotal+pr.price*qty; enriched:=enriched||jsonb_build_array(jsonb_build_object('product_id',pr.id,'name',pr.name,'price',pr.price,'quantity',qty));
  update public.products set stock=stock-qty,updated_at=now() where id=pr.id;
 end loop;
 select * into q from public.delivery_quote(p_store_id,p_customer_lat,p_customer_lng);
 insert into public.orders(customer_id,store_id,customer_name,customer_phone,delivery_address,customer_lat,customer_lng,items,subtotal,delivery_fee,total,distance_km)
 values(uid,p_store_id,trim(p_customer_name),trim(p_customer_phone),trim(p_delivery_address),p_customer_lat,p_customer_lng,enriched,subtotal,q.fee,subtotal+q.fee,q.distance_km) returning id into new_id;
 return new_id;
end; $$;

create or replace function public.submit_custom_request(p_customer_name text,p_customer_phone text,p_order_text text,p_delivery_address text,p_customer_lat double precision default null,p_customer_lng double precision default null)
returns uuid language plpgsql security definer set search_path=public as $$ declare uid uuid:=auth.uid(); new_id uuid; begin
 if uid is null then raise exception 'سجل الدخول أولاً لإرسال الطلب.'; end if;
 if nullif(trim(p_customer_name),'') is null or nullif(trim(p_customer_phone),'') is null or nullif(trim(p_order_text),'') is null or nullif(trim(p_delivery_address),'') is null then raise exception 'أكمل جميع البيانات المطلوبة.'; end if;
 insert into public.custom_orders(customer_id,customer_name,customer_phone,order_text,delivery_address,customer_lat,customer_lng) values(uid,trim(p_customer_name),trim(p_customer_phone),trim(p_order_text),trim(p_delivery_address),p_customer_lat,p_customer_lng) returning id into new_id; return new_id; end; $$;
create or replace function public.submit_global_request(p_customer_name text,p_customer_phone text,p_product_link text,p_product_image text,p_description text,p_size text,p_color text,p_quantity integer,p_delivery_address text)
returns uuid language plpgsql security definer set search_path=public as $$ declare uid uuid:=auth.uid(); new_id uuid; begin
 if uid is null then raise exception 'سجل الدخول أولاً لإرسال الطلب.'; end if;
 if nullif(trim(p_customer_name),'') is null or nullif(trim(p_customer_phone),'') is null or nullif(trim(p_delivery_address),'') is null then raise exception 'أكمل بيانات الاسم والجوال والعنوان.'; end if;
 if nullif(trim(coalesce(p_product_link,'')),'') is null and nullif(trim(coalesce(p_product_image,'')),'') is null then raise exception 'أضف رابط المنتج أو صورته.'; end if;
 insert into public.global_orders(customer_id,customer_name,customer_phone,delivery_address,product_link,product_image,description,size,color,quantity) values(uid,trim(p_customer_name),trim(p_customer_phone),trim(p_delivery_address),nullif(trim(p_product_link),''),nullif(trim(p_product_image),''),trim(coalesce(p_description,'')),trim(coalesce(p_size,'')),trim(coalesce(p_color,'')),greatest(1,least(30,coalesce(p_quantity,1)))) returning id into new_id; return new_id; end; $$;
create or replace function public.update_driver_location(p_lat double precision,p_lng double precision) returns void language plpgsql security definer set search_path=public as $$ begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='driver') then raise exception 'هذه الخدمة متاحة للسائقين فقط.'; end if;
 update public.profiles set lat=p_lat,lng=p_lng,location_updated_at=now() where id=auth.uid(); end; $$;

alter table public.profiles enable row level security; alter table public.settings enable row level security; alter table public.stores enable row level security;
alter table public.products enable row level security; alter table public.orders enable row level security; alter table public.custom_orders enable row level security; alter table public.global_orders enable row level security;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin() or exists(select 1 from public.orders o where o.driver_id=profiles.id and o.customer_id=auth.uid()) or exists(select 1 from public.custom_orders o where o.driver_id=profiles.id and o.customer_id=auth.uid()) or exists(select 1 from public.global_orders o where o.driver_id=profiles.id and o.customer_id=auth.uid()));
create policy settings_read on public.settings for select to anon,authenticated using(true);
create policy settings_admin_update on public.settings for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy stores_public_read on public.stores for select to anon,authenticated using(status='active' or owner_id=auth.uid() or public.is_admin());
create policy stores_admin_all on public.stores for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy products_public_read on public.products for select to anon,authenticated using((is_active=true and exists(select 1 from public.stores s where s.id=products.store_id and s.status='active')) or exists(select 1 from public.stores s where s.id=products.store_id and s.owner_id=auth.uid()) or public.is_admin());
create policy products_owner_insert on public.products for insert to authenticated with check(exists(select 1 from public.stores s where s.id=store_id and s.owner_id=auth.uid()) or public.is_admin());
create policy products_owner_update on public.products for update to authenticated using(exists(select 1 from public.stores s where s.id=store_id and s.owner_id=auth.uid()) or public.is_admin()) with check(exists(select 1 from public.stores s where s.id=store_id and s.owner_id=auth.uid()) or public.is_admin());
create policy orders_read on public.orders for select to authenticated using(customer_id=auth.uid() or driver_id=auth.uid() or exists(select 1 from public.stores s where s.id=store_id and s.owner_id=auth.uid()) or public.is_admin());
create policy orders_update on public.orders for update to authenticated using(driver_id=auth.uid() or public.is_admin()) with check(driver_id=auth.uid() or public.is_admin());
create policy custom_orders_read on public.custom_orders for select to authenticated using(customer_id=auth.uid() or driver_id=auth.uid() or public.is_admin());
create policy custom_orders_update on public.custom_orders for update to authenticated using(driver_id=auth.uid() or public.is_admin()) with check(driver_id=auth.uid() or public.is_admin());
create policy global_orders_read on public.global_orders for select to authenticated using(customer_id=auth.uid() or driver_id=auth.uid() or public.is_admin());
create policy global_orders_update on public.global_orders for update to authenticated using(driver_id=auth.uid() or public.is_admin()) with check(driver_id=auth.uid() or public.is_admin());

grant execute on function public.delivery_quote(uuid,double precision,double precision) to anon,authenticated;
grant execute on function public.place_market_order(uuid,text,text,text,double precision,double precision,jsonb) to authenticated;
grant execute on function public.submit_custom_request(text,text,text,text,double precision,double precision) to authenticated;
grant execute on function public.submit_global_request(text,text,text,text,text,text,text,integer,text) to authenticated;
grant execute on function public.update_driver_location(double precision,double precision) to authenticated;

-- Add order tables to Realtime. Add profiles via Supabase Dashboard if desired for live driver map updates.
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.custom_orders;
alter publication supabase_realtime add table public.global_orders;

-- Prevent drivers from editing customer/order financial fields through the REST API.
create or replace function public.guard_assigned_order_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if public.is_admin() then return new; end if;
 if auth.uid() is null or old.driver_id is distinct from auth.uid() or new.driver_id is distinct from old.driver_id then
   raise exception 'غير مصرح بتعديل هذا الطلب.';
 end if;
 if (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
   raise exception 'السائق يستطيع تحديث حالة الطلب فقط.';
 end if;
 new.updated_at:=now();
 return new;
end; $$;
drop trigger if exists guard_orders_update on public.orders;
create trigger guard_orders_update before update on public.orders for each row execute function public.guard_assigned_order_update();
drop trigger if exists guard_custom_orders_update on public.custom_orders;
create trigger guard_custom_orders_update before update on public.custom_orders for each row execute function public.guard_assigned_order_update();
drop trigger if exists guard_global_orders_update on public.global_orders;
create trigger guard_global_orders_update before update on public.global_orders for each row execute function public.guard_assigned_order_update();

-- Public image viewing, authenticated uploads only.
insert into storage.buckets(id,name,public) values('request-images','request-images',true) on conflict(id) do nothing;
create policy request_images_public_read on storage.objects for select to anon,authenticated using(bucket_id='request-images');
create policy request_images_authenticated_upload on storage.objects for insert to authenticated with check(bucket_id='request-images' and (storage.foldername(name))[1]='shein-requests');
alter publication supabase_realtime add table public.profiles;
