-- Receive order-level Shopee finance snapshots. No bank or QRPay flow changes.
create table finance.shopee_finance_events (
  id uuid primary key default gen_random_uuid(),
  payload_hash text not null unique check (payload_hash ~ '^[a-f0-9]{64}$'),
  order_sn text,
  shop_id text,
  marketplace_order_id uuid references public.marketplace_orders(id) on delete set null,
  normalized_data jsonb not null default '{}'::jsonb,
  mapping_errors jsonb not null default '[]'::jsonb,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received','pending_order','needs_mapping','applied','superseded','failed')),
  provider_updated_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  duplicate_count integer not null default 0,
  last_received_at timestamptz not null default now(),
  last_error text
);
alter table finance.shopee_finance_events enable row level security;
revoke all on finance.shopee_finance_events from public,anon,authenticated;
grant usage on schema finance to service_role;
grant all on finance.shopee_finance_events to service_role;
create index shopee_finance_events_pending_idx on finance.shopee_finance_events(order_sn,received_at)
  where status='pending_order';
create index shopee_finance_events_order_idx on finance.shopee_finance_events(marketplace_order_id,provider_updated_at desc)
  where marketplace_order_id is not null;

create function finance.apply_shopee_finance_event(p_event_id uuid)
returns text language plpgsql security invoker set search_path='' as $function$
declare
  e finance.shopee_finance_events%rowtype;
  o public.marketplace_orders%rowtype;
  f public.marketplace_order_financials%rowtype;
  d jsonb;
