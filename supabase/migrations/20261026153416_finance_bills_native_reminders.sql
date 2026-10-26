-- Owner-only Accounts Payable and operational reminders. No new public table access.
create table finance.bill_suppliers (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 200),
 email text, phone text, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index bill_suppliers_name_uq on finance.bill_suppliers(lower(trim(name)));
create table finance.bill_schedules (
 id uuid primary key default gen_random_uuid(), code text unique, title text not null check(length(trim(title)) between 3 and 200),
 kind text not null check(kind in ('bill','reminder')), supplier_id uuid references finance.bill_suppliers,
 expense_account_id bigint references finance.accounts, subtotal numeric(16,2) not null default 0 check(subtotal>=0),
 tax_amount numeric(16,2) not null default 0 check(tax_amount>=0), currency text not null default 'MYR' check(currency='MYR'),
 frequency text not null check(frequency in ('monthly','quarterly','yearly')), anchor_day int not null check(anchor_day between 1 and 31),
 next_due_date date not null, reminder_days int not null default 3 check(reminder_days between 0 and 30),
 payment_method text not null default '', payment_url text not null default '' check(payment_url='' or payment_url ~ '^https://'),
 notes text not null default '', reminder_enabled boolean not null default true, is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((kind='bill' and subtotal+tax_amount>0 and expense_account_id is not null) or (kind='reminder' and subtotal=0 and tax_amount=0))
);
create index bill_schedules_due_idx on finance.bill_schedules(next_due_date) where is_active;
create index bill_schedules_supplier_idx on finance.bill_schedules(supplier_id);
create index bill_schedules_expense_idx on finance.bill_schedules(expense_account_id);
create table finance.bills (
 id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
 title text not null check(length(trim(title)) between 3 and 200), kind text not null check(kind in ('bill','reminder')),
 supplier_id uuid references finance.bill_suppliers, schedule_id uuid references finance.bill_schedules,
 invoice_number text, issue_date date not null, due_date date not null check(due_date>=issue_date),
 expense_account_id bigint references finance.accounts, subtotal numeric(16,2) not null default 0 check(subtotal>=0),
 tax_amount numeric(16,2) not null default 0 check(tax_amount>=0), total numeric(16,2) generated always as (subtotal+tax_amount) stored,
 currency text not null default 'MYR' check(currency='MYR'), status text not null default 'draft' check(status in ('draft','open','paid','void')),
 reminder_enabled boolean not null default true, reminder_days int not null default 3 check(reminder_days between 0 and 30),
 payment_method text not null default '', payment_url text not null default '' check(payment_url='' or payment_url ~ '^https://'),
 document_url text not null default '' check(document_url='' or document_url ~ '^https://'), notes text not null default '',
 journal_entry_id bigint references finance.journal_entries, version int not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((kind='bill' and subtotal+tax_amount>0 and expense_account_id is not null) or (kind='reminder' and subtotal=0 and tax_amount=0)),
 unique(schedule_id,due_date)
);
create unique index bills_supplier_invoice_uq on finance.bills(supplier_id,lower(trim(invoice_number)))
 where nullif(trim(invoice_number),'') is not null and status<>'void';
create index bills_due_status_idx on finance.bills(status,due_date);
create index bills_supplier_idx on finance.bills(supplier_id);
create index bills_expense_idx on finance.bills(expense_account_id);
create index bills_journal_idx on finance.bills(journal_entry_id);
create table finance.bill_payments (
 id uuid primary key default gen_random_uuid(), bill_id uuid not null references finance.bills,
 transaction_id bigint not null references finance.transactions, journal_entry_id bigint not null references finance.journal_entries,
 amount numeric(16,2) not null check(amount>0), paid_date date not null,
 method text not null, reference text not null, notes text not null default '', source text not null check(source in ('manual','bank_feed')),
 status text not null default 'posted' check(status in ('posted','reversed')), request_key uuid not null unique,
 created_by text not null, created_at timestamptz not null default now(), reversed_at timestamptz, reversal_reason text
);
create index bill_payments_bill_idx on finance.bill_payments(bill_id);
create index bill_payments_tx_idx on finance.bill_payments(transaction_id);
create index bill_payments_journal_idx on finance.bill_payments(journal_entry_id);
create table finance.bill_reminder_runs (
 id uuid primary key default gen_random_uuid(), bill_id uuid not null references finance.bills,
 stage text not null check(stage in ('advance','due')), scheduled_date date not null,
 queue_id uuid references public.notification_queue, status text not null check(status in ('queued','blocked','skipped')),
 reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(bill_id,stage)
);
create index bill_reminder_queue_idx on finance.bill_reminder_runs(queue_id);
create index bill_reminder_bill_idx on finance.bill_reminder_runs(bill_id,scheduled_date);
create table finance.billing_settings (
 singleton boolean primary key default true check(singleton), enabled boolean not null default true,
 send_hour int not null default 9 check(send_hour between 0 and 23), timezone text not null default 'Asia/Kuala_Lumpur' check(timezone='Asia/Kuala_Lumpur'),
 updated_at timestamptz not null default now()
);
insert into finance.billing_settings(singleton) values(true);
alter table finance.bill_suppliers enable row level security;
alter table finance.bill_schedules enable row level security;
alter table finance.bills enable row level security;
alter table finance.bill_payments enable row level security;
alter table finance.bill_reminder_runs enable row level security;
alter table finance.billing_settings enable row level security;
revoke all on finance.bill_suppliers,finance.bill_schedules,finance.bills,finance.bill_payments,finance.bill_reminder_runs,finance.billing_settings from public,anon,authenticated;
grant all on finance.bill_suppliers,finance.bill_schedules,finance.bills,finance.bill_payments,finance.bill_reminder_runs,finance.billing_settings to service_role;
grant usage,select on sequence finance.bills_number_seq to service_role;

