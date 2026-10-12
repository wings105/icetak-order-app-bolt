-- New paid orders and bounded return detail receive priority over historical enrichment.
CREATE OR REPLACE FUNCTION public.process_marketplace_webhook_event(p_event_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event public.marketplace_webhook_events%rowtype;
  v_payload jsonb;
  v_data jsonb;
  v_item jsonb;
  v_update jsonb;
  v_order_id uuid;
  v_order_sn text;
  v_package_number text;
  v_return_sn text;
  v_region text;
  v_status text;
  v_previous_status text;
  v_effective_status text;
  v_event_time timestamptz;
  v_line_no integer;
  v_sequence integer;
  v_quantity integer;
  v_subtotal numeric;
  v_product_subtotal numeric;
begin
  select * into v_event
  from public.marketplace_webhook_events
  where id = p_event_id
  for update;

  if not found then raise exception 'marketplace webhook event % not found', p_event_id; end if;
  if v_event.parse_error is not null or v_event.parsed_payload is null then
    update public.marketplace_webhook_events
       set processing_status='failed', last_error=coalesce(v_event.parse_error,'missing parsed payload')
     where id=p_event_id;
    return 'failed';
  end if;

  if v_event.event_code = 10 then return 'chat_routed'; end if;
  if v_event.event_code in (5,9,16,22,28) then return marketplace_ops.process_aux_event(p_event_id); end if;

  v_payload := v_event.parsed_payload;
  v_data := case when jsonb_typeof(v_payload->'data')='object' then v_payload->'data' else v_payload end;
  v_order_sn := coalesce(v_event.order_sn, nullif(v_data->>'order_sn',''), nullif(v_data->>'ordersn',''), nullif(v_payload->>'orderno',''));

  if v_order_sn is null then return 'captured'; end if;

  v_region := upper(coalesce(v_event.region, nullif(v_payload->>'region',''),
    (select region from marketplace_ops.shops where shop_id=v_event.shop_id),
    (select region from public.marketplace_orders where provider=v_event.provider and order_sn=v_order_sn),'MY'));
  v_event_time := coalesce(v_event.occurred_at, v_event.received_at);
  v_status := nullif(v_data->>'status','');

  select o.current_status into v_previous_status
  from public.marketplace_orders o
  where o.provider=v_event.provider and o.order_sn=v_order_sn;

  insert into public.marketplace_orders (
    provider, order_sn, shop_id, region, currency,
    current_status, first_seen_at, last_seen_at,
    latest_provider_update_at, created_at, updated_at
  ) values (
    v_event.provider, v_order_sn, v_event.shop_id, v_region,
    case when v_region='SG' then 'SGD' else 'MYR' end,
    coalesce(v_status,'UNKNOWN'), v_event.received_at, v_event.last_received_at,
    v_event_time, now(), now()
  )
  on conflict (provider,order_sn) do update set
    shop_id=coalesce(excluded.shop_id,public.marketplace_orders.shop_id),
    region=coalesce(excluded.region,public.marketplace_orders.region),
    currency=case when excluded.shop_id in (select shop_id from marketplace_ops.shops) then excluded.currency else coalesce(public.marketplace_orders.currency,excluded.currency) end,
    first_seen_at=least(public.marketplace_orders.first_seen_at,excluded.first_seen_at),
    last_seen_at=greatest(public.marketplace_orders.last_seen_at,excluded.last_seen_at),
    latest_provider_update_at=greatest(coalesce(public.marketplace_orders.latest_provider_update_at,'-infinity'::timestamptz),excluded.latest_provider_update_at),
    updated_at=now()
  returning id into v_order_id;

  if v_event.event_code is null and nullif(v_payload->>'orderno','') is not null then
    update public.marketplace_orders
       set buyer_username=nullif(v_payload->>'buyer',''),
           payment_status='paid',
           courier_name=nullif(v_payload->>'courier',''),
           delivery_address=nullif(v_payload->>'address',''),
           buyer_message=nullif(v_payload->>'message',''),
           placed_at=coalesce(public.marketplace_parse_local_time(v_payload->>'place_order',v_region),placed_at),
           ship_by_at=case when coalesce(public.marketplace_parse_local_time(v_payload->>'latest_update',v_region),v_event_time)>=coalesce((metadata->>'ship_by_event_time')::timestamptz,'-infinity'::timestamptz) then coalesce(public.marketplace_parse_local_time(v_payload->>'Ship Before',v_region),ship_by_at) else ship_by_at end,
           latest_provider_update_at=coalesce(public.marketplace_parse_local_time(v_payload->>'latest_update',v_region),latest_provider_update_at),
           detail_complete=true,
           detail_received_at=v_event.received_at,
           detail_source_event_id=v_event.id,
           raw_detail=v_payload,
           updated_at=now()
     where id=v_order_id;

    if jsonb_typeof(v_payload->'product')='array' then
      update public.marketplace_order_items set is_current=false,updated_at=now() where order_id=v_order_id;
      v_line_no := 0;
      v_product_subtotal := 0;
      for v_item in select value from jsonb_array_elements(v_payload->'product') loop
        v_line_no := v_line_no + 1;
        v_quantity := greatest(coalesce((v_item->>'quantity')::integer,1),1);
        v_subtotal := coalesce(public.marketplace_safe_numeric(v_item->>'discounted_price'),0) * v_quantity;
        v_product_subtotal := v_product_subtotal + v_subtotal;
        insert into public.marketplace_order_items (
          order_id,line_no,provider_item_id,provider_variation_id,item_sku,variation_sku,
          title,variation_name,quantity,unit_original_price,unit_discounted_price,
          line_subtotal,image_url,is_current,source_event_id,raw_item
        ) values (
          v_order_id,v_line_no,nullif(v_item->>'prodId',''),nullif(v_item->>'variationsku',''),
          nullif(v_item->>'prodsku',''),nullif(v_item->>'variationsku',''),
          nullif(v_item->>'prodtitle',''),nullif(v_item->>'variationname',''),v_quantity,
          public.marketplace_safe_numeric(v_item->>'original_price'),
          public.marketplace_safe_numeric(v_item->>'discounted_price'),v_subtotal,
          nullif(v_item->>'image_url',''),true,v_event.id,v_item
        )
        on conflict (order_id,line_no) do update set
          provider_item_id=excluded.provider_item_id,
          provider_variation_id=excluded.provider_variation_id,
          item_sku=excluded.item_sku,
          variation_sku=excluded.variation_sku,
          title=excluded.title,
          variation_name=excluded.variation_name,
          quantity=excluded.quantity,
          unit_original_price=excluded.unit_original_price,
          unit_discounted_price=excluded.unit_discounted_price,
          line_subtotal=excluded.line_subtotal,
          image_url=excluded.image_url,
          is_current=true,
          source_event_id=excluded.source_event_id,
          raw_item=excluded.raw_item,
          updated_at=now();
      end loop;

      insert into public.marketplace_order_financials (
        order_id,currency,product_subtotal,buyer_paid,shipping_fee,payment_method,
        settlement_status,detail_source_event_id,provider_payload,updated_at
      ) values (
        v_order_id,case when v_region='SG' then 'SGD' else 'MYR' end,
        v_product_subtotal,public.marketplace_safe_numeric(v_payload->>'buyer_paid'),
        public.marketplace_safe_numeric(v_payload->>'shipping_fee'),
        nullif(v_payload->>'payment_method',''),'pending_release',v_event.id,v_payload,now()
      )
      on conflict (order_id) do update set
        currency=excluded.currency,
        product_subtotal=excluded.product_subtotal,
        buyer_paid=excluded.buyer_paid,
        shipping_fee=excluded.shipping_fee,
        payment_method=excluded.payment_method,
        detail_source_event_id=excluded.detail_source_event_id,
        provider_payload=public.marketplace_order_financials.provider_payload || excluded.provider_payload,
        updated_at=now();
    end if;

    update public.marketplace_shipments
       set courier_name=coalesce(courier_name,nullif(v_payload->>'courier','')),updated_at=now()
     where order_id=v_order_id;

    insert into public.marketplace_order_status_history (
      order_id,source_event_id,sequence_no,event_code,event_kind,status,occurred_at,payload
    ) values (v_order_id,v_event.id,0,null,'order_detail','DETAIL_RECEIVED',v_event_time,v_payload)
    on conflict (source_event_id,sequence_no) do nothing;

  elsif v_event.event_code = 3 then
    update public.marketplace_orders
       set current_status=coalesce(v_status,current_status),
           payment_status=case
             when v_status='UNPAID' then 'unpaid'
             when v_status in ('READY_TO_SHIP','PROCESSED','SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED') then 'paid'
             else payment_status end,
           completed_scenario=nullif(v_data->>'completed_scenario',''),
           updated_at=now()
     where id=v_order_id;

    insert into public.marketplace_order_status_history (
      order_id,source_event_id,sequence_no,event_code,event_kind,status,previous_status,occurred_at,payload
    ) values (v_order_id,v_event.id,0,3,'order_status',v_status,v_previous_status,v_event_time,v_data)
    on conflict (source_event_id,sequence_no) do nothing;

    -- Reconcile by Shopee event time so late/out-of-order webhooks cannot regress status.
    v_effective_status := public.reconcile_marketplace_order_status(v_order_id);

    if v_effective_status='COMPLETED' then
      insert into public.marketplace_order_financials(order_id,currency,settlement_status,updated_at)
      values (v_order_id,case when v_region='SG' then 'SGD' else 'MYR' end,'awaiting_enrichment',now())
      on conflict (order_id) do update set
        settlement_status=case when public.marketplace_order_financials.released_at is null then 'awaiting_enrichment' else public.marketplace_order_financials.settlement_status end,
        updated_at=now();

      insert into public.marketplace_enrichment_jobs(order_id,job_type,status,available_at,request_payload,updated_at)
      values (v_order_id,'financial_release','pending',now(),jsonb_build_object('source_event_id',v_event.id),now())
      on conflict (order_id,job_type) do update set
        status=case when public.marketplace_enrichment_jobs.status='completed' then 'completed' else 'pending' end,
        available_at=case when public.marketplace_enrichment_jobs.status='completed' then public.marketplace_enrichment_jobs.available_at else now() end,
        last_error=case when public.marketplace_enrichment_jobs.status='completed' then public.marketplace_enrichment_jobs.last_error else null end,
        request_payload=public.marketplace_enrichment_jobs.request_payload || excluded.request_payload,
        updated_at=now();
    end if;

  elsif v_event.event_code in (4,15,30,47) then
    v_package_number := coalesce(v_event.package_number,nullif(v_data->>'package_number',''));
    if v_package_number is not null then
      insert into public.marketplace_shipments (
        order_id,provider,package_number,provider_forder_id,tracking_number,courier_name,
        shipment_status,fulfillment_status,logistics_channel_id,ship_by_at,return_code,
        last_event_at,raw_snapshot,updated_at
      ) values (
        v_order_id,v_event.provider,v_package_number,nullif(v_data->>'forder_id',''),
        nullif(v_data->>'tracking_no',''),
        (select courier_name from public.marketplace_orders where id=v_order_id),
        case when v_event.event_code=15 then nullif(v_data->>'status','') end,
        case when v_event.event_code=30 then nullif(v_data->>'fulfillment_status','') end,
        case when v_event.event_code=47 then nullif(v_data#>>'{new,logistics_channel_id}','') end,
        case when v_event.event_code=47 and coalesce(v_data#>>'{new,ship_by_date}','') ~ '^[0-9]+$' and (v_data#>>'{new,ship_by_date}')::bigint>0
             then to_timestamp((v_data#>>'{new,ship_by_date}')::double precision) end,
        case when v_event.event_code=47 then nullif(v_data#>>'{new,return_code}','') end,
        v_event_time,v_data,now()
      )
      on conflict (provider,package_number) do update set
        order_id=excluded.order_id,
        provider_forder_id=coalesce(excluded.provider_forder_id,public.marketplace_shipments.provider_forder_id),
        tracking_number=coalesce(excluded.tracking_number,public.marketplace_shipments.tracking_number),
        courier_name=coalesce(excluded.courier_name,public.marketplace_shipments.courier_name),
        shipment_status=coalesce(excluded.shipment_status,public.marketplace_shipments.shipment_status),
        fulfillment_status=coalesce(excluded.fulfillment_status,public.marketplace_shipments.fulfillment_status),
        logistics_channel_id=coalesce(excluded.logistics_channel_id,public.marketplace_shipments.logistics_channel_id),
        ship_by_at=coalesce(excluded.ship_by_at,public.marketplace_shipments.ship_by_at),
        return_code=coalesce(excluded.return_code,public.marketplace_shipments.return_code),
        last_event_at=greatest(coalesce(public.marketplace_shipments.last_event_at,'-infinity'::timestamptz),excluded.last_event_at),
        raw_snapshot=public.marketplace_shipments.raw_snapshot || excluded.raw_snapshot,
        updated_at=now();
    end if;

    if v_event.event_code=47 and coalesce(v_data#>>'{new,ship_by_date}','') ~ '^[0-9]+$'
       and (v_data#>>'{new,ship_by_date}')::bigint>0 then
      update public.marketplace_orders set ship_by_at=to_timestamp((v_data#>>'{new,ship_by_date}')::double precision),
       metadata=metadata||jsonb_build_object('ship_by_event_time',v_event_time,'ship_by_source','code47'),updated_at=now()
      where id=v_order_id and v_event_time>=coalesce((metadata->>'ship_by_event_time')::timestamptz,'-infinity'::timestamptz);
    end if;
    if v_event.event_code=30 then
      update public.marketplace_orders set fulfillment_status=nullif(v_data->>'fulfillment_status',''),updated_at=now() where id=v_order_id;
      v_status := nullif(v_data->>'fulfillment_status','');
    elsif v_event.event_code=4 then v_status := nullif(v_data->>'tracking_no','');
    elsif v_event.event_code=47 then v_status := array_to_string(array(select jsonb_array_elements_text(coalesce(v_data->'changed_fields','[]'::jsonb))),',');
    end if;

    insert into public.marketplace_order_status_history (
      order_id,source_event_id,sequence_no,event_code,event_kind,status,occurred_at,payload
    ) values (
      v_order_id,v_event.id,0,v_event.event_code,
      case v_event.event_code when 4 then 'tracking_assigned' when 15 then 'shipment_status' when 30 then 'fulfillment_status' else 'order_change' end,
      v_status,v_event_time,v_data
    ) on conflict (source_event_id,sequence_no) do nothing;

  elsif v_event.event_code = 29 then
    v_return_sn := nullif(v_data->>'return_sn','');
    if v_return_sn is not null then
      insert into public.marketplace_returns(order_id,provider,return_sn,last_event_at,raw_snapshot,updated_at)
      values (v_order_id,v_event.provider,v_return_sn,v_event_time,v_data,now())
      on conflict (provider,return_sn) do update set
        order_id=excluded.order_id,last_event_at=greatest(public.marketplace_returns.last_event_at,excluded.last_event_at),
        raw_snapshot=public.marketplace_returns.raw_snapshot || excluded.raw_snapshot,updated_at=now();

      v_sequence := 0;
      if jsonb_typeof(v_data->'updated_values')='array' then
        for v_update in select value from jsonb_array_elements(v_data->'updated_values') loop
          v_sequence := v_sequence + 1;
          update public.marketplace_returns set
            return_status=case when v_update->>'update_field'='return_status' then v_update->>'new_value' else return_status end,
            logistics_status=case when v_update->>'update_field'='logistics_status' then v_update->>'new_value' else logistics_status end,
            reverse_logistics_status=case when v_update->>'update_field'='reverse_logistics_status' then v_update->>'new_value' else reverse_logistics_status end,
            return_solution=case when v_update->>'update_field'='return_solution' then v_update->>'new_value' else return_solution end,
            updated_at=now()
          where provider=v_event.provider and return_sn=v_return_sn
            and not exists(select 1 from public.marketplace_order_status_history h where h.order_id=v_order_id and h.event_code=29 and h.event_kind=v_update->>'update_field' and h.payload->>'return_sn'=v_return_sn and h.occurred_at>coalesce(case when coalesce(v_update->>'update_time','') ~ '^[0-9]+$' then to_timestamp((v_update->>'update_time')::double precision) end,v_event_time));

          insert into public.marketplace_order_status_history(
            order_id,source_event_id,sequence_no,event_code,event_kind,status,previous_status,occurred_at,payload
          ) values (
            v_order_id,v_event.id,v_sequence,29,coalesce(v_update->>'update_field','return_update'),
            v_update->>'new_value',v_update->>'old_value',
            case when coalesce(v_update->>'update_time','') ~ '^[0-9]+$' then to_timestamp((v_update->>'update_time')::double precision) else v_event_time end,
            v_update||jsonb_build_object('return_sn',v_return_sn)
          ) on conflict (source_event_id,sequence_no) do nothing;
        end loop;
      end if;
    end if;
  else
    return 'captured';
  end if;

  if exists(select 1 from public.marketplace_orders o left join public.marketplace_order_financials f on f.order_id=o.id where o.id=v_order_id and o.payment_status='paid' and o.shop_id is not null and (f.escrow_amount is null or f.commission_fee is null or f.service_fee is null or f.transaction_fee is null)) then
    insert into public.marketplace_enrichment_jobs(order_id,job_type,status,available_at,request_payload) values(v_order_id,'financial_detail','pending',now(),jsonb_build_object('source_event_id',v_event.id))
    on conflict(order_id,job_type) do update set status=case when marketplace_enrichment_jobs.status='processing' then 'processing' else 'pending' end,available_at=least(marketplace_enrichment_jobs.available_at,now()),updated_at=now() where marketplace_enrichment_jobs.status<>'completed';
  elsif v_event.event_code=29 and v_event_time>=coalesce((select last_enriched_at from public.marketplace_order_financials where order_id=v_order_id),'-infinity'::timestamptz) then
    insert into public.marketplace_enrichment_jobs(order_id,job_type,status,available_at,request_payload) values(v_order_id,'financial_detail','pending',now()+interval '10 minutes',jsonb_build_object('source_event_id',v_event.id,'reason','return_update'))
    on conflict(order_id,job_type) do update set status=case when marketplace_enrichment_jobs.status='processing' then 'processing' else 'pending' end,attempts=case when marketplace_enrichment_jobs.status='completed' then 0 else marketplace_enrichment_jobs.attempts end,available_at=now()+interval '10 minutes',updated_at=now();
  end if;

  update public.marketplace_webhook_events
     set processing_status='processed',processed_at=now(),last_error=null
   where id=p_event_id;
  return 'processed';
exception when others then
  update public.marketplace_webhook_events
     set processing_status='failed',processed_at=null,last_error=left(sqlerrm,1000)
   where id=p_event_id;
  return 'failed';
end;
$function$;
CREATE OR REPLACE FUNCTION public.claim_marketplace_enrichment_jobs(p_limit integer DEFAULT 10)
 RETURNS TABLE(job_id uuid, order_id uuid, order_sn text, shop_id text, region text, currency text, job_type text, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  with candidates as (
    select j.id
    from public.marketplace_enrichment_jobs j join public.marketplace_orders o on o.id=j.order_id
    where j.status in ('pending','failed')
      and j.available_at <= now()
      and j.attempts < 10
    order by case when o.current_status in('READY_TO_SHIP','PROCESSED') then 0 else 1 end,j.available_at,j.created_at
    for update of j skip locked
    limit greatest(1,least(coalesce(p_limit,10),50))
  ), claimed as (
    update public.marketplace_enrichment_jobs j
       set status='processing',attempts=j.attempts+1,locked_at=now(),
           last_error=null,updated_at=now()
    from candidates c
    where j.id=c.id
    returning j.*
  )
  select c.id,c.order_id,o.order_sn,o.shop_id,o.region,o.currency,c.job_type,c.attempts
  from claimed c
  join public.marketplace_orders o on o.id=c.order_id;
end;
$function$;

create or replace function public.marketplace_returns_pending(p_limit integer default 3)
returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from (select r.return_sn,o.shop_id,o.order_sn from public.marketplace_returns r join public.marketplace_orders o on o.id=r.order_id where not r.raw_snapshot?'detail' and coalesce((r.raw_snapshot->>'detail_next_at')::timestamptz,'-infinity'::timestamptz)<=now() and coalesce((r.raw_snapshot->>'detail_attempts')::integer,0)<8 order by r.last_event_at desc nulls last limit greatest(1,least(p_limit,10))) x;
$$;
create or replace function public.marketplace_return_read_failed(p_return_sn text,p_error text)
returns void language sql security invoker set search_path='' as $$
 update public.marketplace_returns set raw_snapshot=raw_snapshot||jsonb_build_object('detail_error',left(p_error,200),'detail_next_at',now()+interval '6 hours','detail_attempts',coalesce((raw_snapshot->>'detail_attempts')::integer,0)+1) where provider='shopee' and return_sn=p_return_sn;
$$;
revoke all on function public.marketplace_returns_pending(integer),public.marketplace_return_read_failed(text,text) from public,anon,authenticated;
grant execute on function public.marketplace_returns_pending(integer),public.marketplace_return_read_failed(text,text) to service_role;
-- Fill the new return_solution column only from retained, chronological source events.
do $$declare e record;begin for e in select id from public.marketplace_webhook_events where provider='shopee' and event_code=29 and processing_status='processed' order by coalesce(occurred_at,received_at) loop perform public.process_marketplace_webhook_event(e.id);end loop;end $$;
