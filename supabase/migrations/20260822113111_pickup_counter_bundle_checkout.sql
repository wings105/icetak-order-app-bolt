-- Multi-order pickup checkout.
-- Additive by design: ordinary one-order sessions, ClickUp and production states
-- retain their existing paths. A pickup payment owns one session/transaction and
-- many finance allocations.

create table public.pickup_checkouts (
  id uuid primary key default gen_random_uuid(),
  checkout_no text not null unique,
  customer_master_id uuid not null references public.customer_master(id),
  customer_id uuid references public.customers(id),
  source text not null default 'counter'
    check (source in ('counter','customer_portal','whatsapp','admin_crm')),
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment','paid','expired','cancelled')),
  payment_method text not null
    check (payment_method in ('cash','qrpay')),
  total_amount numeric(16,2) not null check (total_amount > 0),
  payment_session_id uuid unique references public.payment_sessions(id) on delete set null,
  finance_transaction_id bigint references finance.transactions(id) on delete set null,
  transaction_id text,
  expires_at timestamptz,
  paid_at timestamptz,
  created_by text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pickup_checkouts_customer_idx
  on public.pickup_checkouts(customer_master_id,created_at desc);
create index pickup_checkouts_status_idx
  on public.pickup_checkouts(status,expires_at);

create table public.pickup_checkout_orders (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null references public.pickup_checkouts(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  amount numeric(16,2) not null check (amount > 0),
  ready_at_creation boolean not null default false,
  item_snapshot jsonb not null default '[]'::jsonb,
  status text not null default 'reserved'
    check (status in ('reserved','allocated','released')),
  active_reservation boolean not null default true,
  created_at timestamptz not null default now(),
  unique(checkout_id,order_id)
);

create unique index pickup_checkout_orders_active_order_uidx
  on public.pickup_checkout_orders(order_id)
  where active_reservation;
create index pickup_checkout_orders_checkout_idx
  on public.pickup_checkout_orders(checkout_id,status);

create table public.pickup_access_tokens (
  id uuid primary key default gen_random_uuid(),
  customer_master_id uuid not null references public.customer_master(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index pickup_access_tokens_customer_idx
  on public.pickup_access_tokens(customer_master_id,expires_at desc);

create table public.pickup_handovers (
  id uuid primary key default gen_random_uuid(),
  handover_no text not null unique,
  customer_master_id uuid not null references public.customer_master(id),
  checkout_id uuid references public.pickup_checkouts(id) on delete set null,
  notes text,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table public.pickup_handover_orders (
  handover_id uuid not null references public.pickup_handovers(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(handover_id,order_id)
);

alter table public.pickup_checkouts enable row level security;
alter table public.pickup_checkout_orders enable row level security;
alter table public.pickup_access_tokens enable row level security;
alter table public.pickup_handovers enable row level security;
alter table public.pickup_handover_orders enable row level security;

revoke all on public.pickup_checkouts from anon,authenticated;
revoke all on public.pickup_checkout_orders from anon,authenticated;
revoke all on public.pickup_access_tokens from anon,authenticated;
revoke all on public.pickup_handovers from anon,authenticated;
revoke all on public.pickup_handover_orders from anon,authenticated;
grant all on public.pickup_checkouts to service_role;
grant all on public.pickup_checkout_orders to service_role;
grant all on public.pickup_access_tokens to service_role;
grant all on public.pickup_handovers to service_role;
grant all on public.pickup_handover_orders to service_role;

create or replace function public.icetak_pickup_is_ready(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.orders o
    where o.id=p_order_id
      and o.pickup_collected_at is null
      and lower(coalesce(o.status,'')) not in ('cancelled','canceled')
      and lower(coalesce(o.fulfillment_stage,'')) not in ('cancelled','canceled')
      and (
        o.pickup_ready_at is not null
        or lower(coalesce(o.fulfillment_stage,''))='ready_for_pickup'
        or lower(coalesce(o.admin_status,'')) like '%ready%pickup%'
        or lower(coalesce(o.status,'')) like '%ready%pickup%'
      )
      and exists (
        select 1 from public.production_components pc
        where pc.order_id=o.id
      )
      and not exists (
        select 1 from public.production_components pc
        where pc.order_id=o.id
          and coalesce(pc.progress_percent,0)<100
      )
  );
$$;

create or replace function public.icetak_pickup_master_from_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_master uuid;
begin
  if nullif(btrim(coalesce(p_token,'')),'') is null then
    return null;
  end if;

  select s.customer_master_id into v_master
  from public.icetak_customer_session_context(p_token) s
  limit 1;

  if v_master is null then
    select t.customer_master_id into v_master
    from public.pickup_access_tokens t
    where t.token_hash=public.icetak_customer_session_hash(p_token)
      and t.revoked_at is null and t.expires_at>now()
    limit 1;
    if v_master is not null then
      update public.pickup_access_tokens
      set last_used_at=now()
      where token_hash=public.icetak_customer_session_hash(p_token)
        and (last_used_at is null or last_used_at<now()-interval '5 minutes');
    end if;
  end if;

  if v_master is null then
    select coalesce(m.merged_into_id,m.id) into v_master
    from public.customers c
    join public.customer_master m on m.id=c.customer_master_id
    where c.public_token=p_token
    order by c.created_at desc
    limit 1;
  end if;
  return v_master;
end;
$$;

create or replace function public.icetak_pickup_overview_for_master(p_master_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_master uuid;
  v_result jsonb;
begin
  select coalesce(m.merged_into_id,m.id) into v_master
  from public.customer_master m where m.id=p_master_id;
  if v_master is null then raise exception 'customer_not_found'; end if;

  select jsonb_build_object(
    'ok',true,
    'customer',jsonb_build_object(
      'id',m.id,
      'name',coalesce(nullif(m.display_name,''),'Customer'),
      'phone',m.primary_phone_normalized
    ),
    'orders',coalesce((
      select jsonb_agg(order_row.data order by
        case order_row.data->>'group'
          when 'ready_unpaid' then 1 when 'ready_paid' then 2
          when 'processing_unpaid' then 3 when 'processing_paid' then 4 else 5 end,
        order_row.data->>'createdAt' desc)
      from (
        select jsonb_build_object(
          'id',o.id,
          'orderNo',coalesce(o.order_no,o.order_id),
          'orderToken',o.public_token,
          'total',round(coalesce(o.total,0),2),
          'balance',case when paid.is_paid then 0 else round(coalesce(o.total,0),2) end,
          'paid',paid.is_paid,
          'ready',public.icetak_pickup_is_ready(o.id),
          'collected',o.pickup_collected_at is not null
            or lower(coalesce(o.fulfillment_stage,''))='collected',
          'group',case
            when o.pickup_collected_at is not null
              or lower(coalesce(o.fulfillment_stage,''))='collected' then 'collected'
            when public.icetak_pickup_is_ready(o.id) and paid.is_paid then 'ready_paid'
            when public.icetak_pickup_is_ready(o.id) then 'ready_unpaid'
            when paid.is_paid then 'processing_paid'
            else 'processing_unpaid'
          end,
          'status',coalesce(o.admin_status,o.status,'Processing'),
          'dateNeed',o.date_need,
          'createdAt',o.created_at,
          'paymentMethod',o.payment_method,
          'items',coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',i.id,'title',coalesce(i.title,i.product_type,'Item'),
              'kind',coalesce(i.k,i.product_type),
              'qty',coalesce(i.qty,1),'price',coalesce(i.price,0),
              'size',i.size,'style',i.style,
              'wording',coalesce(i.custom_text,i.wording),
              'previewUrl',i.design_preview_url
            ) order by coalesce(i.sort_index,0),i.updated_at nulls last,i.id)
            from public.order_items i where i.order_id=o.id
          ),'[]'::jsonb)
        ) data
        from public.orders o
        join public.customers c on c.id=o.customer_id
        cross join lateral (
          select lower(coalesce(o.payment_status,'')) in ('paid','matched','payment_received')
              or lower(coalesce(o.payment,''))='paid' as is_paid
        ) paid
        where coalesce((select coalesce(cm.merged_into_id,cm.id)
                        from public.customer_master cm where cm.id=c.customer_master_id),c.customer_master_id)=v_master
          and (
            lower(coalesce(o.delivery_method,'')) like '%pickup%'
            or lower(coalesce(o.delivery,'')) like '%pickup%'
            or o.pickup_ready_at is not null
            or o.pickup_collected_at is not null
          )
          and lower(coalesce(o.status,'')) not in ('cancelled','canceled')
      ) order_row
    ),'[]'::jsonb),
    'generatedAt',now()
  ) into v_result
  from public.customer_master m where m.id=v_master;
  return v_result;
end;
$$;

create or replace function public.icetak_admin_pickup_customer_search(
  p_query text,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_q text:=lower(btrim(coalesce(p_query,'')));
  v_phone text:=public.icetak_norm_msisdn(p_query);
  v_result jsonb;
begin
  if not (
    public.icetak_admin_has_permission('view_customers')
    or public.icetak_admin_has_permission('manage_customers')
    or public.icetak_admin_has_permission('verify_payments')
    or public.icetak_admin_has_permission('approve_production')
  ) then raise exception 'Forbidden'; end if;

  select coalesce(jsonb_agg(x.data order by x.name),'[]'::jsonb) into v_result
  from (
    select distinct on (master_id)
      master_id,name,
      jsonb_build_object(
        'id',master_id,'name',name,'phone',phone,
        'readyUnpaid',(
          select count(*) from public.orders o
          join public.customers oc on oc.id=o.customer_id
          where oc.customer_master_id=master_id
            and public.icetak_pickup_is_ready(o.id)
            and lower(coalesce(o.payment_status,o.payment,'')) not in ('paid','matched','payment_received')
        ),
        'readyAmount',(
          select coalesce(sum(o.total),0) from public.orders o
          join public.customers oc on oc.id=o.customer_id
          where oc.customer_master_id=master_id
            and public.icetak_pickup_is_ready(o.id)
            and lower(coalesce(o.payment_status,o.payment,'')) not in ('paid','matched','payment_received')
        )
      ) data
    from (
      select coalesce(m.merged_into_id,m.id) master_id,
        coalesce(nullif(m.display_name,''),c.name,'Customer') name,
        coalesce(m.primary_phone_normalized,c.phone,w.normalized_phone,w.phone) phone
      from public.customer_master m
      left join public.customers c on c.customer_master_id=m.id
      left join public.whatsapp_contacts w on w.customer_id=c.id
      where v_q=''
        or lower(coalesce(m.display_name,'')) like '%'||v_q||'%'
        or lower(coalesce(c.name,'')) like '%'||v_q||'%'
        or lower(coalesce(w.username,'')) like '%'||v_q||'%'
        or lower(coalesce(w.bsuid,''))=v_q
        or (v_phone is not null and (
          public.icetak_norm_msisdn(m.primary_phone_normalized)=v_phone
          or public.icetak_norm_msisdn(c.phone)=v_phone
          or public.icetak_norm_msisdn(w.normalized_phone)=v_phone
          or public.icetak_norm_msisdn(w.phone)=v_phone
        ))
        or exists (
          select 1 from public.orders so
          where so.customer_id=c.id
            and lower(coalesce(so.order_no,so.order_id,''))=v_q
        )
    ) candidates
    order by master_id,name
    limit greatest(1,least(coalesce(p_limit,20),50))
  ) x;
  return jsonb_build_object('ok',true,'rows',v_result);
end;
$$;

create or replace function public.icetak_admin_pickup_customer_overview(p_customer_master_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if not (
    public.icetak_admin_has_permission('view_customers')
    or public.icetak_admin_has_permission('manage_customers')
    or public.icetak_admin_has_permission('verify_payments')
    or public.icetak_admin_has_permission('approve_production')
  ) then raise exception 'Forbidden'; end if;
  return public.icetak_pickup_overview_for_master(p_customer_master_id);
end;
$$;

create or replace function public.icetak_customer_pickup_overview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_master uuid;
begin
  v_master:=public.icetak_pickup_master_from_token(p_token);
  if v_master is null then raise exception 'invalid_or_expired_pickup_link'; end if;
  return public.icetak_pickup_overview_for_master(v_master);
end;
$$;

create or replace function public.icetak_admin_create_pickup_access(p_customer_master_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor text;
  v_token text:=encode(extensions.gen_random_bytes(24),'hex');
  v_master uuid;
  v_expires timestamptz:=now()+interval '7 days';
begin
  if not (
    public.icetak_admin_has_permission('view_customers')
    or public.icetak_admin_has_permission('manage_customers')
    or public.icetak_admin_has_permission('verify_payments')
  ) then raise exception 'Forbidden'; end if;
  select coalesce(m.merged_into_id,m.id) into v_master
  from public.customer_master m where m.id=p_customer_master_id;
  if v_master is null then raise exception 'customer_not_found'; end if;
  select u.username into v_actor from public.admin_users u
  where u.auth_user_id=auth.uid() and u.is_active limit 1;
  insert into public.pickup_access_tokens(customer_master_id,token_hash,expires_at,created_by)
  values(v_master,public.icetak_customer_session_hash(v_token),v_expires,coalesce(v_actor,'admin'));
  return jsonb_build_object(
    'ok',true,'token',v_token,'expiresAt',v_expires,
    'path','/?pickup='||v_token
  );
end;
$$;

create or replace function public.icetak_finalize_pickup_checkout(
  p_checkout_id uuid,
  p_transaction_id text,
  p_amount numeric,
  p_provider text,
  p_sender_name text,
  p_actor text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_checkout public.pickup_checkouts%rowtype;
  v_tx public.payment_transactions%rowtype;
  v_finance_id bigint;
  v_account_id bigint;
  v_sales_id bigint;
  v_order record;
  v_paid_at timestamptz:=coalesce(nullif(p_payload->>'paid_at','')::timestamptz,now());
  v_method text;
begin
  select * into v_checkout from public.pickup_checkouts
  where id=p_checkout_id for update;
  if not found then raise exception 'pickup_checkout_not_found'; end if;

  if v_checkout.status='paid' then
    return jsonb_build_object(
      'ok',true,'paid',true,'duplicate',true,
      'checkoutId',v_checkout.id,'checkoutNo',v_checkout.checkout_no,
      'amount',v_checkout.total_amount,'transactionId',v_checkout.transaction_id
    );
  end if;
  if v_checkout.status<>'awaiting_payment' then raise exception 'pickup_checkout_not_payable'; end if;
  if v_checkout.expires_at is not null and v_checkout.expires_at<now() then
    update public.pickup_checkouts set status='expired',updated_at=now() where id=v_checkout.id;
    update public.pickup_checkout_orders
      set status='released',active_reservation=false
      where checkout_id=v_checkout.id and active_reservation;
    update public.payment_sessions set status='expired'
      where id=v_checkout.payment_session_id and status='pending';
    raise exception 'pickup_checkout_expired';
  end if;
  if round(coalesce(p_amount,0),2)<>round(v_checkout.total_amount,2) then
    raise exception 'pickup_checkout_amount_mismatch';
  end if;
  if nullif(btrim(coalesce(p_transaction_id,'')),'') is null then
    raise exception 'transaction_id_required';
  end if;

  perform 1 from public.orders o
  join public.pickup_checkout_orders po on po.order_id=o.id
  where po.checkout_id=v_checkout.id
  order by o.id for update of o;

  if exists (
    select 1 from public.payment_transactions p
    where p.transaction_id=p_transaction_id
      and p.payment_session_id is distinct from v_checkout.payment_session_id
  ) then raise exception 'transaction_already_used'; end if;

  insert into public.payment_transactions(
    order_id,payment_session_id,provider,transaction_id,amount,paid_at,sender_name,raw_payload
  ) values(
    null,v_checkout.payment_session_id,coalesce(nullif(p_provider,''),'qrpay'),
    p_transaction_id,v_checkout.total_amount,v_paid_at,
    coalesce(p_sender_name,''),coalesce(p_payload,'{}'::jsonb)
      ||jsonb_build_object('pickup_checkout_id',v_checkout.id,'pickup_checkout_no',v_checkout.checkout_no)
  )
  on conflict(transaction_id) do update
    set raw_payload=public.payment_transactions.raw_payload
      ||excluded.raw_payload
  returning * into v_tx;

  update public.payment_sessions
  set status='matched',transaction_id=p_transaction_id,matched_at=coalesce(matched_at,now())
  where id=v_checkout.payment_session_id;

  v_method:=case when v_checkout.payment_method='cash'
    then 'Cash at Counter (Pickup Bundle)' else 'QRPay (Pickup Bundle)' end;

  for v_order in
    select o.*,po.amount allocation_amount
    from public.orders o
    join public.pickup_checkout_orders po on po.order_id=o.id
    where po.checkout_id=v_checkout.id
    order by o.id
  loop
    if lower(coalesce(v_order.payment_status,'')) in ('paid','matched','payment_received')
       or lower(coalesce(v_order.payment,''))='paid' then
      raise exception 'order_already_paid:%',coalesce(v_order.order_no,v_order.order_id);
    end if;
    update public.orders
    set payment_status='paid',payment='Paid',payment_method=v_method,
        payment_transaction_id=p_transaction_id,
        payment_verified_at=coalesce(payment_verified_at,v_paid_at,now()),
        payment_verified_by=coalesce(nullif(p_actor,''),'pickup_checkout'),
        updated_at=now()
    where id=v_order.id;
    insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
    values(
      v_order.id::text,coalesce(v_order.order_no,v_order.order_id),
      'pickup_bundle_paid',coalesce(nullif(p_actor,''),'pickup_checkout'),
      jsonb_build_object('checkout_id',v_checkout.id,'checkout_no',v_checkout.checkout_no,
        'transaction_id',p_transaction_id,'allocated_amount',v_order.allocation_amount,
        'method',v_checkout.payment_method)
    );
  end loop;

  select ft.id into v_finance_id
  from finance.transactions ft
  where ft.payment_session_id=v_checkout.payment_session_id
     or ft.external_reference=p_transaction_id
  order by (ft.payment_session_id=v_checkout.payment_session_id) desc,ft.id desc
  limit 1 for update;

  select id into v_sales_id from finance.accounts where code='4000-SALES' limit 1;
  if v_checkout.payment_method='cash' then
    select id into v_account_id from finance.accounts where code='1010-CASH' limit 1;
  else
    select coalesce(sc.target_account_id,
      (select id from finance.accounts where code='1000-CIMB' limit 1))
    into v_account_id
    from finance.source_connections sc
    where sc.slug='qrpay-in'
    limit 1;
    if v_account_id is null then
      select id into v_account_id from finance.accounts
      where code in ('1040-QR-CLEARING','1000-CIMB') order by code limit 1;
    end if;
  end if;
  if v_account_id is null or v_sales_id is null then
    raise exception 'finance_accounts_not_configured';
  end if;

  if v_finance_id is null then
    insert into finance.transactions(
      account_id,direction,amount,currency,occurred_at,settled_at,
      description,counterparty,bank_reference,external_reference,
      status,reconciliation_status,classification_account_id,
      payment_session_id,dedupe_fingerprint,metadata
    ) values(
      v_account_id,'in',v_checkout.total_amount,'MYR',v_paid_at,v_paid_at,
      'Pickup bundle '||v_checkout.checkout_no,coalesce(nullif(p_sender_name,''),'Counter customer'),
      p_transaction_id,p_transaction_id,'posted','matched',v_sales_id,
      v_checkout.payment_session_id,
      'pickup-bundle:'||v_checkout.id::text,
      jsonb_build_object('source','pickup_bundle','pickup_checkout_id',v_checkout.id,
        'pickup_checkout_no',v_checkout.checkout_no,'payment_method',v_checkout.payment_method)
    ) returning id into v_finance_id;
  else
    update finance.transactions
    set account_id=v_account_id,amount=v_checkout.total_amount,
        occurred_at=v_paid_at,settled_at=v_paid_at,
        description='Pickup bundle '||v_checkout.checkout_no,
        counterparty=coalesce(nullif(p_sender_name,''),counterparty),
        bank_reference=coalesce(bank_reference,p_transaction_id),
        external_reference=coalesce(external_reference,p_transaction_id),
        status='posted',reconciliation_status='matched',
        classification_account_id=v_sales_id,order_id=null,
        payment_session_id=v_checkout.payment_session_id,
        metadata=coalesce(metadata,'{}'::jsonb)
          ||jsonb_build_object('source','pickup_bundle','pickup_checkout_id',v_checkout.id,
            'pickup_checkout_no',v_checkout.checkout_no,'payment_method',v_checkout.payment_method),
        updated_at=now()
    where id=v_finance_id;
  end if;

  insert into finance.payment_allocations(
    transaction_id,order_id,payment_session_id,amount,status,created_by
  )
  select v_finance_id,po.order_id,null,po.amount,'allocated',
    coalesce(nullif(p_actor,''),'pickup_checkout')
  from public.pickup_checkout_orders po
  where po.checkout_id=v_checkout.id
  on conflict do nothing;

  update finance.reconciliation_cases
  set status='resolved',resolution='pickup_bundle_allocated',
      resolved_by=coalesce(nullif(p_actor,''),'pickup_checkout'),resolved_at=now()
  where primary_transaction_id=v_finance_id and status='open';

  perform finance.post_transaction(v_finance_id,coalesce(nullif(p_actor,''),'pickup_checkout'));

  update public.pickup_checkout_orders
  set status='allocated',active_reservation=false
  where checkout_id=v_checkout.id;
  update public.pickup_checkouts
  set status='paid',finance_transaction_id=v_finance_id,
      transaction_id=p_transaction_id,paid_at=v_paid_at,updated_at=now()
  where id=v_checkout.id;

  return jsonb_build_object(
    'ok',true,'paid',true,'checkoutId',v_checkout.id,
    'checkoutNo',v_checkout.checkout_no,'amount',v_checkout.total_amount,
    'transactionId',p_transaction_id,'financeTransactionId',v_finance_id
  );
end;
$$;

create or replace function public.icetak_create_pickup_checkout_internal(
  p_customer_master_id uuid,
  p_order_ids uuid[],
  p_method text,
  p_source text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_master uuid;
  v_checkout_id uuid:=gen_random_uuid();
  v_checkout_no text:='PC'||to_char(now() at time zone 'Asia/Kuala_Lumpur','YYMMDD')
    ||'-'||upper(substr(replace(v_checkout_id::text,'-',''),1,6));
  v_session_id uuid:=gen_random_uuid();
  v_session_token text:='pb_'||encode(extensions.gen_random_bytes(16),'hex');
  v_total numeric;
  v_count integer;
  v_expires timestamptz:=now()+interval '30 minutes';
  v_result jsonb;
begin
  if p_method not in ('cash','qrpay') then raise exception 'invalid_payment_method'; end if;
  if coalesce(cardinality(p_order_ids),0)=0 then raise exception 'select_at_least_one_order'; end if;
  if cardinality(p_order_ids)<>cardinality(array(select distinct unnest(p_order_ids))) then
    raise exception 'duplicate_order_selection';
  end if;
  select coalesce(m.merged_into_id,m.id) into v_master
  from public.customer_master m where m.id=p_customer_master_id;
  if v_master is null then raise exception 'customer_not_found'; end if;

  update public.pickup_checkouts
  set status='expired',updated_at=now()
  where status='awaiting_payment' and expires_at<now();
  update public.pickup_checkout_orders po
  set status='released',active_reservation=false
  where po.active_reservation
    and exists(select 1 from public.pickup_checkouts pc
      where pc.id=po.checkout_id and pc.status in ('expired','cancelled'));

  perform 1
  from public.orders o
  where o.id=any(p_order_ids)
  order by o.id for update;

  select count(*),round(sum(coalesce(o.total,0)),2)
  into v_count,v_total
  from public.orders o
  join public.customers c on c.id=o.customer_id
  join public.customer_master m on m.id=c.customer_master_id
  where o.id=any(p_order_ids)
    and coalesce(m.merged_into_id,m.id)=v_master
    and (
      lower(coalesce(o.delivery_method,'')) like '%pickup%'
      or lower(coalesce(o.delivery,'')) like '%pickup%'
      or o.pickup_ready_at is not null
    )
    and o.pickup_collected_at is null
    and lower(coalesce(o.status,'')) not in ('cancelled','canceled')
    and lower(coalesce(o.payment_status,'')) not in ('paid','matched','payment_received')
    and lower(coalesce(o.payment,''))<>'paid';
  if v_count<>cardinality(p_order_ids) then
    raise exception 'invalid_paid_or_foreign_order_selection';
  end if;
  if coalesce(v_total,0)<=0 then raise exception 'invalid_checkout_total'; end if;

  insert into public.payment_sessions(
    id,order_id,expected_amount,status,base_amount,discount,expires_at,
    order_token,purpose,pricing_snapshot,reservation_grace_seconds
  ) values(
    v_session_id,null,v_total,'pending',v_total,0,v_expires,
    v_session_token,'pickup_bundle',
    jsonb_build_object('pickup_checkout_id',v_checkout_id,'pickup_checkout_no',v_checkout_no,
      'customer_master_id',v_master,'order_ids',to_jsonb(p_order_ids),'source',p_source),
    120
  );

  insert into public.pickup_checkouts(
    id,checkout_no,customer_master_id,customer_id,source,status,payment_method,
    total_amount,payment_session_id,expires_at,created_by
  )
  select v_checkout_id,v_checkout_no,v_master,
    (select c.id from public.customers c where c.customer_master_id=v_master
      order by c.created_at desc limit 1),
    case when p_source in ('counter','customer_portal','whatsapp','admin_crm')
      then p_source else 'counter' end,
    'awaiting_payment',p_method,v_total,v_session_id,v_expires,coalesce(nullif(p_actor,''),'pickup_checkout');

  insert into public.pickup_checkout_orders(
    checkout_id,order_id,amount,ready_at_creation,item_snapshot
  )
  select v_checkout_id,o.id,round(coalesce(o.total,0),2),
    public.icetak_pickup_is_ready(o.id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'title',coalesce(i.title,i.product_type,'Item'),
        'qty',coalesce(i.qty,1),'price',coalesce(i.price,0),
        'size',i.size,'wording',coalesce(i.custom_text,i.wording),
        'previewUrl',i.design_preview_url
      ) order by coalesce(i.sort_index,0),i.id)
      from public.order_items i where i.order_id=o.id
    ),'[]'::jsonb)
  from public.orders o where o.id=any(p_order_ids);

  if p_method='cash' then
    v_result:=public.icetak_finalize_pickup_checkout(
      v_checkout_id,'CASH-'||v_checkout_no,v_total,'cash_counter','',
      coalesce(nullif(p_actor,''),'pickup_counter'),
      jsonb_build_object('source','pickup_counter','paid_at',now())
    );
  else
    v_result:=jsonb_build_object(
      'ok',true,'paid',false,'checkoutId',v_checkout_id,'checkoutNo',v_checkout_no,
      'amount',v_total,'paymentSessionId',v_session_id,'expiresAt',v_expires
    );
  end if;
  return v_result;
end;
$$;

create or replace function public.icetak_admin_create_pickup_checkout(
  p_customer_master_id uuid,
  p_order_ids uuid[],
  p_method text,
  p_source text default 'counter'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_actor text;
begin
  if not public.icetak_admin_has_permission('verify_payments') then
    raise exception 'Forbidden: verify_payments';
  end if;
  select u.username into v_actor from public.admin_users u
  where u.auth_user_id=auth.uid() and u.is_active limit 1;
  return public.icetak_create_pickup_checkout_internal(
    p_customer_master_id,p_order_ids,lower(p_method),p_source,coalesce(v_actor,'admin')
  );
end;
$$;

create or replace function public.icetak_customer_create_pickup_checkout(
  p_token text,
  p_order_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_master uuid;
begin
  v_master:=public.icetak_pickup_master_from_token(p_token);
  if v_master is null then raise exception 'invalid_or_expired_pickup_link'; end if;
  return public.icetak_create_pickup_checkout_internal(
    v_master,p_order_ids,'qrpay','customer_portal','customer'
  );
end;
$$;

create or replace function public.icetak_admin_pickup_handover(
  p_customer_master_id uuid,
  p_order_ids uuid[],
  p_checkout_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor text;
  v_master uuid;
  v_count integer;
  v_id uuid:=gen_random_uuid();
  v_no text:='HO'||to_char(now() at time zone 'Asia/Kuala_Lumpur','YYMMDD')
    ||'-'||upper(substr(replace(v_id::text,'-',''),1,6));
  v_order record;
begin
  if not (
    public.icetak_admin_has_permission('verify_payments')
    or public.icetak_admin_has_permission('approve_production')
  ) then raise exception 'Forbidden'; end if;
  if coalesce(cardinality(p_order_ids),0)=0 then raise exception 'select_ready_paid_orders'; end if;
  select coalesce(m.merged_into_id,m.id) into v_master
  from public.customer_master m where m.id=p_customer_master_id;
  select u.username into v_actor from public.admin_users u
  where u.auth_user_id=auth.uid() and u.is_active limit 1;

  perform 1 from public.orders o where o.id=any(p_order_ids)
  order by o.id for update;
  select count(*) into v_count
  from public.orders o
  join public.customers c on c.id=o.customer_id
  join public.customer_master m on m.id=c.customer_master_id
  where o.id=any(p_order_ids)
    and coalesce(m.merged_into_id,m.id)=v_master
    and public.icetak_pickup_is_ready(o.id)
    and o.pickup_collected_at is null
    and (
      lower(coalesce(o.payment_status,'')) in ('paid','matched','payment_received')
      or lower(coalesce(o.payment,''))='paid'
    );
  if v_count<>cardinality(p_order_ids) then
    raise exception 'handover_requires_ready_and_fully_paid_orders';
  end if;

  insert into public.pickup_handovers(
    id,handover_no,customer_master_id,checkout_id,notes,created_by
  ) values(v_id,v_no,v_master,p_checkout_id,nullif(btrim(coalesce(p_notes,'')),''),
    coalesce(v_actor,'admin'));
  insert into public.pickup_handover_orders(handover_id,order_id)
  select v_id,unnest(p_order_ids);

  for v_order in select * from public.orders where id=any(p_order_ids) loop
    update public.orders
    set pickup_collected_at=coalesce(pickup_collected_at,now()),
        fulfillment_stage='collected',status='Customer Collected',
        admin_status='Customer Collected',tab='completed',updated_at=now()
    where id=v_order.id;
    insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
    values(v_order.id::text,coalesce(v_order.order_no,v_order.order_id),
      'pickup_handover',coalesce(v_actor,'admin'),
      jsonb_build_object('handover_id',v_id,'handover_no',v_no,'checkout_id',p_checkout_id));
  end loop;
  return jsonb_build_object('ok',true,'handoverId',v_id,'handoverNo',v_no,
    'orderCount',cardinality(p_order_ids));
end;
$$;

create or replace function public.icetak_pickup_checkout_status(
  p_token text,
  p_checkout_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_master uuid; v_checkout public.pickup_checkouts%rowtype;
begin
  v_master:=public.icetak_pickup_master_from_token(p_token);
  if v_master is null then raise exception 'invalid_or_expired_pickup_link'; end if;
  select * into v_checkout from public.pickup_checkouts
  where id=p_checkout_id and customer_master_id=v_master;
  if not found then raise exception 'pickup_checkout_not_found'; end if;
  return jsonb_build_object(
    'ok',true,'checkoutId',v_checkout.id,'checkoutNo',v_checkout.checkout_no,
    'status',v_checkout.status,'paid',v_checkout.status='paid',
    'amount',v_checkout.total_amount,'transactionId',v_checkout.transaction_id,
    'expiresAt',v_checkout.expires_at,'paidAt',v_checkout.paid_at
  );
end;
$$;

create or replace function public.icetak_admin_pickup_checkout_status(p_checkout_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_checkout public.pickup_checkouts%rowtype;
begin
  if not (
    public.icetak_admin_has_permission('verify_payments')
    or public.icetak_admin_has_permission('view_finance')
  ) then raise exception 'Forbidden'; end if;
  select * into v_checkout from public.pickup_checkouts where id=p_checkout_id;
  if not found then raise exception 'pickup_checkout_not_found'; end if;
  return jsonb_build_object(
    'ok',true,'checkoutId',v_checkout.id,'checkoutNo',v_checkout.checkout_no,
    'status',v_checkout.status,'paid',v_checkout.status='paid',
    'amount',v_checkout.total_amount,'transactionId',v_checkout.transaction_id,
    'expiresAt',v_checkout.expires_at,'paidAt',v_checkout.paid_at
  );
end;
$$;

create or replace function public.icetak_admin_pickup_total_by_identity(p_identity text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_search jsonb;
  v_row jsonb;
  v_overview jsonb;
  v_access jsonb;
  v_ready jsonb;
  v_total numeric;
begin
  if not (
    public.icetak_admin_has_permission('view_customers')
    or public.icetak_admin_has_permission('verify_payments')
  ) then raise exception 'Forbidden'; end if;
  v_search:=public.icetak_admin_pickup_customer_search(p_identity,2);
  if jsonb_array_length(v_search->'rows')<>1 then
    return jsonb_build_object('ok',false,'reason','identity_not_unique',
      'matches',jsonb_array_length(v_search->'rows'));
  end if;
  v_row:=(v_search->'rows')->0;
  v_overview:=public.icetak_pickup_overview_for_master((v_row->>'id')::uuid);
  select coalesce(jsonb_agg(x),'[]'::jsonb),coalesce(sum((x->>'balance')::numeric),0)
  into v_ready,v_total
  from jsonb_array_elements(v_overview->'orders') x
  where x->>'group'='ready_unpaid';
  v_access:=public.icetak_admin_create_pickup_access((v_row->>'id')::uuid);
  return jsonb_build_object(
    'ok',true,'customer',v_overview->'customer','orders',v_ready,
    'total',round(v_total,2),'path',v_access->>'path',
    'message','Hi '||(v_overview#>>'{customer,name}')||E',\n\n'
      ||jsonb_array_length(v_ready)||' order siap untuk pickup. '
      ||'Jumlah belum dibayar: RM'||to_char(v_total,'FM999999990.00')||E'\n'
      ||'Pilih order dan buat bayaran melalui link: '||(v_access->>'path')
  );
end;
$$;

create or replace function public.icetak_payment_session_whatsapp_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.purpose,'order_payment')='pickup_bundle' then
    return new;
  end if;
  if lower(coalesce(new.status,''))='matched'
     and lower(coalesce(old.status,'')) is distinct from 'matched' then
    perform public.icetak_enqueue_whatsapp_event(
      'payment_received',new.order_id,
      jsonb_build_object('transaction_id',new.transaction_id,'paid_amount',new.expected_amount),
      null,now()
    );
  end if;
  return new;
end;
$$;

alter function public.icetak_payment_webhook(jsonb)
  rename to icetak_payment_webhook_single_order_20260822;

create function public.icetak_payment_webhook(p_payload jsonb)
returns jsonb
language plpgsql
set search_path=''
as $$
declare
  v_amount numeric;
  v_transaction_id text;
  v_checkout_id uuid;
  v_checkout public.pickup_checkouts%rowtype;
  v_provider text;
  v_paid_at timestamptz:=now();
begin
  begin v_amount:=round((p_payload->>'amount')::numeric,2);
  exception when others then
    return jsonb_build_object('success',false,'matched',false,'reason','invalid_amount');
  end;
  v_transaction_id:=coalesce(nullif(btrim(p_payload->>'transaction_id'),''),
    'payload_'||md5(p_payload::text));
  v_provider:=coalesce(nullif(p_payload->>'provider',''),'webhook');
  begin v_paid_at:=coalesce(nullif(p_payload->>'paid_at','')::timestamptz,now());
  exception when others then v_paid_at:=now(); end;

  select pc.id into v_checkout_id
  from public.pickup_checkouts pc
  where pc.transaction_id=v_transaction_id and pc.status='paid'
  limit 1;
  if v_checkout_id is not null then
    return public.icetak_finalize_pickup_checkout(
      v_checkout_id,v_transaction_id,v_amount,v_provider,
      coalesce(p_payload->>'sender_name',''),'payment_webhook',
      p_payload||jsonb_build_object('paid_at',v_paid_at)
    )||jsonb_build_object('success',true,'matched',true,'pickup_bundle',true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('icetak_payment_amount_allocator',0));
  select pc.* into v_checkout
  from public.pickup_checkouts pc
  join public.payment_sessions ps on ps.id=pc.payment_session_id
  where pc.status='awaiting_payment'
    and pc.payment_method='qrpay'
    and pc.total_amount=v_amount
    and pc.expires_at>now()-make_interval(secs=>coalesce(ps.reservation_grace_seconds,120))
    and ps.status in ('pending','submitted','receipt_submitted','pending_review')
  order by pc.created_at desc
  limit 1 for update of pc;

  if v_checkout.id is not null then
    return public.icetak_finalize_pickup_checkout(
      v_checkout.id,v_transaction_id,v_amount,v_provider,
      coalesce(p_payload->>'sender_name',''),'payment_webhook',
      p_payload||jsonb_build_object('paid_at',v_paid_at)
    )||jsonb_build_object(
      'success',true,'matched',true,'pickup_bundle',true,
      'payment_recorded',true,'payment_session_id',v_checkout.payment_session_id
    );
  end if;
  return public.icetak_payment_webhook_single_order_20260822(p_payload);
end;
$$;

revoke execute on function public.icetak_pickup_is_ready(uuid) from public,anon,authenticated;
revoke execute on function public.icetak_pickup_master_from_token(text) from public,anon,authenticated;
revoke execute on function public.icetak_pickup_overview_for_master(uuid) from public,anon,authenticated;
revoke execute on function public.icetak_create_pickup_checkout_internal(uuid,uuid[],text,text,text) from public,anon,authenticated;
revoke execute on function public.icetak_finalize_pickup_checkout(uuid,text,numeric,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_pickup_is_ready(uuid) to service_role;
grant execute on function public.icetak_pickup_master_from_token(text) to service_role;
grant execute on function public.icetak_pickup_overview_for_master(uuid) to service_role;
grant execute on function public.icetak_create_pickup_checkout_internal(uuid,uuid[],text,text,text) to service_role;
grant execute on function public.icetak_finalize_pickup_checkout(uuid,text,numeric,text,text,text,jsonb) to service_role;

revoke execute on function public.icetak_admin_pickup_customer_search(text,integer) from public,anon;
revoke execute on function public.icetak_admin_pickup_customer_overview(uuid) from public,anon;
revoke execute on function public.icetak_admin_create_pickup_access(uuid) from public,anon;
revoke execute on function public.icetak_admin_create_pickup_checkout(uuid,uuid[],text,text) from public,anon;
revoke execute on function public.icetak_admin_pickup_handover(uuid,uuid[],uuid,text) from public,anon;
revoke execute on function public.icetak_admin_pickup_checkout_status(uuid) from public,anon;
revoke execute on function public.icetak_admin_pickup_total_by_identity(text) from public,anon;
grant execute on function public.icetak_admin_pickup_customer_search(text,integer) to authenticated,service_role;
grant execute on function public.icetak_admin_pickup_customer_overview(uuid) to authenticated,service_role;
grant execute on function public.icetak_admin_create_pickup_access(uuid) to authenticated,service_role;
grant execute on function public.icetak_admin_create_pickup_checkout(uuid,uuid[],text,text) to authenticated,service_role;
grant execute on function public.icetak_admin_pickup_handover(uuid,uuid[],uuid,text) to authenticated,service_role;
grant execute on function public.icetak_admin_pickup_checkout_status(uuid) to authenticated,service_role;
grant execute on function public.icetak_admin_pickup_total_by_identity(text) to authenticated,service_role;

revoke execute on function public.icetak_customer_pickup_overview(text) from public,authenticated;
revoke execute on function public.icetak_customer_create_pickup_checkout(text,uuid[]) from public,authenticated;
revoke execute on function public.icetak_pickup_checkout_status(text,uuid) from public,authenticated;
grant execute on function public.icetak_customer_pickup_overview(text) to anon,authenticated,service_role;
grant execute on function public.icetak_customer_create_pickup_checkout(text,uuid[]) to anon,authenticated,service_role;
grant execute on function public.icetak_pickup_checkout_status(text,uuid) to anon,authenticated,service_role;

-- Preserve the legacy webhook's role compatibility while the actual production
-- Edge Function continues to invoke it with service_role.
grant execute on function public.icetak_payment_webhook(jsonb) to anon,authenticated,service_role;
grant execute on function public.icetak_payment_webhook_single_order_20260822(jsonb) to anon,authenticated,service_role;
