-- Manual ParcelDaily AWB reconciliation + NinjaVan tracking support.
-- Auto-link priority: exact reference, then unique exact phone + compatible courier within 14 days.

create or replace function public.icetak_shipping_phone_key(p_phone text)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when regexp_replace(coalesce(p_phone,''),'\D','','g') = '' then ''
    when regexp_replace(coalesce(p_phone,''),'\D','','g') like '60%' then regexp_replace(coalesce(p_phone,''),'\D','','g')
    when regexp_replace(coalesce(p_phone,''),'\D','','g') like '0%' then '6'||regexp_replace(coalesce(p_phone,''),'\D','','g')
    when regexp_replace(coalesce(p_phone,''),'\D','','g') like '1%' then '60'||regexp_replace(coalesce(p_phone,''),'\D','','g')
    else regexp_replace(coalesce(p_phone,''),'\D','','g') end;
$$;

create or replace function public.icetak_shipping_courier_key(p_courier text,p_tracking_no text default null)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when upper(btrim(coalesce(p_tracking_no,''))) ~ '^NVMY[A-Z0-9]+$' then 'ninja'
    when upper(btrim(coalesce(p_tracking_no,''))) ~ '^MY[0-9]+$' then 'spx'
    when btrim(coalesce(p_tracking_no,'')) ~ '^[0-9]+$' then 'jnt'
    when lower(btrim(coalesce(p_courier,''))) in ('ninja','ninjavan','ninja van') then 'ninja'
    when lower(btrim(coalesce(p_courier,''))) in ('spx','shopee express','shopee xpress') then 'spx'
    when lower(btrim(coalesce(p_courier,''))) in ('jnt','j&t','j&t express','jnt express') then 'jnt'
    when lower(btrim(coalesce(p_courier,''))) in ('pickup','self pickup','self-pickup') then 'pickup'
    else nullif(lower(regexp_replace(btrim(coalesce(p_courier,'')),'[^a-zA-Z0-9]+','','g')),'') end;
$$;

create or replace function public.icetak_tracking_courier(p_tracking_no text,p_courier text default null)
returns text language sql immutable set search_path to 'public' as $$
  select public.icetak_shipping_courier_key(p_courier,p_tracking_no);
$$;

create or replace function public.icetak_tracking_link(p_tracking_no text)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when upper(btrim(coalesce(p_tracking_no,''))) ~ '^NVMY[A-Z0-9]+$'
      then 'https://www.ninjavan.co/en-my/tracking?id='||upper(btrim(p_tracking_no))
    when upper(btrim(coalesce(p_tracking_no,''))) ~ '^MY[0-9]+$'
      then 'https://spx.com.my/track?'||upper(btrim(p_tracking_no))
    when btrim(coalesce(p_tracking_no,'')) ~ '^[0-9]+$'
      then 'https://jtexpress.my/tracking/'||btrim(p_tracking_no)
    else null end;
$$;

create or replace function public.icetak_tracking_message(p_tracking_no text)
returns text language sql immutable set search_path to 'public' as $$
  select 'Hi,'||E'\n'||'This tracking number for your order'||E'\n\n'||
         'Tracking Number: '||btrim(coalesce(p_tracking_no,''))||E'\n'||
         'Track here: '||coalesce(public.icetak_tracking_link(p_tracking_no),'');
$$;

create or replace function public.icetak_resolve_shipment_order_auto(
  p_reference text,p_recipient_phone text,p_courier text,p_service_provider text,p_tracking_no text,p_created_at timestamptz
) returns uuid language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare
  v_order_id uuid;
  v_phone text:=public.icetak_shipping_phone_key(p_recipient_phone);
  v_courier text:=public.icetak_shipping_courier_key(coalesce(nullif(p_courier,''),p_service_provider),p_tracking_no);
  v_created timestamptz:=coalesce(p_created_at,now());
  v_count integer;
