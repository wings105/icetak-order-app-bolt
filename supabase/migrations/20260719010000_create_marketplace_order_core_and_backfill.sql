-- Production-normalized marketplace order model. The raw webhook ledger remains immutable.
create table if not exists public.marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'shopee',
  order_sn text not null,
  shop_id text,
  region text,
  currency text,
  internal_order_id uuid references public.orders(id) on delete set null,
  buyer_username text,
  current_status text not null default 'UNKNOWN',
  payment_status text not null default 'unknown',
  fulfillment_status text,
  completed_scenario text,
  courier_name text,
  delivery_address text,
  buyer_message text,
  placed_at timestamptz,
  ship_by_at timestamptz,
  latest_provider_update_at timestamptz,
  detail_complete boolean not null default false,
  detail_received_at timestamptz,
  detail_source_event_id uuid references public.marketplace_webhook_events(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw_detail jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, order_sn)
);

create table if not exists public.marketplace_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.marketplace_orders(id) on delete cascade,
  line_no integer not null,
  provider_item_id text,
  provider_variation_id text,
  item_sku text,
  variation_sku text,
  title text,
  variation_name text,
  quantity integer not null default 1 check (quantity > 0),
  unit_original_price numeric(14,2),
  unit_discounted_price numeric(14,2),
  line_subtotal numeric(14,2),
  image_url text,
  is_current boolean not null default true,
  source_event_id uuid references public.marketplace_webhook_events(id) on delete set null,
  raw_item jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, line_no)
);

create table if not exists public.marketplace_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.marketplace_orders(id) on delete cascade,
  provider text not null default 'shopee',
  package_number text not null,
  provider_forder_id text,
  tracking_number text,
  courier_name text,
  shipment_status text,
  fulfillment_status text,
  logistics_channel_id text,
  ship_by_at timestamptz,
  return_code text,
  last_event_at timestamptz,
  raw_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, package_number)
);

create table if not exists public.marketplace_order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.marketplace_orders(id) on delete cascade,
  source_event_id uuid not null references public.marketplace_webhook_events(id) on delete cascade,
  sequence_no integer not null default 0,
  event_code integer,
  event_kind text not null,
  status text,
  previous_status text,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_event_id, sequence_no)
);

create table if not exists public.marketplace_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.marketplace_orders(id) on delete cascade,
  provider text not null default 'shopee',
  return_sn text not null,
  return_status text,
  logistics_status text,
  reverse_logistics_status text,
  last_event_at timestamptz,
  raw_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, return_sn)
);

create table if not exists public.marketplace_order_financials (
  order_id uuid primary key references public.marketplace_orders(id) on delete cascade,
  currency text,
  product_subtotal numeric(14,2),
  buyer_paid numeric(14,2),
  shipping_fee numeric(14,2),
  payment_method text,
  escrow_amount numeric(14,2),
  released_amount numeric(14,2),
  commission_fee numeric(14,2),
  service_fee numeric(14,2),
  transaction_fee numeric(14,2),
  other_fees numeric(14,2),
  settlement_status text not null default 'pending_release',
  released_at timestamptz,
  last_enriched_at timestamptz,
  detail_source_event_id uuid references public.marketplace_webhook_events(id) on delete set null,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketplace_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.marketplace_orders(id) on delete cascade,
  job_type text not null,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, job_type)
);

create index if not exists idx_marketplace_orders_status
  on public.marketplace_orders (current_status, latest_provider_update_at desc);
create index if not exists idx_marketplace_orders_internal
  on public.marketplace_orders (internal_order_id) where internal_order_id is not null;
create index if not exists idx_marketplace_items_provider_item
  on public.marketplace_order_items (provider_item_id) where provider_item_id is not null;
create index if not exists idx_marketplace_shipments_order
  on public.marketplace_shipments (order_id, last_event_at desc);
create index if not exists idx_marketplace_shipments_tracking
  on public.marketplace_shipments (tracking_number) where tracking_number is not null;
create index if not exists idx_marketplace_history_order_time
  on public.marketplace_order_status_history (order_id, occurred_at desc);
create index if not exists idx_marketplace_jobs_pending
  on public.marketplace_enrichment_jobs (available_at, created_at)
  where status in ('pending','failed');

alter table public.marketplace_orders enable row level security;
alter table public.marketplace_order_items enable row level security;
alter table public.marketplace_shipments enable row level security;
alter table public.marketplace_order_status_history enable row level security;
alter table public.marketplace_returns enable row level security;
alter table public.marketplace_order_financials enable row level security;
alter table public.marketplace_enrichment_jobs enable row level security;

do $policies$
declare
  v_table text;
begin
  foreach v_table in array array[
    'marketplace_orders','marketplace_order_items','marketplace_shipments',
    'marketplace_order_status_history','marketplace_returns',
    'marketplace_order_financials','marketplace_enrichment_jobs'
  ] loop
    execute format(
      'drop policy if exists %I on public.%I',
      'authenticated_read_' || v_table,
      v_table
    );
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      'authenticated_read_' || v_table,
      v_table
    );
  end loop;
