-- iCetak Finance foundation
-- Additive only: existing Orders, Payments, Shipping, WhatsApp and marketplace flows are not replaced.

create schema if not exists finance;
revoke all on schema finance from public, anon, authenticated;
grant usage on schema finance to service_role;

create table if not exists finance.accounts (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  account_type text not null check (account_type in ('asset','liability','equity','income','expense')),
  account_subtype text,
  currency text not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  opening_balance numeric(16,2) not null default 0,
  opening_balance_at timestamptz,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists finance.source_connections (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9_-]*$'),
  name text not null,
  source_type text not null check (source_type in ('qrpay','bank_webhook','bank_statement','marketplace','manual','legacy')),
  direction_hint text check (direction_hint is null or direction_hint in ('in','out','mixed')),
  target_account_id bigint references finance.accounts(id),
  secret_hash text check (secret_hash is null or secret_hash ~ '^[0-9a-f]{64}$'),
  is_active boolean not null default true,
  last_event_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_source_connections_account_idx on finance.source_connections(target_account_id);

create table if not exists finance.import_batches (
  id bigint generated always as identity primary key,
  source_connection_id bigint not null references finance.source_connections(id),
  external_batch_id text,
  status text not null default 'processing' check (status in ('processing','completed','partial','failed')),
  received_rows integer not null default 0 check (received_rows >= 0),
  processed_rows integer not null default 0 check (processed_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  review_rows integer not null default 0 check (review_rows >= 0),
  error_rows integer not null default 0 check (error_rows >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
create unique index if not exists finance_import_batches_external_uidx
  on finance.import_batches(source_connection_id, external_batch_id)
  where external_batch_id is not null;
create index if not exists finance_import_batches_source_idx on finance.import_batches(source_connection_id, started_at desc);

create table if not exists finance.raw_events (
  id bigint generated always as identity primary key,
  source_connection_id bigint not null references finance.source_connections(id),
  import_batch_id bigint references finance.import_batches(id),
  idempotency_key text not null,
  external_event_id text,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  event_occurred_at timestamptz,
  received_at timestamptz not null default now(),
  headers jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  processing_status text not null default 'received' check (processing_status in ('received','processed','duplicate','needs_mapping','review','error')),
  processing_error text,
  attempt_count integer not null default 1 check (attempt_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(source_connection_id,idempotency_key)
);
create index if not exists finance_raw_events_source_received_idx on finance.raw_events(source_connection_id,received_at desc);
create index if not exists finance_raw_events_status_idx on finance.raw_events(processing_status,received_at desc)
  where processing_status in ('needs_mapping','review','error');
create index if not exists finance_raw_events_batch_idx on finance.raw_events(import_batch_id) where import_batch_id is not null;

create table if not exists finance.transactions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  account_id bigint not null references finance.accounts(id),
  direction text not null check (direction in ('in','out')),
  amount numeric(16,2) not null check (amount > 0),
  currency text not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  occurred_at timestamptz not null,
  settled_at timestamptz,
  description text,
  counterparty text,
  bank_reference text,
  external_reference text,
  status text not null default 'posted' check (status in ('pending','posted','review','void')),
  reconciliation_status text not null default 'source_only' check (reconciliation_status in ('source_only','matched','confirmed','possible_duplicate','unmatched','ignored')),
  classification_account_id bigint references finance.accounts(id),
  order_id uuid references public.orders(id) on delete set null,
  payment_session_id uuid references public.payment_sessions(id) on delete set null,
  marketplace_order_id uuid references public.marketplace_orders(id) on delete set null,
  duplicate_of_transaction_id bigint references finance.transactions(id),
  dedupe_fingerprint text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_transactions_account_date_idx on finance.transactions(account_id,occurred_at desc);
create index if not exists finance_transactions_status_date_idx on finance.transactions(status,reconciliation_status,occurred_at desc);
create index if not exists finance_transactions_order_idx on finance.transactions(order_id) where order_id is not null;
create index if not exists finance_transactions_payment_session_idx on finance.transactions(payment_session_id) where payment_session_id is not null;
create index if not exists finance_transactions_marketplace_order_idx on finance.transactions(marketplace_order_id) where marketplace_order_id is not null;
create index if not exists finance_transactions_reference_idx on finance.transactions(account_id,direction,bank_reference) where bank_reference is not null;
create index if not exists finance_transactions_external_reference_idx on finance.transactions(external_reference) where external_reference is not null;
create index if not exists finance_transactions_review_idx on finance.transactions(occurred_at desc)
  where status='review' or reconciliation_status in ('possible_duplicate','unmatched');

create table if not exists finance.transaction_observations (
  id bigint generated always as identity primary key,
  raw_event_id bigint not null unique references finance.raw_events(id),
  source_connection_id bigint not null references finance.source_connections(id),
  account_id bigint not null references finance.accounts(id),
  external_reference text,
  bank_reference text,
  direction text not null check (direction in ('in','out')),
  amount numeric(16,2) not null check (amount > 0),
  currency text not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  occurred_at timestamptz not null,
  description text,
  counterparty text,
  normalized_payload jsonb not null default '{}'::jsonb,
  parse_confidence numeric(5,4) not null default 1 check (parse_confidence between 0 and 1),
  created_at timestamptz not null default now()
);
create index if not exists finance_observations_source_ref_idx on finance.transaction_observations(source_connection_id,external_reference) where external_reference is not null;
create index if not exists finance_observations_match_idx on finance.transaction_observations(account_id,direction,amount,occurred_at desc);
create index if not exists finance_observations_bank_ref_idx on finance.transaction_observations(account_id,bank_reference) where bank_reference is not null;

create table if not exists finance.transaction_sources (
  transaction_id bigint not null references finance.transactions(id) on delete cascade,
  observation_id bigint not null unique references finance.transaction_observations(id) on delete cascade,
  match_method text not null check (match_method in ('new','exact_external','exact_bank_reference','fuzzy_time','fuzzy_counterparty','manual','legacy')),
  match_confidence numeric(5,4) not null check (match_confidence between 0 and 1),
  is_primary boolean not null default false,
  linked_at timestamptz not null default now(),
  primary key(transaction_id,observation_id)
);
create index if not exists finance_transaction_sources_observation_idx on finance.transaction_sources(observation_id);

create table if not exists finance.payment_allocations (
  id bigint generated always as identity primary key,
  transaction_id bigint not null references finance.transactions(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  payment_session_id uuid references public.payment_sessions(id) on delete set null,
  amount numeric(16,2) not null check (amount > 0),
  status text not null default 'allocated' check (status in ('allocated','reversed')),
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  reversed_at timestamptz
);
create unique index if not exists finance_payment_allocations_tx_session_uidx
  on finance.payment_allocations(transaction_id,payment_session_id)
  where payment_session_id is not null and status='allocated';
create index if not exists finance_payment_allocations_order_idx on finance.payment_allocations(order_id,created_at desc);

create table if not exists finance.expense_allocations (
  id bigint generated always as identity primary key,
  transaction_id bigint not null references finance.transactions(id) on delete cascade,
  expense_account_id bigint not null references finance.accounts(id),
  amount numeric(16,2) not null check (amount > 0),
  supplier text,
  description text,
  tax_amount numeric(16,2) not null default 0 check (tax_amount >= 0),
  created_by text not null default 'system',
  created_at timestamptz not null default now()
);
create index if not exists finance_expense_allocations_tx_idx on finance.expense_allocations(transaction_id);
create index if not exists finance_expense_allocations_account_idx on finance.expense_allocations(expense_account_id,created_at desc);

create table if not exists finance.transfer_pairs (
  id bigint generated always as identity primary key,
  outgoing_transaction_id bigint not null unique references finance.transactions(id),
  incoming_transaction_id bigint not null unique references finance.transactions(id),
  amount numeric(16,2) not null check (amount > 0),
  status text not null default 'matched' check (status in ('suggested','matched','reversed')),
  matched_by text not null default 'system',
  matched_at timestamptz not null default now(),
  check (outgoing_transaction_id <> incoming_transaction_id)
);

create table if not exists finance.journal_entries (
  id bigint generated always as identity primary key,
  transaction_id bigint unique references finance.transactions(id) on delete restrict,
  entry_date date not null,
  description text not null,
  status text not null default 'posted' check (status in ('draft','posted','reversed')),
  source_type text not null default 'transaction',
  source_reference text,
  posted_at timestamptz,
  posted_by text,
  reversed_entry_id bigint references finance.journal_entries(id),
  created_at timestamptz not null default now()
);
create index if not exists finance_journal_entries_date_idx on finance.journal_entries(entry_date desc,status);
create index if not exists finance_journal_entries_reversed_idx on finance.journal_entries(reversed_entry_id) where reversed_entry_id is not null;

create table if not exists finance.journal_lines (
  id bigint generated always as identity primary key,
  journal_entry_id bigint not null references finance.journal_entries(id) on delete cascade,
  account_id bigint not null references finance.accounts(id),
  debit numeric(16,2) not null default 0 check (debit >= 0),
  credit numeric(16,2) not null default 0 check (credit >= 0),
  memo text,
  created_at timestamptz not null default now(),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create index if not exists finance_journal_lines_entry_idx on finance.journal_lines(journal_entry_id);
create index if not exists finance_journal_lines_account_idx on finance.journal_lines(account_id,journal_entry_id);

create table if not exists finance.reconciliation_cases (
  id bigint generated always as identity primary key,
  case_type text not null check (case_type in ('possible_duplicate','unmatched_payment','needs_mapping','transfer_match','shopee_variance')),
  status text not null default 'open' check (status in ('open','resolved','ignored')),
  primary_transaction_id bigint references finance.transactions(id),
  candidate_transaction_id bigint references finance.transactions(id),
  raw_event_id bigint references finance.raw_events(id),
  reason text not null,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  details jsonb not null default '{}'::jsonb,
  resolution text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists finance_reconciliation_open_idx on finance.reconciliation_cases(created_at desc) where status='open';
create index if not exists finance_reconciliation_primary_idx on finance.reconciliation_cases(primary_transaction_id) where primary_transaction_id is not null;
create index if not exists finance_reconciliation_candidate_idx on finance.reconciliation_cases(candidate_transaction_id) where candidate_transaction_id is not null;
create unique index if not exists finance_reconciliation_pair_uidx
  on finance.reconciliation_cases(case_type,least(primary_transaction_id,candidate_transaction_id),greatest(primary_transaction_id,candidate_transaction_id))
  where primary_transaction_id is not null and candidate_transaction_id is not null and status='open';

create table if not exists finance.classification_rules (
  id bigint generated always as identity primary key,
  name text not null,
  priority integer not null default 100,
  is_active boolean not null default true,
  direction text check (direction is null or direction in ('in','out')),
  source_connection_id bigint references finance.source_connections(id),
  description_pattern text,
  counterparty_pattern text,
  min_amount numeric(16,2),
  max_amount numeric(16,2),
  target_account_id bigint not null references finance.accounts(id),
  created_by text not null default 'admin1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_amount is null or min_amount >= 0),
  check (max_amount is null or max_amount >= 0),
  check (min_amount is null or max_amount is null or min_amount <= max_amount)
);
create index if not exists finance_classification_rules_active_idx on finance.classification_rules(priority,id) where is_active;
create index if not exists finance_classification_rules_source_idx on finance.classification_rules(source_connection_id) where source_connection_id is not null;

create table if not exists finance.shopee_settlements (
  id bigint generated always as identity primary key,
  provider text not null default 'shopee',
  settlement_reference text,
  status text not null default 'pending' check (status in ('pending','escrow','released','withdrawn','reconciled','review')),
  currency text not null default 'MYR',
  gross_amount numeric(16,2) not null default 0,
  fee_amount numeric(16,2) not null default 0,
  net_amount numeric(16,2) not null default 0,
  released_at timestamptz,
  bank_received_at timestamptz,
  bank_transaction_id bigint references finance.transactions(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists finance_shopee_settlement_ref_uidx on finance.shopee_settlements(provider,settlement_reference) where settlement_reference is not null;
create index if not exists finance_shopee_settlements_status_idx on finance.shopee_settlements(status,released_at desc);
create index if not exists finance_shopee_settlements_bank_tx_idx on finance.shopee_settlements(bank_transaction_id) where bank_transaction_id is not null;

create table if not exists finance.shopee_settlement_lines (
  id bigint generated always as identity primary key,
  settlement_id bigint references finance.shopee_settlements(id) on delete cascade,
  marketplace_order_id uuid not null unique references public.marketplace_orders(id) on delete restrict,
  order_sn text not null,
  completed_at timestamptz,
  product_subtotal numeric(16,2) not null default 0,
  buyer_paid numeric(16,2) not null default 0,
  shipping_fee numeric(16,2) not null default 0,
  escrow_amount numeric(16,2) not null default 0,
  released_amount numeric(16,2) not null default 0,
  commission_fee numeric(16,2) not null default 0,
  service_fee numeric(16,2) not null default 0,
  transaction_fee numeric(16,2) not null default 0,
  other_fees numeric(16,2) not null default 0,
  settlement_status text,
  released_at timestamptz,
  is_complete boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_shopee_lines_settlement_idx on finance.shopee_settlement_lines(settlement_id) where settlement_id is not null;
create index if not exists finance_shopee_lines_status_idx on finance.shopee_settlement_lines(settlement_status,released_at desc);

create table if not exists finance.wallet_events (
  id bigint generated always as identity primary key,
  wallet_account_id bigint not null references finance.accounts(id),
  event_type text not null check (event_type in ('escrow_hold','wallet_release','fee','ads','loan_disbursement','loan_repayment','withdrawal','refund','adjustment')),
  direction text not null check (direction in ('in','out')),
  amount numeric(16,2) not null check (amount > 0),
  currency text not null default 'MYR',
  occurred_at timestamptz not null,
  external_reference text,
  marketplace_order_id uuid references public.marketplace_orders(id),
  transaction_id bigint references finance.transactions(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists finance_wallet_events_external_uidx on finance.wallet_events(wallet_account_id,event_type,external_reference) where external_reference is not null;
create index if not exists finance_wallet_events_account_date_idx on finance.wallet_events(wallet_account_id,occurred_at desc);
create index if not exists finance_wallet_events_marketplace_idx on finance.wallet_events(marketplace_order_id) where marketplace_order_id is not null;
create index if not exists finance_wallet_events_tx_idx on finance.wallet_events(transaction_id) where transaction_id is not null;

create table if not exists finance.reconciliation_runs (
  id bigint generated always as identity primary key,
  source_connection_id bigint references finance.source_connections(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running','completed','partial','failed')),
  observations_scanned integer not null default 0,
  auto_matched integer not null default 0,
  review_created integer not null default 0,
  errors integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists finance_reconciliation_runs_source_idx on finance.reconciliation_runs(source_connection_id,started_at desc);

create table if not exists finance.period_closings (
  id bigint generated always as identity primary key,
  period_start date not null,
  period_end date not null,
  status text not null default 'open' check (status in ('open','closed','reopened')),
  closed_by text,
  closed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique(period_start,period_end),
  check (period_start <= period_end)
);

create table if not exists finance.audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  created_at timestamptz not null default now()
);
create index if not exists finance_audit_log_entity_idx on finance.audit_log(entity_type,entity_id,created_at desc);
create index if not exists finance_audit_log_actor_idx on finance.audit_log(actor,created_at desc);

-- Private schema is defense-in-depth even though it is not exposed through the Data API.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname='finance' loop
    execute format('alter table finance.%I enable row level security',r.tablename);
    execute format('alter table finance.%I force row level security',r.tablename);
    execute format('revoke all on finance.%I from public, anon, authenticated',r.tablename);
    execute format('grant select,insert,update,delete on finance.%I to service_role',r.tablename);
  end loop;
end $$;
grant usage,select on all sequences in schema finance to service_role;

insert into finance.accounts(code,name,account_type,account_subtype) values
  ('1000-CIMB','CIMB Bank','asset','bank'),
  ('1010-CASH','Cash Counter','asset','cash'),
  ('1020-SHOPEE-ESCROW','Shopee Escrow','asset','marketplace_escrow'),
  ('1030-SHOPEE-WALLET','Shopee Wallet','asset','marketplace_wallet'),
  ('1040-QR-CLEARING','QRPay Clearing','asset','clearing'),
  ('2000-SHOPEE-LOAN','Shopee Loan Payable','liability','loan'),
  ('2100-LOAN','Loans Payable','liability','loan'),
  ('3000-OWNER-EQUITY','Owner Equity','equity','owner'),
  ('3100-OWNER-DRAW','Owner Drawings','equity','drawings'),
  ('4000-SALES','Sales Revenue','income','sales'),
  ('4010-SHIPPING','Shipping Revenue','income','shipping'),
  ('4090-UNCLASS-IN','Unclassified Income','income','suspense'),
  ('5000-COGS','Cost of Goods Sold','expense','cogs'),
  ('5010-COURIER','Courier & Delivery','expense','shipping'),
  ('5020-SHOPEE-FEE','Shopee Platform Fees','expense','marketplace_fee'),
  ('5030-SHOPEE-ADS','Shopee Ads','expense','advertising'),
  ('5040-SALARY','Salary & Wages','expense','payroll'),
  ('5050-MATERIAL','Materials & Supplies','expense','materials'),
  ('5060-LOAN-COST','Loan Interest & Charges','expense','finance_cost'),
  ('5090-UNCLASS-OUT','Unclassified Expense','expense','suspense')
on conflict(code) do update set name=excluded.name,account_type=excluded.account_type,account_subtype=excluded.account_subtype,updated_at=now();

insert into finance.source_connections(slug,name,source_type,direction_hint,target_account_id,secret_hash,metadata)
select 'qrpay-in','QRPay Incoming','qrpay','in',a.id,'aa4188243178a5c8f8607745daa0cd5a2d7ed7f28619edc09c63d60ee57038ab',jsonb_build_object('bridge_existing_payment_matcher',true)
from finance.accounts a where a.code='1000-CIMB'
on conflict(slug) do update set name=excluded.name,target_account_id=excluded.target_account_id,secret_hash=excluded.secret_hash,is_active=true,metadata=excluded.metadata,updated_at=now();

insert into finance.source_connections(slug,name,source_type,direction_hint,target_account_id,secret_hash)
select 'cimb-out','CIMB Outgoing Webhook','bank_webhook','out',a.id,'09a3930451cd69108c8c52d0cdb4b57f09483b5dddcfef1ff37d103ac3521126'
from finance.accounts a where a.code='1000-CIMB'
on conflict(slug) do update set name=excluded.name,target_account_id=excluded.target_account_id,secret_hash=excluded.secret_hash,is_active=true,updated_at=now();

insert into finance.source_connections(slug,name,source_type,direction_hint,target_account_id,secret_hash)
select 'bank-statement','CIMB Bank Statement','bank_statement','mixed',a.id,'1f52f6ca35fbfcd8e19e99de1aad769083479dafc81e2ced1c88a12c31bec201'
from finance.accounts a where a.code='1000-CIMB'
on conflict(slug) do update set name=excluded.name,target_account_id=excluded.target_account_id,secret_hash=excluded.secret_hash,is_active=true,updated_at=now();

insert into finance.source_connections(slug,name,source_type,direction_hint,target_account_id,is_active,metadata)
select 'legacy-payment','Existing Payment Transactions','legacy','in',a.id,false,'{"read_only":true}'::jsonb
from finance.accounts a where a.code='1000-CIMB'
on conflict(slug) do nothing;

insert into finance.source_connections(slug,name,source_type,direction_hint,target_account_id,is_active,metadata)
select 'legacy-unmatched-payment','Existing Unmatched Payments','legacy','in',a.id,false,'{"read_only":true}'::jsonb
from finance.accounts a where a.code='1000-CIMB'
on conflict(slug) do nothing;

insert into finance.source_connections(slug,name,source_type,direction_hint,target_account_id,is_active,metadata)
select 'shopee-financials','Shopee Financial Enrichment','marketplace','mixed',a.id,true,'{"internal_sync":true}'::jsonb
from finance.accounts a where a.code='1030-SHOPEE-WALLET'
on conflict(slug) do update set target_account_id=excluded.target_account_id,is_active=true,updated_at=now();

create or replace function finance.post_transaction(p_transaction_id bigint,p_actor text default 'system')
returns bigint language plpgsql security definer set search_path='' as $$
declare
  v_tx finance.transactions%rowtype;
  v_entry_id bigint;
  v_offset_id bigint;
begin
  select * into v_tx from finance.transactions where id=p_transaction_id for update;
  if not found or v_tx.status not in ('posted','pending') then return null; end if;
  select id into v_entry_id from finance.journal_entries where transaction_id=p_transaction_id;
  if v_entry_id is not null then return v_entry_id; end if;

  if v_tx.classification_account_id is not null then
    v_offset_id:=v_tx.classification_account_id;
  elsif v_tx.direction='in' then
    select id into v_offset_id from finance.accounts where code=case when v_tx.order_id is not null then '4000-SALES' else '4090-UNCLASS-IN' end;
  else
    select id into v_offset_id from finance.accounts where code='5090-UNCLASS-OUT';
  end if;

  insert into finance.journal_entries(transaction_id,entry_date,description,status,source_type,source_reference,posted_at,posted_by)
  values(v_tx.id,(v_tx.occurred_at at time zone 'Asia/Kuala_Lumpur')::date,coalesce(v_tx.description,'Finance transaction'),'posted','transaction',coalesce(v_tx.external_reference,v_tx.bank_reference),now(),p_actor)
  returning id into v_entry_id;

  if v_tx.direction='in' then
    insert into finance.journal_lines(journal_entry_id,account_id,debit,credit,memo) values
      (v_entry_id,v_tx.account_id,v_tx.amount,0,coalesce(v_tx.counterparty,'Incoming funds')),
      (v_entry_id,v_offset_id,0,v_tx.amount,coalesce(v_tx.description,'Income'));
  else
    insert into finance.journal_lines(journal_entry_id,account_id,debit,credit,memo) values
      (v_entry_id,v_offset_id,v_tx.amount,0,coalesce(v_tx.description,'Expense')),
      (v_entry_id,v_tx.account_id,0,v_tx.amount,coalesce(v_tx.counterparty,'Outgoing funds'));
  end if;
  return v_entry_id;
end $$;

create or replace function public.finance_ingest_event(
  p_connection_slug text,
  p_secret_hash text,
  p_idempotency_key text,
  p_external_event_id text,
  p_payload_hash text,
  p_headers jsonb,
  p_payload jsonb,
  p_normalized jsonb,
  p_payment_match jsonb default null,
  p_import_batch_id bigint default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_conn finance.source_connections%rowtype;
  v_raw finance.raw_events%rowtype;
  v_obs_id bigint;
  v_tx_id bigint;
  v_candidate_id bigint;
  v_candidate_score integer;
  v_candidate_count integer;
  v_amount numeric(16,2);
  v_direction text;
  v_occurred timestamptz;
  v_external text;
  v_bank_ref text;
  v_description text;
  v_counterparty text;
  v_currency text;
  v_status text;
  v_recon text;
  v_order_id uuid;
  v_session_id uuid;
  v_classification_id bigint;
  v_match_method text;
  v_confidence numeric(5,4);
begin
  select * into v_conn from finance.source_connections where slug=p_connection_slug and is_active for update;
  if not found or v_conn.secret_hash is null or v_conn.secret_hash<>lower(coalesce(p_secret_hash,'')) then
    raise exception 'unauthorized finance webhook';
  end if;
  if p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid payload hash'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key)='' then raise exception 'missing idempotency key'; end if;
  perform pg_advisory_xact_lock(hashtextextended('finance:'||v_conn.id::text||':'||p_idempotency_key,0));

  insert into finance.raw_events(source_connection_id,import_batch_id,idempotency_key,external_event_id,payload_hash,event_occurred_at,headers,payload)
  values(v_conn.id,p_import_batch_id,p_idempotency_key,nullif(btrim(p_external_event_id),''),p_payload_hash,nullif(p_normalized->>'occurred_at','')::timestamptz,coalesce(p_headers,'{}'::jsonb),p_payload)
  on conflict(source_connection_id,idempotency_key) do update
    set attempt_count=finance.raw_events.attempt_count+1,last_seen_at=now()
  returning * into v_raw;

  select ts.transaction_id into v_tx_id
  from finance.transaction_observations o join finance.transaction_sources ts on ts.observation_id=o.id
  where o.raw_event_id=v_raw.id;
  if v_tx_id is not null then
    update finance.raw_events set processing_status='duplicate',last_seen_at=now() where id=v_raw.id;
    update finance.source_connections set last_event_at=now(),updated_at=now() where id=v_conn.id;
    return jsonb_build_object('success',true,'duplicate',true,'transaction_id',v_tx_id,'raw_event_id',v_raw.id);
  end if;
  if v_raw.attempt_count>1 and v_raw.processing_status in ('needs_mapping','review','error') then
    update finance.source_connections set last_event_at=now(),updated_at=now() where id=v_conn.id;
    return jsonb_build_object('success',true,'duplicate',true,'processing_status',v_raw.processing_status,'raw_event_id',v_raw.id);
  end if;

  begin v_amount:=round((p_normalized->>'amount')::numeric,2); exception when others then v_amount:=null; end;
  v_direction:=lower(coalesce(nullif(p_normalized->>'direction',''),v_conn.direction_hint));
  begin v_occurred:=coalesce(nullif(p_normalized->>'occurred_at','')::timestamptz,now()); exception when others then v_occurred:=now(); end;
  v_external:=nullif(btrim(coalesce(p_normalized->>'external_reference',p_external_event_id)), '');
  v_bank_ref:=nullif(upper(regexp_replace(coalesce(p_normalized->>'bank_reference',''),'[^A-Za-z0-9]','','g')),'');
  v_description:=nullif(btrim(p_normalized->>'description'),'');
  v_counterparty:=nullif(btrim(p_normalized->>'counterparty'),'');
  v_currency:=upper(coalesce(nullif(p_normalized->>'currency',''),'MYR'));

  if v_amount is null or v_amount<=0 or v_direction not in ('in','out') then
    update finance.raw_events set processing_status='needs_mapping',processing_error='amount_or_direction_missing' where id=v_raw.id;
    insert into finance.reconciliation_cases(case_type,raw_event_id,reason,details)
    values('needs_mapping',v_raw.id,'Webhook payload needs field mapping',jsonb_build_object('normalized',p_normalized))
    on conflict do nothing;
    update finance.source_connections set last_event_at=now(),updated_at=now() where id=v_conn.id;
    return jsonb_build_object('success',true,'accepted',true,'needs_mapping',true,'raw_event_id',v_raw.id);
  end if;

  insert into finance.transaction_observations(raw_event_id,source_connection_id,account_id,external_reference,bank_reference,direction,amount,currency,occurred_at,description,counterparty,normalized_payload,parse_confidence)
  values(v_raw.id,v_conn.id,v_conn.target_account_id,v_external,v_bank_ref,v_direction,v_amount,v_currency,v_occurred,v_description,v_counterparty,p_normalized,coalesce(nullif(p_normalized->>'confidence','')::numeric,1))
  returning id into v_obs_id;

  with scored as (
    select t.id,
      case
        when v_external is not null and t.external_reference=v_external and t.direction=v_direction and t.amount=v_amount then 100
        when v_bank_ref is not null and t.bank_reference=v_bank_ref and t.direction=v_direction and t.amount=v_amount then 99
        when t.direction=v_direction and t.amount=v_amount and t.account_id=v_conn.target_account_id
          and abs(extract(epoch from (t.occurred_at-v_occurred)))<=900 then 92
        when t.direction=v_direction and t.amount=v_amount and t.account_id=v_conn.target_account_id
          and abs(extract(epoch from (t.occurred_at-v_occurred)))<=259200
          and v_counterparty is not null and lower(regexp_replace(coalesce(t.counterparty,''),'[^a-z0-9]','','g'))=lower(regexp_replace(v_counterparty,'[^a-z0-9]','','g')) then 90
        when t.direction=v_direction and t.amount=v_amount and t.account_id=v_conn.target_account_id
          and abs(extract(epoch from (t.occurred_at-v_occurred)))<=259200 then 70
        else 0 end score
    from finance.transactions t
    where t.status<>'void' and t.duplicate_of_transaction_id is null
      and t.account_id=v_conn.target_account_id and t.direction=v_direction and t.amount=v_amount
      and t.occurred_at between v_occurred-interval '3 days' and v_occurred+interval '3 days'
  ), ranked as (select * from scored where score>=70 order by score desc,id)
  select count(*),min(id) filter(where score=(select max(score) from ranked)),max(score)
  into v_candidate_count,v_candidate_id,v_candidate_score from ranked;

  if v_candidate_id is not null and v_candidate_score>=90 then
    v_tx_id:=v_candidate_id;
    v_match_method:=case when v_candidate_score=100 then 'exact_external' when v_candidate_score=99 then 'exact_bank_reference' when v_candidate_score=92 then 'fuzzy_time' else 'fuzzy_counterparty' end;
    v_confidence:=v_candidate_score/100.0;
    insert into finance.transaction_sources(transaction_id,observation_id,match_method,match_confidence,is_primary)
    values(v_tx_id,v_obs_id,v_match_method,v_confidence,false);
    update finance.transactions set
      reconciliation_status=case when v_conn.source_type='bank_statement' then 'confirmed' else 'matched' end,
      status=case when v_conn.source_type='bank_statement' then 'posted' else status end,
      settled_at=case when v_conn.source_type='bank_statement' then coalesce(settled_at,v_occurred) else settled_at end,
      updated_at=now(),metadata=metadata||jsonb_build_object('last_confirmed_source',v_conn.slug)
    where id=v_tx_id;
    update finance.raw_events set processing_status='processed' where id=v_raw.id;
    update finance.source_connections set last_event_at=now(),updated_at=now() where id=v_conn.id;
    return jsonb_build_object('success',true,'duplicate',false,'matched_existing',true,'match_method',v_match_method,'confidence',v_confidence,'transaction_id',v_tx_id,'raw_event_id',v_raw.id);
  end if;

  v_session_id:=nullif(p_payment_match->>'payment_session_id','')::uuid;
  if v_session_id is not null then select order_id into v_order_id from public.payment_sessions where id=v_session_id; end if;
  select id into v_classification_id from finance.accounts
  where code=case when v_direction='in' and v_order_id is not null then '4000-SALES' when v_direction='in' then '4090-UNCLASS-IN' else '5090-UNCLASS-OUT' end;
  v_status:=case when v_candidate_id is not null then 'review' else 'posted' end;
  v_recon:=case when v_candidate_id is not null then 'possible_duplicate' when v_conn.source_type='bank_statement' then 'confirmed' else 'source_only' end;

  insert into finance.transactions(account_id,direction,amount,currency,occurred_at,settled_at,description,counterparty,bank_reference,external_reference,status,reconciliation_status,classification_account_id,order_id,payment_session_id,dedupe_fingerprint,metadata)
  values(v_conn.target_account_id,v_direction,v_amount,v_currency,v_occurred,case when v_conn.source_type='bank_statement' then v_occurred end,v_description,v_counterparty,v_bank_ref,v_external,v_status,v_recon,v_classification_id,v_order_id,v_session_id,p_payload_hash,jsonb_build_object('first_source',v_conn.slug,'payment_match',coalesce(p_payment_match,'null'::jsonb)))
  returning id into v_tx_id;
  insert into finance.transaction_sources(transaction_id,observation_id,match_method,match_confidence,is_primary) values(v_tx_id,v_obs_id,'new',1,true);

  if v_order_id is not null then
    insert into finance.payment_allocations(transaction_id,order_id,payment_session_id,amount,status,created_by)
    values(v_tx_id,v_order_id,v_session_id,v_amount,'allocated','qrpay-webhook') on conflict do nothing;
  end if;

  if v_candidate_id is not null then
    insert into finance.reconciliation_cases(case_type,primary_transaction_id,candidate_transaction_id,raw_event_id,reason,confidence,details)
    values('possible_duplicate',v_candidate_id,v_tx_id,v_raw.id,'Same account, direction and amount within three days',v_candidate_score/100.0,jsonb_build_object('source',v_conn.slug));
  else
    perform finance.post_transaction(v_tx_id,'finance-webhook');
  end if;
  update finance.raw_events set processing_status=case when v_candidate_id is null then 'processed' else 'review' end where id=v_raw.id;
  update finance.source_connections set last_event_at=now(),updated_at=now() where id=v_conn.id;
  return jsonb_build_object('success',true,'duplicate',false,'transaction_id',v_tx_id,'review_required',v_candidate_id is not null,'raw_event_id',v_raw.id);
end $$;

create or replace function finance.backfill_existing_payments() returns jsonb language plpgsql security definer set search_path='' as $$
declare r record; v_conn finance.source_connections%rowtype; v_raw_id bigint; v_obs_id bigint; v_tx_id bigint; v_sales bigint; v_review bigint:=0; v_posted bigint:=0;
begin
  select * into v_conn from finance.source_connections where slug='legacy-payment';
  select id into v_sales from finance.accounts where code='4000-SALES';
  for r in select * from public.payment_transactions order by paid_at,created_at loop
    insert into finance.raw_events(source_connection_id,idempotency_key,external_event_id,payload_hash,event_occurred_at,payload,processing_status)
    values(v_conn.id,'legacy-payment:'||r.id::text,r.transaction_id,encode(extensions.digest(coalesce(r.raw_payload,'{}'::jsonb)::text,'sha256'),'hex'),coalesce(r.paid_at,r.created_at),coalesce(r.raw_payload,'{}'::jsonb),'processed')
    on conflict(source_connection_id,idempotency_key) do update set last_seen_at=finance.raw_events.last_seen_at returning id into v_raw_id;
    select ts.transaction_id into v_tx_id from finance.transaction_observations o join finance.transaction_sources ts on ts.observation_id=o.id where o.raw_event_id=v_raw_id;
    if v_tx_id is null then
      insert into finance.transaction_observations(raw_event_id,source_connection_id,account_id,external_reference,direction,amount,currency,occurred_at,description,counterparty,normalized_payload)
      values(v_raw_id,v_conn.id,v_conn.target_account_id,r.transaction_id,'in',r.amount,'MYR',coalesce(r.paid_at,r.created_at),'Existing QR payment',r.sender_name,jsonb_build_object('provider',r.provider)) returning id into v_obs_id;
      insert into finance.transactions(account_id,direction,amount,currency,occurred_at,settled_at,description,counterparty,external_reference,status,reconciliation_status,classification_account_id,order_id,payment_session_id,dedupe_fingerprint,metadata)
      values(v_conn.target_account_id,'in',r.amount,'MYR',coalesce(r.paid_at,r.created_at),coalesce(r.paid_at,r.created_at),'Existing QR payment',r.sender_name,r.transaction_id,'posted','source_only',v_sales,r.order_id,r.payment_session_id,'legacy-payment:'||r.id::text,jsonb_build_object('provider',r.provider,'legacy_payment_transaction_id',r.id)) returning id into v_tx_id;
      insert into finance.transaction_sources(transaction_id,observation_id,match_method,match_confidence,is_primary) values(v_tx_id,v_obs_id,'legacy',1,true);
      if r.order_id is not null then insert into finance.payment_allocations(transaction_id,order_id,payment_session_id,amount,created_by) values(v_tx_id,r.order_id,r.payment_session_id,r.amount,'legacy-backfill') on conflict do nothing; end if;
      perform finance.post_transaction(v_tx_id,'legacy-backfill'); v_posted:=v_posted+1;
    end if;
  end loop;
  return jsonb_build_object('posted',v_posted,'review',v_review);
end $$;

create or replace function finance.backfill_unmatched_payments() returns jsonb language plpgsql security definer set search_path='' as $$
declare r record; v_conn finance.source_connections%rowtype; v_raw_id bigint; v_obs_id bigint; v_tx_id bigint; v_income bigint; v_count bigint:=0;
begin
  select * into v_conn from finance.source_connections where slug='legacy-unmatched-payment';
  select id into v_income from finance.accounts where code='4090-UNCLASS-IN';
  for r in select * from public.unmatched_payment_transactions where amount>0 order by paid_at,created_at loop
    insert into finance.raw_events(source_connection_id,idempotency_key,external_event_id,payload_hash,event_occurred_at,payload,processing_status)
    values(v_conn.id,'legacy-unmatched:'||r.id::text,r.transaction_id,encode(extensions.digest(coalesce(r.raw_payload,r.raw,'{}'::jsonb)::text,'sha256'),'hex'),coalesce(r.paid_at,r.created_at),coalesce(r.raw_payload,r.raw,'{}'::jsonb),'review')
    on conflict(source_connection_id,idempotency_key) do update set last_seen_at=finance.raw_events.last_seen_at returning id into v_raw_id;
    select ts.transaction_id into v_tx_id from finance.transaction_observations o join finance.transaction_sources ts on ts.observation_id=o.id where o.raw_event_id=v_raw_id;
    if v_tx_id is null then
      insert into finance.transaction_observations(raw_event_id,source_connection_id,account_id,external_reference,direction,amount,currency,occurred_at,description,counterparty,normalized_payload)
      values(v_raw_id,v_conn.id,v_conn.target_account_id,r.transaction_id,'in',r.amount,'MYR',coalesce(r.paid_at,r.created_at),'Unmatched legacy payment',r.sender_name,jsonb_build_object('provider',r.provider)) returning id into v_obs_id;
      insert into finance.transactions(account_id,direction,amount,currency,occurred_at,description,counterparty,external_reference,status,reconciliation_status,classification_account_id,dedupe_fingerprint,metadata)
      values(v_conn.target_account_id,'in',r.amount,'MYR',coalesce(r.paid_at,r.created_at),'Unmatched legacy payment',r.sender_name,r.transaction_id,'review','unmatched',v_income,'legacy-unmatched:'||r.id::text,jsonb_build_object('provider',r.provider,'legacy_unmatched_id',r.id)) returning id into v_tx_id;
      insert into finance.transaction_sources(transaction_id,observation_id,match_method,match_confidence,is_primary) values(v_tx_id,v_obs_id,'legacy',1,true);
      insert into finance.reconciliation_cases(case_type,primary_transaction_id,raw_event_id,reason,details) values('unmatched_payment',v_tx_id,v_raw_id,'Existing payment was not matched to an order',jsonb_build_object('legacy_unmatched_id',r.id));
      v_count:=v_count+1;
    end if;
  end loop;
  return jsonb_build_object('review_created',v_count);
end $$;

create or replace function finance.sync_shopee_financials() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_lines bigint; v_events bigint;
begin
  insert into finance.shopee_settlement_lines(marketplace_order_id,order_sn,completed_at,product_subtotal,buyer_paid,shipping_fee,escrow_amount,released_amount,commission_fee,service_fee,transaction_fee,other_fees,settlement_status,released_at,is_complete,metadata)
  select mo.id,mo.order_sn,case when lower(coalesce(mo.current_status,'')) in ('completed','to receive','delivered') then mo.latest_provider_update_at end,
    coalesce(f.product_subtotal,0),coalesce(f.buyer_paid,0),coalesce(f.shipping_fee,0),coalesce(f.escrow_amount,0),coalesce(f.released_amount,0),coalesce(f.commission_fee,0),coalesce(f.service_fee,0),coalesce(f.transaction_fee,0),coalesce(f.other_fees,0),f.settlement_status,f.released_at,
    (f.released_amount is not null and f.last_enriched_at is not null),jsonb_build_object('provider_payload',coalesce(f.provider_payload,'{}'::jsonb),'payment_method',f.payment_method)
  from public.marketplace_orders mo join public.marketplace_order_financials f on f.order_id=mo.id
  on conflict(marketplace_order_id) do update set
    order_sn=excluded.order_sn,completed_at=excluded.completed_at,product_subtotal=excluded.product_subtotal,buyer_paid=excluded.buyer_paid,shipping_fee=excluded.shipping_fee,escrow_amount=excluded.escrow_amount,released_amount=excluded.released_amount,commission_fee=excluded.commission_fee,service_fee=excluded.service_fee,transaction_fee=excluded.transaction_fee,other_fees=excluded.other_fees,settlement_status=excluded.settlement_status,released_at=excluded.released_at,is_complete=excluded.is_complete,metadata=excluded.metadata,updated_at=now();
  get diagnostics v_lines=row_count;

  insert into finance.wallet_events(wallet_account_id,event_type,direction,amount,occurred_at,external_reference,marketplace_order_id,metadata)
  select a.id,'wallet_release','in',l.released_amount,coalesce(l.released_at,l.updated_at),'shopee-release:'||l.order_sn,l.marketplace_order_id,jsonb_build_object('order_sn',l.order_sn,'settlement_status',l.settlement_status)
  from finance.shopee_settlement_lines l cross join finance.accounts a
  where a.code='1030-SHOPEE-WALLET' and l.released_amount>0
  on conflict(wallet_account_id,event_type,external_reference) where external_reference is not null
  do update set amount=excluded.amount,occurred_at=excluded.occurred_at,metadata=excluded.metadata;
  get diagnostics v_events=row_count;
  return jsonb_build_object('lines_synced',v_lines,'wallet_events_synced',v_events);
end $$;

create or replace function public.finance_admin_snapshot() returns jsonb language sql stable security definer set search_path='' as $$
  with movement as (
    select a.id,a.code,a.name,a.account_type,a.account_subtype,a.opening_balance,
      a.opening_balance+coalesce(sum(case when jl.account_id=a.id then jl.debit-jl.credit else 0 end) filter(where je.status='posted'),0) balance
    from finance.accounts a left join finance.journal_lines jl on jl.account_id=a.id left join finance.journal_entries je on je.id=jl.journal_entry_id
    where a.is_active group by a.id
  ), kpi as (
    select
      coalesce(sum(t.amount) filter(where t.direction='in' and t.status='posted' and t.occurred_at>=date_trunc('month',now())),0) month_in,
      coalesce(sum(t.amount) filter(where t.direction='out' and t.status='posted' and t.occurred_at>=date_trunc('month',now())),0) month_out,
      count(*) filter(where t.status='review' or t.reconciliation_status in ('possible_duplicate','unmatched')) review_transactions
    from finance.transactions t
  ) select jsonb_build_object(
    'kpis',(select to_jsonb(kpi) from kpi),
    'accounts',(select coalesce(jsonb_agg(to_jsonb(m) order by m.account_type,m.code),'[]'::jsonb) from movement m),
    'connections',(select coalesce(jsonb_agg(jsonb_build_object('slug',slug,'name',name,'source_type',source_type,'is_active',is_active,'last_event_at',last_event_at) order by id),'[]'::jsonb) from finance.source_connections where source_type<>'legacy'),
    'reconciliation',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (select id,case_type,status,primary_transaction_id,candidate_transaction_id,reason,confidence,details,created_at from finance.reconciliation_cases where status='open' order by created_at desc limit 50)x),
    'recent_transactions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc),'[]'::jsonb) from (select t.id,t.public_id,t.direction,t.amount,t.currency,t.occurred_at,t.description,t.counterparty,t.status,t.reconciliation_status,t.order_id,a.code account_code,a.name account_name,ca.code classification_code,ca.name classification_name,(select count(*) from finance.transaction_sources s where s.transaction_id=t.id) source_count from finance.transactions t join finance.accounts a on a.id=t.account_id left join finance.accounts ca on ca.id=t.classification_account_id order by t.occurred_at desc limit 100)x),
    'shopee',(select jsonb_build_object('orders',count(*),'released',coalesce(sum(released_amount),0),'fees',coalesce(sum(commission_fee+service_fee+transaction_fee+other_fees),0),'pending',count(*) filter(where not is_complete)) from finance.shopee_settlement_lines),
    'raw_event_status',(select coalesce(jsonb_object_agg(processing_status,n),'{}'::jsonb) from (select processing_status,count(*) n from finance.raw_events group by processing_status)s)
  );
$$;

create or replace function public.finance_admin_transactions(p_limit integer default 100,p_offset integer default 0,p_status text default null,p_direction text default null,p_query text default null,p_from timestamptz default null,p_to timestamptz default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc),'[]'::jsonb),'limit',least(greatest(p_limit,1),500),'offset',greatest(p_offset,0)) from (
    select t.id,t.public_id,t.direction,t.amount,t.currency,t.occurred_at,t.settled_at,t.description,t.counterparty,t.bank_reference,t.external_reference,t.status,t.reconciliation_status,t.order_id,t.payment_session_id,a.code account_code,a.name account_name,ca.code classification_code,ca.name classification_name,o.order_no,(select count(*) from finance.transaction_sources s where s.transaction_id=t.id) source_count
    from finance.transactions t join finance.accounts a on a.id=t.account_id left join finance.accounts ca on ca.id=t.classification_account_id left join public.orders o on o.id=t.order_id
    where (p_status is null or t.status=p_status or t.reconciliation_status=p_status)
      and (p_direction is null or t.direction=p_direction)
      and (p_from is null or t.occurred_at>=p_from) and (p_to is null or t.occurred_at<p_to)
      and (p_query is null or btrim(p_query)='' or coalesce(t.description,'') ilike '%'||p_query||'%' or coalesce(t.counterparty,'') ilike '%'||p_query||'%' or coalesce(t.bank_reference,'') ilike '%'||p_query||'%' or coalesce(t.external_reference,'') ilike '%'||p_query||'%' or coalesce(o.order_no,'') ilike '%'||p_query||'%')
    order by t.occurred_at desc limit least(greatest(p_limit,1),500) offset greatest(p_offset,0)
  )x;
$$;

create or replace function public.finance_admin_report(p_from date,p_to date) returns jsonb language sql stable security definer set search_path='' as $$
  with lines as (
    select a.account_type,a.code,a.name,sum(jl.credit-jl.debit) amount
    from finance.journal_entries je join finance.journal_lines jl on jl.journal_entry_id=je.id join finance.accounts a on a.id=jl.account_id
    where je.status='posted' and je.entry_date between p_from and p_to and a.account_type in ('income','expense') group by a.account_type,a.code,a.name
  ), totals as (select coalesce(sum(amount) filter(where account_type='income'),0) income,coalesce(sum(-amount) filter(where account_type='expense'),0) expense from lines)
  select jsonb_build_object('from',p_from,'to',p_to,'income',(select income from totals),'expense',(select expense from totals),'profit',(select income-expense from totals),'lines',(select coalesce(jsonb_agg(to_jsonb(lines) order by account_type,code),'[]'::jsonb) from lines));
$$;

create or replace function public.finance_admin_sync_shopee() returns jsonb
language sql security definer set search_path='' as $$
  select finance.sync_shopee_financials();
$$;

create or replace function public.finance_admin_classify_transaction(p_transaction_id bigint,p_account_code text,p_actor text default 'admin1') returns jsonb language plpgsql security definer set search_path='' as $$
declare v_tx finance.transactions%rowtype; v_account finance.accounts%rowtype; v_before jsonb;
begin
  select * into v_tx from finance.transactions where id=p_transaction_id for update; if not found then raise exception 'transaction not found'; end if;
  select * into v_account from finance.accounts where code=p_account_code and is_active; if not found then raise exception 'classification account not found'; end if;
  if (v_tx.direction='in' and v_account.account_type<>'income') or (v_tx.direction='out' and v_account.account_type not in ('expense','liability','equity','asset')) then raise exception 'invalid account type for direction'; end if;
  v_before:=to_jsonb(v_tx);
  delete from finance.journal_lines where journal_entry_id in(select id from finance.journal_entries where transaction_id=p_transaction_id);
  delete from finance.journal_entries where transaction_id=p_transaction_id;
  update finance.transactions set classification_account_id=v_account.id,status='posted',updated_at=now() where id=p_transaction_id;
  if v_tx.direction='out' then insert into finance.expense_allocations(transaction_id,expense_account_id,amount,description,created_by) values(p_transaction_id,v_account.id,v_tx.amount,v_tx.description,p_actor); end if;
  perform finance.post_transaction(p_transaction_id,p_actor);
  insert into finance.audit_log(actor,action,entity_type,entity_id,before_data,after_data) values(p_actor,'classify','transaction',p_transaction_id::text,v_before,(select to_jsonb(t) from finance.transactions t where t.id=p_transaction_id));
  return jsonb_build_object('success',true,'transaction_id',p_transaction_id,'classification',v_account.code);
end $$;

create or replace function public.finance_admin_resolve_reconciliation(p_case_id bigint,p_action text,p_actor text default 'admin1',p_notes text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_case finance.reconciliation_cases%rowtype; v_primary finance.transactions%rowtype; v_candidate finance.transactions%rowtype; r record;
begin
  select * into v_case from finance.reconciliation_cases where id=p_case_id and status='open' for update; if not found then raise exception 'open case not found'; end if;
  if p_action='confirm_same' then
    if v_case.primary_transaction_id is null or v_case.candidate_transaction_id is null then raise exception 'case has no transaction pair'; end if;
    select * into v_primary from finance.transactions where id=v_case.primary_transaction_id for update;
    select * into v_candidate from finance.transactions where id=v_case.candidate_transaction_id for update;
    for r in select observation_id,match_method,match_confidence,is_primary from finance.transaction_sources where transaction_id=v_candidate.id loop
      insert into finance.transaction_sources(transaction_id,observation_id,match_method,match_confidence,is_primary) values(v_primary.id,r.observation_id,'manual',1,false) on conflict(observation_id) do update set transaction_id=excluded.transaction_id,match_method='manual',match_confidence=1,is_primary=false;
    end loop;
    update finance.transactions set reconciliation_status='confirmed',status='posted',updated_at=now() where id=v_primary.id;
    update finance.transactions set status='void',reconciliation_status='ignored',duplicate_of_transaction_id=v_primary.id,updated_at=now() where id=v_candidate.id;
    delete from finance.journal_lines where journal_entry_id in(select id from finance.journal_entries where transaction_id=v_candidate.id);
    delete from finance.journal_entries where transaction_id=v_candidate.id;
  elsif p_action='keep_separate' then
    update finance.transactions set status='posted',reconciliation_status=case when reconciliation_status='possible_duplicate' then 'source_only' else reconciliation_status end,updated_at=now() where id in(v_case.primary_transaction_id,v_case.candidate_transaction_id);
    if v_case.candidate_transaction_id is not null then perform finance.post_transaction(v_case.candidate_transaction_id,p_actor); end if;
  elsif p_action='ignore' then
    null;
  else raise exception 'unsupported reconciliation action'; end if;
  update finance.reconciliation_cases set status=case when p_action='ignore' then 'ignored' else 'resolved' end,resolution=p_action||coalesce(': '||nullif(p_notes,''),''),resolved_by=p_actor,resolved_at=now() where id=p_case_id;
  insert into finance.audit_log(actor,action,entity_type,entity_id,after_data) values(p_actor,'resolve_reconciliation','reconciliation_case',p_case_id::text,jsonb_build_object('action',p_action,'notes',p_notes));
  return jsonb_build_object('success',true,'case_id',p_case_id,'action',p_action);
end $$;

-- Only Edge Functions using service_role may call finance RPCs.
revoke execute on function public.finance_ingest_event(text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,bigint) from public,anon,authenticated;
revoke execute on function public.finance_admin_snapshot() from public,anon,authenticated;
revoke execute on function public.finance_admin_transactions(integer,integer,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke execute on function public.finance_admin_report(date,date) from public,anon,authenticated;
revoke execute on function public.finance_admin_sync_shopee() from public,anon,authenticated;
revoke execute on function public.finance_admin_classify_transaction(bigint,text,text) from public,anon,authenticated;
revoke execute on function public.finance_admin_resolve_reconciliation(bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.finance_ingest_event(text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,bigint) to service_role;
grant execute on function public.finance_admin_snapshot() to service_role;
grant execute on function public.finance_admin_transactions(integer,integer,text,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.finance_admin_report(date,date) to service_role;
grant execute on function public.finance_admin_sync_shopee() to service_role;
grant execute on function public.finance_admin_classify_transaction(bigint,text,text) to service_role;
grant execute on function public.finance_admin_resolve_reconciliation(bigint,text,text,text) to service_role;
revoke execute on function finance.post_transaction(bigint,text) from public,anon,authenticated;
revoke execute on function finance.backfill_existing_payments() from public,anon,authenticated;
revoke execute on function finance.backfill_unmatched_payments() from public,anon,authenticated;
revoke execute on function finance.sync_shopee_financials() from public,anon,authenticated;
grant execute on function finance.post_transaction(bigint,text) to service_role;
grant execute on function finance.sync_shopee_financials() to service_role;

-- Finance permissions are deliberately owner-only for the initial rollout.
update public.admin_permissions set permissions=(select array_agg(distinct x order by x) from unnest(coalesce(permissions,'{}'::text[])||array['view_finance','manage_finance'])x)
where username='admin1';

select finance.backfill_existing_payments();
select finance.backfill_unmatched_payments();
select finance.sync_shopee_financials();

comment on schema finance is 'Private iCetak accounting, reconciliation, bank feed and marketplace wallet ledger.';
comment on table finance.raw_events is 'Immutable-ish black-box webhook observations with idempotent retries; payload credentials are stripped by Edge Function.';
comment on table finance.transactions is 'One canonical real-world money movement; multiple observations link through transaction_sources.';
comment on table finance.journal_lines is 'Double-entry posting lines. Application writes only through privileged Finance RPCs.';
