-- Exact-bill history is independent of the global activity page limit.
create function public.finance_billing_payments(p_bill_id uuid) returns jsonb language plpgsql set search_path='' as $$
begin
 if current_user not in ('postgres','service_role') then raise insufficient_privilege using message='Finance service required'; end if;
 return coalesce((select jsonb_agg(p order by p.created_at desc) from finance.bill_payments p where p.bill_id=p_bill_id),'[]');
end $$;
revoke all on function public.finance_billing_payments(uuid) from public,anon,authenticated;
grant execute on function public.finance_billing_payments(uuid) to service_role;
insert into finance.accounts(code,name,account_type,account_subtype) values('1050-WISE','Wise','asset','bank') on conflict(code) do nothing;

-- Correct the Admin deep link and safely recover only a queue cancelled before
-- any provider send because its WhatsApp window had just expired.
do $$ declare src text; begin
 src:=pg_get_functiondef('finance.billing_tick(timestamptz,boolean)'::regprocedure);
 src:=replace(src,'?admin=v2&page=finance&finance_tab=bills','?admin=v2&view=finance&finance_tab=bills');
 if position('if found and r.status in (''queued'',''skipped'') then continue; end if;' in src)=0 then raise exception 'Unexpected billing scheduler version'; end if;
 src:=replace(src,'if found and r.status in (''queued'',''skipped'') then continue; end if;',
 'if found and r.status in (''queued'',''skipped'') then
   if r.status=''queued'' and exists(select 1 from public.notification_queue where id=r.queue_id and status=''cancelled'' and last_error=''billing_window_closed'' and provider_message_id is null) then
    null;
   else continue; end if;
  end if;');
 src:=replace(src,'if v_queue is null then select id into v_queue from public.notification_queue where idempotency_key=v_key; end if;',
 'if v_queue is null then select id into v_queue from public.notification_queue where idempotency_key=v_key; end if;
  update public.notification_queue set status=''pending'',scheduled_at=now(),attempts=0,last_error=null,processed_at=null
   where id=v_queue and status=''cancelled'' and last_error=''billing_window_closed'' and provider_message_id is null;');
 execute src;
end $$;
