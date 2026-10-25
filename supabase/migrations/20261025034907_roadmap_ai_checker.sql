-- Owner-only resumable AI reviews. No external provider calls or autonomous scheduler.
alter table public.icetak_roadmap_items
 add column if not exists priority_reason text not null default '' check(char_length(priority_reason)<=1000),
 add column if not exists priority_rank integer not null default 100 check(priority_rank between 0 and 9999),
 add column if not exists work_type text not null default 'build' check(work_type in ('fix','verify','build','improve'));

create table public.icetak_roadmap_ai_runs(
 id uuid primary key,
 item_id uuid not null references public.icetak_roadmap_items(id) on delete restrict,
 checker text not null check(char_length(trim(checker)) between 2 and 120),
 scope text not null check(char_length(trim(scope)) between 10 and 2000),
 outcome text not null default 'running' check(outcome in ('running','verified','partial','blocked','failed','interrupted')),
 verification_level text not null default 'not_checked' check(verification_level in ('not_checked','source','controlled','production')),
 summary text not null default '' check(char_length(summary)<=4000),
 evidence jsonb not null default '[]' check(jsonb_typeof(evidence)='array' and jsonb_array_length(evidence)<=30),
 next_action text not null default '' check(char_length(next_action)<=2000),
 source_ref text not null default '' check(char_length(source_ref)<=1000),
 before_state jsonb not null default '{}',after_state jsonb not null default '{}',
 created_by uuid default auth.uid(),
 started_at timestamptz not null default clock_timestamp(),
 last_activity_at timestamptz not null default clock_timestamp(),finished_at timestamptz
);
create unique index roadmap_ai_one_active on public.icetak_roadmap_ai_runs(item_id) where outcome='running';
create index roadmap_ai_item_history on public.icetak_roadmap_ai_runs(item_id,started_at desc);
create index roadmap_ai_recent on public.icetak_roadmap_ai_runs(started_at desc);
create table public.icetak_roadmap_ai_events(
 id bigint generated always as identity primary key,
 run_id uuid not null references public.icetak_roadmap_ai_runs(id) on delete restrict,
 item_id uuid not null references public.icetak_roadmap_items(id) on delete restrict,
 event_kind text not null,checker text not null,summary text not null,
 evidence jsonb not null,next_action text not null,
 before_state jsonb not null,after_state jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index roadmap_ai_event_history on public.icetak_roadmap_ai_events(run_id,id);
create index roadmap_ai_event_item on public.icetak_roadmap_ai_events(item_id,id desc);
alter table public.icetak_roadmap_ai_runs enable row level security;
alter table public.icetak_roadmap_ai_events enable row level security;
revoke all on public.icetak_roadmap_ai_runs,public.icetak_roadmap_ai_events from public,anon,authenticated,service_role;
grant select,insert,update on public.icetak_roadmap_ai_runs to authenticated,service_role;
grant select,insert on public.icetak_roadmap_ai_events to authenticated,service_role;
grant usage on sequence public.icetak_roadmap_ai_events_id_seq to authenticated,service_role;
create policy roadmap_ai_owner_read on public.icetak_roadmap_ai_runs for select to authenticated using(icetak_private.roadmap_owner());
create policy roadmap_ai_owner_insert on public.icetak_roadmap_ai_runs for insert to authenticated with check(icetak_private.roadmap_owner());
create policy roadmap_ai_owner_update on public.icetak_roadmap_ai_runs for update to authenticated using(icetak_private.roadmap_owner()) with check(icetak_private.roadmap_owner());
create policy roadmap_ai_owner_events_read on public.icetak_roadmap_ai_events for select to authenticated using(icetak_private.roadmap_owner());
create policy roadmap_ai_owner_events_insert on public.icetak_roadmap_ai_events for insert to authenticated with check(icetak_private.roadmap_owner());

create function icetak_private.roadmap_ai_run_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_item public.icetak_roadmap_items;
begin
 select * into strict v_item from public.icetak_roadmap_items where id=new.item_id for update;
 if tg_op='INSERT' then
  if new.outcome<>'running' then raise exception 'Start review before recording a result'; end if;
  new.before_state=to_jsonb(v_item);new.after_state=to_jsonb(v_item);
  new.started_at=clock_timestamp();new.created_by=auth.uid();new.finished_at=null;
 else
  if old.outcome<>'running' then raise exception 'Finished reviews are immutable; start a new review'; end if;
  if new.id<>old.id or new.item_id<>old.item_id or new.checker<>old.checker or new.scope<>old.scope or new.before_state<>old.before_state or new.started_at<>old.started_at or new.created_by is distinct from old.created_by then
   raise exception 'Review identity and starting snapshot are immutable';
  end if;
  new.after_state=to_jsonb(v_item);
 end if;
 if exists(select 1 from jsonb_array_elements(new.evidence) e where jsonb_typeof(e)<>'string' or char_length(e#>>'{}') not between 3 and 2000) then raise exception 'Evidence must contain 3-2000 character text references'; end if;
 if new.outcome<>'running' then
  if char_length(trim(new.summary))<10 then raise exception 'Result summary required'; end if;
  if new.outcome='verified' and (new.verification_level not in ('controlled','production') or jsonb_array_length(new.evidence)=0) then raise exception 'Verified requires controlled/production outcome evidence'; end if;
  if new.outcome<>'verified' and char_length(trim(new.next_action))<10 then raise exception 'Record what the next checker must do'; end if;
  new.finished_at=clock_timestamp();
 else new.finished_at=null;
 end if;
 new.last_activity_at=clock_timestamp();
 return new;
end;
$$;
create trigger roadmap_ai_run_guard before insert or update on public.icetak_roadmap_ai_runs for each row execute function icetak_private.roadmap_ai_run_guard();
create function icetak_private.roadmap_ai_event_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op<>'INSERT' or pg_trigger_depth()<2 then raise exception 'AI events are append-only and generated by review transitions'; end if;
 return new;
end;
$$;
create trigger roadmap_ai_event_guard before insert or update or delete on public.icetak_roadmap_ai_events for each row execute function icetak_private.roadmap_ai_event_guard();
create function icetak_private.roadmap_ai_run_event() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 insert into public.icetak_roadmap_ai_events(run_id,item_id,event_kind,checker,summary,evidence,next_action,before_state,after_state)
 values(new.id,new.item_id,case when tg_op='INSERT' then 'started' when new.outcome='running' then 'checkpoint' else new.outcome end,new.checker,
  case when tg_op='INSERT' then 'Semakan bermula. Skop: '||new.scope else new.summary end,new.evidence,new.next_action,new.before_state,new.after_state);
 return new;
end;
$$;
create trigger roadmap_ai_run_event after insert or update on public.icetak_roadmap_ai_runs for each row execute function icetak_private.roadmap_ai_run_event();
revoke all on function icetak_private.roadmap_ai_run_guard(),icetak_private.roadmap_ai_event_guard(),icetak_private.roadmap_ai_run_event() from public,anon,authenticated;

create function public.icetak_roadmap_ai_latest() returns setof public.icetak_roadmap_ai_runs
language sql stable security invoker set search_path='' as $$
 select distinct on(r.item_id) r.* from public.icetak_roadmap_ai_runs r order by r.item_id,r.started_at desc,r.id;
$$;
revoke all on function public.icetak_roadmap_ai_latest() from public,anon;
grant execute on function public.icetak_roadmap_ai_latest() to authenticated,service_role;

create function public.icetak_roadmap_ai_check(p_action text,p_run_id uuid,p_item_id uuid default null,p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.icetak_roadmap_ai_runs;i public.icetak_roadmap_items;v_outcome text;v_change boolean;
begin
 if current_user not in ('postgres','service_role') and not icetak_private.roadmap_owner() then raise insufficient_privilege using message='Roadmap owner required'; end if;
 if p_run_id is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Run UUID and object payload required'; end if;
 if p_action='start' then
  -- Serialize starts on the feature, then retry the same UUID without another event.
  select * into strict i from public.icetak_roadmap_items where id=p_item_id for update;
  select * into r from public.icetak_roadmap_ai_runs where id=p_run_id;
  if found then
   if r.item_id<>p_item_id then raise exception 'Run UUID belongs to another feature'; end if;
   return to_jsonb(r);
  end if;
  if exists(select 1 from public.icetak_roadmap_ai_runs where item_id=p_item_id and outcome='running') then raise exception 'Review already running; resume or explicitly interrupt it first'; end if;
  insert into public.icetak_roadmap_ai_runs(id,item_id,checker,scope,source_ref,next_action)
   values(p_run_id,p_item_id,p_payload->>'checker',p_payload->>'scope',coalesce(p_payload->>'source_ref',''),coalesce(p_payload->>'next_action','Read source and live state within this scope')) returning * into r;
  return to_jsonb(r);
 end if;
 -- Same lock order as start: item before run, preventing cross-agent deadlocks.
 select item_id into p_item_id from public.icetak_roadmap_ai_runs where id=p_run_id;
 select * into strict i from public.icetak_roadmap_items where id=p_item_id for update;
 select * into strict r from public.icetak_roadmap_ai_runs where id=p_run_id for update;
 if p_action not in ('checkpoint','finish') then raise exception 'Unknown review action'; end if;
 if r.outcome<>'running' then return to_jsonb(r); end if;
 v_outcome=case when p_action='checkpoint' then 'running' else p_payload->>'outcome' end;
 if v_outcome is null or (p_action='finish' and v_outcome='running') then raise exception 'Choose a final outcome'; end if;
 v_change=p_action='finish' and p_payload ?| array['progress','status','priority','priority_rank','priority_reason','work_type'];
 if v_change and i.updated_at is distinct from (r.before_state->>'updated_at')::timestamptz then
  update public.icetak_roadmap_ai_runs set summary='CONFLICT: Feature changed since review started. No roadmap update applied.',next_action='Reread current feature, close this run as interrupted, then start a fresh review.' where id=r.id returning * into r;
  return to_jsonb(r)||jsonb_build_object('conflict',true);
 end if;
 if v_change then
  if jsonb_array_length(coalesce(p_payload->'evidence',r.evidence))=0 then raise exception 'Evidence is required before updating roadmap'; end if;
  if (p_payload ? 'progress' or p_payload ? 'status') and coalesce(p_payload->>'verification_level',r.verification_level)='not_checked' then raise exception 'Record verification level before changing progress'; end if;
  if (coalesce(p_payload->>'status',i.status)='completed') <> (coalesce((p_payload->>'progress')::int,i.progress)=100) then raise exception 'Completed and 100%% must agree'; end if;
  if coalesce(p_payload->>'status',i.status)='completed' then
   if v_outcome<>'verified' or coalesce(p_payload->>'verification_level',r.verification_level)<>'production' or coalesce(p_payload->>'next_action','')<>'' then raise exception '100%% / Completed requires production evidence and no remaining work'; end if;
   if (p_payload ? 'status' and p_payload->>'status'<>'completed') or (p_payload ? 'progress' and (p_payload->>'progress')::int<>100) then raise exception 'Completed and 100%% must agree'; end if;
  end if;
  if p_payload ?| array['priority','priority_rank','work_type'] and char_length(trim(coalesce(p_payload->>'priority_reason',i.priority_reason)))<10 then raise exception 'Explain priority and work order'; end if;
  update public.icetak_roadmap_items set
   progress=coalesce((p_payload->>'progress')::smallint,progress),status=coalesce(p_payload->>'status',status),
   priority=coalesce(p_payload->>'priority',priority),priority_rank=coalesce((p_payload->>'priority_rank')::int,priority_rank),
   priority_reason=coalesce(p_payload->>'priority_reason',priority_reason),work_type=coalesce(p_payload->>'work_type',work_type)
   where id=i.id returning * into i;
  insert into public.icetak_roadmap_updates(item_id,kind,is_public,body) values(i.id,'progress',false,
   left('AI Checker '||r.id::text||': '||coalesce(p_payload->>'summary','')||' | '||(r.before_state->>'progress')||'% -> '||i.progress||'%; '||i.status||'; '||upper(i.priority)||' #'||i.priority_rank,1000));
 end if;
 update public.icetak_roadmap_ai_runs set outcome=v_outcome,
  summary=coalesce(p_payload->>'summary',summary),evidence=coalesce(p_payload->'evidence',evidence),
  next_action=coalesce(p_payload->>'next_action',next_action),source_ref=coalesce(p_payload->>'source_ref',source_ref),
  verification_level=coalesce(p_payload->>'verification_level',verification_level)
 where id=r.id returning * into r;
 return to_jsonb(r);
end;
$$;
revoke all on function public.icetak_roadmap_ai_check(text,uuid,uuid,jsonb) from public,anon;
grant execute on function public.icetak_roadmap_ai_check(text,uuid,uuid,jsonb) to authenticated,service_role;
notify pgrst,'reload schema';