begin
  select * into e from finance.shopee_finance_events where id=p_event_id for update;
  if not found then raise exception 'finance event not found'; end if;
  if e.status in ('applied','superseded','needs_mapping') then return e.status; end if;
  if jsonb_array_length(e.mapping_errors)>0 or e.order_sn is null then
    update finance.shopee_finance_events set status='needs_mapping' where id=e.id;
    return 'needs_mapping';
  end if;
  select * into o from public.marketplace_orders where provider='shopee' and order_sn=e.order_sn;
  if not found then
    update finance.shopee_finance_events set status='pending_order' where id=e.id;
    return 'pending_order';
  end if;
  if e.shop_id is not null and o.shop_id is not null and e.shop_id<>o.shop_id then
    update finance.shopee_finance_events set status='needs_mapping',last_error='shop_id_mismatch' where id=e.id;
    return 'needs_mapping';
  end if;
  d:=e.normalized_data;
  if d ? 'currency' and o.currency is not null and d->>'currency'<>o.currency then
    update finance.shopee_finance_events set status='needs_mapping',last_error='currency_mismatch' where id=e.id;
    return 'needs_mapping';
  end if;
  if e.provider_updated_at is not null and exists (
    select 1 from finance.shopee_finance_events newer
    where newer.marketplace_order_id=o.id and newer.status='applied'
      and newer.provider_updated_at>e.provider_updated_at
  ) then
    update finance.shopee_finance_events set status='superseded',marketplace_order_id=o.id,processed_at=now() where id=e.id;
    return 'superseded';
  end if;
  insert into public.marketplace_order_financials (
    order_id,currency,product_subtotal,buyer_paid,shipping_fee,escrow_amount,released_amount,
    commission_fee,service_fee,transaction_fee,other_fees,settlement_status,released_at,
    last_enriched_at,provider_payload,updated_at
  ) values (
    o.id,coalesce(d->>'currency',o.currency),
    (d->>'product_subtotal')::numeric,(d->>'buyer_paid')::numeric,(d->>'shipping_fee')::numeric,
    (d->>'escrow_amount')::numeric,(d->>'released_amount')::numeric,
    (d->>'commission_fee')::numeric,(d->>'service_fee')::numeric,(d->>'transaction_fee')::numeric,
    (d->>'other_fees')::numeric,d->>'settlement_status',(d->>'released_at')::timestamptz,
    now(),jsonb_build_object('shopee_finance',e.payload,'finance_ingest_event_id',e.id),now()
  ) on conflict(order_id) do update set
    currency=coalesce(excluded.currency,marketplace_order_financials.currency),
    product_subtotal=coalesce(excluded.product_subtotal,marketplace_order_financials.product_subtotal),
    buyer_paid=coalesce(excluded.buyer_paid,marketplace_order_financials.buyer_paid),
    shipping_fee=coalesce(excluded.shipping_fee,marketplace_order_financials.shipping_fee),
    escrow_amount=coalesce(excluded.escrow_amount,marketplace_order_financials.escrow_amount),
    released_amount=coalesce(excluded.released_amount,marketplace_order_financials.released_amount),
    commission_fee=coalesce(excluded.commission_fee,marketplace_order_financials.commission_fee),
    service_fee=coalesce(excluded.service_fee,marketplace_order_financials.service_fee),
    transaction_fee=coalesce(excluded.transaction_fee,marketplace_order_financials.transaction_fee),
    other_fees=coalesce(excluded.other_fees,marketplace_order_financials.other_fees),
    settlement_status=case
      when excluded.settlement_status='pending_release' and marketplace_order_financials.settlement_status='released'
        then marketplace_order_financials.settlement_status
      else coalesce(excluded.settlement_status,marketplace_order_financials.settlement_status) end,
    released_at=coalesce(excluded.released_at,marketplace_order_financials.released_at),
    last_enriched_at=now(),provider_payload=coalesce(marketplace_order_financials.provider_payload,'{}'::jsonb)||excluded.provider_payload,
    updated_at=now()
  returning * into f;

  -- Update this order only; avoid running the global settlement sync per webhook.
  insert into finance.shopee_settlement_lines (
    marketplace_order_id,order_sn,completed_at,product_subtotal,buyer_paid,shipping_fee,
    escrow_amount,released_amount,commission_fee,service_fee,transaction_fee,other_fees,
    settlement_status,released_at,is_complete,metadata
  ) values (
    o.id,o.order_sn,case when lower(coalesce(o.current_status,'')) in ('completed','to receive','delivered') then o.latest_provider_update_at end,
    coalesce(f.product_subtotal,0),coalesce(f.buyer_paid,0),coalesce(f.shipping_fee,0),
    coalesce(f.escrow_amount,0),coalesce(f.released_amount,0),coalesce(f.commission_fee,0),
    coalesce(f.service_fee,0),coalesce(f.transaction_fee,0),coalesce(f.other_fees,0),
    f.settlement_status,f.released_at,f.released_amount is not null and f.settlement_status='released',
    jsonb_build_object('provider_payload',f.provider_payload,'payment_method',f.payment_method)
  ) on conflict(marketplace_order_id) do update set
    completed_at=coalesce(excluded.completed_at,shopee_settlement_lines.completed_at),
    product_subtotal=excluded.product_subtotal,buyer_paid=excluded.buyer_paid,shipping_fee=excluded.shipping_fee,
    escrow_amount=excluded.escrow_amount,released_amount=excluded.released_amount,
    commission_fee=excluded.commission_fee,service_fee=excluded.service_fee,transaction_fee=excluded.transaction_fee,
    other_fees=excluded.other_fees,settlement_status=excluded.settlement_status,released_at=excluded.released_at,
    is_complete=excluded.is_complete,metadata=excluded.metadata,updated_at=now();

  if f.released_amount is not null and f.settlement_status='released' then
    update public.marketplace_enrichment_jobs set status='completed',completed_at=now(),locked_at=null,
      last_error=null,response_payload=jsonb_build_object('source','shopee-finance-ingest','finance',d),updated_at=now()
    where order_id=o.id and job_type='financial_release';
    insert into finance.wallet_events(wallet_account_id,event_type,direction,amount,occurred_at,external_reference,marketplace_order_id,metadata)
    select a.id,'wallet_release','in',f.released_amount,coalesce(f.released_at,now()),'shopee-release:'||o.order_sn,o.id,
      jsonb_build_object('order_sn',o.order_sn,'settlement_status',f.settlement_status)
    from finance.accounts a where a.code='1030-SHOPEE-WALLET' and f.released_amount>0
    on conflict(wallet_account_id,event_type,external_reference) where external_reference is not null
      do update set amount=excluded.amount,occurred_at=excluded.occurred_at,metadata=excluded.metadata;
  end if;
  update finance.shopee_finance_events set status='applied',marketplace_order_id=o.id,processed_at=now(),last_error=null where id=e.id;
  return 'applied';
end;
$function$;
revoke all on function finance.apply_shopee_finance_event(uuid) from public,anon,authenticated;
grant execute on function finance.apply_shopee_finance_event(uuid) to service_role;