begin
  if nullif(btrim(coalesce(p_reference,'')),'') is not null then
    v_order_id:=public.resolve_shipping_order_reference(btrim(p_reference));
    if v_order_id is not null then return v_order_id; end if;
  end if;
  if v_phone='' or v_courier is null or v_courier='pickup' then return null; end if;
  with candidates as (
    select o.id
    from public.orders o left join public.customers c on c.id=o.customer_id
    where public.icetak_shipping_phone_key(coalesce(nullif(o.delivery_phone,''),c.phone))=v_phone
      and public.icetak_shipping_courier_key(coalesce(nullif(o.courier,''),nullif(o.delivery_method,''),o.delivery),null)=v_courier
      and nullif(btrim(coalesce(o.tracking,'')),'') is null
      and lower(btrim(coalesce(o.status,''))) not in ('completed','cancelled','canceled','delivered')
      and lower(btrim(coalesce(o.admin_status,''))) not in ('cancelled','canceled','delivered','customer collected')
      and lower(btrim(coalesce(o.fulfillment_stage,''))) not in ('delivered','collected','cancelled','canceled')
      and o.created_at between v_created-interval '14 days' and v_created+interval '1 day'
  ) select count(*),(array_agg(id))[1] into v_count,v_order_id from candidates;
  if v_count=1 then return v_order_id; end if;
  return null;
end;
$$;

