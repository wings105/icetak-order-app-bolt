-- Keep Finance in sync with the canonical QRPay records already written by the
-- operational payment webhook. The bridge is additive and deliberately runs
-- after the existing Orders payment workflow.

create unique index if not exists finance_payment_allocations_tx_order_no_session_uidx
  on finance.payment_allocations(transaction_id, order_id)
  where order_id is not null
    and payment_session_id is null
    and status = 'allocated';

create index if not exists finance_reconciliation_unmatched_tx_open_idx
  on finance.reconciliation_cases(primary_transaction_id)
  where case_type = 'unmatched_payment'
    and candidate_transaction_id is null
    and status = 'open';

create or replace function finance.sync_operational_qrpay(
  p_transaction_id text,
  p_provider text,
  p_amount numeric,
  p_paid_at timestamptz,
  p_sender_name text,
  p_raw_payload jsonb,
  p_order_id uuid default null,
  p_payment_session_id uuid default null,
  p_actor text default 'operational-qrpay-bridge'
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transaction_ref text := nullif(pg_catalog.btrim(p_transaction_id), '');
  v_provider text := pg_catalog.lower(coalesce(nullif(pg_catalog.btrim(p_provider), ''), 'qrpay'));
  v_amount numeric(16,2) := pg_catalog.round(p_amount, 2);
  v_paid_at timestamptz := coalesce(p_paid_at, pg_catalog.now());
  v_sender_name text := nullif(pg_catalog.btrim(p_sender_name), '');
  v_raw_payload jsonb := coalesce(p_raw_payload, '{}'::jsonb);
  v_order_id uuid := p_order_id;
  v_payment_session_id uuid := p_payment_session_id;
  v_order_no text;
  v_connection_id bigint;
  v_bank_account_id bigint;
  v_sales_account_id bigint;
  v_unclassified_account_id bigint;
  v_raw_event_id bigint;
  v_observation_id bigint;
  v_finance_transaction_id bigint;
  v_existing_order_id uuid;
  v_existing_session_id uuid;
  v_existing_classification_id bigint;
  v_existing_status text;
  v_existing_reconciliation_status text;
  v_description text;
  v_reconciliation_status text;
  v_classification_id bigint;
  v_payload jsonb;
  v_payload_hash text;
  v_has_bank_statement boolean := false;
  v_created boolean := false;
  v_matched_payment record;
  v_entry_id bigint;
begin
  if v_transaction_ref is null then
    raise exception 'QRPay transaction_id is required';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'QRPay amount must be greater than zero';
  end if;
  if v_provider not in ('qrpay', 'qrpay_ai', 'duitnow', 'finance-qrpay') then
    raise exception 'Unsupported QRPay provider: %', v_provider;
  end if;

  -- One transaction reference is one economic event, even when webhook retries,
  -- the AI worker, and an admin match happen concurrently.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finance-operational-qrpay:' || v_transaction_ref, 0)
  );

  -- A matched operational record is authoritative over an unmatched copy that
  -- may briefly coexist while the QRPay worker moves the transaction.
  if v_order_id is null then
    select
      pt.provider,
      pt.amount,
      pt.paid_at,
      pt.sender_name,
      pt.raw_payload,
      pt.order_id,
      pt.payment_session_id
    into v_matched_payment
    from public.payment_transactions pt
    where pt.transaction_id = v_transaction_ref
      and pg_catalog.lower(coalesce(pt.provider, '')) in ('qrpay', 'qrpay_ai', 'duitnow', 'finance-qrpay')
    order by pt.created_at desc nulls last, pt.id desc
    limit 1;

    if found then
      v_provider := pg_catalog.lower(coalesce(nullif(pg_catalog.btrim(v_matched_payment.provider), ''), v_provider));
      v_amount := pg_catalog.round(v_matched_payment.amount, 2);
      v_paid_at := coalesce(v_matched_payment.paid_at, v_paid_at);
      v_sender_name := coalesce(nullif(pg_catalog.btrim(v_matched_payment.sender_name), ''), v_sender_name);
      v_raw_payload := coalesce(v_matched_payment.raw_payload, v_raw_payload);
      v_order_id := v_matched_payment.order_id;
      v_payment_session_id := v_matched_payment.payment_session_id;
    end if;
  end if;

  select sc.id, sc.target_account_id
  into v_connection_id, v_bank_account_id
  from finance.source_connections sc
  where sc.slug = 'qrpay-in'
    and sc.is_active
  for update;

  if v_connection_id is null or v_bank_account_id is null then
    raise exception 'Active Finance QRPay Incoming connection is not configured';
  end if;

  select a.id into v_sales_account_id
  from finance.accounts a where a.code = '4000-SALES' and a.is_active;
  select a.id into v_unclassified_account_id
  from finance.accounts a where a.code = '4090-UNCLASS-IN' and a.is_active;

  if v_sales_account_id is null or v_unclassified_account_id is null then
    raise exception 'Finance QRPay classification accounts are not configured';
  end if;

  if v_order_id is not null then
    select o.order_no into v_order_no
    from public.orders o where o.id = v_order_id;
  end if;

  v_description := case
    when v_order_id is not null then 'QRPay matched to ' || coalesce(v_order_no, v_order_id::text)
    else 'QRPay awaiting order match'
  end;
  v_classification_id := case when v_order_id is not null then v_sales_account_id else v_unclassified_account_id end;

  v_payload := pg_catalog.jsonb_build_object(
    'source', 'operational_qrpay_webhook',
    'provider', v_provider,
    'transaction_id', v_transaction_ref,
    'amount', v_amount,
    'paid_at', v_paid_at,
    'sender_name', v_sender_name,
    'order_id', v_order_id,
    'payment_session_id', v_payment_session_id,
    'raw_payload', v_raw_payload
  );
  v_payload_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into finance.raw_events(
    source_connection_id,
    idempotency_key,
    external_event_id,
    payload_hash,
    event_occurred_at,
    headers,
    payload,
    processing_status,
    processing_error
  ) values (
    v_connection_id,
    'operational-qrpay:' || v_transaction_ref,
    v_transaction_ref,
    v_payload_hash,
    v_paid_at,
    pg_catalog.jsonb_build_object('bridge', 'database-trigger'),
    v_payload,
    'processed',
    null
  )
  on conflict (source_connection_id, idempotency_key) do update set
    external_event_id = excluded.external_event_id,
    payload_hash = excluded.payload_hash,
    event_occurred_at = excluded.event_occurred_at,
    payload = excluded.payload,
    processing_status = 'processed',
    processing_error = null,
    attempt_count = finance.raw_events.attempt_count + 1,
    last_seen_at = pg_catalog.now()
  returning id into v_raw_event_id;

  insert into finance.transaction_observations(
    raw_event_id,
    source_connection_id,
    account_id,
    external_reference,
    direction,
    amount,
    currency,
    occurred_at,
    description,
    counterparty,
    normalized_payload,
    parse_confidence
  ) values (
    v_raw_event_id,
    v_connection_id,
    v_bank_account_id,
    v_transaction_ref,
    'in',
    v_amount,
    'MYR',
    v_paid_at,
    v_description,
    v_sender_name,
    v_payload,
    1
  )
  on conflict (raw_event_id) do update set
    account_id = excluded.account_id,
    external_reference = excluded.external_reference,
    direction = excluded.direction,
    amount = excluded.amount,
    currency = excluded.currency,
    occurred_at = excluded.occurred_at,
    description = excluded.description,
    counterparty = excluded.counterparty,
    normalized_payload = excluded.normalized_payload,
    parse_confidence = excluded.parse_confidence
  returning id into v_observation_id;

  select ts.transaction_id
  into v_finance_transaction_id
  from finance.transaction_sources ts
  where ts.observation_id = v_observation_id;

  if v_finance_transaction_id is null then
    select t.id
    into v_finance_transaction_id
    from finance.transactions t
    where t.external_reference = v_transaction_ref
      and t.direction = 'in'
      and t.status <> 'void'
    order by
      case when t.order_id is not null then 0 else 1 end,
      t.created_at asc,
      t.id asc
    limit 1
    for update;
  end if;

  if v_finance_transaction_id is not null then
    select
      t.order_id,
      t.payment_session_id,
      t.classification_account_id,
      t.status,
      t.reconciliation_status
    into
      v_existing_order_id,
      v_existing_session_id,
      v_existing_classification_id,
      v_existing_status,
      v_existing_reconciliation_status
    from finance.transactions t
    where t.id = v_finance_transaction_id
    for update;

    select exists (
      select 1
      from finance.transaction_sources ts
      join finance.transaction_observations o on o.id = ts.observation_id
      join finance.source_connections sc on sc.id = o.source_connection_id
      where ts.transaction_id = v_finance_transaction_id
        and sc.source_type = 'bank_statement'
    ) into v_has_bank_statement;

    v_reconciliation_status := case
      when v_order_id is null then 'unmatched'
      when v_has_bank_statement then 'confirmed'
      else 'matched'
    end;

    update finance.transactions set
      account_id = v_bank_account_id,
      direction = 'in',
      amount = v_amount,
      currency = 'MYR',
      occurred_at = v_paid_at,
      settled_at = v_paid_at,
      description = v_description,
      counterparty = v_sender_name,
      external_reference = v_transaction_ref,
      status = 'posted',
      reconciliation_status = v_reconciliation_status,
      classification_account_id = v_classification_id,
      order_id = v_order_id,
      payment_session_id = v_payment_session_id,
      metadata = coalesce(finance.transactions.metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
        'operational_qrpay_bridge', true,
        'operational_provider', v_provider,
        'last_operational_sync_at', pg_catalog.now()
      ),
      updated_at = pg_catalog.now()
    where id = v_finance_transaction_id;
  else
    v_reconciliation_status := case when v_order_id is null then 'unmatched' else 'matched' end;

    insert into finance.transactions(
      account_id,
      direction,
      amount,
      currency,
      occurred_at,
      settled_at,
      description,
      counterparty,
      external_reference,
      status,
      reconciliation_status,
      classification_account_id,
      order_id,
      payment_session_id,
      dedupe_fingerprint,
      metadata
    ) values (
      v_bank_account_id,
      'in',
      v_amount,
      'MYR',
      v_paid_at,
      v_paid_at,
      v_description,
      v_sender_name,
      v_transaction_ref,
      'posted',
      v_reconciliation_status,
      v_classification_id,
      v_order_id,
      v_payment_session_id,
      v_payload_hash,
      pg_catalog.jsonb_build_object(
        'operational_qrpay_bridge', true,
        'operational_provider', v_provider,
        'first_operational_sync_at', pg_catalog.now(),
        'last_operational_sync_at', pg_catalog.now()
      )
    ) returning id into v_finance_transaction_id;
    v_created := true;
  end if;

  insert into finance.transaction_sources(
    transaction_id,
    observation_id,
    match_method,
    match_confidence,
    is_primary
  ) values (
    v_finance_transaction_id,
    v_observation_id,
    case when v_created then 'new' else 'exact_external' end,
    1,
    true
  )
  on conflict (observation_id) do update set
    transaction_id = excluded.transaction_id,
    match_method = excluded.match_method,
    match_confidence = excluded.match_confidence,
    is_primary = excluded.is_primary,
    linked_at = pg_catalog.now();

  if v_order_id is null then
    update finance.payment_allocations set
      status = 'reversed',
      reversed_at = coalesce(reversed_at, pg_catalog.now())
    where transaction_id = v_finance_transaction_id
      and status = 'allocated';

    insert into finance.reconciliation_cases(
      case_type,
      status,
      primary_transaction_id,
      raw_event_id,
      reason,
      confidence,
      details
    )
    select
      'unmatched_payment',
      'open',
      v_finance_transaction_id,
      v_raw_event_id,
      'QRPay money received but not linked to an order',
      1,
      pg_catalog.jsonb_build_object(
        'transaction_id', v_transaction_ref,
        'provider', v_provider,
        'amount', v_amount,
        'source', 'operational_qrpay_webhook'
      )
    where not exists (
      select 1
      from finance.reconciliation_cases rc
      where rc.case_type = 'unmatched_payment'
        and rc.primary_transaction_id = v_finance_transaction_id
        and rc.candidate_transaction_id is null
        and rc.status = 'open'
    );
  else
    update finance.payment_allocations set
      status = 'reversed',
      reversed_at = coalesce(reversed_at, pg_catalog.now())
    where transaction_id = v_finance_transaction_id
      and status = 'allocated'
      and (
        order_id is distinct from v_order_id
        or payment_session_id is distinct from v_payment_session_id
      );

    insert into finance.payment_allocations(
      transaction_id,
      order_id,
      payment_session_id,
      amount,
      status,
      created_by
    )
    select
      v_finance_transaction_id,
      v_order_id,
      v_payment_session_id,
      v_amount,
      'allocated',
      p_actor
    where not exists (
      select 1
      from finance.payment_allocations pa
      where pa.transaction_id = v_finance_transaction_id
        and pa.order_id = v_order_id
        and pa.payment_session_id is not distinct from v_payment_session_id
        and pa.status = 'allocated'
    );

    update finance.reconciliation_cases set
      status = 'resolved',
      resolution = 'Matched by operational QRPay workflow to ' || coalesce(v_order_no, v_order_id::text),
      resolved_by = p_actor,
      resolved_at = pg_catalog.now()
    where case_type = 'unmatched_payment'
      and primary_transaction_id = v_finance_transaction_id
      and status = 'open';
  end if;

  -- Post once. If an unmatched payment was already posted to Unclassified
  -- Income, move only the offset line when it later becomes matched.
  perform finance.post_transaction(v_finance_transaction_id, p_actor);

  select je.id into v_entry_id
  from finance.journal_entries je
  where je.transaction_id = v_finance_transaction_id;

  if v_entry_id is not null then
    update finance.journal_entries set
      entry_date = (v_paid_at at time zone 'Asia/Kuala_Lumpur')::date,
      description = v_description,
      source_reference = v_transaction_ref
    where id = v_entry_id;

    update finance.journal_lines set
      account_id = v_bank_account_id,
      debit = v_amount,
      credit = 0,
      memo = coalesce(v_sender_name, 'QRPay incoming funds')
    where journal_entry_id = v_entry_id
      and debit > 0;

    update finance.journal_lines set
      account_id = v_classification_id,
      debit = 0,
      credit = v_amount,
      memo = v_description
    where journal_entry_id = v_entry_id
      and credit > 0;
  end if;

  update finance.raw_events set
    processing_status = 'processed',
    processing_error = null,
    last_seen_at = pg_catalog.now()
  where id = v_raw_event_id;

  update finance.source_connections set
    last_event_at = greatest(
      coalesce(last_event_at, v_paid_at),
      v_paid_at,
      pg_catalog.now()
    ),
    updated_at = pg_catalog.now()
  where id = v_connection_id;

  if v_created
     or v_existing_order_id is distinct from v_order_id
     or v_existing_session_id is distinct from v_payment_session_id
     or v_existing_classification_id is distinct from v_classification_id
     or v_existing_status is distinct from 'posted'
     or v_existing_reconciliation_status is distinct from v_reconciliation_status then
    insert into finance.audit_log(
      actor,
      action,
      entity_type,
      entity_id,
      before_data,
      after_data,
      request_id
    ) values (
      p_actor,
      case when v_created then 'qrpay_auto_imported' else 'qrpay_auto_synced' end,
      'transaction',
      v_finance_transaction_id::text,
      case when v_created then null else pg_catalog.jsonb_build_object(
        'order_id', v_existing_order_id,
        'payment_session_id', v_existing_session_id,
        'classification_account_id', v_existing_classification_id,
        'status', v_existing_status,
        'reconciliation_status', v_existing_reconciliation_status
      ) end,
      pg_catalog.jsonb_build_object(
        'transaction_id', v_transaction_ref,
        'order_id', v_order_id,
        'payment_session_id', v_payment_session_id,
        'amount', v_amount,
        'status', 'posted',
        'reconciliation_status', v_reconciliation_status
      ),
      'operational-qrpay:' || v_transaction_ref
    );
  end if;

  return v_finance_transaction_id;
