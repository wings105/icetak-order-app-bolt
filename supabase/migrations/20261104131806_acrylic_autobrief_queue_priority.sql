create or replace function public.icetak_claim_acrylic_briefs(p_task_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare jobs jsonb; enabled boolean;
begin
 select acrylic_enabled into enabled from public.clickup_order_brief_settings where singleton;
 if not coalesce(enabled,false) and p_task_id is null then return jsonb_build_object('enabled',false,'jobs','[]'::jsonb);end if;
 insert into public.clickup_order_brief_jobs(task_id,order_reference,source_fingerprint,content_hash,state,next_poll_at)
 select s.task_id,s.order_reference,coalesce(nullif(a.data->>'fingerprint',''),md5(s.task_id||s.source_updated_at::text)),
  md5(concat_ws('|',s.task_name,a.data->>'fingerprint',s.source_updated_at::text)),'pending',now()
 from public.ai_clickup_work_snapshots s left join public.task_detail_automation a using(task_id)
 left join public.orders o on o.id=s.order_id left join public.marketplace_orders m on m.id=s.marketplace_order_id
 where s.list_id='18375902' and lower(btrim(s.clickup_status))='acrylic'
 and s.order_reference not ilike '%TEST%' and coalesce(o.created_at,m.placed_at,m.first_seen_at)<=now()-interval '15 minutes'
 and (s.task_id=p_task_id or (p_task_id is null and coalesce(o.created_at,m.first_seen_at)>=(select acrylic_rollout_after from public.clickup_order_brief_settings where singleton)))
 on conflict(task_id) do update set source_fingerprint=excluded.source_fingerprint,content_hash=excluded.content_hash,
  next_poll_at=now(),state='pending',attempts=0,next_attempt_at=now(),last_error=null,updated_at=now()
 where public.clickup_order_brief_jobs.content_hash is distinct from excluded.content_hash
 and (public.clickup_order_brief_jobs.lease_until is null or public.clickup_order_brief_jobs.lease_until<now());
 with candidates as (
  select j.task_id from public.clickup_order_brief_jobs j join public.ai_clickup_work_snapshots s using(task_id)
  where s.list_id='18375902' and lower(btrim(s.clickup_status))='acrylic'
  and (p_task_id is null or j.task_id=p_task_id) and (j.lease_until is null or j.lease_until<now())
  and (p_task_id is not null or ((j.state in ('pending','failed') and j.next_attempt_at<=now() and j.attempts<5)
   or (j.state='processing' and j.attempts<5) or (j.state in ('completed','review') and j.next_poll_at<=now())))
  order by case when j.state in ('pending','failed') then 0 else 1 end,j.next_poll_at,j.created_at limit 1 for update of j skip locked
 ), changed as (
 update public.clickup_order_brief_jobs j set state='processing',lease_until=now()+interval '4 minutes',
 attempts=case when j.state in ('completed','review') then 1 else j.attempts+1 end,last_polled_at=now(),updated_at=now()
 from candidates c where c.task_id=j.task_id returning j.*
 ) select coalesce(jsonb_agg(to_jsonb(changed)),'[]') into jobs from changed;
 return jsonb_build_object('enabled',coalesce(enabled,false),'jobs',jobs);
end $$;

CREATE OR REPLACE FUNCTION clickup_gate.dispatch_order_brief()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'clickup_gate'
AS $function$
declare t text;
begin
 if not (select enabled from public.clickup_order_brief_settings where singleton=true) then return; end if;
 select setting_value into t from public.private_runtime_settings where setting_key='order_brief_worker_token';
 if t is null then return; end if;
 perform net.http_post(
   url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-order-brief',
   body:='{"action":"run"}'::jsonb,
   headers:=jsonb_build_object('Content-Type','application/json','x-order-brief-token',t),
   timeout_milliseconds:=60000
 );
 if (select acrylic_enabled from public.clickup_order_brief_settings where singleton) then
  for acrylic_slot in 1..3 loop
  perform net.http_post(
   url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-order-brief',
   body:='{"action":"acrylic_run"}'::jsonb,
   headers:=jsonb_build_object('Content-Type','application/json','x-order-brief-token',t),
   timeout_milliseconds:=120000);
  end loop;
 end if;
end $function$
;