insert into finance.accounts(code,name,account_type,account_subtype) values
 ('2200-ACCOUNTS-PAYABLE','Supplier Bills Payable','liability','accounts_payable'),
 ('5070-SUBSCRIPTIONS','Software & Subscriptions','expense','operating'),
 ('5071-UTILITIES','Utilities & Rent','expense','operating') on conflict(code) do nothing;

create function finance.billing_open_period(p_date date) returns void language plpgsql set search_path='' as $$
begin
 if exists(select 1 from finance.period_closings where status='closed' and p_date between period_start and period_end) then
  raise exception 'Accounting period is closed';
 end if;
end $$;

create function finance.billing_next_date(p_date date,p_frequency text,p_anchor int) returns date language sql immutable set search_path='' as $$
 select (date_trunc('month',p_date)+make_interval(months=>case p_frequency when 'yearly' then 12 when 'quarterly' then 3 else 1 end)
  + (least(p_anchor,extract(day from (date_trunc('month',p_date)+make_interval(months=>case p_frequency when 'yearly' then 13 when 'quarterly' then 4 else 2 end)-interval '1 day'))::int)-1)*interval '1 day')::date
$$;

create function finance.billing_supplier(p_name text) returns uuid language plpgsql set search_path='' as $$
declare v_id uuid;
begin
 if nullif(trim(p_name),'') is null then return null; end if;
 insert into finance.bill_suppliers(name) values(trim(p_name)) on conflict(lower(trim(name))) do update set updated_at=now() returning id into v_id;
 return v_id;
end $$;

