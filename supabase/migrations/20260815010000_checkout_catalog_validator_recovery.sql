-- Restore the server-side catalog selection validator required by icetak_create_order.
create or replace function public.icetak_validate_catalog_selection(
  p_catalog_slug text,
  p_wording_mode text,
  p_custom_text text,
  p_size_code text
)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $function$
declare
  v_product public.products%rowtype;
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
  if not found then raise exception 'catalog_product_unavailable'; end if;
  if v_product.order_profile_id is null then raise exception 'catalog_order_profile_missing'; end if;

  select * into v_profile
  from public.product_order_profiles
  where id=v_product.order_profile_id and active=true
  limit 1;
  if not found then raise exception 'catalog_order_profile_unavailable'; end if;

  if jsonb_typeof(v_profile.config->'size_options')='array'
     and jsonb_array_length(v_profile.config->'size_options')>0 then
    select elem into v_size
    from jsonb_array_elements(v_profile.config->'size_options') elem
    where elem->>'value'=coalesce(nullif(trim(p_size_code),''), (v_profile.config->'size_options'->0)->>'value')
    limit 1;
    if v_size is null then raise exception 'catalog_invalid_size'; end if;
    v_size_value:=v_size->>'value';
    v_size_label:=coalesce(nullif(v_size->>'label',''),v_size_value);
    v_price:=coalesce(nullif(v_size->>'price','')::numeric,v_product.base_price,0);
  else
    v_size_value:=coalesce(nullif(trim(p_size_code),''),'1 pc');
    v_size_label:=v_size_value;
    v_price:=coalesce(v_product.base_price,0);
  end if;

  if jsonb_typeof(v_profile.config->'wording_options')='array'
     and jsonb_array_length(v_profile.config->'wording_options')>0 then
    select elem into v_wording
    from jsonb_array_elements(v_profile.config->'wording_options') elem
    where elem->>'value'=coalesce(nullif(trim(p_wording_mode),''), (v_profile.config->'wording_options'->0)->>'value')
    limit 1;
    if v_wording is null then raise exception 'catalog_invalid_wording'; end if;
    v_wording_value:=v_wording->>'value';
    v_wording_label:=coalesce(nullif(v_wording->>'label',''),v_wording_value);
    v_requires_text:=coalesce((v_wording->>'requires_text')::boolean,false);
    v_review:=coalesce((v_wording->>'review_required')::boolean,false);
    if v_requires_text and v_text='' then raise exception 'custom_wording_required'; end if;
    if not v_requires_text then v_text:=coalesce(nullif(trim(v_wording->>'default_text'),''),''); end if;
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
      'review_required',v_review,
      'admin_process',coalesce(nullif(v_profile.config->>'default_process',''),'Pre-order')
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
$function$;

revoke all on function public.icetak_validate_catalog_selection(text,text,text,text) from public;
revoke all on function public.icetak_validate_catalog_selection(text,text,text,text) from anon;
revoke all on function public.icetak_validate_catalog_selection(text,text,text,text) from authenticated;

-- Keep old carts/clients compatible: catalog configurator stores selected size as `size`,
-- and older customer checkout did not send delivery_fee separately.
do $do$
declare
  v_def text;
  v_old_size text := 'coalesce(v_item->>''sizeCode'',v_item->>''size_code'','''')';
  v_new_size text := 'coalesce(v_item->>''sizeCode'',v_item->>''size_code'',v_item->>''size'','''')';
  v_old_fee text := 'v_delivery_fee numeric:=coalesce(nullif(payload->>''delivery_fee'','''')::numeric,0)';
  v_new_fee text := 'v_delivery_fee numeric:=coalesce(nullif(payload->>''delivery_fee'','''')::numeric,case lower(coalesce(payload->>''delivery'',''pickup'')) when ''spx'' then 4.50 when ''jnt'' then 5.90 when ''ninja'' then 6.90 else 0 end)';
begin
  select pg_get_functiondef('public.icetak_create_order(jsonb)'::regprocedure) into v_def;
  if position(v_old_size in v_def)>0 then v_def:=replace(v_def,v_old_size,v_new_size); end if;
  if position(v_old_fee in v_def)>0 then v_def:=replace(v_def,v_old_fee,v_new_fee); end if;
  execute v_def;
end
$do$;
