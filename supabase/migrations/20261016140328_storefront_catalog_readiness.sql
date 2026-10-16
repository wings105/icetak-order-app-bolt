-- Shared catalogue preparation, reversible owner bulk actions and bounded public browsing.
create table public.product_catalog_bulk_events (
 id uuid primary key default gen_random_uuid(),request_id uuid not null,product_id uuid not null references public.products(id),
 actor text not null,operation text not null,before_state jsonb not null,after_state jsonb not null,created_at timestamptz not null default now(),
 unique(request_id,product_id)
);
alter table public.product_catalog_bulk_events enable row level security;
revoke all on public.product_catalog_bulk_events from public,anon,authenticated;
grant all on public.product_catalog_bulk_events to service_role;
create policy catalog_bulk_service on public.product_catalog_bulk_events for all to service_role using(true) with check(true);
create index catalog_bulk_product_idx on public.product_catalog_bulk_events(product_id,created_at desc);

insert into public.product_categories(name,slug,sort_order) values
 ('Cake Topper Glossy','store-printed',10),('Edible Image','store-edible',20),('Acrylic Cake Topper','store-acrylic',30),
 ('Mirror Gold Artpaper','store-mirror',40),('Wafer Paper','store-wafer',50),('Burn Away','store-burnaway',60)
on conflict(slug) do nothing;
update public.product_order_profiles set config=jsonb_set(config,'{wording_options}',
 '[{"value":"model_none","label":"Happy Birthday","default_text":"Happy Birthday","requires_text":false,"review_required":false},{"value":"model_custom","label":"Custom Words","requires_text":true,"review_required":true}]'),updated_at=now()
 where code='shopee_model_printed';

create function public.icetak_catalog_state(p_id uuid) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare p products%rowtype; op product_order_profiles%rowtype; k text; t text; why text; missing jsonb:='[]'; auto_issues jsonb:='[]'; n int; available int; listing_count int; provider text;
begin
 select * into p from products where id=p_id;if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
 select * into op from product_order_profiles where id=p.order_profile_id and active;
 t:=lower(coalesce(p.source_title,p.name,'')||' '||coalesce(p.parent_sku,''));
 if t ~ 'wafer' and t ~ 'edible' then k:='burnaway';why:='Wafer + Edible pada tajuk';
 elsif t ~ 'wafer' then k:='wafer';why:='Wafer pada tajuk';
 elsif t ~ 'acrylic|aryclic' then k:='acrylic';why:='Acrylic pada tajuk';
 elsif t ~ 'mirror.*(gold|artpaper)|artpaper.*gold' then k:='mirror';why:='Mirror Gold Artpaper pada tajuk';
 elsif t ~ 'edible|icing paper' or coalesce(p.parent_sku,'') ~* '^ei[0-9]' then k:='edible';why:='Edible / kod EI';
 elsif lower(coalesce(p.description,'')) ~ 'material[^a-z]{0,12}(artpaper glossy|glossy)' then k:='printed';why:='Material Glossy dalam keterangan';
 elsif t ~ 'cake topper' then k:='printed';why:='Cake Topper tanpa material lain';
 else auto_issues:=auto_issues||'"Kategori production belum dikenal pasti"'::jsonb;
 end if;
 select count(*),count(*) filter(where active and price>0 and stock>0) into n,available from product_variants where product_id=p.id;
 select count(*),min(provider_status) into listing_count,provider from product_channel_listings where product_id=p.id;
 if p.status<>'active' then missing:=missing||'"Produk website tidak aktif"'::jsonb;end if;
 if nullif(trim(p.display_name),'') is null then missing:=missing||'"Tajuk kosong"'::jsonb;end if;
 if coalesce(p.main_image_url,'') !~ '^https://' then missing:=missing||'"Gambar utama tiada"'::jsonb;end if;
 if op.id is null then missing:=missing||'"Pilih profil production"'::jsonb;end if;
 if coalesce((op.config->>'catalog_models')::boolean,false) and available=0 then missing:=missing||'"Tiada variasi aktif dengan harga dan ketersediaan"'::jsonb;end if;
 if not coalesce((op.config->>'catalog_models')::boolean,false) and coalesce(p.base_price,0)<=0 then missing:=missing||'"Harga website belum ditetapkan"'::jsonb;end if;
 if p.metadata->>'catalog_managed'='true' and not p.is_published and p.metadata->>'catalog_setup_version' is null then missing:=missing||'"Pemetaan import belum disemak"'::jsonb;end if;
 if n=0 or available=0 then auto_issues:=auto_issues||'"Tiada variasi berharga dan tersedia"'::jsonb;end if;
 if listing_count<>1 then auto_issues:=auto_issues||'"Perlu satu listing sumber yang jelas"'::jsonb;end if;
 if provider is distinct from 'NORMAL' then auto_issues:=auto_issues||'"Listing Shopee tidak aktif / belum disemak"'::jsonb;end if;
 if t ~ 'ready[ -]?stock|belon|balloon' then auto_issues:=auto_issues||'"Semak produk siap stok / produk selain servis custom"'::jsonb;end if;
 if coalesce(p.main_image_url,'') !~ '^https://' then auto_issues:=auto_issues||'"Gambar utama tiada"'::jsonb;end if;
 return jsonb_build_object('kind',op.product_type,'suggested_kind',k,'suggestion_reason',why,'auto_issues',auto_issues,
 'can_prepare',jsonb_array_length(auto_issues)=0,'missing',missing,'ready',jsonb_array_length(missing)=0,
 'state',case when p.is_published then 'published' when jsonb_array_length(missing)=0 then 'ready' else 'review' end,
 'model_count',n,'available_models',available);
