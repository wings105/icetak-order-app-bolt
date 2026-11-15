CREATE OR REPLACE FUNCTION public.icetak_acrylic_auto_worker(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s acrylic_auto.settings; j acrylic_auto.jobs; c jsonb; v jsonb; t text; patch jsonb;
begin
 if p_action='config' then select * into s from acrylic_auto.settings where singleton;return to_jsonb(s)-'updated_by';end if;
 if p_action='source' then return acrylic_auto.source(p_data->>'task_id');end if;
 if p_action='sync' then
  for c in select value from jsonb_array_elements(p_data->'candidates') loop
   t:=c->>'task_id';if t !~ '^[a-zA-Z0-9_-]{1,80}$' then continue;end if;
   v:=acrylic_auto.source(t);if v is null then continue;end if;
   insert into acrylic_auto.jobs(task_id,source_token,brief,eligible_at,due_at) values(t,v->>'source_token',v->'brief',(v->>'eligible_at')::timestamptz,nullif(c->>'due_at','')::timestamptz)
   on conflict(task_id) do update set due_at=excluded.due_at;
   update acrylic_auto.jobs set source_token=v->>'source_token',brief=v->'brief',eligible_at=(v->>'eligible_at')::timestamptz,state='queued',stage='prepare',data='{}',attempts=0,last_error='',next_attempt_at=now(),updated_at=now()
    where task_id=t and source_token<>v->>'source_token' and data->>'generation_started_at' is null and data->>'storage_path' is null and data->>'attachment_id' is null and (lease_until is null or lease_until<now());
  end loop;return jsonb_build_object('ok',true);
 end if;
 if p_action='claim' then
  select * into s from acrylic_auto.settings where singleton for update;
  if not s.enabled or exists(select 1 from acrylic_auto.jobs where lease_until>now()) then return null;end if;
  -- Recover only the same approved revision. Keep the existing stage, paid call and PNG.
  with ready as materialized (
   select q.task_id, acrylic_auto.source(q.task_id) as source
   from acrylic_auto.jobs q
   where q.state='review' and q.last_error='AUTOBRIEF_CHANGED_OR_NOT_READY'
     and (q.lease_until is null or q.lease_until<now())
  )
  update acrylic_auto.jobs q
  set state='queued', eligible_at=(ready.source->>'eligible_at')::timestamptz,
      next_attempt_at=now(), last_error='', updated_at=now()
  from ready
  where q.task_id=ready.task_id and q.state='review'
    and q.last_error='AUTOBRIEF_CHANGED_OR_NOT_READY'
    and (q.lease_until is null or q.lease_until<now())
    and ready.source->>'source_token'=q.source_token
    and (ready.source->>'eligible_at')::timestamptz<=now();

  -- Check current readiness before claiming, since AutoBrief can be refreshing.
  select q.* into j
  from acrylic_auto.jobs q
  cross join lateral (select acrylic_auto.source(q.task_id) as source) ready
  where q.state='queued' and q.eligible_at<=now() and q.next_attempt_at<=now()
    and (q.lease_until is null or q.lease_until<now())
    and (ready.source->>'eligible_at')::timestamptz<=now()
  order by q.last_attempt_at asc nulls first,q.due_at asc nulls last,q.created_at
  for update of q skip locked limit 1;
  if not found then return null;end if;
  update acrylic_auto.jobs set lease=gen_random_uuid(),lease_until=now()+interval '10 minutes',last_attempt_at=now(),updated_at=now() where task_id=j.task_id returning * into j;
  return to_jsonb(j);
 end if;
 if p_action='reserve' then select * into s from acrylic_auto.settings where singleton for update;end if;
 select * into j from acrylic_auto.jobs where task_id=p_data->>'task_id' and lease=(p_data->>'lease')::uuid and lease_until>now() for update;
 if not found then raise exception 'LEASE_LOST';end if;
 if p_action='reserve' then
  select * into s from acrylic_auto.settings where singleton for update;
  if not s.enabled then return jsonb_build_object('ok',false,'reason','DISABLED');end if;
  if j.data->>'generation_started_at' is not null then return jsonb_build_object('ok',false,'reason','GENERATION_ALREADY_STARTED');end if;
  if (select count(*) from acrylic_auto.calls where created_at>=date_trunc('day',now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur')>=s.daily_limit then return jsonb_build_object('ok',false,'reason','DAILY_LIMIT');end if;
  insert into acrylic_auto.calls(task_id,source_token) values(j.task_id,j.source_token);
  update acrylic_auto.jobs set data=data||jsonb_build_object('generation_started_at',now()),updated_at=now() where task_id=j.task_id;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='record' then
  patch:=coalesce(p_data->'patch','{}'::jsonb);
  update acrylic_auto.jobs set data=data||coalesce(patch->'data','{}'::jsonb),state=coalesce(patch->>'state',state),stage=coalesce(patch->>'stage',stage),last_error=coalesce(patch->>'error',''),attempts=attempts+case when patch->>'retry'='true' then 1 else 0 end,next_attempt_at=case when patch->>'defer'='true' then (date_trunc('day',now() at time zone 'Asia/Kuala_Lumpur')+interval '1 day') at time zone 'Asia/Kuala_Lumpur' when patch->>'retry'='true' then now()+interval '10 minutes' else now() end,lease=case when patch->>'release'='false' then lease else null end,lease_until=case when patch->>'release'='false' then lease_until else null end,updated_at=now() where task_id=j.task_id returning * into j;
  if j.attempts>=3 and j.state='queued' then update acrylic_auto.jobs set state='review',last_error='RETRY_LIMIT: '||last_error where task_id=j.task_id;end if;
  return jsonb_build_object('ok',true,'state',j.state,'stage',j.stage);
 end if;
 raise exception 'UNKNOWN_ACTION';
end $function$;
