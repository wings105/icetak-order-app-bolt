-- Private transition history; receipt snapshots remain owned by the Inbox bridge.
create table public.autobrief_followup_events (
 id bigint generated always as identity primary key,
 task_id text not null,
 order_reference text,
 phase text not null,
 state text not null,
 remark text not null default '',
 snapshot jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.autobrief_followup_events enable row level security;
revoke all on public.autobrief_followup_events from public,anon,authenticated;
grant select,insert on public.autobrief_followup_events to service_role;
grant usage,select on sequence public.autobrief_followup_events_id_seq to service_role;
create index autobrief_followup_events_task_idx on public.autobrief_followup_events(task_id,id desc);

create function public.icetak_log_autobrief_followup() returns trigger
language plpgsql security definer set search_path='' as $$
declare f jsonb:=coalesce(new.brief->'followup','{}'); prior jsonb:='{}'; sig jsonb; oldsig jsonb; phase text; status text;
begin
 if f='{}' or f='null'::jsonb then return new; end if;
 if tg_op='UPDATE' then prior:=coalesce(old.brief->'followup','{}'); end if;
 -- checked_at / receipt updated_at change on routine reads, not on business transitions.
 sig:=(f-'checked_at') #- '{first,updated_at}' #- '{deadline,updated_at}';
 oldsig:=(prior-'checked_at') #- '{first,updated_at}' #- '{deadline,updated_at}';
 if tg_op='UPDATE' and sig=oldsig and coalesce(new.brief->>'wording','')=coalesce(old.brief->>'wording','') and coalesce(new.brief->>'confirmed','')=coalesce(old.brief->>'confirmed','') then return new; end if;
 phase:=case when (sig->'deadline') is distinct from (oldsig->'deadline') and f->'deadline'<>'null'::jsonb then 'deadline' when (sig->'first') is distinct from (oldsig->'first') and f->'first'<>'null'::jsonb then 'first' else 'assessment' end;
 status:=case when f->>'blocked' is not null then 'blocked' when f->>'defaulted'='true' then 'defaulted' when coalesce(new.brief->>'wording','')<>'' then 'detail_available' else coalesce(f->phase->>'state','waiting') end;
 insert into public.autobrief_followup_events(task_id,order_reference,phase,state,remark,snapshot)
 values(new.task_id,new.order_reference,phase,status,left(coalesce(new.brief->>'followup_remark',''),2400),jsonb_build_object('followup',sig,'wording',left(new.brief->>'wording',500),'confirmed',new.brief->'confirmed'));
 return new;
end $$;
revoke all on function public.icetak_log_autobrief_followup() from public,anon,authenticated;
create trigger autobrief_followup_event after insert or update of brief on public.clickup_order_brief_jobs for each row execute function public.icetak_log_autobrief_followup();

create function public.icetak_autobrief_logs(p_query text default '',p_phase text default '',p_state text default '',p_offset integer default 0,p_task_id text default '') returns jsonb
language sql stable security invoker set search_path='' as $$
 with jobs as (
  select j.task_id,j.order_reference,j.state as job_state,j.last_error,j.updated_at,j.last_polled_at,j.comment_id,j.brief,
    j.brief->'followup' as f
  from public.clickup_order_brief_jobs j
  where j.brief->'followup' is not null and j.brief->'followup'<>'{}'::jsonb
    and (coalesce(p_task_id,'')='' or j.task_id=p_task_id)
    and (coalesce(p_query,'')='' or position(lower(left(p_query,80)) in lower(coalesce(j.order_reference,'')||' '||j.task_id))>0)
 ), phases as (
  select j.*,v.phase,j.f->v.phase as receipt,
    case when j.f->v.phase->>'state' is not null then j.f->v.phase->>'state'
     when j.f->>'blocked' is not null then 'blocked'
     when coalesce(j.brief->>'wording','')<>'' or j.brief->>'confirmed'='true' then 'skipped'
     else 'waiting' end as status
  from jobs j cross join (values('first'),('deadline')) v(phase)
 ), filtered as (
  select * from phases where (coalesce(p_phase,'')='' or phase=p_phase) and (coalesce(p_state,'')='' or status=p_state)
 ), paged as (
  select jsonb_build_object('task_id',task_id,'order_reference',order_reference,'phase',phase,'status',status,
    'updated_at',updated_at,'checked_at',f->>'checked_at','due_at',f->>'due_at','blocked',f->>'blocked',
    'defaulted',coalesce(f->>'defaulted','false')='true','remark',brief->>'followup_remark','sku',brief->>'sku',
    'wording',brief->>'wording','confirmed',brief->'confirmed','job_state',job_state,'last_error',last_error,
    'receipt',receipt,'product_id',brief->>'product_id','product_title',brief->>'product_title','comment_id',comment_id) as row
  from filtered order by updated_at desc,task_id,phase limit 30 offset least(100000,greatest(0,coalesce(p_offset,0)))
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(row) from paged),'[]'::jsonb),'total',(select count(*) from filtered),
  'events',case when coalesce(p_task_id,'')<>'' then coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (select id,phase,state,remark,snapshot,created_at from public.autobrief_followup_events where task_id=p_task_id order by id desc limit 100) e),'[]'::jsonb) else '[]'::jsonb end,
  'as_of',now(),'history_limit',100);
$$;
revoke all on function public.icetak_autobrief_logs(text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.icetak_autobrief_logs(text,text,text,integer,text) to service_role;
comment on table public.autobrief_followup_events is 'Private append-only AutoBrief follow-up transitions from deployment onward; no-change polls excluded. Older phase receipts are shown through current job snapshots.';