end $$;
revoke all on function public.icetak_catalog_state(uuid) from public,anon,authenticated;
grant execute on function public.icetak_catalog_state(uuid) to service_role;

create function public.icetak_catalog_capture(p_id uuid) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('product',to_jsonb(p),'variants',coalesce((select jsonb_agg(to_jsonb(v) order by v.id) from product_variants v where v.product_id=p.id),'[]')) from products p where id=p_id;
$$;
revoke all on function public.icetak_catalog_capture(uuid) from public,anon,authenticated;
grant execute on function public.icetak_catalog_capture(uuid) to service_role;

create function public.icetak_catalog_admin(p_action text,p_body jsonb,p_actor text) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r jsonb; st jsonb; entry jsonb; p products%rowtype; k text; op_id uuid; cat uuid; req uuid; old product_catalog_requests%rowtype;
 before_value jsonb; after_value jsonb; result_rows jsonb:='[]'; hash text; err text; operation text:=coalesce(p_body->>'operation','prepare');
 q text:=left(coalesce(p_body->>'q',''),160); provider_filter text:=coalesce(p_body->>'status','');web_filter text:=coalesce(p_body->>'website','');offst int:=greatest(0,least(100000,coalesce((p_body->>'offset')::int,0)));
 saved product_catalog_bulk_events%rowtype; b jsonb; v jsonb; description_value text; process_value text;