create function public.ingest_shopee_finance(p_events jsonb,p_dry_run boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare
  item jsonb;
  v_id uuid;
  v_status text;
  v_duplicate boolean;
  v_order_id uuid;
  v_results jsonb:='[]'::jsonb;
  v_applied integer:=0;
  v_pending integer:=0;
  v_mapping integer:=0;
  v_duplicates integer:=0;
begin
  if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events) not between 1 and 100 then
    raise exception 'send 1 to 100 finance events';
  end if;
  for item in select value from jsonb_array_elements(p_events) order by value->>'order_sn',value->>'payload_hash' loop
    v_id:=null;v_order_id:=null;v_duplicate:=false;
    if p_dry_run then
      select id into v_order_id from public.marketplace_orders
        where provider='shopee' and order_sn=item->>'order_sn';
      v_status:=case when jsonb_array_length(coalesce(item->'mapping_errors','[]'::jsonb))>0 then 'needs_mapping'
        when v_order_id is null then 'pending_order' else 'would_apply' end;
    else
      -- Serialize a given order with its delayed replay trigger, including the
      -- period where the order insert is not visible to this request yet.
      if item->>'order_sn' is not null then
        perform pg_advisory_xact_lock(hashtextextended('shopee-finance:'||(item->>'order_sn'),0));
      end if;
      insert into finance.shopee_finance_events(payload_hash,order_sn,shop_id,normalized_data,mapping_errors,payload,provider_updated_at)
      values (item->>'payload_hash',item->>'order_sn',item->>'shop_id',item->'normalized_data',
        coalesce(item->'mapping_errors','[]'::jsonb),item->'payload',(item#>>'{normalized_data,provider_updated_at}')::timestamptz)
      on conflict(payload_hash) do nothing returning id into v_id;
      if v_id is null then
        v_duplicate:=true;
        update finance.shopee_finance_events set duplicate_count=duplicate_count+1,last_received_at=now()
          where payload_hash=item->>'payload_hash' returning id into v_id;
      end if;
      v_status:=finance.apply_shopee_finance_event(v_id);
      select marketplace_order_id into v_order_id from finance.shopee_finance_events where id=v_id;
    end if;
    if v_status in ('applied','would_apply') then v_applied:=v_applied+1; end if;
    if v_status='pending_order' then v_pending:=v_pending+1; end if;
    if v_status='needs_mapping' then v_mapping:=v_mapping+1; end if;
    if v_duplicate then v_duplicates:=v_duplicates+1; end if;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('order_sn',item->>'order_sn','event_id',v_id,
      'order_id',v_order_id,'status',v_status,'duplicate',v_duplicate,'mapping_errors',item->'mapping_errors')
      ||case when p_dry_run then jsonb_build_object('normalized_data',item->'normalized_data') else '{}'::jsonb end);
  end loop;
  return jsonb_build_object('ok',true,'captured',not p_dry_run,'dry_run',p_dry_run,'received',jsonb_array_length(p_events),
    'applied',v_applied,'pending_order',v_pending,'needs_mapping',v_mapping,'duplicates',v_duplicates,'results',v_results);
end;
$function$;
revoke all on function public.ingest_shopee_finance(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.ingest_shopee_finance(jsonb,boolean) to service_role;

-- Replay finance that arrived before its marketplace order. The private trigger
-- needs narrowly scoped elevated privileges to access the private receipt table.
create function finance.replay_shopee_finance_on_order_insert()
returns trigger language plpgsql security definer set search_path='' as $function$
declare e record;
begin
  if new.provider<>'shopee' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('shopee-finance:'||new.order_sn,0));
  for e in select id from finance.shopee_finance_events
    where order_sn=new.order_sn and status='pending_order' order by received_at,id
  loop
    begin
      perform finance.apply_shopee_finance_event(e.id);
    exception when others then
      update finance.shopee_finance_events set status='failed',last_error=left(sqlerrm,500) where id=e.id;
    end;
  end loop;
  return new;
end;
$function$;
revoke all on function finance.replay_shopee_finance_on_order_insert() from public,anon,authenticated;
create constraint trigger shopee_finance_replay_after_order_insert after insert on public.marketplace_orders
  deferrable initially deferred
  for each row execute function finance.replay_shopee_finance_on_order_insert();
