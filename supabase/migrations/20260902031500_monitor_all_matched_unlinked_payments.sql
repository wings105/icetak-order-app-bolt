-- Do not age out a matched checkout payment.  It remains an admin review item
-- until a real order exists or the admin explicitly marks it ignored.
create or replace function public.icetak_scan_payment_order_attention()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_inserted integer:=0; v_resolved integer:=0; cfg public.payment_order_attention_settings%rowtype;
begin
  select * into cfg from public.payment_order_attention_settings where singleton=true;
  if coalesce(cfg.enabled,true) is not true then
    return jsonb_build_object('ok',true,'enabled',false,'new_alerts',0,'resolved',0,'threshold_minutes',coalesce(cfg.delay_minutes,15));
  end if;
  update public.payment_order_attention_alerts a
  set status='resolved',resolved_at=now(),locked_at=null,updated_at=now()
  where a.status in ('pending','sending','retry','sent','failed')
    and (
      not exists(select 1 from public.payment_transactions p where p.transaction_id=a.transaction_id)
      or exists(select 1 from public.payment_transactions p left join public.payment_sessions ps on ps.id=p.payment_session_id where p.transaction_id=a.transaction_id and (p.order_id is not null or ps.order_id is not null))
      or exists(select 1 from finance.qrpay_payment_controls qc where qc.transaction_id=a.transaction_id and qc.workflow_state='ignored')
    );
  get diagnostics v_resolved=row_count;
  insert into public.payment_order_attention_alerts(transaction_id,alert_type,status,scheduled_at)
  select p.transaction_id,'matched_checkout_no_order','pending',now()
  from public.payment_transactions p
  join public.payment_sessions ps on ps.id=p.payment_session_id and ps.status='matched'
  left join finance.qrpay_payment_controls qc on qc.transaction_id=p.transaction_id
  where p.provider in ('qrpay','qrpay_ai','duitnow')
    and p.order_id is null and ps.order_id is null
    and nullif(btrim(coalesce(p.transaction_id,'')),'') is not null
    and coalesce(p.paid_at,p.created_at) <= now()-make_interval(mins=>coalesce(cfg.delay_minutes,15))
    and coalesce(qc.workflow_state,'') <> 'ignored'
  on conflict(transaction_id,alert_type) do update
    set status=case when public.payment_order_attention_alerts.status='disabled' then 'pending' else public.payment_order_attention_alerts.status end,
        scheduled_at=case when public.payment_order_attention_alerts.status='disabled' then now() else public.payment_order_attention_alerts.scheduled_at end,
        updated_at=case when public.payment_order_attention_alerts.status='disabled' then now() else public.payment_order_attention_alerts.updated_at end;
  get diagnostics v_inserted=row_count;
  return jsonb_build_object('ok',true,'enabled',true,'new_alerts',v_inserted,'resolved',v_resolved,'threshold_minutes',coalesce(cfg.delay_minutes,15));
end;
$function$;