begin
 if p_action='list' then
  with matches as materialized (
   select pr.*,cl.id listing_id,cl.shop_id,cl.item_id,cl.provider_status,cl.revision,cl.last_verified_at,cl.last_imported_at,cl.snapshot,icetak_catalog_state(pr.id) readiness
   from products pr left join lateral(select * from product_channel_listings where product_id=pr.id order by id limit 1)cl on true
   where (q='' or concat_ws(' ',pr.display_name,pr.parent_sku,cl.item_id) ilike '%'||q||'%')
  ),filtered as(select * from matches where(provider_filter='' or provider_status=provider_filter) and(web_filter='' or readiness->>'state'=web_filter))
  select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(row_value) from(
   select jsonb_build_object('id',id,'slug',slug,'display_name',display_name,'parent_sku',parent_sku,'main_image_url',main_image_url,'base_price',base_price,'is_published',is_published,'order_profile_id',order_profile_id,'updated_at',updated_at,
    'listing_id',listing_id,'shop_id',shop_id,'item_id',item_id,'provider_status',provider_status,'revision',revision,'last_verified_at',last_verified_at,'model_count',readiness->'model_count','readiness',readiness,
    'shopee_summary',(select jsonb_build_object('price_min',min((m->>'price')::numeric),'price_max',max((m->>'price')::numeric),'stock',sum((m->>'stock')::int),'captured_at',last_imported_at) from jsonb_array_elements(coalesce(snapshot->'models','[]'))m))row_value
   from filtered order by created_at desc,id limit 40 offset offst)x),'[]'),
   'status_counts',(select coalesce(jsonb_object_agg(s,n),'{}')||jsonb_build_object('ALL',(select count(*) from matches)) from(select coalesce(provider_status,'WEBSITE_ONLY') s,count(*)n from matches group by 1)x),
   'website_counts',(select jsonb_object_agg(s,n) from(select readiness->>'state' s,count(*)n from matches group by 1)x)) into r;
  return r;
 elsif p_action='detail' then
  r:=icetak_product_admin('detail',p_body,p_actor);
  return r||jsonb_build_object('readiness',icetak_catalog_state((p_body->>'id')::uuid),'history',coalesce((select jsonb_agg(x) from(select id,request_id,operation,actor,created_at from product_catalog_bulk_events where product_id=(p_body->>'id')::uuid order by created_at desc limit 10)x),'[]'));
 elsif p_action='save_extra' then
  update products set metadata=metadata||jsonb_build_object('catalog_setup_version',1,'website_description',left(coalesce(p_body->>'website_description',description,''),20000)),updated_at=clock_timestamp() where id=(p_body->>'id')::uuid;
  return '{}'::jsonb;
 end if;
 if p_action not in('preview','apply') then raise exception 'INVALID_CATALOG_ACTION';end if;
 if operation not in('prepare','configure','publish','unpublish','restore') then raise exception 'INVALID_BULK_OPERATION';end if;
 if jsonb_typeof(p_body->'items') is distinct from 'array' or jsonb_array_length(p_body->'items') not between 1 and 40 then raise exception 'SELECT_1_TO_40_PRODUCTS';end if;
 if p_action='apply' then
  req:=(p_body->>'request_id')::uuid;if req is null then raise exception 'REQUEST_ID_REQUIRED';end if;hash:=md5(p_body::text);
  perform pg_advisory_xact_lock(hashtextextended(req::text,0));select * into old from product_catalog_requests where request_id=req;
  if found then if old.payload_hash<>hash or old.actor<>p_actor or old.action<>'catalog_apply' then raise exception 'REQUEST_REUSED';end if;return old.result;end if;
 end if;
 for entry in select value from jsonb_array_elements(p_body->'items') order by value->>'id' loop
  begin
   if p_action='apply' then select * into p from products where id=(entry->>'id')::uuid for update;else select * into p from products where id=(entry->>'id')::uuid;end if;
   if not found or p.is_basic then raise exception 'CATALOG_DESIGN_REQUIRED';end if;
   if p.updated_at is distinct from (entry->>'updated_at')::timestamptz then raise exception 'PRODUCT_CHANGED_RELOAD';end if;
   st:=icetak_catalog_state(p.id);k:=coalesce(nullif(p_body->>'kind','auto'),'');if k='' then k:=st->>'suggested_kind';end if;
   if operation in('prepare','configure') then
    if k not in('printed','edible','acrylic','mirror','wafer','burnaway') or k is null then raise exception 'SELECT_PRODUCTION_CATEGORY';end if;
    if operation='prepare' and (p.is_published or not (st->>'can_prepare')::boolean) then raise exception 'REVIEW_REQUIRED: %',coalesce(nullif(st->'auto_issues','[]'),'["Produk sudah diterbitkan"]');end if;
    if not exists(select 1 from product_variants where product_id=p.id and active and price>0 and stock>0) then raise exception 'ACTIVE_PRICED_MODEL_REQUIRED';end if;
    select id into op_id from product_order_profiles where code='shopee_model_'||k and active;
    select id into cat from product_categories where slug='store-'||k;
    if op_id is null or cat is null then raise exception 'PROFILE_NOT_AVAILABLE';end if;
    process_value:=coalesce(nullif(p_body->>'process',''),p.metadata#>>'{website_order,process}','Pre-order');
    if process_value not in('Pre-order','Urgent') then raise exception 'INVALID_ORDER_PROCESS';end if;
   elsif operation='publish' and not (st->>'ready')::boolean then raise exception 'NOT_READY: %',st->'missing';
   elsif operation='restore' then
    select * into saved from product_catalog_bulk_events where id=(p_body->>'event_id')::uuid and product_id=p.id;
    if not found or icetak_catalog_capture(p.id)<>saved.after_state then raise exception 'RESTORE_CONFLICT_OR_EVENT_MISSING';end if;
   end if;
   if p_action='apply' then
    before_value:=icetak_catalog_capture(p.id);
    if operation in('prepare','configure') then
     description_value:=case k when 'printed' then 'Cake Topper Glossy mengikut design pada gambar. Pilih variasi dan wording untuk tempahan anda.' when 'edible' then 'Cetakan Edible Image mengikut design pada gambar. Pilih saiz dan pilihan wording yang tersedia.' when 'acrylic' then 'Acrylic cake topper custom. Pilih warna dan saiz, kemudian isi wording. Boleh muat naik gambar contoh untuk rujukan design.' when 'wafer' then 'Cetakan Wafer Paper sahaja. Pilih saiz dan bentuk, kemudian muat naik gambar untuk dicetak.' when 'burnaway' then 'Set cetakan Edible Image dan Wafer Paper untuk Burn Away. Pilih kombinasi saiz dan muat naik gambar rujukan.' else 'Cake Topper Mirror Gold Artpaper. Pilih variasi dan isi wording tempahan.' end;
     update products set order_profile_id=op_id,category_id=cat,base_price=(select min(price) from product_variants where product_id=p.id and active and price>0),
      metadata=metadata||jsonb_build_object('catalog_setup_version',1,'catalog_managed',true,'website_description',coalesce(nullif(metadata->>'website_description',''),description_value),
      'website_order',coalesce(metadata->'website_order','{}')||jsonb_build_object('process',process_value,'allow_custom',coalesce((p_body->>'allow_custom')::boolean,(metadata#>>'{website_order,allow_custom}')::boolean,true),
      'review_required',coalesce((p_body->>'review_required')::boolean,(metadata#>>'{website_order,review_required}')::boolean,k in('acrylic','burnaway','wafer')),'allow_upload',coalesce((p_body->>'allow_upload')::boolean,true),
      'upload_required',coalesce((p_body->>'upload_required')::boolean,k in('wafer','burnaway')),'wording_required',k='acrylic')),
      updated_at=clock_timestamp() where id=p.id;
     if p_body->>'price_mode'='source' then
      update product_variants set price=(metadata#>>'{provider_snapshot,price}')::numeric,updated_at=clock_timestamp() where product_id=p.id and (metadata#>>'{provider_snapshot,price}')::numeric>0;
     elsif p_body->>'price_mode'='fixed' then
      if coalesce((p_body->>'fixed_price')::numeric,0)<=0 or (p_body->>'fixed_price')::numeric>100000 then raise exception 'INVALID_FIXED_PRICE';end if;
      update product_variants set price=(p_body->>'fixed_price')::numeric,updated_at=clock_timestamp() where product_id=p.id;
     end if;
     update products set base_price=(select min(price) from product_variants where product_id=p.id and active and price>0) where id=p.id;
     if coalesce((p_body->>'publish')::boolean,false) then
      if not (icetak_catalog_state(p.id)->>'ready')::boolean then raise exception 'NOT_READY_AFTER_PREPARE';end if;
      update products set is_published=true,is_indexable=true where id=p.id;
     end if;
    elsif operation in('publish','unpublish') then update products set is_published=operation='publish',is_indexable=operation='publish',updated_at=clock_timestamp() where id=p.id;
    elsif operation='restore' then
     b:=saved.before_state->'product';
     update products set order_profile_id=nullif(b->>'order_profile_id','')::uuid,category_id=nullif(b->>'category_id','')::uuid,base_price=(b->>'base_price')::numeric,metadata=b->'metadata',is_published=(b->>'is_published')::boolean,is_indexable=(b->>'is_indexable')::boolean,updated_at=clock_timestamp() where id=p.id;
     for v in select value from jsonb_array_elements(saved.before_state->'variants') loop
      update product_variants set price=(v->>'price')::numeric,stock=(v->>'stock')::int,active=(v->>'active')::boolean,metadata=v->'metadata',updated_at=clock_timestamp() where id=(v->>'id')::uuid and product_id=p.id;
     end loop;
    end if;
    after_value:=icetak_catalog_capture(p.id);
    insert into product_catalog_bulk_events(request_id,product_id,actor,operation,before_state,after_state) values(req,p.id,p_actor,operation,before_value,after_value);
   end if;
   result_rows:=result_rows||jsonb_build_array(jsonb_build_object('id',p.id,'name',p.display_name,'ok',true,'kind',k,'operation',operation,'price_mode',coalesce(p_body->>'price_mode','keep'),'publish',coalesce((p_body->>'publish')::boolean,false),'readiness',case when p_action='apply' then icetak_catalog_state(p.id) else st end));
  exception when others then get stacked diagnostics err=message_text;result_rows:=result_rows||jsonb_build_array(jsonb_build_object('id',entry->>'id','ok',false,'error',left(err,240)));end;
 end loop;
 r:=jsonb_build_object('request_id',req,'rows',result_rows,'applied',(select count(*) from jsonb_array_elements(result_rows)x where (x->>'ok')::boolean));
 if p_action='apply' then insert into product_catalog_requests values(req,'catalog_apply',p_actor,hash,r,now());end if;
 return r;
end $$;
revoke all on function public.icetak_catalog_admin(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.icetak_catalog_admin(text,jsonb,text) to service_role;

-- Public data uses existing product/profile RLS, without exposing source listings or private audit rows.
create function public.icetak_store_catalog(p_query text default '',p_kind text default '',p_sort text default 'relevance',p_offset int default 0,p_limit int default 24)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 with params as(select left(lower(trim(coalesce(p_query,''))),100)q,coalesce(p_kind,'')kind,least(48,greatest(1,coalesce(p_limit,24)))take,greatest(0,least(100000,coalesce(p_offset,0)))skip),
 matches as materialized(select p.id,p.slug,p.display_name display_title,coalesce(p.source_title,p.name)title,coalesce(p.metadata->>'website_description',p.description,'')description,
  op.product_type kind,coalesce(c.name,'Produk')category,p.parent_sku,p.shopee_product_id,p.main_image_url image_url,p.shopee_url,p.created_at,
  coalesce(v.price_min,p.base_price)price_min,coalesce(v.price_max,p.base_price)price_max,
  case when coalesce((op.config->>'catalog_models')::boolean,false) then coalesce(v.available,0)>0 else coalesce(p.base_price,0)>0 end available,
  case when lower(p.parent_sku)=params.q or p.shopee_product_id=params.q then 5 when lower(p.display_name)=params.q then 4 when lower(p.display_name) like '%'||params.q||'%' then 3 else 1 end rank
  from products p join product_order_profiles op on op.id=p.order_profile_id and op.active left join product_categories c on c.id=p.category_id
  left join lateral(select min(price)price_min,max(price)price_max,count(*)filter(where stock>0)available from product_variants where product_id=p.id and active and price>0)v on true
  cross join params where p.is_published and p.status='active' and p.product_kind<>'basic_service'
  and(params.q='' or not exists(select 1 from regexp_split_to_table(params.q,'\s+')token where strpos(lower(concat_ws(' ',p.display_name,p.parent_sku,p.shopee_product_id)),token)=0))),
 filtered as(select matches.* from matches cross join params where params.kind='' or matches.kind=params.kind),
 page as(select * from filtered order by case when p_sort='price_asc' then price_min end asc nulls last,case when p_sort='price_desc' then price_min end desc nulls last,
  case when p_sort='title' then display_title end asc,case when p_sort='relevance' then rank end desc,created_at desc,id limit(select take from params)offset(select skip from params))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)-'q'-'kind1'-'take'-'skip'-'rank')from page),'[]'),'total',(select count(*) from filtered),
 'categories',coalesce((select jsonb_object_agg(kind,n)from(select kind,count(*)n from matches group by kind)x),'{}'));
$$;
revoke all on function public.icetak_store_catalog(text,text,text,int,int) from public;
grant execute on function public.icetak_store_catalog(text,text,text,int,int) to anon,authenticated,service_role;

-- Retain exact model identity and use authoritative wording requirements from the chosen model.
do $patch$
declare d text:=pg_get_functiondef('public.icetak_validate_catalog_selection(text,text,text,text)'::regprocedure);
begin
 if position('v_text:='''';' in d)=0 then raise exception 'CATALOG_VALIDATOR_DRIFT';end if;
 d:=replace(d,'if not coalesce((v_wording->>''requires_text'')::boolean,false) then v_text:=''''; end if;',
 'if (coalesce((v_product.metadata#>>''{website_order,wording_required}'')::boolean,false) or v_variant.name ~* ''add wording|custom name'') and (not coalesce((v_wording->>''requires_text'')::boolean,false) or v_text='''') then raise exception ''custom_wording_required'';end if;
 if v_variant.name ~* ''no wording'' and coalesce((v_wording->>''requires_text'')::boolean,false) then raise exception ''catalog_wording_model_mismatch'';end if;
 if length(v_text)>1000 then raise exception ''catalog_wording_too_long'';end if;
 if not coalesce((v_wording->>''requires_text'')::boolean,false) then v_text:=coalesce(v_wording->>''default_text'',''''); end if;');
 d:=replace(d,'''admin_process'',coalesce(v_product.metadata#>>''{website_order,process}'',''Pre-order''),',
 '''admin_process'',coalesce(v_product.metadata#>>''{website_order,process}'',''Pre-order''),''catalog_model_label'',v_variant.name,''colour'',case when v_profile.product_type=''acrylic'' then split_part(v_variant.name,'','',1) else v_variant.colour end,');
 execute d;
end $patch$;

-- Keep extra storefront settings in the existing optimistic/idempotent save transaction.
do $patch$
declare d text:=pg_get_functiondef('public.icetak_product_admin(text,jsonb,text)'::regprocedure);
begin
 d:=replace(d,'metadata=metadata||jsonb_build_object(''website_order'',jsonb_build_object(',
 'metadata=metadata||jsonb_build_object(''website_order'',coalesce(metadata->''website_order'',''{}''::jsonb)||jsonb_build_object(');
 if position('  r:=jsonb_build_object(''saved'',p.id);' in d)=0 then raise exception 'CATALOG_SAVE_DRIFT';end if;
 d:=replace(d,'  r:=jsonb_build_object(''saved'',p.id);',$body$
  update products set metadata=metadata||jsonb_build_object('catalog_setup_version',1,'website_description',left(coalesce(p_body->>'website_description',metadata->>'website_description',description,''),20000),
    'website_order',coalesce(metadata->'website_order','{}')||jsonb_strip_nulls(jsonb_build_object('allow_upload',p_body#>'{website_order,allow_upload}','upload_required',p_body#>'{website_order,upload_required}','wording_required',p_body#>'{website_order,wording_required}'))) where id=p.id;
  if (p_body->>'is_published')::boolean and not (icetak_catalog_state(p.id)->>'ready')::boolean then raise exception 'WEBSITE_PRODUCT_NOT_READY';end if;
  r:=jsonb_build_object('saved',p.id);
 $body$);
 execute d;
end $patch$;