end;
$$;

create or replace function finance.capture_operational_qrpay()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := pg_catalog.to_jsonb(new);
  v_transaction_ref text := nullif(pg_catalog.btrim(v_row ->> 'transaction_id'), '');
  v_provider text := pg_catalog.lower(coalesce(nullif(pg_catalog.btrim(v_row ->> 'provider'), ''), ''));
begin
  if v_transaction_ref is null
     or v_provider not in ('qrpay', 'qrpay_ai', 'duitnow', 'finance-qrpay') then
    return new;
  end if;

  perform finance.sync_operational_qrpay(
    v_transaction_ref,
    v_provider,
    nullif(v_row ->> 'amount', '')::numeric,
    nullif(v_row ->> 'paid_at', '')::timestamptz,
    v_row ->> 'sender_name',
    coalesce(v_row -> 'raw_payload', v_row -> 'raw', '{}'::jsonb),
    nullif(v_row ->> 'order_id', '')::uuid,
    nullif(v_row ->> 'payment_session_id', '')::uuid,
    'operational-qrpay-trigger'
  );
  return new;
exception when others then
  -- Finance must never roll back an otherwise valid order payment webhook.
  begin
    insert into finance.audit_log(
      actor,
      action,
      entity_type,
      entity_id,
      after_data,
      request_id
    ) values (
      'operational-qrpay-trigger',
      'qrpay_auto_sync_failed',
      tg_table_schema || '.' || tg_table_name,
      v_transaction_ref,
      pg_catalog.jsonb_build_object(
        'sqlstate', sqlstate,
        'error', sqlerrm,
        'provider', v_provider
      ),
      case when v_transaction_ref is null then null else 'operational-qrpay:' || v_transaction_ref end
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

revoke all on function finance.sync_operational_qrpay(text,text,numeric,timestamptz,text,jsonb,uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function finance.capture_operational_qrpay()
  from public, anon, authenticated;
grant execute on function finance.sync_operational_qrpay(text,text,numeric,timestamptz,text,jsonb,uuid,uuid,text)
  to service_role;

drop trigger if exists trg_finance_capture_qrpay_payment on public.payment_transactions;
create trigger trg_finance_capture_qrpay_payment
after insert or update on public.payment_transactions
for each row execute function finance.capture_operational_qrpay();

drop trigger if exists trg_finance_capture_qrpay_unmatched on public.unmatched_payment_transactions;
create trigger trg_finance_capture_qrpay_unmatched
after insert or update on public.unmatched_payment_transactions
for each row execute function finance.capture_operational_qrpay();

comment on function finance.sync_operational_qrpay(text,text,numeric,timestamptz,text,jsonb,uuid,uuid,text)
  is 'Idempotently mirrors the canonical operational QRPay webhook record into Finance and updates the same transaction when order matching changes.';
comment on function finance.capture_operational_qrpay()
  is 'Failure-isolated trigger bridge from operational QRPay tables into the private Finance ledger.';

-- One-time catch-up: prefer a matched row when a temporary unmatched copy exists.
do $$
declare
  r record;
begin
  for r in
    with operational_qrpay as (
      select
        pt.transaction_id,
        pt.provider,
        pt.amount,
        pt.paid_at,
        pt.sender_name,
        pt.raw_payload,
        pt.order_id,
        pt.payment_session_id,
        1 as source_priority,
        pt.created_at
      from public.payment_transactions pt
      where pg_catalog.lower(coalesce(pt.provider, '')) in ('qrpay', 'qrpay_ai', 'duitnow', 'finance-qrpay')
        and nullif(pg_catalog.btrim(pt.transaction_id), '') is not null
        and pt.amount > 0

      union all

      select
        upt.transaction_id,
        upt.provider,
        upt.amount,
        upt.paid_at,
        upt.sender_name,
        coalesce(upt.raw_payload, upt.raw, '{}'::jsonb),
        null::uuid,
        null::uuid,
        2 as source_priority,
        upt.created_at
      from public.unmatched_payment_transactions upt
      where pg_catalog.lower(coalesce(upt.provider, '')) in ('qrpay', 'qrpay_ai', 'duitnow', 'finance-qrpay')
        and nullif(pg_catalog.btrim(upt.transaction_id), '') is not null
        and upt.amount > 0
    ), canonical as (
      select distinct on (transaction_id)
        transaction_id,
        provider,
        amount,
        paid_at,
        sender_name,
        raw_payload,
        order_id,
        payment_session_id
      from operational_qrpay
      order by transaction_id, source_priority, created_at desc nulls last
    )
    select * from canonical order by paid_at nulls last, transaction_id
  loop
    perform finance.sync_operational_qrpay(
      r.transaction_id,
      r.provider,
      r.amount,
      r.paid_at,
      r.sender_name,
      r.raw_payload,
      r.order_id,
      r.payment_session_id,
      'operational-qrpay-backfill'
    );
  end loop;
end;
$$;