-- One service-only mutation contract. Actor comes from the authenticated gateway.
create function public.finance_billing_action(p_action text,p_payload jsonb default '{}',p_actor text default 'admin1')
returns jsonb language plpgsql set search_path='' as $$
declare
 b finance.bills; s finance.bill_schedules; pay finance.bill_payments; tx finance.transactions;
 v_id uuid; v_supplier uuid; v_account bigint; v_ap bigint; v_cash bigint; v_entry bigint; v_tx bigint;
 v_amount numeric; v_paid numeric; v_allocated numeric; v_before jsonb; v_date date; v_journal_date date;
 v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
 if current_user not in ('postgres','service_role') then raise insufficient_privilege using message='Finance service required'; end if;
 if jsonb_typeof(p_payload)<>'object' then raise exception 'Object payload required'; end if;
 select id into strict v_ap from finance.accounts where code='2200-ACCOUNTS-PAYABLE';
 if p_action in ('save_bill','save_schedule') then
  v_supplier:=finance.billing_supplier(p_payload->>'supplier');
  if p_payload->>'kind'='bill' then
   select id into v_account from finance.accounts where code=p_payload->>'expense_code' and account_type='expense' and is_active;
   if v_account is null then raise exception 'Choose an active expense category'; end if;
   if v_supplier is null then raise exception 'Supplier required for a bill'; end if;
  end if;
  v_date:=(p_payload->>'due_date')::date;
  if v_date is null then raise exception 'Due date required'; end if;
  if char_length(coalesce(p_payload->>'notes',''))>4000 then raise exception 'Notes too long'; end if;
  if p_action='save_schedule' then
   v_id:=nullif(p_payload->>'id','')::uuid;
   if v_id is not null then
    select * into strict s from finance.bill_schedules where id=v_id for update;
    if (p_payload->>'updated_at')::timestamptz is distinct from s.updated_at then raise exception 'Record changed; refresh before editing'; end if;
    v_before:=to_jsonb(s);
   end if;
   insert into finance.bill_schedules(id,title,kind,supplier_id,expense_account_id,subtotal,tax_amount,frequency,anchor_day,next_due_date,
    reminder_days,payment_method,payment_url,notes,reminder_enabled,is_active)
   values(coalesce(v_id,gen_random_uuid()),trim(p_payload->>'title'),p_payload->>'kind',v_supplier,v_account,
    case when p_payload->>'kind'='bill' then (p_payload->>'subtotal')::numeric else 0 end,
    case when p_payload->>'kind'='bill' then coalesce((p_payload->>'tax_amount')::numeric,0) else 0 end,
    p_payload->>'frequency',coalesce((p_payload->>'anchor_day')::int,extract(day from v_date)::int),v_date,
    coalesce((p_payload->>'reminder_days')::int,3),coalesce(p_payload->>'payment_method',''),coalesce(p_payload->>'payment_url',''),
    coalesce(p_payload->>'notes',''),coalesce((p_payload->>'reminder_enabled')::boolean,true),coalesce((p_payload->>'is_active')::boolean,true))
   on conflict(id) do update set title=excluded.title,kind=excluded.kind,supplier_id=excluded.supplier_id,expense_account_id=excluded.expense_account_id,
    subtotal=excluded.subtotal,tax_amount=excluded.tax_amount,frequency=excluded.frequency,anchor_day=excluded.anchor_day,next_due_date=excluded.next_due_date,
    reminder_days=excluded.reminder_days,payment_method=excluded.payment_method,payment_url=excluded.payment_url,notes=excluded.notes,
    reminder_enabled=excluded.reminder_enabled,is_active=excluded.is_active,updated_at=clock_timestamp() returning * into s;
   insert into finance.audit_log(actor,action,entity_type,entity_id,before_data,after_data)
    values(p_actor,p_action,'bill_schedule',s.id::text,v_before,to_jsonb(s));
   return to_jsonb(s);
  end if;
  v_id:=nullif(p_payload->>'id','')::uuid;
  if v_id is not null then
   select * into strict b from finance.bills where id=v_id for update;
   if b.status<>'draft' then raise exception 'Only draft bills can be edited; void approved bills for correction'; end if;
   if (p_payload->>'version')::int is distinct from b.version then raise exception 'Record changed; refresh before editing'; end if;
   v_before:=to_jsonb(b);
  end if;
  insert into finance.bills(id,title,kind,supplier_id,invoice_number,issue_date,due_date,expense_account_id,subtotal,tax_amount,
   reminder_days,payment_method,payment_url,document_url,notes,reminder_enabled)
  values(coalesce(v_id,gen_random_uuid()),trim(p_payload->>'title'),p_payload->>'kind',v_supplier,nullif(trim(p_payload->>'invoice_number'),''),
   coalesce(nullif(p_payload->>'issue_date','')::date,v_today),v_date,v_account,
   case when p_payload->>'kind'='bill' then (p_payload->>'subtotal')::numeric else 0 end,
   case when p_payload->>'kind'='bill' then coalesce((p_payload->>'tax_amount')::numeric,0) else 0 end,
   coalesce((p_payload->>'reminder_days')::int,3),coalesce(p_payload->>'payment_method',''),coalesce(p_payload->>'payment_url',''),
   coalesce(p_payload->>'document_url',''),coalesce(p_payload->>'notes',''),coalesce((p_payload->>'reminder_enabled')::boolean,true))
  on conflict(id) do update set title=excluded.title,kind=excluded.kind,supplier_id=excluded.supplier_id,invoice_number=excluded.invoice_number,
   issue_date=excluded.issue_date,due_date=excluded.due_date,expense_account_id=excluded.expense_account_id,subtotal=excluded.subtotal,tax_amount=excluded.tax_amount,
   reminder_days=excluded.reminder_days,payment_method=excluded.payment_method,payment_url=excluded.payment_url,document_url=excluded.document_url,
   notes=excluded.notes,reminder_enabled=excluded.reminder_enabled,version=finance.bills.version+1,updated_at=clock_timestamp() returning * into b;
  insert into finance.audit_log(actor,action,entity_type,entity_id,before_data,after_data) values(p_actor,p_action,'bill',b.id::text,v_before,to_jsonb(b));
  return to_jsonb(b);
 end if;
 if p_action='toggle_schedule' then
  select * into strict s from finance.bill_schedules where id=(p_payload->>'id')::uuid for update;
  v_before:=to_jsonb(s);
  update finance.bill_schedules set is_active=(p_payload->>'is_active')::boolean,updated_at=clock_timestamp() where id=s.id returning * into s;
  insert into finance.audit_log(actor,action,entity_type,entity_id,before_data,after_data) values(p_actor,p_action,'bill_schedule',s.id::text,v_before,to_jsonb(s));
  return to_jsonb(s);
 end if;
 if p_action='save_settings' then
  update finance.billing_settings set enabled=coalesce((p_payload->>'enabled')::boolean,enabled),send_hour=coalesce((p_payload->>'send_hour')::int,send_hour),updated_at=now();
  insert into finance.audit_log(actor,action,entity_type,entity_id,after_data) values(p_actor,p_action,'billing_settings','true',p_payload);
  return (select to_jsonb(x) from finance.billing_settings x);
 end if;
 if p_action='save_supplier' then
  v_id:=finance.billing_supplier(p_payload->>'name');
  update finance.bill_suppliers set email=nullif(p_payload->>'email',''),phone=nullif(p_payload->>'phone',''),notes=p_payload->>'notes',updated_at=now() where id=v_id;
  insert into finance.audit_log(actor,action,entity_type,entity_id,after_data) values(p_actor,p_action,'bill_supplier',v_id::text,p_payload);
  return jsonb_build_object('id',v_id);
 end if;
 if p_action='reverse_payment' then
  select * into strict pay from finance.bill_payments where id=(p_payload->>'id')::uuid;
  select * into strict b from finance.bills where id=pay.bill_id for update;
  select * into strict pay from finance.bill_payments where id=pay.id for update;
  if pay.status='reversed' then return to_jsonb(pay); end if;
  if length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'Reversal reason required'; end if;
  select entry_date into v_journal_date from finance.journal_entries where id=pay.journal_entry_id;
  perform finance.billing_open_period(v_journal_date);
  update finance.bill_payments set status='reversed',reversed_at=now(),reversal_reason=p_payload->>'reason' where id=pay.id;
  update finance.journal_entries set status='reversed' where id=pay.journal_entry_id;
  if pay.source='manual' then update finance.transactions set status='void',updated_at=now() where id=pay.transaction_id; end if;
  update finance.bills set status='open',version=version+1,updated_at=now() where id=b.id;
  insert into finance.audit_log(actor,action,entity_type,entity_id,before_data,after_data) values(p_actor,p_action,'bill_payment',pay.id::text,to_jsonb(pay),p_payload);
  return jsonb_build_object('id',pay.id,'status','reversed');
 end if;
 select * into strict b from finance.bills where id=(p_payload->>'id')::uuid for update;
 v_before:=to_jsonb(b);
 if p_action='approve' then
  if b.status='open' then return to_jsonb(b); end if;
  if b.status<>'draft' then raise exception 'Only drafts can be approved'; end if;
  if b.kind='bill' then
   perform finance.billing_open_period(b.issue_date);
   insert into finance.journal_entries(entry_date,description,status,source_type,source_reference,posted_by)
   values(b.issue_date,b.title,'draft','supplier_bill',b.id::text,p_actor) returning id into v_entry;
   insert into finance.journal_lines(journal_entry_id,account_id,debit,credit,memo) values
    (v_entry,b.expense_account_id,b.total,0,'Supplier bill, tax included'),(v_entry,v_ap,0,b.total,'Accounts payable');
   update finance.journal_entries set status='posted',posted_at=now() where id=v_entry;
  end if;
  update finance.bills set status='open',journal_entry_id=v_entry,version=version+1,updated_at=now() where id=b.id returning * into b;
 elsif p_action='complete' then
  if b.kind<>'reminder' or b.status<>'open' then raise exception 'Only open check reminders can be completed'; end if;
  update finance.bills set status='paid',version=version+1,updated_at=now() where id=b.id returning * into b;
 elsif p_action='void' then
  if b.status='void' then return to_jsonb(b); end if;
  if exists(select 1 from finance.bill_payments where bill_id=b.id and status='posted') then raise exception 'Reverse payments before voiding'; end if;
  if length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'Void reason required'; end if;
  if b.journal_entry_id is not null then
   perform finance.billing_open_period(b.issue_date);
   update finance.journal_entries set status='reversed' where id=b.journal_entry_id;
  end if;
  update finance.bills set status='void',version=version+1,updated_at=now() where id=b.id returning * into b;
 elsif p_action='pay' then
  select * into pay from finance.bill_payments where request_key=(p_payload->>'request_key')::uuid;
  if found then
   if pay.bill_id<>b.id then raise exception 'Payment request belongs to a different bill'; end if;
   return to_jsonb(pay);
  end if;
  if b.kind<>'bill' or b.status<>'open' then raise exception 'Only approved outstanding bills can be paid'; end if;
  v_amount:=round((p_payload->>'amount')::numeric,2); v_date:=(p_payload->>'paid_date')::date;
  if v_amount is null or v_amount<=0 or v_date is null or v_date>v_today then raise exception 'Valid payment amount and date required'; end if;
  if nullif(trim(p_payload->>'reference'),'') is null or nullif(trim(p_payload->>'method'),'') is null then raise exception 'Payment method and reference required'; end if;
  perform finance.billing_open_period(v_date);
  select coalesce(sum(amount),0) into v_paid from finance.bill_payments where bill_id=b.id and status='posted';
  if v_amount>b.total-v_paid then raise exception 'Payment exceeds outstanding balance'; end if;
  v_tx:=nullif(p_payload->>'transaction_id','')::bigint;
  if v_tx is not null then
   select * into strict tx from finance.transactions where id=v_tx for update;
   if tx.direction<>'out' or tx.status<>'posted' or tx.currency<>b.currency or tx.order_id is not null or tx.duplicate_of_transaction_id is not null or tx.reconciliation_status='possible_duplicate' then raise exception 'Choose a posted outgoing bank transaction without order/duplicate conflicts'; end if;
   if tx.classification_account_id is null or not exists(select 1 from finance.accounts where id=tx.classification_account_id and account_type='expense') then raise exception 'Bank transaction must have an expense category before allocation'; end if;
   if not exists(select 1 from finance.journal_entries e join finance.journal_lines l on l.journal_entry_id=e.id where e.transaction_id=tx.id and e.status='posted' and l.account_id=tx.classification_account_id and l.debit=tx.amount) then raise exception 'Bank transaction journal is missing or changed'; end if;
   select coalesce(sum(amount),0) into v_allocated from finance.bill_payments where transaction_id=tx.id and status='posted';
   if v_amount>tx.amount-v_allocated then raise exception 'Allocation exceeds available bank transaction amount'; end if;
   -- Bank feed already expensed this cash movement. Reclassify only allocated amount to AP.
   insert into finance.journal_entries(entry_date,description,status,source_type,source_reference,posted_by)
    values(v_date,'Bill payment allocation: '||b.title,'draft','bill_payment_allocation',b.id::text,p_actor) returning id into v_entry;
   insert into finance.journal_lines(journal_entry_id,account_id,debit,credit,memo) values
    (v_entry,v_ap,v_amount,0,'Settle supplier payable'),(v_entry,tx.classification_account_id,0,v_amount,'Expense already recognized on bill approval');
   update finance.journal_entries set status='posted',posted_at=now() where id=v_entry;
  else
   select id into v_cash from finance.accounts where code=p_payload->>'account_code' and account_type='asset' and currency=b.currency and is_active
    and account_subtype in ('bank','cash','wallet');
   if v_cash is null then raise exception 'Choose a cash or bank payment account'; end if;
   insert into finance.transactions(account_id,direction,amount,currency,occurred_at,description,counterparty,bank_reference,status,reconciliation_status,classification_account_id,metadata)
    values(v_cash,'out',v_amount,b.currency,v_date::timestamp at time zone 'Asia/Kuala_Lumpur','Bill payment: '||b.title,
     (select name from finance.bill_suppliers where id=b.supplier_id),p_payload->>'reference','posted','confirmed',v_ap,jsonb_build_object('bill_id',b.id,'source','bill_payment')) returning id into v_tx;
   v_entry:=finance.post_transaction(v_tx,p_actor);
  end if;
  insert into finance.bill_payments(bill_id,transaction_id,journal_entry_id,amount,paid_date,method,reference,notes,source,request_key,created_by)
   values(b.id,v_tx,v_entry,v_amount,v_date,p_payload->>'method',p_payload->>'reference',coalesce(p_payload->>'notes',''),
    case when nullif(p_payload->>'transaction_id','') is null then 'manual' else 'bank_feed' end,(p_payload->>'request_key')::uuid,p_actor) returning * into pay;
  update finance.bills set status=case when v_paid+v_amount=total then 'paid' else 'open' end,version=version+1,updated_at=now() where id=b.id returning * into b;
  insert into finance.audit_log(actor,action,entity_type,entity_id,after_data) values(p_actor,'record_payment','bill_payment',pay.id::text,to_jsonb(pay));
 else raise exception 'Unknown billing action';
 end if;
 -- Cancel unsent notices after payment, completion or void; never resubmit old failed messages.
 if b.status in ('paid','void') then
  update public.notification_queue set status='cancelled',decision_reason='bill_closed',processed_at=now()
   where id in(select queue_id from finance.bill_reminder_runs where bill_id=b.id) and status='pending';
 end if;
 insert into finance.audit_log(actor,action,entity_type,entity_id,before_data,after_data) values(p_actor,p_action,'bill',b.id::text,v_before,to_jsonb(b)||jsonb_build_object('reason',p_payload->>'reason'));
 return to_jsonb(b);
