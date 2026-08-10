create or replace function public.icetak_admin_order_update(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  order_uuid uuid := nullif(p_payload->>'order_db_id','')::uuid;
  order_value public.orders%rowtype;
  item jsonb;
  username_value text;
  total_value numeric;
  current_delivery_fee numeric;
  delivery_key text;
  before_items jsonb;
  after_items jsonb;
  before_order jsonb;
  after_order jsonb;
  shipment_locked boolean := false;
begin
  if not public.icetak_admin_has_permission('edit_order') then raise exception 'Forbidden'; end if;
  if order_uuid is null then raise exception 'order_db_id required'; end if;

  select * into order_value from public.orders where id=order_uuid;
  if order_value.id is null then raise exception 'Order not found'; end if;

  if p_payload ? 'delivery_method' then
    delivery_key := lower(btrim(coalesce(p_payload->>'delivery_method','')));
    if delivery_key in ('j&t','jt','j&t express','jnt express') then delivery_key := 'jnt'; end if;
    if delivery_key not in ('pickup','spx','jnt') then
      raise exception 'Unsupported delivery method. Use pickup, spx or jnt';
    end if;

    shipment_locked := nullif(btrim(coalesce(order_value.tracking,'')),'') is not null
      or exists (
        select 1 from public.shipments s
        where s.order_id=order_uuid
          and nullif(btrim(coalesce(s.tracking_no,'')),'') is not null
      );
    if shipment_locked then
      raise exception 'Courier/delivery cannot be changed after tracking has been created';
    end if;
  end if;

  before_order:=jsonb_build_object(
    'dateNeed',order_value.date_need,
    'adminRemark',order_value.admin_remark,
    'total',order_value.total,
    'deliveryFee',coalesce(order_value.delivery_fee,0),
    'delivery',coalesce(order_value.delivery,''),
    'deliveryMethod',coalesce(order_value.delivery_method,''),
    'courier',coalesce(order_value.courier,'')
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'qty',i.qty,'price',i.price,
    'customText',coalesce(i.custom_text,i.wording,''),
    'previewUrl',coalesce(i.design_preview_url,'')
  ) order by i.id),'[]'::jsonb)
  into before_items
  from public.order_items i where i.order_id=order_uuid;

  update public.orders set
    date_need=coalesce(nullif(p_payload->>'date_need','')::date,date_need),
    admin_remark=coalesce(p_payload->>'admin_remark',admin_remark),
    delivery_fee=case
      when delivery_key='pickup' then 0
      when p_payload ? 'delivery_fee' then greatest(0,coalesce(nullif(p_payload->>'delivery_fee','')::numeric,0))
      else delivery_fee
    end,
    delivery=case delivery_key
      when 'pickup' then 'Pickup'
      when 'spx' then 'SPX'
      when 'jnt' then 'JNT'
      else delivery
    end,
    delivery_method=coalesce(delivery_key,delivery_method),
    courier=case
      when delivery_key='pickup' then null
      when delivery_key in ('spx','jnt') then delivery_key
      else courier
    end,
    updated_at=now()
  where id=order_uuid;

  if jsonb_typeof(p_payload->'items')='array' then
    for item in select value from jsonb_array_elements(p_payload->'items') loop
      update public.order_items set
        qty=greatest(1,coalesce(nullif(item->>'qty','')::integer,qty)),
        price=greatest(0,coalesce(nullif(item->>'price','')::numeric,price)),
        custom_text=coalesce(item->>'custom_text',custom_text),
        wording=coalesce(item->>'custom_text',wording),
        design_preview_url=coalesce(item->>'design_preview_url',design_preview_url),
        updated_at=now()
      where id=nullif(item->>'id','')::uuid and order_id=order_uuid;
    end loop;
  end if;

  select coalesce(delivery_fee,0) into current_delivery_fee from public.orders where id=order_uuid;
  select coalesce(sum(coalesce(qty,1)*coalesce(price,0)),0)+coalesce(current_delivery_fee,0)
  into total_value
  from public.order_items where order_id=order_uuid;

  update public.orders set total=total_value,updated_at=now() where id=order_uuid;
  select * into order_value from public.orders where id=order_uuid;

  after_order:=jsonb_build_object(
    'dateNeed',order_value.date_need,
    'adminRemark',order_value.admin_remark,
    'total',order_value.total,
    'deliveryFee',coalesce(order_value.delivery_fee,0),
    'delivery',coalesce(order_value.delivery,''),
    'deliveryMethod',coalesce(order_value.delivery_method,''),
    'courier',coalesce(order_value.courier,'')
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'qty',i.qty,'price',i.price,
    'customText',coalesce(i.custom_text,i.wording,''),
    'previewUrl',coalesce(i.design_preview_url,'')
  ) order by i.id),'[]'::jsonb)
  into after_items
  from public.order_items i where i.order_id=order_uuid;

  select username into username_value
  from public.admin_users
  where auth_user_id=auth.uid() and is_active=true limit 1;

  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(
    order_uuid::text,
    coalesce(order_value.order_id,order_value.order_no),
    'update_order',username_value,
    jsonb_build_object(
      'before',jsonb_build_object('order',before_order,'items',before_items),
      'after',jsonb_build_object('order',after_order,'items',after_items)
    )
  );

  return jsonb_build_object(
    'ok',true,
    'total',total_value,
    'deliveryFee',coalesce(order_value.delivery_fee,0),
    'delivery',coalesce(order_value.delivery,''),
    'deliveryMethod',coalesce(order_value.delivery_method,''),
    'courier',coalesce(order_value.courier,'')
  );
end;
$function$;