create or replace function public.icetak_shipment_match_suggestion(p_shipment_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare
  s public.shipments%rowtype;
  v_ref_order uuid;
  v_phone text;
  v_courier text;
  v_count integer;
  v_order uuid;
  v_candidates jsonb:='[]'::jsonb;
begin
  select * into s from public.shipments where id=p_shipment_id;
  if not found then return jsonb_build_object('candidateCount',0,'autoLinkable',false,'reason','shipment_not_found','candidates','[]'::jsonb); end if;
  if s.order_id is not null then
    return jsonb_build_object('candidateCount',1,'autoLinkable',false,'reason','already_linked','orderDbId',s.order_id,'orderNo',(select o.order_no from public.orders o where o.id=s.order_id),'confidence',100,'candidates','[]'::jsonb);
  end if;
  if nullif(btrim(coalesce(s.reference,'')),'') is not null then
    v_ref_order:=public.resolve_shipping_order_reference(s.reference);
    if v_ref_order is not null then
      return jsonb_build_object('candidateCount',1,'autoLinkable',true,'reason','exact_reference','orderDbId',v_ref_order,'orderNo',(select o.order_no from public.orders o where o.id=v_ref_order),'confidence',100,'candidates','[]'::jsonb);
    end if;
  end if;
  v_phone:=public.icetak_shipping_phone_key(s.recipient_phone);
  v_courier:=public.icetak_shipping_courier_key(coalesce(nullif(s.courier,''),s.service_provider),s.tracking_no);
  if v_phone='' then return jsonb_build_object('candidateCount',0,'autoLinkable',false,'reason','phone_missing','confidence',0,'candidates','[]'::jsonb); end if;

  with c as (
    select o.id,o.order_no,o.status,o.admin_status,o.delivery,o.delivery_method,o.courier,o.created_at,
      public.icetak_shipping_courier_key(coalesce(nullif(o.courier,''),nullif(o.delivery_method,''),o.delivery),null) order_courier
    from public.orders o left join public.customers cu on cu.id=o.customer_id
    where public.icetak_shipping_phone_key(coalesce(nullif(o.delivery_phone,''),cu.phone))=v_phone
      and nullif(btrim(coalesce(o.tracking,'')),'') is null
      and lower(btrim(coalesce(o.status,''))) not in ('completed','cancelled','canceled','delivered')
      and lower(btrim(coalesce(o.admin_status,''))) not in ('cancelled','canceled','delivered','customer collected')
      and lower(btrim(coalesce(o.fulfillment_stage,''))) not in ('delivered','collected','cancelled','canceled')
      and o.created_at between coalesce(s.created_at,now())-interval '14 days' and coalesce(s.created_at,now())+interval '1 day'
      and (v_courier is null or public.icetak_shipping_courier_key(coalesce(nullif(o.courier,''),nullif(o.delivery_method,''),o.delivery),null)=v_courier)
    order by o.created_at desc
  ) select count(*),(array_agg(id order by created_at desc))[1],
      coalesce(jsonb_agg(jsonb_build_object('orderDbId',id,'orderNo',order_no,'status',status,'adminStatus',admin_status,'delivery',delivery,'courier',order_courier,'createdAt',created_at) order by created_at desc),'[]'::jsonb)
    into v_count,v_order,v_candidates from c;
  if v_count=1 then return jsonb_build_object('candidateCount',1,'autoLinkable',true,'reason','exact_phone_unique_courier','orderDbId',v_order,'orderNo',(select o.order_no from public.orders o where o.id=v_order),'confidence',95,'candidates',v_candidates);
  elsif v_count>1 then return jsonb_build_object('candidateCount',v_count,'autoLinkable',false,'reason','ambiguous_phone','confidence',50,'candidates',v_candidates); end if;

  with c as (
    select o.id,o.order_no,o.status,o.admin_status,o.delivery,o.delivery_method,o.courier,o.created_at,
      public.icetak_shipping_courier_key(coalesce(nullif(o.courier,''),nullif(o.delivery_method,''),o.delivery),null) order_courier
    from public.orders o left join public.customers cu on cu.id=o.customer_id
    where public.icetak_shipping_phone_key(coalesce(nullif(o.delivery_phone,''),cu.phone))=v_phone
      and nullif(btrim(coalesce(o.tracking,'')),'') is null
      and lower(btrim(coalesce(o.status,''))) not in ('completed','cancelled','canceled','delivered')
      and lower(btrim(coalesce(o.admin_status,''))) not in ('cancelled','canceled','delivered','customer collected')
      and lower(btrim(coalesce(o.fulfillment_stage,''))) not in ('delivered','collected','cancelled','canceled')
      and o.created_at between coalesce(s.created_at,now())-interval '14 days' and coalesce(s.created_at,now())+interval '1 day'
    order by o.created_at desc
  ) select count(*),(array_agg(id order by created_at desc))[1],
      coalesce(jsonb_agg(jsonb_build_object('orderDbId',id,'orderNo',order_no,'status',status,'adminStatus',admin_status,'delivery',delivery,'courier',order_courier,'createdAt',created_at) order by created_at desc),'[]'::jsonb)
    into v_count,v_order,v_candidates from c;
  if v_count=1 then return jsonb_build_object('candidateCount',1,'autoLinkable',false,'reason','phone_unique_courier_mismatch','orderDbId',v_order,'orderNo',(select o.order_no from public.orders o where o.id=v_order),'confidence',75,'candidates',v_candidates);
  elsif v_count>1 then return jsonb_build_object('candidateCount',v_count,'autoLinkable',false,'reason','ambiguous_phone','confidence',45,'candidates',v_candidates); end if;
  return jsonb_build_object('candidateCount',0,'autoLinkable',false,'reason','no_match','confidence',0,'candidates','[]'::jsonb);
end;
$$;

create or replace function public.shipment_resolve_order_before_write()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare payload jsonb; extracted_reference text; extracted_tracking_link text;
begin
  payload:=coalesce(new.provider_payload->'last_webhook',new.provider_payload->'first_webhook',new.provider_payload->'checkout',new.provider_payload->'created','{}'::jsonb);
  extracted_reference:=coalesce(nullif(new.reference,''),nullif(payload->>'reference',''),nullif(payload#>>'{data,reference}',''));
  new.reference:=extracted_reference;
  if new.order_id is null then
    new.order_id:=public.icetak_resolve_shipment_order_auto(extracted_reference,new.recipient_phone,new.courier,new.service_provider,new.tracking_no,new.created_at);
  end if;
  extracted_tracking_link:=coalesce(nullif(new.tracking_link,''),nullif(payload#>>'{serviceProviderInfo,tracking_link}',''),nullif(payload#>>'{data,serviceProviderInfo,tracking_link}',''),public.icetak_tracking_link(new.tracking_no));
  new.tracking_link:=extracted_tracking_link;
  if new.normalized_status is null or new.normalized_status='' or new.normalized_status='unknown' then new.normalized_status:=public.normalize_shipping_status(new.status,new.status_group); end if;
  new.status_group:=coalesce(nullif(new.normalized_status,''),nullif(new.status_group,''),'unknown');
  if new.public_tracking_token is null then new.public_tracking_token:=gen_random_uuid(); end if;
  return new;
end;
$$;

create or replace function public.icetak_admin_link_shipment_order(p_shipment_id uuid,p_order_ref text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare s public.shipments%rowtype; o public.orders%rowtype; v_order_id uuid; v_actor text;
begin
  if not public.icetak_admin_can_manage_shipping_messages() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into s from public.shipments where id=p_shipment_id for update;
  if not found then raise exception 'SHIPMENT_NOT_FOUND'; end if;
  v_order_id:=public.resolve_shipping_order_reference(btrim(coalesce(p_order_ref,'')));
  if v_order_id is null then select id into v_order_id from public.orders where id::text=btrim(coalesce(p_order_ref,'')) limit 1; end if;
  if v_order_id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  select * into o from public.orders where id=v_order_id for update;
  if s.order_id is not null and s.order_id<>v_order_id then raise exception 'SHIPMENT_ALREADY_LINKED_TO_ANOTHER_ORDER'; end if;
  if nullif(btrim(coalesce(o.tracking,'')),'') is not null and o.tracking<>s.tracking_no then raise exception 'ORDER_ALREADY_HAS_DIFFERENT_TRACKING'; end if;
  update public.shipments
  set order_id=v_order_id,
      reference=coalesce(nullif(reference,''),o.order_no,o.order_id),
      tracking_link=coalesce(nullif(tracking_link,''),public.icetak_tracking_link(tracking_no)),
      updated_at=greatest(coalesce(updated_at,'epoch'::timestamptz),now())
  where id=p_shipment_id;
  update public.shipment_events set order_id=v_order_id where shipment_id=p_shipment_id and order_id is distinct from v_order_id;
  perform public.icetak_refresh_shipment_tracking_state(p_shipment_id);
  select username into v_actor from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1;
  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(v_order_id::text,coalesce(o.order_no,o.order_id),'link_shipment_order',v_actor,jsonb_build_object('shipmentId',p_shipment_id,'trackingNo',s.tracking_no,'previousOrderId',s.order_id));
  return jsonb_build_object('ok',true,'shipmentId',p_shipment_id,'orderDbId',v_order_id,'orderNo',coalesce(o.order_no,o.order_id),'trackingNo',s.tracking_no,'trackingLink',public.icetak_tracking_link(s.tracking_no));
end;
$$;

revoke all on function public.icetak_admin_link_shipment_order(uuid,text) from public,anon;
grant execute on function public.icetak_admin_link_shipment_order(uuid,text) to authenticated;
revoke all on function public.icetak_shipment_match_suggestion(uuid) from public,anon;
grant execute on function public.icetak_shipment_match_suggestion(uuid) to authenticated;

-- Existing unlinked shipments are backfilled only when the same conservative resolver finds exactly one safe order.
update public.shipments s
set order_id=public.icetak_resolve_shipment_order_auto(s.reference,s.recipient_phone,s.courier,s.service_provider,s.tracking_no,s.created_at),
    tracking_link=coalesce(nullif(s.tracking_link,''),public.icetak_tracking_link(s.tracking_no)),
    updated_at=greatest(coalesce(s.updated_at,'epoch'::timestamptz),now())
where s.order_id is null
  and public.icetak_resolve_shipment_order_auto(s.reference,s.recipient_phone,s.courier,s.service_provider,s.tracking_no,s.created_at) is not null;