end $$;

-- An allocated bank feed must not be silently reclassified, resized or voided elsewhere.
create function finance.billing_guard_transaction() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.amount,new.currency,new.account_id,new.classification_account_id,new.status) is distinct from
    (old.amount,old.currency,old.account_id,old.classification_account_id,old.status)
 and exists(select 1 from finance.bill_payments where transaction_id=old.id and status='posted') then
  raise exception 'Reverse bill payment allocations before changing this bank transaction';
 end if;
 return new;
end $$;
create trigger billing_guard_transaction before update on finance.transactions for each row execute function finance.billing_guard_transaction();

create function public.finance_billing_snapshot(p_filter jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
declare v_result jsonb; v_today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
 if current_user not in ('postgres','service_role') then raise insufficient_privilege using message='Finance service required'; end if;
 with base as (
  select b.*,s.name supplier,a.code expense_code,a.name expense_name,coalesce(p.paid,0) paid_amount,b.total-coalesce(p.paid,0) balance,
   case when b.status='open' and b.kind='bill' and b.due_date<v_today then 'overdue'
    when b.status='open' and coalesce(p.paid,0)>0 then 'partial' when b.kind='reminder' and b.status='paid' then 'checked' else b.status end display_status
  from finance.bills b left join finance.bill_suppliers s on s.id=b.supplier_id left join finance.accounts a on a.id=b.expense_account_id
  left join lateral(select sum(amount) paid from finance.bill_payments where bill_id=b.id and status='posted') p on true
 ), filtered as (
  select * from base where (coalesce(p_filter->>'query','')='' or concat_ws(' ',title,supplier,invoice_number,number::text) ilike '%'||(p_filter->>'query')||'%')
   and (coalesce(p_filter->>'status','all')='all' or display_status=p_filter->>'status' or (p_filter->>'status'='outstanding' and status='open'))
   and (coalesce(p_filter->>'kind','all')='all' or kind=p_filter->>'kind')
 ), page as (select * from filtered order by (status in ('paid','void')),due_date,number desc limit 50 offset greatest(coalesce((p_filter->>'offset')::int,0),0))
 select jsonb_build_object('today',v_today,'rows',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'), 'total',(select count(*) from filtered),
  'kpis',(select jsonb_build_object('outstanding',coalesce(sum(balance) filter(where status='open' and kind='bill'),0),
   'overdue',coalesce(sum(balance) filter(where status='open' and kind='bill' and due_date<v_today),0),
   'due_7_days',coalesce(sum(balance) filter(where status='open' and kind='bill' and due_date between v_today and v_today+7),0),
   'open_reminders',count(*) filter(where status='open' and kind='reminder')) from base),
  'ageing',(select coalesce(jsonb_agg(x),'[]') from (select band,coalesce(sum(balance),0) amount,count(*) count from
   (select balance,case when due_date>=v_today then 'Current' when v_today-due_date<=30 then '1–30 days' when v_today-due_date<=60 then '31–60 days' when v_today-due_date<=90 then '61–90 days' else '90+ days' end band from base where status='open' and kind='bill') y group by band) x)
 ) into v_result;
 return v_result || jsonb_build_object(
  'suppliers',coalesce((select jsonb_agg(s order by s.name) from finance.bill_suppliers s),'[]'),
  'accounts',coalesce((select jsonb_agg(jsonb_build_object('code',code,'name',name,'type',account_type,'subtype',account_subtype)) from finance.accounts where is_active and currency='MYR' and account_type in ('expense','asset')),'[]'),
  'schedules',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('supplier',v.name,'expense_code',a.code) order by s.next_due_date) from finance.bill_schedules s left join finance.bill_suppliers v on v.id=s.supplier_id left join finance.accounts a on a.id=s.expense_account_id),'[]'),
  'settings',(select to_jsonb(x) from finance.billing_settings x),
  'admin_phone',(select text_value from public.whatsapp_settings where key='admin_order_notify_phone' limit 1),
  'reminders',coalesce((select jsonb_agg(x) from (select r.*,b.title,q.status queue_status,q.provider_message_id,q.last_error from finance.bill_reminder_runs r join finance.bills b on b.id=r.bill_id left join public.notification_queue q on q.id=r.queue_id order by r.created_at desc limit 50) x),'[]'),
  'payments',coalesce((select jsonb_agg(x) from (select p.*,b.title from finance.bill_payments p join finance.bills b on b.id=p.bill_id order by p.created_at desc limit 100) x),'[]'),
  'audit',coalesce((select jsonb_agg(x) from (select id,actor,action,entity_type,entity_id,created_at from finance.audit_log where entity_type in ('bill','bill_payment','bill_schedule','bill_supplier','billing_settings') order by id desc limit 50) x),'[]')
 );
