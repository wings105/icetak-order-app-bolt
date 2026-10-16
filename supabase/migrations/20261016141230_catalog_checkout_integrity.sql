-- A browser checkout retry reuses one result, including the original payment session.
create table public.catalog_checkout_receipts(request_id uuid primary key,payload_hash text not null,result jsonb not null,created_at timestamptz not null default now());
alter table public.catalog_checkout_receipts enable row level security;
revoke all on public.catalog_checkout_receipts from public,anon,authenticated;grant all on public.catalog_checkout_receipts to service_role;
create policy checkout_receipt_service on public.catalog_checkout_receipts for all to service_role using(true)with check(true);
do $patch$
declare d text:=pg_get_functiondef('public.icetak_create_order(jsonb)'::regprocedure);
begin
 d:=replace(d,E'declare\n',E'declare\n  v_checkout_request uuid:=nullif(payload->>''checkout_request_id'','''')::uuid; v_checkout_old public.catalog_checkout_receipts%rowtype; v_checkout_result jsonb;\n');
 d:=replace(d,'  if jsonb_typeof(v_items)',
 '  if v_checkout_request is not null then
    perform pg_advisory_xact_lock(hashtextextended(''checkout:''||v_checkout_request::text,0));
    select * into v_checkout_old from public.catalog_checkout_receipts where request_id=v_checkout_request;
    if found then if v_checkout_old.payload_hash<>md5(payload::text) then raise exception ''CHECKOUT_REQUEST_REUSED'';end if;return v_checkout_old.result||jsonb_build_object(''duplicate'',true);end if;
  end if;
  if jsonb_typeof(v_items)');
 if position('  return jsonb_build_object(''success'',true,''duplicate'',false,' in d)=0 then raise exception 'CHECKOUT_RETURN_DRIFT';end if;
 d:=replace(d,'  return jsonb_build_object(''success'',true,''duplicate'',false,','  v_checkout_result:=jsonb_build_object(''success'',true,''duplicate'',false,');
 d:=replace(d,'''delivery_address_id'',v_address_id);','''delivery_address_id'',v_address_id);
  if v_checkout_request is not null then insert into public.catalog_checkout_receipts values(v_checkout_request,md5(payload::text),v_checkout_result,now());end if;
  return v_checkout_result;');
 execute d;
end $patch$;

-- Layer references, chosen model size/colour and option constraints travel with the real order.
do $patch$
declare d text:=pg_get_functiondef('public.icetak_validate_catalog_selection(text,text,text,text)'::regprocedure);
begin
 d:=replace(d,'''catalog_model_label'',v_variant.name,',
 '''catalog_model_label'',v_variant.name,''layers'',case when v_profile.product_type=''burnaway'' then jsonb_build_object(''edible'',jsonb_build_object(''size'',split_part(v_variant.name,'','',1),''shape'',''Round / Bulat''),''wafer'',jsonb_build_object(''size'',split_part(v_variant.name,'','',2),''shape'',''Round / Bulat''))else ''{}''::jsonb end,');
 execute d;
 d:=pg_get_functiondef('public.icetak_catalog_check_uploads(uuid,jsonb)'::regprocedure);
 d:=replace(d,' for f in select value',
 ' if exists(select 1 from products p join product_order_profiles op on op.id=p.order_profile_id where p.id=p_product and op.product_type=''burnaway'' and (p.metadata#>>''{website_order,upload_required}'')::boolean=true) and (not exists(select 1 from jsonb_array_elements(coalesce(p_files,''[]''))x where x->>''layer''=''edible'')or not exists(select 1 from jsonb_array_elements(coalesce(p_files,''[]''))x where x->>''layer''=''wafer''))then raise exception ''CATALOG_BOTH_LAYER_IMAGES_REQUIRED'';end if;
 for f in select value');
 execute d;
 d:=pg_get_functiondef('public.icetak_catalog_attach_files(uuid,jsonb)'::regprocedure);
 d:=replace(d,'''mime'',u.mime_type)', '''mime'',u.mime_type,''layer'',case when f->>''layer'' in(''edible'',''wafer'')then f->>''layer'' else ''general'' end)');
 d:=replace(d,' if jsonb_array_length(refs)>0 then',
 ' if exists(select 1 from production_components where order_item_id=i.id and component_type=''burnaway'')then null;end if;
 if jsonb_array_length(refs)>0 then');
 -- Layers already exist in the validated customization before component rows are inserted.
 d:=replace(d,'where id=i.id;end if;',
 'where id=i.id;
  for f in select value from jsonb_array_elements(refs)where value->>''layer'' in(''edible'',''wafer'')loop
   update order_items set customization=jsonb_set(customization,array[''layers'',f->>''layer''],coalesce(customization#>array[''layers'',f->>''layer''],''{}'')||jsonb_build_object(''reference_url'',f->>''url''),true)where id=i.id;
  end loop;
 end if;');
 execute d;
 d:=pg_get_functiondef('public.icetak_catalog_state(uuid)'::regprocedure);
 d:=replace(d,' return jsonb_build_object(',
 ' if (p.metadata#>>''{website_order,upload_required}'')::boolean=true and not coalesce((p.metadata#>>''{website_order,allow_upload}'')::boolean,false)then missing:=missing||''"Benarkan upload untuk gambar wajib"''::jsonb;end if;
 if (p.metadata#>>''{website_order,wording_required}'')::boolean=true and not coalesce((p.metadata#>>''{website_order,allow_custom}'')::boolean,true)then missing:=missing||''"Benarkan custom untuk wording wajib"''::jsonb;end if;
 return jsonb_build_object(');
 execute d;
end $patch$;
-- Hide legacy demo records without a usable cover from the public browse grid.
do $patch$
declare d text:=pg_get_functiondef('public.icetak_store_catalog(text,text,text,integer,integer)'::regprocedure);
begin d:=replace(d,'p.is_published and p.status=''active'' and p.product_kind','p.is_published and p.status=''active'' and p.main_image_url ~ ''^https://'' and p.product_kind');execute d;end $patch$;