end;
$policies$;

create or replace function public.marketplace_safe_numeric(p_value text)
returns numeric
language plpgsql
immutable
set search_path = public
as $function$
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  return p_value::numeric;
exception when others then
  return null;
end;
$function$;

create or replace function public.marketplace_parse_local_time(p_value text, p_region text default 'MY')
returns timestamptz
language plpgsql
stable
set search_path = public
as $function$
declare
  v_zone text := case upper(coalesce(p_region,'MY')) when 'SG' then 'Asia/Singapore' else 'Asia/Kuala_Lumpur' end;
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  return to_timestamp(p_value, 'DD-Mon-YY HH24:MI')::timestamp at time zone v_zone;
exception when others then
  begin
    return p_value::timestamptz;
  exception when others then
    return null;
  end;
end;
$function$;

create or replace function public.process_marketplace_webhook_event(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $function$
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
  if v_event.event_code = 5 then
    update public.marketplace_webhook_events
       set processing_status='ignored', processed_at=now(), last_error=null
     where id=p_event_id;
    return 'ignored';
  end if;

  v_payload := v_event.parsed_payload;
  v_data := case when jsonb_typeof(v_payload->'data')='object' then v_payload->'data' else v_payload end;
  v_order_sn := coalesce(v_event.order_sn, nullif(v_data->>'order_sn',''), nullif(v_data->>'ordersn',''), nullif(v_payload->>'orderno',''));

  if v_order_sn is null then return 'captured'; end if;

  v_region := upper(coalesce(v_event.region, nullif(v_payload->>'region',''), 'MY'));
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
    currency=coalesce(public.marketplace_orders.currency,excluded.currency),
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
           ship_by_at=coalesce(public.marketplace_parse_local_time(v_payload->>'Ship Before',v_region),ship_by_at),
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

    if v_status='COMPLETED' then
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
        order_id=excluded.order_id,last_event_at=excluded.last_event_at,
        raw_snapshot=public.marketplace_returns.raw_snapshot || excluded.raw_snapshot,updated_at=now();

      v_sequence := 0;
      if jsonb_typeof(v_data->'updated_values')='array' then
        for v_update in select value from jsonb_array_elements(v_data->'updated_values') loop
          v_sequence := v_sequence + 1;
          update public.marketplace_returns set
            return_status=case when v_update->>'update_field'='return_status' then v_update->>'new_value' else return_status end,
            logistics_status=case when v_update->>'update_field'='logistics_status' then v_update->>'new_value' else logistics_status end,
            reverse_logistics_status=case when v_update->>'update_field'='reverse_logistics_status' then v_update->>'new_value' else reverse_logistics_status end,
            updated_at=now()
          where provider=v_event.provider and return_sn=v_return_sn;

          insert into public.marketplace_order_status_history(
            order_id,source_event_id,sequence_no,event_code,event_kind,status,previous_status,occurred_at,payload
          ) values (
            v_order_id,v_event.id,v_sequence,29,coalesce(v_update->>'update_field','return_update'),
            v_update->>'new_value',v_update->>'old_value',
            case when coalesce(v_update->>'update_time','') ~ '^[0-9]+$' then to_timestamp((v_update->>'update_time')::double precision) else v_event_time end,
            v_update
          ) on conflict (source_event_id,sequence_no) do nothing;
        end loop;
      end if;
    end if;
  else
    return 'captured';
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

create or replace function public.normalize_marketplace_webhook_event_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.parse_error is null and (
    new.event_code in (3,4,5,15,29,30,47) or
    (new.event_code is null and nullif(new.parsed_payload->>'orderno','') is not null)
  ) then
    perform public.process_marketplace_webhook_event(new.id);
  end if;
  return new;
end;
$function$;

drop trigger if exists normalize_marketplace_webhook_event_after_insert on public.marketplace_webhook_events;
create trigger normalize_marketplace_webhook_event_after_insert
after insert on public.marketplace_webhook_events
for each row execute function public.normalize_marketplace_webhook_event_trigger();

revoke all on function public.marketplace_safe_numeric(text) from public,anon,authenticated;
revoke all on function public.marketplace_parse_local_time(text,text) from public,anon,authenticated;
revoke all on function public.process_marketplace_webhook_event(uuid) from public,anon,authenticated;
revoke all on function public.normalize_marketplace_webhook_event_trigger() from public,anon,authenticated;
grant execute on function public.process_marketplace_webhook_event(uuid) to service_role;

-- Backfill all known operational event types in original arrival order.
do $backfill$
declare
  v_id uuid;
begin
  for v_id in
    select id from public.marketplace_webhook_events
    where parse_error is null
      and (
        event_code in (3,4,5,15,29,30,47) or
        (event_code is null and nullif(parsed_payload->>'orderno','') is not null)
      )
    order by received_at,id
  loop
    perform public.process_marketplace_webhook_event(v_id);
  end loop;
end;
$backfill$;