end $$;

-- Runs wholly in Postgres. Hourly tick uses Malaysia dates and a stable unique stage key.
create function finance.billing_tick(p_now timestamptz default now(),p_dry_run boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare s finance.bill_schedules; b finance.bills; cfg finance.billing_settings; r finance.bill_reminder_runs;
 v_today date:=(p_now at time zone 'Asia/Kuala_Lumpur')::date; v_hour int:=extract(hour from p_now at time zone 'Asia/Kuala_Lumpur');
 v_phone text; v_enabled text; v_window bool; v_count int:=0; v_generated int:=0; v_blocked int:=0; v_stage text; v_date date;
 v_id uuid; v_queue uuid; v_text text; v_reason text; v_key text; v_next date;
begin
 if current_user not in ('postgres','service_role') then raise insufficient_privilege using message='Finance service required'; end if;
 select * into strict cfg from finance.billing_settings where singleton;
 if p_dry_run then return jsonb_build_object('dry_run',true,'enabled',cfg.enabled,'today',v_today,'send_hour',cfg.send_hour,
  'eligible_schedules',(select count(*) from finance.bill_schedules where is_active and next_due_date<=v_today+31)); end if;
 if not pg_try_advisory_xact_lock(hashtextextended('finance.billing_tick',0)) then return jsonb_build_object('busy',true); end if;
 -- Generate only current/future scheduled occurrences. Old unpaid bills remain separately visible.
 for s in select * from finance.bill_schedules where is_active and next_due_date<=v_today+31 order by next_due_date limit 100 for update skip locked loop
  v_next:=s.next_due_date;
  for j in 1..120 loop
   exit when v_next>v_today+31;
   if v_next>=v_today-7 then
    insert into finance.bills(title,kind,supplier_id,schedule_id,issue_date,due_date,expense_account_id,subtotal,tax_amount,status,
     reminder_days,payment_method,payment_url,notes,reminder_enabled)
    values(s.title,s.kind,s.supplier_id,s.id,least(v_today,v_next),v_next,s.expense_account_id,s.subtotal,s.tax_amount,
     case when s.kind='reminder' then 'open' else 'draft' end,s.reminder_days,s.payment_method,s.payment_url,s.notes,s.reminder_enabled)
    on conflict(schedule_id,due_date) do nothing;
    if found then v_generated:=v_generated+1; end if;
   end if;
   v_next:=finance.billing_next_date(v_next,s.frequency,s.anchor_day);
  end loop;
  update finance.bill_schedules set next_due_date=v_next,updated_at=now() where id=s.id;
 end loop;
 if not cfg.enabled or v_hour<cfg.send_hour then return jsonb_build_object('generated',v_generated,'queued',0,'enabled',cfg.enabled); end if;
 select coalesce(nullif(text_value,''),value::text) into v_enabled from public.whatsapp_settings where key='enabled';
 select text_value into v_phone from public.whatsapp_settings where key='admin_order_notify_phone';
 select coalesce(window_status='open' and window_expires_at>p_now,false) into v_window from public.admin_whatsapp_window_monitor where admin_phone=v_phone;
 for b in select * from finance.bills where status='open' and reminder_enabled and due_date between v_today-7 and v_today+30
  and (schedule_id is null or exists(select 1 from finance.bill_schedules where id=finance.bills.schedule_id and is_active and reminder_enabled))
  order by due_date limit 200 for update skip locked loop
  v_stage:=case when v_today>=b.due_date then 'due' else 'advance' end;
  v_date:=case when v_stage='due' then b.due_date else b.due_date-b.reminder_days end;
  if v_today<v_date or (v_stage='advance' and b.reminder_days=0) then continue; end if;
  select * into r from finance.bill_reminder_runs where bill_id=b.id and stage=v_stage for update;
  if found and r.status in ('queued','skipped') then continue; end if;
  v_reason:=case when lower(coalesce(v_enabled,'')) not in ('true','1','yes','on','enabled') then 'WhatsApp master disabled'
   when coalesce(v_phone,'') !~ '^601[0-9]{8,9}$' then 'Admin phone missing' when not coalesce(v_window,false) then 'WhatsApp 24h window closed; reopen admin chat' else null end;
  if v_reason is not null then
   insert into finance.bill_reminder_runs(bill_id,stage,scheduled_date,status,reason) values(b.id,v_stage,v_date,'blocked',v_reason)
   on conflict(bill_id,stage) do update set status='blocked',reason=excluded.reason,updated_at=now();
   v_blocked:=v_blocked+1; continue;
  end if;
  v_text:='🔔 iCetak • '||case when b.kind='reminder' then 'Peringatan semakan' else 'Bil perlu dibayar' end||E'\n\n'||b.title||
   E'\nTarikh: '||to_char(b.due_date,'DD/MM/YYYY')||case when b.kind='bill' then E'\nBaki: RM'||to_char(b.total-coalesce((select sum(amount) from finance.bill_payments where bill_id=b.id and status='posted'),0),'FM999999999990.00') else '' end||
   case when b.payment_method<>'' then E'\nKaedah bayaran: '||b.payment_method else '' end||
   case when b.notes<>'' then E'\n\n'||b.notes else '' end||case when b.payment_url<>'' then E'\n\nSemak bayaran:\n'||b.payment_url else '' end||
   E'\n\nFinance: https://shop.decocake.my/?admin=v2&page=finance&finance_tab=bills';
  v_key:='finance-bill-reminder:'||b.id||':'||v_stage;
  insert into public.notification_queue(event_type,phone,payload,idempotency_key)
  values('finance_bill_reminder',v_phone,jsonb_build_object('event_type','finance_bill_reminder','phone',v_phone,'mode','auto','text',v_text,
   'vars',jsonb_build_object('bill_id',b.id,'customer_name','Admin iCetak')),v_key)
  on conflict do nothing returning id into v_queue;
  if v_queue is null then select id into v_queue from public.notification_queue where idempotency_key=v_key; end if;
  insert into finance.bill_reminder_runs(bill_id,stage,scheduled_date,queue_id,status) values(b.id,v_stage,v_date,v_queue,'queued')
  on conflict(bill_id,stage) do update set queue_id=excluded.queue_id,status='queued',reason=null,updated_at=now();
  v_count:=v_count+1;
 end loop;
 return jsonb_build_object('generated',v_generated,'queued',v_count,'blocked',v_blocked,'today',v_today);
end $$;

-- Pre-dispatch revalidation also cancels a pending reminder when an invoice is paid/voided/paused.
create function public.finance_billing_dispatch_allowed(p_bill_id uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from finance.bills b cross join finance.billing_settings cfg where b.id=p_bill_id and b.status='open' and b.reminder_enabled and cfg.enabled
  and (b.schedule_id is null or exists(select 1 from finance.bill_schedules s where s.id=b.schedule_id and s.is_active and s.reminder_enabled)))
$$;

do $$ declare r record; begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='finance' and p.proname like 'billing_%') or (n.nspname='public' and p.proname in ('finance_billing_action','finance_billing_snapshot','finance_billing_dispatch_allowed')) loop
  execute format('revoke all on function %s from public,anon,authenticated',r.signature);
  execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end $$;
insert into public.whatsapp_notification_rules(event_type,label,enabled,freeform_text,freeform_enabled,template_enabled,notes)
 values('finance_bill_reminder','Finance • Bills & Reminders',true,'{message}',true,false,'Admin-only native Finance scheduler; respect master and 24h window.') on conflict(event_type) do nothing;

-- Provider-specific reminder records and private billing portal identifiers are
-- configured through the owner-only Finance interface, not distributed in source.
select cron.schedule('icetak-finance-billing-hourly','0 * * * *','select finance.billing_tick();');
