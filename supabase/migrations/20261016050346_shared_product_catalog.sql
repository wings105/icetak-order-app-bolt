-- Shared catalogue. Provider snapshots never implicitly publish or overwrite website edits.
create table public.product_channel_listings (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id),
 channel text not null default 'shopee' check(channel='shopee'), shop_id text not null check(shop_id ~ '^[0-9]+$'),
 item_id text not null check(item_id ~ '^[0-9]+$'), provider_status text not null default 'UNKNOWN',
 snapshot jsonb not null default '{}', revision bigint not null default 1, last_imported_at timestamptz,
 last_verified_at timestamptz, updated_at timestamptz not null default now(), unique(channel,shop_id,item_id)
);
create index product_channel_product_idx on public.product_channel_listings(product_id);
alter table public.product_channel_listings enable row level security;
revoke all on public.product_channel_listings from anon,authenticated;
grant all on public.product_channel_listings to service_role;
create table public.product_sync_jobs (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique, listing_id uuid not null references public.product_channel_listings(id),
 actor text not null, expected_revision bigint not null, action text not null check(action in ('item','price','stock','model','status')),
 desired jsonb not null, status text not null default 'pending' check(status in ('pending','running','verified','failed','unknown','conflict')),
 result jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index product_sync_pending_idx on public.product_sync_jobs(created_at) where status='pending';
create index product_sync_listing_idx on public.product_sync_jobs(listing_id,created_at desc);
alter table public.product_sync_jobs enable row level security;
revoke all on public.product_sync_jobs from anon,authenticated;
grant all on public.product_sync_jobs to service_role;
create table public.product_catalog_requests (request_id uuid primary key,action text not null,actor text not null,payload_hash text not null,result jsonb not null,created_at timestamptz not null default now());
alter table public.product_catalog_requests enable row level security;
revoke all on public.product_catalog_requests from anon,authenticated;
grant all on public.product_catalog_requests to service_role;

create or replace function public.icetak_product_admin(p_action text,p_body jsonb,p_actor text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r jsonb; v jsonb; m jsonb; p products%rowtype; l product_channel_listings%rowtype; j product_sync_jobs%rowtype;
 pid uuid; vid uuid; bid uuid; rid uuid; h text; old product_catalog_requests%rowtype; n int:=0; profile uuid; q text; offst int;
begin
 if p_action='list' then
  q:=left(coalesce(p_body->>'q',''),160); offst:=greatest(0,least(100000,coalesce((p_body->>'offset')::int,0)));
  select jsonb_build_object('total',count(*),'rows',coalesce((select jsonb_agg(x) from (
   select pr.id,pr.slug,pr.display_name,pr.parent_sku,pr.main_image_url,pr.base_price,pr.is_published,pr.order_profile_id,pr.updated_at,
   cl.id listing_id,cl.shop_id,cl.item_id,cl.provider_status,cl.revision,cl.last_verified_at,
   (select count(*) from product_variants pv where pv.product_id=pr.id) model_count
   from products pr left join product_channel_listings cl on cl.product_id=pr.id
   where (q='' or concat_ws(' ',pr.display_name,pr.parent_sku,cl.item_id) ilike '%'||q||'%')
   and (coalesce(p_body->>'status','')='' or cl.provider_status=p_body->>'status')
   order by pr.created_at desc,pr.id limit 40 offset offst) x),'[]')) into r
  from products pr left join product_channel_listings cl on cl.product_id=pr.id
  where (q='' or concat_ws(' ',pr.display_name,pr.parent_sku,cl.item_id) ilike '%'||q||'%')
  and (coalesce(p_body->>'status','')='' or cl.provider_status=p_body->>'status');
  return r;
 elsif p_action='detail' then
  return jsonb_build_object('product',(select to_jsonb(x) from products x where id=(p_body->>'id')::uuid),
   'variants',coalesce((select jsonb_agg(x order by x.name) from product_variants x where product_id=(p_body->>'id')::uuid),'[]'),
   'images',coalesce((select jsonb_agg(x order by x.position) from product_images x where product_id=(p_body->>'id')::uuid),'[]'),
   'listings',coalesce((select jsonb_agg(x) from product_channel_listings x where product_id=(p_body->>'id')::uuid),'[]'),
   'jobs',coalesce((select jsonb_agg(x) from (select sj.* from product_sync_jobs sj join product_channel_listings cl on cl.id=sj.listing_id where cl.product_id=(p_body->>'id')::uuid order by sj.created_at desc limit 20) x),'[]'),
   'profiles',coalesce((select jsonb_agg(x) from product_order_profiles x where active),'[]'));
 end if;
 rid:=(p_body->>'request_id')::uuid;
 if rid is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
 h:=md5(p_body::text);
 perform pg_advisory_xact_lock(hashtextextended(rid::text,0));
 select * into old from product_catalog_requests where request_id=rid;
 if found then
  if old.action<>p_action or old.actor<>p_actor or old.payload_hash<>h then raise exception 'REQUEST_REUSED'; end if;
  return old.result;
 end if;
 if p_action='import' then
  if jsonb_array_length(p_body->'products') not between 1 and 30 then raise exception 'IMPORT_CHUNK_LIMIT'; end if;
  if p_body->>'shop_id' !~ '^[0-9]+$' then raise exception 'SHOP_REQUIRED'; end if;
  bid:=(p_body->>'batch_id')::uuid;
  insert into product_import_batches(id,source,file_name,status,summary) values(bid,'shopee_export',left(p_body->>'file_name',400),'importing',jsonb_build_object('shop_id',p_body->>'shop_id')) on conflict(id) do nothing;
  for v in select value from jsonb_array_elements(p_body->'products') loop
   if v->>'item_id' !~ '^[0-9]+$' or length(v->>'name')<1 or length(v->>'name')>500 or v->>'image_url' !~ '^https://' then raise exception 'INVALID_PRODUCT'; end if;
   select * into l from product_channel_listings where channel='shopee' and shop_id=p_body->>'shop_id' and item_id=v->>'item_id' for update;
   pid:=l.product_id;
   if pid is null then
    -- Existing legacy ID can be attached only for the explicitly imported MY shop; never match by SKU.
    if p_body->>'shop_id'='188218638' then select id into pid from products where shopee_product_id=v->>'item_id' and not exists(select 1 from product_channel_listings c where c.product_id=products.id); end if;
    if pid is null then
     insert into products(slug,source,source_record_id,shopee_product_id,name,display_name,source_title,description,parent_sku,main_image_url,shopee_url,base_price,is_published,is_indexable,metadata,search_text)
     values('shopee-'||(p_body->>'shop_id')||'-'||(v->>'item_id'),'shopee', (p_body->>'shop_id')||':'||(v->>'item_id'),v->>'item_id',v->>'name',v->>'name',v->>'name',v->>'description',nullif(v->>'sku',''),v->>'image_url','https://shopee.com.my/product/'||(p_body->>'shop_id')||'/'||(v->>'item_id'),(v->>'price')::numeric,false,false,jsonb_build_object('catalog_managed',true),concat_ws(' ',v->>'name',v->>'sku',v->>'description')) returning id into pid;
    else update products set metadata=metadata||'{"catalog_managed":true}'::jsonb where id=pid; end if;
   end if;
   insert into product_channel_listings(product_id,shop_id,item_id,snapshot,last_imported_at) values(pid,p_body->>'shop_id',v->>'item_id',v,now())
   on conflict(channel,shop_id,item_id) do update set snapshot=excluded.snapshot,last_imported_at=now(),revision=product_channel_listings.revision+1,updated_at=now();
   for m in select value from jsonb_array_elements(v->'models') loop
    if m->>'model_id' !~ '^[0-9]+$' or (m->>'price')::numeric<0 or (m->>'stock')::int<0 then raise exception 'INVALID_MODEL'; end if;
    insert into product_variants(product_id,source_variation_id,name,sku,price,stock,metadata)
    values(pid,(p_body->>'shop_id')||':'||(m->>'model_id'),coalesce(nullif(m->>'name',''),'Default'),nullif(m->>'sku',''),(m->>'price')::numeric,(m->>'stock')::int,jsonb_build_object('shopee_model_id',m->>'model_id','shop_id',p_body->>'shop_id','image_url',coalesce(m->>'image_url',v->>'image_url'),'provider_snapshot',m))
    on conflict(product_id,source_variation_id) do update set metadata=product_variants.metadata||jsonb_build_object('provider_snapshot',m);
   end loop;
   for m in select value from jsonb_array_elements(v->'images') loop
    if m#>>'{}' ~ '^https://' and not exists(select 1 from product_images where product_id=pid and source_url=m#>>'{}') then
     insert into product_images(product_id,source,source_url,public_url,position,alt_text) values(pid,'shopee',m#>>'{}',m#>>'{}',n,v->>'name');
    end if;
   end loop;
   insert into product_import_rows(batch_id,row_no,source_product_id,raw_payload,normalized_payload,import_status,product_id) values(bid,n+1,v->>'item_id',v,v,'imported',pid);
   n:=n+1;
  end loop;
  update product_import_batches set row_count=row_count+n,inserted_count=inserted_count+n where id=bid;
  r:=jsonb_build_object('imported',n,'batch_id',bid);
 elsif p_action='complete_import' then
  update product_import_batches set status='completed',completed_at=now() where id=(p_body->>'batch_id')::uuid returning jsonb_build_object('batch_id',id,'products',row_count) into r;
 elsif p_action='save' then
  select * into p from products where id=(p_body->>'id')::uuid for update;
  if not found or p.updated_at<>(p_body->>'updated_at')::timestamptz then raise exception 'PRODUCT_CHANGED_RELOAD'; end if;
  if length(trim(p_body->>'display_name')) not between 1 and 500 or length(coalesce(p_body->>'description',''))>20000 then raise exception 'INVALID_PRODUCT'; end if;
  profile:=nullif(p_body->>'order_profile_id','')::uuid;
  if (p_body->>'is_published')::boolean and (profile is null or not exists(select 1 from product_variants where product_id=p.id and active and price>0)) then raise exception 'CONFIGURE_PROFILE_AND_PRICE_BEFORE_PUBLISH'; end if;
  update products set display_name=trim(p_body->>'display_name'),description=p_body->>'description',parent_sku=nullif(p_body->>'parent_sku',''),
   order_profile_id=profile,is_published=(p_body->>'is_published')::boolean,is_indexable=(p_body->>'is_published')::boolean,
   metadata=metadata||'{"catalog_managed":true}'::jsonb,search_text=concat_ws(' ',p_body->>'display_name',p_body->>'parent_sku',p_body->>'description'),updated_at=clock_timestamp() where id=p.id;
  for v in select value from jsonb_array_elements(coalesce(p_body->'variants','[]')) loop
   if (v->>'price')::numeric<=0 or (v->>'price')::numeric>100000 or (v->>'stock')::int<0 then raise exception 'INVALID_WEBSITE_PRICE_STOCK'; end if;
   update product_variants set price=(v->>'price')::numeric,stock=(v->>'stock')::int,active=(v->>'active')::boolean,updated_at=now() where id=(v->>'id')::uuid and product_id=p.id;
   if not found then raise exception 'VARIANT_MISMATCH'; end if;
  end loop;
  r:=jsonb_build_object('saved',p.id);
 elsif p_action='queue' then
  select * into l from product_channel_listings where id=(p_body->>'listing_id')::uuid for update;
  if not found or l.revision<>(p_body->>'revision')::bigint then raise exception 'LISTING_CHANGED_RELOAD'; end if;
  if exists(select 1 from product_sync_jobs where listing_id=l.id and status in ('pending','running','unknown')) then raise exception 'RESOLVE_EXISTING_JOB_FIRST'; end if;
  insert into product_sync_jobs(request_id,listing_id,actor,expected_revision,action,desired) values(rid,l.id,p_actor,l.revision,p_body->>'operation',p_body->'desired') returning to_jsonb(product_sync_jobs.*) into r;
 else raise exception 'INVALID_ACTION';
 end if;
 insert into product_catalog_requests values(rid,p_action,p_actor,h,r,now());
 return r;
end $$;
revoke all on function public.icetak_product_admin(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.icetak_product_admin(text,jsonb,text) to service_role;

-- Profiles for exact model selection; every imported product still requires explicit owner publication.
insert into public.product_order_profiles(code,name,product_type,config)
select 'shopee_model_'||kind,'Shopee model · '||kind,kind,'{"catalog_models":true,"default_process":"Pre-order","wording_options":[{"value":"model_none","label":"Ikut design","review_required":false},{"value":"model_custom","label":"Custom wording","requires_text":true,"review_required":true}]}'::jsonb
from unnest(array['edible','burnaway','wafer','printed','mirror','acrylic']) kind on conflict(code) do nothing;

CREATE OR REPLACE FUNCTION public.icetak_validate_catalog_selection(p_catalog_slug text, p_wording_mode text, p_custom_text text, p_size_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_profile public.product_order_profiles%rowtype;
  v_size jsonb;
  v_wording jsonb;
  v_size_value text;
  v_size_label text;
  v_wording_value text;
  v_wording_label text;
  v_text text:=trim(coalesce(p_custom_text,''));
  v_price numeric;
  v_review boolean:=false;
  v_requires_text boolean:=false;
begin
  select * into v_product
  from public.products
  where slug=trim(coalesce(p_catalog_slug,''))
    and status='active'
    and is_published=true
  limit 1;

  if not found then
    raise exception 'catalog_product_unavailable';
  end if;

  if v_product.order_profile_id is null then
    raise exception 'catalog_order_profile_missing';
  end if;

  select * into v_profile
  from public.product_order_profiles
  where id=v_product.order_profile_id and active=true
  limit 1;

  if not found then
    raise exception 'catalog_order_profile_unavailable';
  end if;

  if coalesce((v_profile.config->>'catalog_models')::boolean,false) then
    if p_size_code !~ '^model:[0-9a-f-]{36}$' then raise exception 'catalog_model_required'; end if;
    select * into v_variant from public.product_variants where id=substring(p_size_code from 7)::uuid and product_id=v_product.id and active;
    if not found or v_variant.price is null or v_variant.price<=0 or coalesce(v_variant.stock,0)<1 then raise exception 'catalog_model_unavailable'; end if;
    select elem into v_wording from jsonb_array_elements(v_profile.config->'wording_options') elem where elem->>'value'=p_wording_mode;
    if v_wording is null then raise exception 'catalog_invalid_wording'; end if;
    v_review:=coalesce((v_wording->>'review_required')::boolean,false);
    if coalesce((v_wording->>'requires_text')::boolean,false) and v_text='' then raise exception 'custom_wording_required'; end if;
    if not coalesce((v_wording->>'requires_text')::boolean,false) then v_text:=''; end if;
    return jsonb_build_object('product_id',v_product.id,'product_variant_id',v_variant.id,'product_type',v_profile.product_type,
      'title',v_product.display_name,'price',v_variant.price,'size',v_variant.name,'style',v_variant.name,
      'wording_mode',p_wording_mode,'custom_text',v_text,'review_required',v_review,'catalog_clickup_task_id',v_product.clickup_task_id,
      'customization',jsonb_build_object('size',v_variant.name,'model_id',v_variant.metadata->>'shopee_model_id','variant_sku',v_variant.sku,'wording_mode',p_wording_mode,'custom_text',v_text,'review_required',v_review),
      'product_snapshot',jsonb_build_object('product_name',v_product.display_name,'source_title',v_product.source_title,'parent_sku',v_product.parent_sku,
        'image_url',coalesce(nullif(v_variant.metadata->>'image_url',''),v_product.main_image_url),'catalog_slug',v_product.slug,
        'selected_size',v_variant.name,'variant_sku',v_variant.sku,'model_id',v_variant.metadata->>'shopee_model_id','product_variant_id',v_variant.id,
        'wording_mode',p_wording_mode,'custom_text',v_text,'unit_price',v_variant.price));
  end if;
  -- Resolve size from the authoritative profile configuration. If a profile has
  -- no configured sizes, fall back to the product base price and supplied label.
  if jsonb_typeof(v_profile.config->'size_options')='array'
     and jsonb_array_length(v_profile.config->'size_options')>0 then
    select elem into v_size
    from jsonb_array_elements(v_profile.config->'size_options') elem
    where elem->>'value'=coalesce(nullif(trim(p_size_code),''), (v_profile.config->'size_options'->0)->>'value')
    limit 1;

    if v_size is null then
      raise exception 'catalog_invalid_size';
    end if;

    v_size_value:=v_size->>'value';
    v_size_label:=coalesce(nullif(v_size->>'label',''),v_size_value);
    v_price:=coalesce(nullif(v_size->>'price','')::numeric,v_product.base_price,0);
  else
    v_size_value:=coalesce(nullif(trim(p_size_code),''),'1 pc');
    v_size_label:=v_size_value;
    v_price:=coalesce(v_product.base_price,0);
  end if;

  -- Resolve wording from the authoritative profile configuration.
  if jsonb_typeof(v_profile.config->'wording_options')='array'
     and jsonb_array_length(v_profile.config->'wording_options')>0 then
    select elem into v_wording
    from jsonb_array_elements(v_profile.config->'wording_options') elem
    where elem->>'value'=coalesce(nullif(trim(p_wording_mode),''), (v_profile.config->'wording_options'->0)->>'value')
    limit 1;

    if v_wording is null then
      raise exception 'catalog_invalid_wording';
    end if;

    v_wording_value:=v_wording->>'value';
    v_wording_label:=coalesce(nullif(v_wording->>'label',''),v_wording_value);
    v_requires_text:=coalesce((v_wording->>'requires_text')::boolean,false);
    v_review:=coalesce((v_wording->>'review_required')::boolean,false);

    if v_requires_text and v_text='' then
      raise exception 'custom_wording_required';
    end if;

    if not v_requires_text then
      v_text:=coalesce(nullif(trim(v_wording->>'default_text'),''),'');
    end if;
  else
    v_wording_value:=coalesce(nullif(trim(p_wording_mode),''),'no_wording');
    v_wording_label:=v_wording_value;
  end if;

  return jsonb_build_object(
    'product_id',v_product.id,
    'product_type',coalesce(nullif(v_profile.product_type,''),'printed'),
    'title',coalesce(nullif(v_product.display_name,''),v_product.name,'Item'),
    'price',v_price,
    'size',v_size_value,
    'wording_mode',v_wording_value,
    'custom_text',v_text,
    'review_required',v_review,
    'catalog_clickup_task_id',coalesce(v_product.clickup_task_id,''),
    'customization',jsonb_build_object(
      'size',v_size_value,
      'size_label',v_size_label,
      'wording_mode',v_wording_value,
      'wording_label',v_wording_label,
      'custom_text',v_text,
      'review_required',v_review
    ),
    'product_snapshot',jsonb_build_object(
      'product_name',coalesce(nullif(v_product.display_name,''),v_product.name,'Item'),
      'source_title',coalesce(nullif(v_product.source_title,''),v_product.display_name,v_product.name,''),
      'parent_sku',coalesce(v_product.parent_sku,''),
      'image_url',coalesce(v_product.main_image_url,''),
      'catalog_slug',v_product.slug,
      'catalog_clickup_task_id',coalesce(v_product.clickup_task_id,''),
      'selected_size',v_size_value,
      'wording_mode',v_wording_value,
      'custom_text',v_text,
      'unit_price',v_price
    )
  );
end;
$function$
;
-- Preserve current order lifecycle definition; patch only the catalogue selection boundary.
do $patch$
declare def text:=pg_get_functiondef('public.icetak_create_order(jsonb)'::regprocedure);
begin
 if position('v_product_variant_id:=nullif(coalesce(v_item->>''productVariantId'',v_item->>''product_variant_id'',''''),'''')::uuid;' in def)=0 then raise exception 'CHECKOUT_VARIANT_PATCH_DRIFT'; end if;
 def:=replace(def,'v_product_variant_id:=nullif(coalesce(v_item->>''productVariantId'',v_item->>''product_variant_id'',''''),'''')::uuid;','v_product_variant_id:=nullif(v_catalog->>''product_variant_id'','''')::uuid;');
 def:=replace(def,'v_item_style:=coalesce(v_item->>''style'',''''); v_item_price:=coalesce(nullif(v_catalog','v_item_style:=coalesce(v_catalog->>''style'',v_item->>''style'',''''); v_item_price:=coalesce(nullif(v_catalog');
 execute def;
end $patch$;



create or replace function public.icetak_product_job(p_id uuid,p_action text,p_result jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare j product_sync_jobs%rowtype; l product_channel_listings%rowtype;
begin
 select * into j from product_sync_jobs where id=p_id for update;
 if not found then raise exception 'JOB_NOT_FOUND'; end if;
 select * into l from product_channel_listings where id=j.listing_id for update;
 if p_action='claim' then
  if j.status='running' and j.updated_at<now()-interval '2 minutes' then update product_sync_jobs set status='unknown',updated_at=now(),result='{"code":"WORKER_INTERRUPTED"}' where id=p_id; j.status:='unknown'; end if;
  if j.status not in ('pending','unknown') then raise exception 'JOB_NOT_PROCESSABLE'; end if;
  if j.status='pending' and l.revision<>j.expected_revision then update product_sync_jobs set status='conflict',updated_at=now() where id=p_id;return jsonb_build_object('status','conflict'); end if;
  update product_sync_jobs set status='running',updated_at=now() where id=p_id;
  return jsonb_build_object('job',to_jsonb(j),'listing',to_jsonb(l),'verify_only',j.status='unknown');
 elsif p_action='finish' then
  if j.status<>'running' or p_result->>'status' not in ('verified','failed','unknown','conflict') then raise exception 'INVALID_JOB_RESULT'; end if;
  update product_sync_jobs set status=p_result->>'status',result=p_result,updated_at=now() where id=p_id;
  if p_result->>'status'='verified' then update product_channel_listings set revision=revision+1,updated_at=now(),last_verified_at=now() where id=l.id; end if;
  return p_result;
 end if;
 raise exception 'INVALID_JOB_ACTION';
end $$;
revoke all on function public.icetak_product_job(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_product_job(uuid,text,jsonb) to service_role;
