create table if not exists public.pickup_ai_requests (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique,
  conversation_id text,
  phone text,
  status text not null default 'received',
  request_payload jsonb not null default '{}'::jsonb,
  extraction jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  order_id uuid references public.orders(id) on delete set null,
  order_no text,
  outbox_id uuid references public.integration_outbox(id) on delete set null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint pickup_ai_requests_status_check check (
    status in ('received','extracting','matched','order_created','completed','failed','dry_run')
  )
);

create index if not exists pickup_ai_requests_conversation_idx
  on public.pickup_ai_requests(conversation_id, created_at desc);
create index if not exists pickup_ai_requests_phone_idx
  on public.pickup_ai_requests(phone, created_at desc);
create index if not exists pickup_ai_requests_order_idx
  on public.pickup_ai_requests(order_id) where order_id is not null;
create index if not exists pickup_ai_requests_outbox_idx
  on public.pickup_ai_requests(outbox_id) where outbox_id is not null;

alter table public.pickup_ai_requests enable row level security;
revoke all on public.pickup_ai_requests from anon, authenticated;
grant all on public.pickup_ai_requests to service_role;

create or replace function public.icetak_auto_create_pickup_ai_order(
  p_request_key text,
  p_payload jsonb,
  p_internal_token text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_expected_token text;
  v_request public.pickup_ai_requests;
  v_existing_order uuid;
  v_create_payload jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_outbox_id uuid;
  v_date_need date;
  v_items jsonb := coalesce(p_payload->'items','[]'::jsonb);
  v_items_total numeric := 0;
  v_total numeric := 0;
  v_request_key text := nullif(trim(coalesce(p_request_key,'')),'');
begin
  select setting_value into v_expected_token
  from public.private_runtime_settings
  where setting_key='qrpay_ai_worker_token';

  if v_expected_token is null or p_internal_token is distinct from v_expected_token then
    raise exception 'Unauthorized pickup AI worker';
  end if;
  if v_request_key is null or length(v_request_key) > 180 then
    raise exception 'Valid pickup AI request_key required';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items)=0 then
    raise exception 'AI extracted no order items';
  end if;

  insert into public.pickup_ai_requests(
    request_key,conversation_id,phone,status,request_payload,extraction,evidence,updated_at
  ) values (
    v_request_key,
    nullif(p_payload->>'conversation_id',''),
    nullif(p_payload#>>'{customer,phone}',''),
    'extracting',
    coalesce(p_payload,'{}'::jsonb),
    coalesce(p_payload,'{}'::jsonb),
    coalesce(p_payload->'evidence','{}'::jsonb),
    now()
  )
  on conflict(request_key) do update set
    conversation_id=coalesce(excluded.conversation_id,public.pickup_ai_requests.conversation_id),
    phone=coalesce(excluded.phone,public.pickup_ai_requests.phone),
    request_payload=excluded.request_payload,
    extraction=excluded.extraction,
    evidence=excluded.evidence,
    updated_at=now()
  returning * into v_request;

  select * into v_request
  from public.pickup_ai_requests
  where request_key=v_request_key
  for update;

  if v_request.order_id is not null then
    return jsonb_build_object(
      'success',true,
      'duplicate',true,
      'reason','request_already_created',
      'request_id',v_request.id,
      'request_key',v_request.request_key,
      'order_db_id',v_request.order_id,
      'order_id',v_request.order_no,
      'outbox_id',v_request.outbox_id,
      'links',public.icetak_order_links(v_request.order_id)
    );
  end if;

  select id into v_existing_order
  from public.orders
  where external_order_id='pickup-ai:'||v_request_key
  limit 1;

  if v_existing_order is not null then
    update public.pickup_ai_requests
    set order_id=v_existing_order,
        order_no=(select coalesce(order_no,order_id) from public.orders where id=v_existing_order),
        status='completed',
        completed_at=now(),
        updated_at=now()
    where id=v_request.id;

    return jsonb_build_object(
      'success',true,
      'duplicate',true,
      'reason','external_order_already_created',
      'request_id',v_request.id,
      'order_db_id',v_existing_order,
      'order_id',(select coalesce(order_no,order_id) from public.orders where id=v_existing_order),
      'links',public.icetak_order_links(v_existing_order)
    );
  end if;

  select coalesce(sum(
    greatest(1,coalesce(nullif(item->>'qty','')::integer,1)) *
    greatest(0,coalesce(nullif(item->>'price','')::numeric,0))
  ),0)
  into v_items_total
  from jsonb_array_elements(v_items) item;

  v_total := round(coalesce(nullif(p_payload->>'total','')::numeric,v_items_total),2);
  if v_total < 0 then raise exception 'Pickup order total cannot be negative'; end if;

  begin
    v_date_need:=nullif(p_payload->>'date_need','')::date;
  exception when others then
    v_date_need:=null;
  end;

  v_create_payload := (coalesce(p_payload,'{}'::jsonb)
    - 'payment_received_at'
    - 'transaction_id'
    - 'match_score'
    - 'match_reason'
    - 'conversation_id'
    - 'evidence'
    - 'request_key'
    - 'pickup_time')
    || jsonb_build_object(
      'payment','Cash at Counter',
      'delivery','pickup',
      'total',v_total,
      'source','pickup_ai',
      'created_by','pickup-ai-trigger',
      'notify_whatsapp',false,
      'external_order_id','pickup-ai:'||v_request_key
    );

  v_result:=public.icetak_create_order(v_create_payload);
  v_order_id:=nullif(v_result->>'order_db_id','')::uuid;

  if v_order_id is null and coalesce((v_result->>'duplicate')::boolean,false) then
    select id into v_order_id
    from public.orders
    where external_order_id='pickup-ai:'||v_request_key
    limit 1;
  end if;
  if v_order_id is null then raise exception 'pickup_order_creation_returned_no_uuid'; end if;

  update public.orders
  set payment_method='Cash at Counter',
      payment='Cash at Counter',
      payment_status='cash_counter',
      customer_confirmed=true,
      customer_confirmed_at=coalesce(customer_confirmed_at,now()),
      production_approved=true,
      status='Ready to Process',
      admin_status='AI Pending Confirmation',
      tab='progress',
      date_need=v_date_need,
      source='pickup_ai',
      whatsapp_opt_in=false,
      admin_remark=left(concat_ws(E'\n',
        nullif(p_payload->>'admin_remark',''),
        'AUTO PICKUP / PAY AT COUNTER',
        'Request: '||v_request_key,
        case
          when nullif(p_payload->>'pickup_time','') is not null
            then 'Pickup time: '||(p_payload->>'pickup_time')
          else null
        end,
        'Admin: semak ClickUp, Confirm jika betul atau delete task jika salah.'
      ),3000),
      updated_at=now()
  where id=v_order_id;

  -- Cash-counter guard marks confirmed unpaid pickup orders as Pending Cash
  -- Approval. This internal endpoint is an explicit production trigger, so
  -- restore the human-review state without changing payment to paid.
  update public.orders
  set admin_status='AI Pending Confirmation', updated_at=now()
  where id=v_order_id;

  update public.order_items
  set review_required=true,
      workflow='Order Received',
      updated_at=now()
  where order_id=v_order_id;

  update public.production_components
  set review_required=true,
      review_status='pending',
      workflow='Order Received',
      updated_at=now()
  where order_id=v_order_id;

  v_outbox_id:=public.enqueue_clickup_production_order(v_order_id);

  update public.pickup_ai_requests
  set status='order_created',
      extraction=coalesce(p_payload,'{}'::jsonb),
      evidence=coalesce(p_payload->'evidence','{}'::jsonb),
      order_id=v_order_id,
      order_no=(select coalesce(order_no,order_id) from public.orders where id=v_order_id),
      outbox_id=v_outbox_id,
      completed_at=now(),
      updated_at=now(),
      last_error=null
  where id=v_request.id;

  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(
    v_order_id::text,
    (select coalesce(order_no,order_id) from public.orders where id=v_order_id),
    'pickup_ai_create',
    'pickup-ai-trigger',
    jsonb_build_object(
      'request_key',v_request_key,
      'conversation_id',p_payload->>'conversation_id',
      'phone',p_payload#>>'{customer,phone}',
      'total',v_total,
      'items_total',v_items_total,
      'outbox_id',v_outbox_id
    )
  );

  return v_result || jsonb_build_object(
    'success',true,
    'duplicate',false,
    'request_id',v_request.id,
    'request_key',v_request_key,
    'order_db_id',v_order_id,
    'order_id',(select coalesce(order_no,order_id) from public.orders where id=v_order_id),
    'total',v_total,
    'items_total',v_items_total,
    'payment_status','cash_counter',
    'production_approved',true,
    'outbox_id',v_outbox_id,
    'clickup',jsonb_build_object(
      'status',case when v_outbox_id is null then 'not_queued' else 'queued' end,
      'outbox_id',v_outbox_id
    ),
    'links',public.icetak_order_links(v_order_id)
  );
exception when others then
  if v_request_key is not null then
    update public.pickup_ai_requests
    set status='failed',
        last_error=left(sqlerrm,2000),
        updated_at=now()
    where request_key=v_request_key and order_id is null;
  end if;
  raise;
end;
$function$;

revoke all on function public.icetak_auto_create_pickup_ai_order(text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.icetak_auto_create_pickup_ai_order(text,jsonb,text)
  to service_role;
