-- One active extraction session per customer/conversation, across prepaid,
-- pickup, QRPay and any other path that creates a real production order.

create or replace function public.icetak_order_session_boundary(
  p_conversation_id uuid,
  p_customer_phone text
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_boundary timestamptz;
  v_phone text := regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g');
begin
  if left(v_phone, 1) = '0' then
    v_phone := '6' || v_phone;
  elsif left(v_phone, 1) = '1' then
    v_phone := '60' || v_phone;
  end if;

  select max(boundary_at)
  into v_boundary
  from (
    select max(coalesce(s.closed_at, s.cutoff_at, s.updated_at)) as boundary_at
    from public.order_sessions s
    where s.status in ('converted', 'closed')
      and (
        (p_conversation_id is not null and s.conversation_id = p_conversation_id)
        or (v_phone <> '' and s.customer_phone = v_phone)
      )

    union all

    select max(o.created_at)
    from public.orders o
    join public.customers c on c.id = o.customer_id
    where v_phone <> ''
      and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = v_phone

    union all

    select max(greatest(coalesce(d.converted_at, d.confirmed_at, o.created_at), o.created_at))
    from public.qrpay_order_drafts d
    join public.orders o on o.id = d.order_id
    where d.status = 'confirmed'
      and (
        (p_conversation_id is not null and d.conversation_id = p_conversation_id)
        or (
          v_phone <> ''
          and regexp_replace(coalesce(d.customer_phone, ''), '[^0-9]', '', 'g') = v_phone
        )
      )
  ) boundaries;

  return greatest(coalesce(v_boundary, now() - interval '45 days'), now() - interval '45 days');
end;
$function$;

-- Reconstruct closed sessions for older QRPay/admin orders that bypassed the
-- original session implementation. Preserve historical close times so recent
-- customer messages are not accidentally hidden during deployment.
-- Linking an old draft must not reapply its pricing or rewrite completed orders.
alter table public.qrpay_order_drafts disable trigger trg_sync_confirmed_draft_pricing_v15;

with missing_drafts as (
  select
    d.id as draft_id,
    d.conversation_id,
    case
      when left(regexp_replace(coalesce(d.customer_phone, ''), '[^0-9]', '', 'g'), 1) = '0'
        then '6' || regexp_replace(coalesce(d.customer_phone, ''), '[^0-9]', '', 'g')
      when left(regexp_replace(coalesce(d.customer_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
        then '60' || regexp_replace(coalesce(d.customer_phone, ''), '[^0-9]', '', 'g')
      else nullif(regexp_replace(coalesce(d.customer_phone, ''), '[^0-9]', '', 'g'), '')
    end as customer_phone,
    d.customer_name,
    d.source_type,
    least(
      coalesce(
        nullif(d.evidence->>'order_session_opened_at', '')::timestamptz,
        nullif(d.evidence->>'session_opened_at', '')::timestamptz,
        d.created_at,
        o.created_at
      ),
      greatest(coalesce(d.converted_at, d.confirmed_at, o.created_at), o.created_at)
    ) as opened_at,
    coalesce(d.cutoff_at, d.payment_received_at, d.created_at, o.created_at) as cutoff_at,
    greatest(coalesce(d.converted_at, d.confirmed_at, o.created_at), o.created_at) as closed_at,
    d.order_id
  from public.qrpay_order_drafts d
  join public.orders o on o.id = d.order_id
  where d.order_session_id is null
    and d.status = 'confirmed'
    and (d.conversation_id is not null or nullif(d.customer_phone, '') is not null)
), restored_sessions as (
  insert into public.order_sessions (
    conversation_id, customer_phone, customer_name, source_type, status,
    opened_at, cutoff_at, closed_at, closed_reason, order_id, metadata
  )
  select
    conversation_id, customer_phone, customer_name, source_type, 'converted',
    opened_at, cutoff_at, closed_at, 'historical_confirmed_order', order_id,
    jsonb_build_object('draft_id', draft_id, 'restored_by', 'order-session-isolation-v2')
  from missing_drafts
  returning id, metadata
)
update public.qrpay_order_drafts d
set order_session_id = s.id
from restored_sessions s
where d.id = (s.metadata->>'draft_id')::uuid;

alter table public.qrpay_order_drafts enable trigger trg_sync_confirmed_draft_pricing_v15;

-- A session must not remain open after its linked draft has already produced
-- an order, regardless of which confirmation function handled that draft.
update public.order_sessions s
set status = 'converted',
    closed_at = greatest(coalesce(d.converted_at, d.confirmed_at, o.created_at), o.created_at),
    closed_reason = 'confirmed_draft_order',
    order_id = o.id,
    updated_at = now()
from public.qrpay_order_drafts d
join public.orders o on o.id = d.order_id
where d.order_session_id = s.id
  and d.status = 'confirmed'
  and s.status in ('open', 'draft_created', 'ready_customer', 'customer_confirmed', 'awaiting_payment', 'paid');

-- Legacy/manual order paths previously left unrelated draft sessions open.
-- Only close sessions when the real order was created after that session was
-- recorded, so pending drafts newer than an old order stay active.
with superseded_sessions as (
  select distinct on (s.id)
    s.id as session_id,
    o.id as order_id,
    o.created_at as order_created_at
  from public.order_sessions s
  join public.customers c
    on regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = s.customer_phone
  join public.orders o on o.customer_id = c.id and o.created_at >= s.created_at
  where s.status in ('open', 'draft_created', 'ready_customer', 'customer_confirmed', 'awaiting_payment', 'paid')
  order by s.id, o.created_at desc
)
update public.order_sessions s
set status = 'converted',
    closed_at = greatest(x.order_created_at, s.opened_at),
    closed_reason = 'existing_confirmed_order',
    order_id = x.order_id,
    updated_at = now()
from superseded_sessions x
where s.id = x.session_id;

create unique index if not exists order_sessions_one_active_conversation_uidx
  on public.order_sessions (conversation_id)
  where conversation_id is not null
    and status in ('open', 'draft_created', 'ready_customer', 'customer_confirmed', 'awaiting_payment', 'paid');

create unique index if not exists order_sessions_one_active_phone_uidx
  on public.order_sessions (customer_phone)
  where customer_phone is not null
    and status in ('open', 'draft_created', 'ready_customer', 'customer_confirmed', 'awaiting_payment', 'paid');

create or replace function public.icetak_open_order_session(
  p_conversation_id uuid,
  p_customer_phone text,
  p_customer_name text,
  p_source_type text,
  p_cutoff_at timestamptz default now(),
  p_trigger_message_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_session public.order_sessions%rowtype;
  v_phone text := regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g');
  v_boundary timestamptz;
  v_lock_key bigint;
begin
  if left(v_phone, 1) = '0' then
    v_phone := '6' || v_phone;
  elsif left(v_phone, 1) = '1' then
    v_phone := '60' || v_phone;
  end if;

  for v_lock_key in
    select distinct lock_key
    from (
      select hashtextextended('icetak-order-session:conversation:' || p_conversation_id::text, 0) as lock_key
      where p_conversation_id is not null
      union all
      select hashtextextended('icetak-order-session:phone:' || v_phone, 0)
      where v_phone <> ''
    ) locks
    order by lock_key
  loop
    perform pg_advisory_xact_lock(v_lock_key);
  end loop;

  v_boundary := public.icetak_order_session_boundary(p_conversation_id, v_phone);

  select *
  into v_session
  from public.order_sessions
  where status in ('open', 'draft_created', 'ready_customer', 'customer_confirmed', 'awaiting_payment', 'paid')
    and (
      (p_conversation_id is not null and conversation_id = p_conversation_id)
      or (v_phone <> '' and customer_phone = v_phone)
    )
  order by opened_at desc
  limit 1
  for update;

  if found and v_session.opened_at < v_boundary and v_boundary >= v_session.created_at then
    update public.order_sessions
    set status = 'closed',
        closed_at = v_boundary,
        closed_reason = 'superseded_by_confirmed_order',
        updated_at = now()
    where id = v_session.id;
    v_session := null;
  end if;

  if v_session.id is not null then
    update public.order_sessions
    set cutoff_at = greatest(coalesce(cutoff_at, p_cutoff_at), p_cutoff_at),
        trigger_message_id = coalesce(p_trigger_message_id, trigger_message_id),
        customer_phone = coalesce(customer_phone, nullif(v_phone, '')),
        customer_name = coalesce(nullif(p_customer_name, ''), customer_name),
        updated_at = now(),
        metadata = metadata || coalesce(p_metadata, '{}'::jsonb)
    where id = v_session.id
    returning * into v_session;
  else
    insert into public.order_sessions (
      conversation_id, customer_phone, customer_name, source_type,
      opened_at, cutoff_at, trigger_message_id, metadata
    ) values (
      p_conversation_id, nullif(v_phone, ''), p_customer_name,
      coalesce(nullif(p_source_type, ''), 'chat_trigger'), v_boundary,
      coalesce(p_cutoff_at, now()), p_trigger_message_id, coalesce(p_metadata, '{}'::jsonb)
    ) returning * into v_session;
  end if;

  return to_jsonb(v_session);
end;
$function$;

create or replace function public.icetak_order_session_context(
  p_conversation_id uuid,
  p_customer_phone text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_session public.order_sessions%rowtype;
  v_phone text := regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g');
  v_boundary timestamptz;
begin
  if left(v_phone, 1) = '0' then
    v_phone := '6' || v_phone;
  elsif left(v_phone, 1) = '1' then
    v_phone := '60' || v_phone;
  end if;

  v_boundary := public.icetak_order_session_boundary(p_conversation_id, v_phone);

  select *
  into v_session
  from public.order_sessions
  where status in ('open', 'draft_created', 'ready_customer', 'customer_confirmed', 'awaiting_payment', 'paid')
    and (opened_at >= v_boundary or v_boundary < created_at)
    and (
      (p_conversation_id is not null and conversation_id = p_conversation_id)
      or (v_phone <> '' and customer_phone = v_phone)
    )
  order by opened_at desc
  limit 1;

  return jsonb_build_object(
    'opened_at', coalesce(v_session.opened_at, v_boundary),
    'boundary_at', v_boundary,
    'session_id', v_session.id,
    'session_status', v_session.status,
    'customer_phone', coalesce(v_session.customer_phone, nullif(v_phone, ''))
  );
end;
$function$;

create or replace function public.icetak_attach_order_session_to_draft()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_session jsonb;
  v_cutoff timestamptz;
begin
  if new.order_session_id is null
     and new.status not in ('confirmed', 'rejected')
     and (new.conversation_id is not null or nullif(new.customer_phone, '') is not null) then
    v_cutoff := coalesce(new.cutoff_at, new.payment_received_at, new.created_at, now());
    v_session := public.icetak_open_order_session(
      new.conversation_id,
      new.customer_phone,
      new.customer_name,
      coalesce(nullif(new.source_type, ''), 'qrpay_payment'),
      v_cutoff,
      new.trigger_message_id,
      jsonb_build_object('draft_id', new.id, 'source_type', new.source_type, 'session_version', 2)
    );
    new.order_session_id := (v_session->>'id')::uuid;
    new.cutoff_at := coalesce(new.cutoff_at, v_cutoff);
  end if;

  if new.order_session_id is not null then
    new.evidence := coalesce(new.evidence, '{}'::jsonb) || jsonb_build_object(
      'order_session_id', new.order_session_id,
      'session_boundary_enforced', true
    );
    new.ai_draft := coalesce(new.ai_draft, '{}'::jsonb) || jsonb_build_object('order_session_id', new.order_session_id);
    new.working_draft := coalesce(new.working_draft, '{}'::jsonb) || jsonb_build_object('order_session_id', new.order_session_id);

    if new.status not in ('confirmed', 'rejected') then
      update public.order_sessions
      set status = case when status = 'open' then 'draft_created' else status end,
          cutoff_at = greatest(coalesce(cutoff_at, new.cutoff_at), coalesce(new.cutoff_at, cutoff_at)),
          updated_at = now()
      where id = new.order_session_id
        and status in ('open', 'draft_created', 'ready_customer', 'customer_confirmed', 'awaiting_payment', 'paid');
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_icetak_attach_order_session_to_draft on public.qrpay_order_drafts;
create trigger trg_icetak_attach_order_session_to_draft
before insert or update of conversation_id, customer_phone, status, order_session_id
on public.qrpay_order_drafts
for each row
execute function public.icetak_attach_order_session_to_draft();

create or replace function public.icetak_close_order_session_from_draft()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_order_created_at timestamptz;
begin
  if new.status <> 'confirmed' or new.order_id is null or new.order_session_id is null then
    return new;
  end if;

  select created_at into v_order_created_at from public.orders where id = new.order_id;

  update public.order_sessions
  set status = 'converted',
      closed_at = greatest(
        coalesce(new.converted_at, new.confirmed_at, v_order_created_at, now()),
        coalesce(v_order_created_at, opened_at)
      ),
      closed_reason = 'confirmed_draft_order',
      order_id = new.order_id,
      updated_at = now()
  where id = new.order_session_id
    and (
      status not in ('converted', 'closed')
      or order_id is distinct from new.order_id
      or closed_at is null
    );

  return new;
end;
$function$;

drop trigger if exists trg_icetak_close_order_session_from_draft on public.qrpay_order_drafts;
create trigger trg_icetak_close_order_session_from_draft
after insert or update of status, order_id, order_session_id
on public.qrpay_order_drafts
for each row
execute function public.icetak_close_order_session_from_draft();

create or replace function public.icetak_close_order_session_from_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_phone text;
begin
  select regexp_replace(coalesce(nullif(new.delivery_phone, ''), c.phone, ''), '[^0-9]', '', 'g')
  into v_phone
  from public.customers c
  where c.id = new.customer_id;

  if left(v_phone, 1) = '0' then
    v_phone := '6' || v_phone;
  elsif left(v_phone, 1) = '1' then
    v_phone := '60' || v_phone;
  end if;

  update public.order_sessions s
  set status = 'converted',
      closed_at = greatest(coalesce(new.created_at, now()), s.opened_at),
      closed_reason = 'order_created',
      order_id = new.id,
      updated_at = now()
  where s.status in ('open', 'draft_created', 'ready_customer', 'customer_confirmed', 'awaiting_payment', 'paid')
    and (
      (coalesce(v_phone, '') <> '' and s.customer_phone = v_phone)
      or exists (
        select 1
        from public.qrpay_order_drafts d
        where d.order_session_id = s.id
          and (
            new.external_order_id = 'draft:' || d.id::text
            or (
              nullif(d.transaction_id, '') is not null
              and new.external_order_id = 'qrpay-ai:' || d.transaction_id
            )
          )
      )
    );

  return new;
end;
$function$;

drop trigger if exists trg_icetak_close_order_session_from_order on public.orders;
create trigger trg_icetak_close_order_session_from_order
after insert on public.orders
for each row
execute function public.icetak_close_order_session_from_order();

-- Attach already-pending QRPay drafts without creating a duplicate order.
update public.qrpay_order_drafts
set customer_phone = customer_phone
where order_session_id is null
  and status not in ('confirmed', 'rejected')
  and (conversation_id is not null or nullif(customer_phone, '') is not null);

alter table public.order_sessions enable row level security;

revoke all on function public.icetak_order_session_boundary(uuid, text) from public, anon, authenticated;
grant execute on function public.icetak_order_session_boundary(uuid, text) to service_role;

revoke all on function public.icetak_open_order_session(uuid, text, text, text, timestamptz, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.icetak_open_order_session(uuid, text, text, text, timestamptz, uuid, jsonb)
  to service_role;

revoke all on function public.icetak_order_session_context(uuid, text) from public, anon, authenticated;
grant execute on function public.icetak_order_session_context(uuid, text) to service_role;

revoke all on function public.icetak_attach_order_session_to_draft() from public, anon, authenticated;
revoke all on function public.icetak_close_order_session_from_draft() from public, anon, authenticated;
revoke all on function public.icetak_close_order_session_from_order() from public, anon, authenticated;
grant execute on function public.icetak_attach_order_session_to_draft() to service_role;
grant execute on function public.icetak_close_order_session_from_draft() to service_role;
grant execute on function public.icetak_close_order_session_from_order() to service_role;
