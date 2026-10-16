-- Customer original images stay private. Random upload capabilities bind each file to one product/order.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('catalog-customer-files','catalog-customer-files',false,8388608,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create table public.catalog_customer_uploads(
 id uuid primary key,product_id uuid not null references public.products(id),storage_path text not null unique,
 original_name text not null,mime_type text not null,bytes int not null check(bytes between 1 and 8388608),token_hash text not null,
 ready boolean not null default false,order_id uuid references public.orders(id),created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '7 days'
);
alter table public.catalog_customer_uploads enable row level security;
revoke all on public.catalog_customer_uploads from public,anon,authenticated;
grant all on public.catalog_customer_uploads to service_role;
create policy customer_upload_service on public.catalog_customer_uploads for all to service_role using(true) with check(true);
create index catalog_upload_expiry_idx on public.catalog_customer_uploads(expires_at) where order_id is null;
create table public.catalog_upload_limits(bucket text primary key,n int not null,expires_at timestamptz not null);
alter table public.catalog_upload_limits enable row level security;
revoke all on public.catalog_upload_limits from public,anon,authenticated;grant all on public.catalog_upload_limits to service_role;
create policy upload_limit_service on public.catalog_upload_limits for all to service_role using(true) with check(true);
create table public.catalog_order_files(order_item_id uuid not null references public.order_items(id) on delete cascade,upload_id uuid not null references public.catalog_customer_uploads(id),primary key(order_item_id,upload_id));
alter table public.catalog_order_files enable row level security;
revoke all on public.catalog_order_files from public,anon,authenticated;grant all on public.catalog_order_files to service_role;
create policy catalog_order_file_service on public.catalog_order_files for all to service_role using(true) with check(true);

create function public.icetak_catalog_upload_gate(p_product uuid,p_client text)returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare k text; n_value int;
begin
 if not exists(select 1 from products where id=p_product and is_published and status='active' and (metadata#>>'{website_order,allow_upload}')::boolean=true)then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('catalog-upload-day',0));
 foreach k in array array['global:'||current_date::text,p_client||':'||current_date::text] loop
  insert into catalog_upload_limits(bucket,n,expires_at)values(k,1,now()+interval '2 days')on conflict(bucket)do update set n=catalog_upload_limits.n+1 returning n into n_value;
  if n_value>(case when k like 'global:%' then 1000 else 60 end) then return false;end if;
 end loop;return true;
end $$;
revoke all on function public.icetak_catalog_upload_gate(uuid,text) from public,anon,authenticated;grant execute on function public.icetak_catalog_upload_gate(uuid,text) to service_role;

create function public.icetak_catalog_check_uploads(p_product uuid,p_files jsonb)returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare f jsonb; row_value catalog_customer_uploads%rowtype;
begin
 if jsonb_typeof(coalesce(p_files,'[]'))<>'array' or jsonb_array_length(coalesce(p_files,'[]'))>3 then raise exception 'CATALOG_FILE_LIMIT';end if;
 if exists(select 1 from products where id=p_product and (metadata#>>'{website_order,upload_required}')::boolean=true)and jsonb_array_length(coalesce(p_files,'[]'))=0 then raise exception 'CATALOG_IMAGE_REQUIRED';end if;
 for f in select value from jsonb_array_elements(coalesce(p_files,'[]'))loop
  select * into row_value from catalog_customer_uploads where id=(f->>'id')::uuid;
  if not found or row_value.product_id<>p_product or row_value.token_hash<>encode(sha256(convert_to(coalesce(f->>'token',''),'UTF8')),'hex') or not row_value.ready or row_value.order_id is not null or row_value.expires_at<now() or not exists(select 1 from storage.objects where bucket_id='catalog-customer-files' and name=row_value.storage_path)then raise exception 'CATALOG_FILE_UNAVAILABLE';end if;
 end loop;
end $$;
revoke all on function public.icetak_catalog_check_uploads(uuid,jsonb) from public,anon,authenticated;grant execute on function public.icetak_catalog_check_uploads(uuid,jsonb) to service_role;

create function public.icetak_catalog_attach_files(p_item uuid,p_files jsonb)returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare i order_items%rowtype; f jsonb; u catalog_customer_uploads%rowtype; refs jsonb:='[]'; link text;
begin
 select * into i from order_items where id=p_item;
 for f in select value from jsonb_array_elements(coalesce(p_files,'[]'))loop
  select * into u from catalog_customer_uploads where id=(f->>'id')::uuid for update;
  if not found or u.product_id<>i.product_id or u.token_hash<>encode(sha256(convert_to(coalesce(f->>'token',''),'UTF8')),'hex')or not u.ready or(u.order_id is not null and u.order_id<>i.order_id)then raise exception 'CATALOG_FILE_ALREADY_USED';end if;
  update catalog_customer_uploads set order_id=i.order_id where id=u.id;
  insert into catalog_order_files values(i.id,u.id)on conflict do nothing;
  link:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/catalog-file?order='||i.order_token||'&file='||u.id::text;
  refs:=refs||jsonb_build_array(jsonb_build_object('id',u.id,'name',u.original_name,'url',link,'mime',u.mime_type));
 end loop;
 if jsonb_array_length(refs)>0 then update order_items set customization=customization||jsonb_build_object('reference_files',refs,'reference_url',refs->0->>'url') where id=i.id;end if;
end $$;
revoke all on function public.icetak_catalog_attach_files(uuid,jsonb) from public,anon,authenticated;grant execute on function public.icetak_catalog_attach_files(uuid,jsonb) to service_role;

do $patch$
declare d text:=pg_get_functiondef('public.icetak_create_order(jsonb)'::regprocedure);
begin
 if position('        v_total:=v_total+(v_catalog->>''price'')::numeric' in d)=0 or position(' returning id into v_item_id;' in d)=0 then raise exception 'CATALOG_ORDER_UPLOAD_DRIFT';end if;
 d:=replace(d,'        v_total:=v_total+(v_catalog->>''price'')::numeric','        perform public.icetak_catalog_check_uploads((v_catalog->>''product_id'')::uuid,v_item->''catalog_uploads'');
        v_total:=v_total+(v_catalog->>''price'')::numeric');
 d:=replace(d,' returning id into v_item_id;',' returning id into v_item_id;
    if v_catalog_slug is not null then perform public.icetak_catalog_attach_files(v_item_id,v_item->''catalog_uploads'');end if;');
 execute d;
end $patch$;

-- Unclaimed originals expire after seven days. Claimed order files are retained.
select cron.schedule('catalog-upload-cleanup','15 19 * * *',$cron$
 select net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/catalog-upload',
 headers:=jsonb_build_object('content-type','application/json','x-admin-window-token',(select setting_value from public.private_runtime_settings where setting_key='admin_window_bridge_token')),
 body:='{"action":"cleanup"}'::jsonb);
$cron$);
