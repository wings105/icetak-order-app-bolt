-- Keep the last recorded receipt visible if a later worker failure clears its current brief.
create or replace function public.icetak_autobrief_logs(p_query text default '',p_phase text default '',p_state text default '',p_offset integer default 0,p_task_id text default '') returns jsonb
language sql stable security invoker set search_path='' as $$
 with sources as (
  select j.*,case when coalesce(j.brief->'followup','{}') not in ('{}'::jsonb,'null'::jsonb) then j.brief
   else e.snapshot||jsonb_build_object('followup_remark',e.remark) end as log_brief,
   coalesce(j.brief->'followup','{}') in ('{}'::jsonb,'null'::jsonb) as is_historical
  from public.clickup_order_brief_jobs j
  left join lateral (select snapshot,remark from public.autobrief_followup_events where task_id=j.task_id order by id desc limit 1) e
   on coalesce(j.brief->'followup','{}') in ('{}'::jsonb,'null'::jsonb)
 ), jobs as (
  select j.task_id,j.order_reference,j.state as job_state,j.last_error,j.updated_at,j.last_polled_at,j.comment_id,j.is_historical,j.log_brief as brief,
    j.log_brief->'followup' as f
  from sources j
  where j.log_brief->'followup' is not null and j.log_brief->'followup'<>'{}'::jsonb
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
  select jsonb_build_object('is_historical',is_historical,'task_id',task_id,'order_reference',order_reference,'phase',phase,'status',status,
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
