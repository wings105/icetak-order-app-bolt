-- Run as postgres. All supplier/bill/payment/queue/journal fixtures are rolled back.
begin;
do $$
declare b jsonb; b2 jsonb; p jsonb; p2 jsonb; s jsonb; q jsonb; before_count bigint; tx bigint; entry bigint; expense bigint; bank bigint; test_key uuid:=gen_random_uuid(); today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
 if finance.billing_next_date('2027-01-31','monthly',31)<>'2027-02-28' then raise exception 'February clamp'; end if;
 if finance.billing_next_date('2027-02-28','monthly',31)<>'2027-03-31' then raise exception 'Month-end anchor drift'; end if;
 if finance.billing_next_date('2028-02-29','yearly',29)<>'2029-02-28' then raise exception 'Leap-year clamp'; end if;
 b:=public.finance_billing_action('save_bill',jsonb_build_object('title','QA subscription bill','kind','bill','supplier','QA Billing Supplier','expense_code','5070-SUBSCRIPTIONS','subtotal',100,'tax_amount',20,'due_date',today,'issue_date',today,'reminder_enabled',false),'qa');
 if b->>'status'<>'draft' or (b->>'total')::numeric<>120 then raise exception 'Draft total'; end if;
 if exists(select 1 from finance.journal_entries where source_reference=b->>'id') then raise exception 'Draft posted prematurely'; end if;
 begin
  perform public.finance_billing_action('save_bill',b||jsonb_build_object('supplier','QA Billing Supplier','expense_code','5070-SUBSCRIPTIONS','version',0),'qa');
  raise exception 'Expected stale edit denial';
 exception when raise_exception then if sqlerrm='Expected stale edit denial' then raise; end if; end;
 b:=public.finance_billing_action('approve',jsonb_build_object('id',b->>'id'),'qa');
 if b->>'status'<>'open' then raise exception 'Approve state'; end if;
 if (select sum(debit-credit) from finance.journal_lines where journal_entry_id=(b->>'journal_entry_id')::bigint)<>0 then raise exception 'Unbalanced approval'; end if;
 perform public.finance_billing_action('approve',jsonb_build_object('id',b->>'id'),'qa');
 if (select count(*) from finance.journal_entries where source_reference=b->>'id')<>1 then raise exception 'Approval duplicated'; end if;
 q:=jsonb_build_object('id',b->>'id','amount',30,'paid_date',today,'account_code','1000-CIMB','method','Wise','reference','QA-REF','request_key',test_key);
 perform public.finance_billing_action('pay',q,'qa');perform public.finance_billing_action('pay',q,'qa');
 if (select sum(amount) from finance.bill_payments where bill_id=(b->>'id')::uuid and status='posted')<>30 then raise exception 'Payment replay duplicated'; end if;
 begin
  perform public.finance_billing_action('pay',q||jsonb_build_object('amount',100,'request_key',gen_random_uuid()),'qa');
  raise exception 'Expected overpayment denial';
 exception when raise_exception then if sqlerrm='Expected overpayment denial' then raise; end if; end;
 perform public.finance_billing_action('pay',q||jsonb_build_object('amount',90,'request_key',gen_random_uuid()),'qa');
 if (select status from finance.bills where id=(b->>'id')::uuid)<>'paid' then raise exception 'Full payment state'; end if;
 for p in select to_jsonb(x) from finance.bill_payments x where bill_id=(b->>'id')::uuid loop
  perform public.finance_billing_action('reverse_payment',jsonb_build_object('id',p->>'id','reason','QA reversal'),'qa');
 end loop;
 perform public.finance_billing_action('void',jsonb_build_object('id',b->>'id','reason','QA void'),'qa');
 if exists(select 1 from finance.journal_entries where status='posted' and (id=(b->>'journal_entry_id')::bigint or id in(select journal_entry_id from finance.bill_payments where bill_id=(b->>'id')::uuid))) then raise exception 'Void/reversal left active entries'; end if;

 -- Imported bank movement is reclassified to AP, never counted as a second expense.
 b2:=public.finance_billing_action('save_bill',jsonb_build_object('title','QA bank allocation bill','kind','bill','supplier','QA Billing Supplier','expense_code','5070-SUBSCRIPTIONS','subtotal',80,'due_date',today,'reminder_enabled',false),'qa');
 perform public.finance_billing_action('approve',jsonb_build_object('id',b2->>'id'),'qa');
 select id into expense from finance.accounts where code='5070-SUBSCRIPTIONS';select id into bank from finance.accounts where code='1000-CIMB';
 insert into finance.transactions(account_id,direction,amount,occurred_at,classification_account_id,status,reconciliation_status,description)
 values(bank,'out',80,now(),expense,'posted','confirmed','QA imported bank movement') returning id into tx;
 entry:=finance.post_transaction(tx,'qa');
 perform public.finance_billing_action('pay',jsonb_build_object('id',b2->>'id','amount',80,'paid_date',today,'transaction_id',tx,'method','Wise','reference','QA-BANK','request_key',gen_random_uuid()),'qa');
 if (select sum(l.debit-l.credit) from finance.journal_lines l join finance.journal_entries e on e.id=l.journal_entry_id where e.status='posted' and l.account_id=expense and (e.source_reference=b2->>'id' or e.transaction_id=tx))<>80 then raise exception 'Bank allocation doubled expense'; end if;
 begin
  update finance.transactions set amount=81 where id=tx;raise exception 'Expected allocated bank guard';
 exception when raise_exception then if sqlerrm='Expected allocated bank guard' then raise; end if; end;

 -- A check reminder must never enter the accounts-payable ledger.
 b:=public.finance_billing_action('save_bill',jsonb_build_object('title','QA no-value check','kind','reminder','due_date',today,'reminder_days',0,'subtotal',999),'qa');
 perform public.finance_billing_action('approve',jsonb_build_object('id',b->>'id'),'qa');
 if (b->>'total')::numeric<>0 or exists(select 1 from finance.journal_entries where source_reference=b->>'id') then raise exception 'Check posted a liability'; end if;
 update finance.billing_settings set send_hour=0,enabled=true;
 update public.whatsapp_settings set text_value='false' where key='enabled';
 perform finance.billing_tick();
 if not exists(select 1 from finance.bill_reminder_runs where bill_id=(b->>'id')::uuid and status='blocked') then raise exception 'Master guard not logged'; end if;
 update public.whatsapp_settings set text_value='true' where key='enabled';
 update public.admin_whatsapp_window_monitor set window_status='open',window_expires_at=now()+interval '1 day' where admin_phone=(select text_value from public.whatsapp_settings where key='admin_order_notify_phone');
 perform finance.billing_tick();perform finance.billing_tick();
 if (select count(*) from public.notification_queue where idempotency_key='finance-bill-reminder:'||(b->>'id')||':due')<>1 then raise exception 'Reminder duplicated'; end if;
 -- A window expiring between enqueue and dispatch may recover the same unsent job.
 update public.notification_queue set status='cancelled',last_error='billing_window_closed',provider_message_id=null
 where idempotency_key='finance-bill-reminder:'||(b->>'id')||':due';
 perform finance.billing_tick();
 if not exists(select 1 from public.notification_queue where idempotency_key='finance-bill-reminder:'||(b->>'id')||':due' and status='pending') then raise exception 'Closed-window recovery failed'; end if;
 if jsonb_array_length(public.finance_billing_payments((b2->>'id')::uuid))<>1 then raise exception 'Exact bill payment history missing'; end if;
 if not public.finance_billing_dispatch_allowed((b->>'id')::uuid) then raise exception 'Open reminder rejected'; end if;
 perform public.finance_billing_action('complete',jsonb_build_object('id',b->>'id'),'qa');
 if public.finance_billing_dispatch_allowed((b->>'id')::uuid) then raise exception 'Closed reminder allowed'; end if;
 if exists(select 1 from public.notification_queue where idempotency_key='finance-bill-reminder:'||(b->>'id')||':due' and status='pending') then raise exception 'Completed reminder pending'; end if;

 s:=public.finance_billing_action('save_schedule',jsonb_build_object('title','QA recurring bill','kind','bill','supplier','QA Billing Supplier','expense_code','5070-SUBSCRIPTIONS','subtotal',50,'frequency','monthly','due_date',today+1,'anchor_day',31,'reminder_enabled',false),'qa');
 perform finance.billing_tick();perform finance.billing_tick();
 if exists(select 1 from finance.bills where schedule_id=(s->>'id')::uuid and status<>'draft') then raise exception 'Recurring bill auto-approved'; end if;
 if exists(select 1 from finance.bills where schedule_id=(s->>'id')::uuid group by due_date having count(*)>1) then raise exception 'Recurring generation duplicated'; end if;
 perform public.finance_billing_action('toggle_schedule',jsonb_build_object('id',s->>'id','is_active',false),'qa');
 if (select is_active from finance.bill_schedules where id=(s->>'id')::uuid) then raise exception 'Pause failed'; end if;
 q:=public.finance_billing_snapshot('{}');
 if not(q ?& array['kpis','ageing','rows','schedules','payments','reminders','audit']) then raise exception 'Snapshot contract'; end if;
 if (q->>'total')::int<3 then raise exception 'Snapshot missing fixtures'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'finance_billing_%' and has_function_privilege('anon',p.oid,'execute')) then raise exception 'Anon RPC leak'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='finance' and c.relname in('bills','bill_payments','bill_suppliers','bill_schedules','bill_reminder_runs','billing_settings') and not c.relrowsecurity) then raise exception 'RLS missing'; end if;
end $$;
select 'PASS: billing lifecycle, balanced journals, bank allocation, reversals, scheduler guards, recurrence, deduplication, RLS and snapshot' as result;
rollback;
