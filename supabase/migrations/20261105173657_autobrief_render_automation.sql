-- Native server queue; no historical order backfill and no client-readable credentials.
create schema if not exists render_auto;
revoke all on schema render_auto from public,anon,authenticated;
grant usage on schema render_auto to service_role;
create table render_auto.settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false,rollout_at timestamptz not null default now());
insert into render_auto.settings(singleton) values(true);
create table render_auto.jobs(
 task_id text primary key references public.clickup_order_brief_jobs(task_id),
 order_reference text not null, source_hash text not null, brief jsonb not null,
 eligible_at timestamptz not null, state text not null check(state in ('queued','processing','retry','review','uncertain','completed','cancelled','skipped')),
 attempts integer not null default 0, lease_token uuid, lease_until timestamptz,
 next_attempt_at timestamptz not null default now(), template_version integer, fields jsonb,
 filename text, attachment_id text, attachment_url text, upload_started_at timestamptz,
 last_error text not null default '', created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index on render_auto.jobs(eligible_at,next_attempt_at) where state in ('queued','retry','uncertain','processing');
create table render_auto.events(id bigint generated always as identity primary key,task_id text not null,state text not null,reason text not null default '',created_at timestamptz not null default now());
alter table render_auto.settings enable row level security;
alter table render_auto.jobs enable row level security;
alter table render_auto.events enable row level security;
grant all on all tables in schema render_auto to service_role;
grant usage,select on all sequences in schema render_auto to service_role;

create function render_auto.enqueue(p_task_id text,p_selected boolean default false) returns boolean language plpgsql security invoker set search_path=pg_catalog,public,render_auto as $$
declare j public.clickup_order_brief_jobs; h text; prior render_auto.jobs; moment timestamptz; cfg render_auto.settings;
begin
 select * into cfg from render_auto.settings where singleton;
 select * into j from public.clickup_order_brief_jobs where task_id=p_task_id;
 if not found then return false;end if;
 select * into prior from render_auto.jobs where task_id=p_task_id for update;
 if j.state='processing' then return false;end if;
 if j.state<>'completed' or coalesce(j.brief->>'confirmed','false')<>'true' or coalesce((j.brief->>'confidence')::numeric,0)<80 then
  update render_auto.jobs set state='cancelled',lease_token=null,lease_until=null,last_error='AUTOBRIEF_NOT_CONFIRMED',updated_at=now() where task_id=p_task_id and state<>'completed';return false;
 end if;
 moment:=nullif(j.brief->>'confirmed_at','')::timestamptz;
 if moment is null then return false;end if;
 if prior.task_id is null and not p_selected and moment<cfg.rollout_at then return false;end if;
 h:=md5(jsonb_build_object('sku',j.brief->>'sku','wording',j.brief->>'wording','instruction',j.brief->>'instruction','pending',j.brief->'pending_change_ids','changes',j.brief->'change_detected','media',j.brief->'media_count','review',j.brief->'review_requested')::text);
 if prior.source_hash=h and prior.state<>'cancelled' then return false;end if;
 insert into render_auto.jobs(task_id,order_reference,source_hash,brief,eligible_at,state)
 values(j.task_id,j.order_reference,h,j.brief,greatest(moment,case when prior.task_id is null then moment else now() end)+interval '5 minutes','queued')
 on conflict(task_id) do update set order_reference=excluded.order_reference,source_hash=excluded.source_hash,brief=excluded.brief,eligible_at=excluded.eligible_at,state='queued',attempts=0,lease_token=null,lease_until=null,next_attempt_at=now(),fields=null,template_version=null,filename=null,attachment_id=null,attachment_url=null,upload_started_at=null,last_error='',updated_at=now();
 insert into render_auto.events(task_id,state,reason) values(j.task_id,'queued','WAIT_5_MINUTES_AFTER_CONFIRM');return true;
end $$;
create function render_auto.capture() returns trigger language plpgsql security definer set search_path=pg_catalog,public,render_auto as $$
begin perform render_auto.enqueue(new.task_id);return new;
exception when others then insert into render_auto.events(task_id,state,reason) values(new.task_id,'review','QUEUE_CAPTURE_FAILED');return new;end $$;
revoke all on function render_auto.capture() from public,anon,authenticated;
create trigger autobrief_render_queue after insert or update of state,brief on public.clickup_order_brief_jobs for each row execute function render_auto.capture();

create function public.icetak_render_auto_claim() returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,render_auto as $$
declare j render_auto.jobs;
begin
 if not (select enabled from render_auto.settings where singleton) then return null;end if;
 if not pg_try_advisory_xact_lock(551106) then return null;end if;
 if exists(select 1 from render_auto.jobs where state='processing' and lease_until>now()) then return null;end if;
 select * into j from render_auto.jobs where state in ('queued','retry','uncertain','processing') and eligible_at<=now() and next_attempt_at<=now() and coalesce(lease_until,'-infinity')<=now() and attempts<5 order by eligible_at for update skip locked limit 1;
 if not found then return null;end if;
 update render_auto.jobs set state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() where task_id=j.task_id returning * into j;
 return to_jsonb(j);
end $$;
create function public.icetak_render_auto_record(p_task_id text,p_lease uuid,p_patch jsonb) returns boolean language plpgsql security invoker set search_path=pg_catalog,public,render_auto as $$
declare affected integer; nextstate text:=p_patch->>'state';
begin
 if nextstate is not null and nextstate not in ('retry','review','uncertain','completed','cancelled','skipped') then raise exception 'INVALID_RENDER_STATE';end if;
 update render_auto.jobs set state=coalesce(nextstate,state),
 fields=coalesce(p_patch->'fields',fields),template_version=coalesce((p_patch->>'template_version')::int,template_version),
 filename=coalesce(p_patch->>'filename',filename),attachment_id=coalesce(p_patch->>'attachment_id',attachment_id),attachment_url=coalesce(p_patch->>'attachment_url',attachment_url),
 upload_started_at=case when p_patch->>'upload_started'='true' then coalesce(upload_started_at,now()) else upload_started_at end,
 last_error=left(coalesce(p_patch->>'error',''),200),
 lease_until=case when nextstate is null then lease_until else null end,lease_token=case when nextstate is null then lease_token else null end,
 next_attempt_at=case when nextstate in ('retry','uncertain') then now()+interval '2 minutes' else next_attempt_at end,updated_at=now()
 where task_id=p_task_id and lease_token=p_lease and state='processing';
 get diagnostics affected=row_count;
 if affected=1 and nextstate is not null then insert into render_auto.events(task_id,state,reason) values(p_task_id,nextstate,coalesce(p_patch->>'error',''));end if;
 return affected=1;
end $$;
create function public.icetak_render_auto_source(p_task_id text,p_hash text) returns boolean language sql security invoker set search_path=pg_catalog,public,render_auto as $$
 select exists(select 1 from render_auto.jobs q join public.clickup_order_brief_jobs j using(task_id) where q.task_id=p_task_id and q.source_hash=p_hash and q.state='processing' and q.lease_until>now() and j.state='completed' and j.brief->>'confirmed'='true' and coalesce(jsonb_array_length(j.brief->'pending_change_ids'),0)=0 and coalesce((j.brief->>'change_detected')::int,0)=0 and j.brief->>'wording'=q.brief->>'wording');
$$;
create function public.icetak_render_auto_status() returns jsonb language sql security invoker set search_path=pg_catalog,public,render_auto as $$
 select jsonb_build_object('enabled',(select enabled from render_auto.settings where singleton),'counts',(select jsonb_object_agg(state,n) from (select state,count(*) n from render_auto.jobs group by state)s),'jobs',(select coalesce(jsonb_agg(j),'[]') from (select task_id,order_reference,state,eligible_at,template_version,fields,filename,attachment_id,last_error,attempts,updated_at from render_auto.jobs order by updated_at desc limit 30)j));
$$;
create function render_auto.dispatch() returns bigint language plpgsql security invoker set search_path=pg_catalog,public,render_auto as $$
declare t text; req bigint;
begin
 if not (select enabled from render_auto.settings where singleton) then return null;end if;
 select setting_value into t from public.private_runtime_settings where setting_key='order_brief_worker_token';
 if t is null then return null;end if;
 select net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/autobrief-render',body:='{"action":"run"}'::jsonb,headers:=jsonb_build_object('Content-Type','application/json','x-order-brief-token',t),timeout_milliseconds:=120000) into req;
 return req;
end $$;
revoke all on all functions in schema render_auto from public,anon,authenticated;
grant execute on all functions in schema render_auto to service_role;
revoke all on function public.icetak_render_auto_claim(),public.icetak_render_auto_record(text,uuid,jsonb),public.icetak_render_auto_source(text,text),public.icetak_render_auto_status() from public,anon,authenticated;
grant execute on function public.icetak_render_auto_claim(),public.icetak_render_auto_record(text,uuid,jsonb),public.icetak_render_auto_source(text,text),public.icetak_render_auto_status() to service_role;
select cron.schedule('icetak-autobrief-render','* * * * *','select render_auto.dispatch();');
