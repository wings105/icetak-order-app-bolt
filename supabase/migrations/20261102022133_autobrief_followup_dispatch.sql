-- Order System only. Scoped priority lane reuses the existing exact claimed task worker.
create function public.icetak_dispatch_order_brief_followups(p_limit integer default 8)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare row record; count_sent integer:=0; worker_token text;
begin
 if not coalesce((select enabled from public.clickup_order_brief_settings where singleton),false)
  or coalesce((select setting_value from public.private_runtime_settings where setting_key='order_brief_followup_enabled'),'false')<>'true'
 then return jsonb_build_object('enabled',false,'dispatched',0);end if;
 select setting_value into worker_token from public.private_runtime_settings where setting_key='order_brief_worker_token';
 if coalesce(worker_token,'')='' then raise exception 'WORKER_TOKEN_UNAVAILABLE';end if;
 for row in
  with candidates as (
   select j.task_id from public.clickup_order_brief_jobs j
   join public.ai_clickup_work_snapshots s on s.task_id=j.task_id
   join public.marketplace_orders m on m.id=s.marketplace_order_id
   join public.task_detail_automation a on a.task_id=j.task_id
   where s.list_id='18375902' and lower(btrim(s.clickup_status))='design editing -topper'
    and m.current_status in ('READY_TO_SHIP','PROCESSED')
    and m.first_seen_at>=(select rollout_after from public.clickup_order_brief_settings where singleton)
    and m.placed_at<=now()-interval '15 minutes'
    and coalesce(j.brief->>'confirmed','false')<>'true'
    and coalesce(a.data->>'fingerprint','')<>''
    and (j.last_polled_at is null or j.last_polled_at<=now()-interval '55 seconds')
    and (j.lease_until is null or j.lease_until<now())
    and (j.state in ('pending','review','completed') or (j.state in ('processing','failed') and j.attempts<5 and j.next_attempt_at<=now()))
   order by case when (m.ship_by_at at time zone 'Asia/Kuala_Lumpur')::date=(now() at time zone 'Asia/Kuala_Lumpur')::date
    and (now() at time zone 'Asia/Kuala_Lumpur')::time>='14:00'::time then 0 else 1 end,
    j.last_polled_at nulls first,j.created_at,j.task_id
   limit greatest(1,least(coalesce(p_limit,8),25)) for update of j skip locked
  ), claimed as (
   update public.clickup_order_brief_jobs j set state='processing',lease_until=now()+interval '4 minutes',
    attempts=1,last_polled_at=now(),updated_at=now(),source_fingerprint=a.data->>'fingerprint'
   from candidates c,public.task_detail_automation a where j.task_id=c.task_id and a.task_id=j.task_id returning j.task_id
  ) select task_id from claimed
 loop
  perform net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-order-brief',
   headers:=jsonb_build_object('content-type','application/json','x-order-brief-token',worker_token),
   body:=jsonb_build_object('action','canary','task_id',row.task_id),timeout_milliseconds:=120000);
  count_sent:=count_sent+1;
 end loop;
 return jsonb_build_object('enabled',true,'dispatched',count_sent);
end $fn$;
revoke all on function public.icetak_dispatch_order_brief_followups(integer) from public,anon,authenticated;
grant execute on function public.icetak_dispatch_order_brief_followups(integer) to service_role;
select cron.schedule('icetak-autobrief-followup-dispatch','* * * * *','select public.icetak_dispatch_order_brief_followups(8)');
select cron.schedule('icetak-autobrief-shipment-deadline','0 6 * * *','select public.icetak_dispatch_order_brief_followups(25)');
