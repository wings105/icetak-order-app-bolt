CREATE OR REPLACE FUNCTION clickup_gate.claim_brief_profile(p_profile text, p_task_id text DEFAULT NULL::text, p_limit integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare enabled boolean; jobs jsonb;
begin
 select s.enabled and case p_profile when 'acrylic' then s.acrylic_enabled when 'print' then s.print_brief_rollout_after is not null or p_task_id is not null else true end into enabled from public.clickup_order_brief_settings s where singleton;
 if not coalesce(enabled,false) then return jsonb_build_object('enabled',false,'jobs','[]'::jsonb);end if;
 if p_profile not in('glossy','acrylic','print') then return jsonb_build_object('enabled',false,'reason','RULE_NOT_CONFIGURED','jobs','[]'::jsonb);end if;
 insert into public.clickup_order_brief_jobs(task_id,order_reference,source_fingerprint,content_hash,state,next_poll_at)
 select s.task_id,s.order_reference,coalesce(nullif(a.data->>'fingerprint',''),md5(s.task_id||r.task_created_at::text)),
  md5(concat_ws('|',s.task_name,a.data->>'fingerprint')),'pending',now()
 from public.ai_clickup_work_snapshots s join public.clickup_autobrief_routes r using(task_id)
 left join public.task_detail_automation a using(task_id)
 left join public.orders o on o.id=s.order_id left join public.marketplace_orders m on m.id=s.marketplace_order_id
 where (r.profile=p_profile or p_profile='print' and r.profile in ('edible','wafer')) and s.list_id='18375902' and lower(btrim(s.clickup_status))=r.initial_status
 and s.order_reference not ilike '%TEST%' and r.task_created_at<=now()-interval '15 minutes'
 and (p_task_id is null or s.task_id=p_task_id)
 and (p_task_id is not null or coalesce(o.created_at,case when p_profile='print' then m.placed_at end,m.first_seen_at)>=
  (select case when p_profile='acrylic' then acrylic_rollout_after when p_profile='print' then print_brief_rollout_after else rollout_after end from public.clickup_order_brief_settings where singleton))
 and (p_profile in ('acrylic','print') or (coalesce(a.data->>'fingerprint','')<>'' and a.data->>'info_status' in('ready','missing','review')))
 on conflict(task_id) do update set source_fingerprint=excluded.source_fingerprint,content_hash=excluded.content_hash,
  next_poll_at=now(),state='pending',attempts=0,next_attempt_at=now(),last_error=null,updated_at=now()
 where public.clickup_order_brief_jobs.content_hash is distinct from excluded.content_hash
  and (p_profile<>'print' or public.clickup_order_brief_jobs.comment_id is null or public.clickup_order_brief_jobs.brief->>'profile'='edible-wafer-v1')
  and not exists(select 1 from public.clickup_autobrief_routes locked where locked.task_id=excluded.task_id and locked.confirmed_at is not null)
  and (public.clickup_order_brief_jobs.lease_until is null or public.clickup_order_brief_jobs.lease_until<now());
 with candidates as(
 select j.task_id from public.clickup_order_brief_jobs j join public.clickup_autobrief_routes r using(task_id)
 join public.ai_clickup_work_snapshots s using(task_id)
 left join public.orders direct on direct.id=s.order_id
 left join public.marketplace_orders market on market.id=s.marketplace_order_id
 where (r.profile=p_profile or p_profile='print' and r.profile in ('edible','wafer')) and s.list_id='18375902' and (p_task_id is null or j.task_id=p_task_id)
 and (p_profile<>'print' or (
   (j.comment_id is null or j.brief->>'profile'='edible-wafer-v1')
   and (p_task_id is not null or coalesce(direct.created_at,market.placed_at,market.first_seen_at)>=
    (select print_brief_rollout_after from public.clickup_order_brief_settings where singleton))
 ))
 and (r.confirmed_at is not null or lower(btrim(s.clickup_status))=r.initial_status)
 and (r.confirmed_at is null or r.confirmed_at>=now()-interval '30 days')
 and r.task_created_at<=now()-interval '15 minutes'
 and (j.lease_until is null or j.lease_until<now())
 and (p_task_id is not null or (j.state in('pending','failed') and j.next_attempt_at<=now() and j.attempts<5)
  or(j.state='processing' and j.attempts<5) or(j.state in('completed','review') and j.next_poll_at<=now()))
 order by case when j.state in('pending','failed') then 0 else 1 end,j.next_poll_at,j.created_at
 limit greatest(1,least(p_limit,5)) for update of j skip locked
 ), changed as(
 update public.clickup_order_brief_jobs j set state='processing',lease_until=now()+interval '4 minutes',
  attempts=case when j.state in('completed','review') then 1 else j.attempts+1 end,last_polled_at=now(),updated_at=now()
 from candidates c where c.task_id=j.task_id returning j.*
 )select coalesce(jsonb_agg(to_jsonb(changed)),'[]'::jsonb) into jobs from changed;
 return jsonb_build_object('enabled',true,'jobs',jobs);
end;$function$;
