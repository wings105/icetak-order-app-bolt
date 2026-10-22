-- Reuse ai_order_work_source production_tasks for the Inbox design projection.
-- Task-only changes must refresh both direct and marketplace cache summaries.
create or replace function inbox_sync.task_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_old jsonb:='{}'; v_new jsonb:='{}';
begin
 if TG_OP<>'INSERT' then v_old:=to_jsonb(old);end if;
 if TG_OP<>'DELETE' then v_new:=to_jsonb(new);end if;
 if TG_OP='UPDATE' and not exists(
  select 1 from unnest(array['order_id','marketplace_order_id','component_id','status','clickup_status',
   'clickup_list_id','list_id','review_status','normalized_review_state','mapping_status']) k
  where v_old->k is distinct from v_new->k
 ) then return new;end if;
 insert into inbox_sync.jobs(source,order_id,requested_at)
 select source,id,clock_timestamp() from (
  select distinct 'direct'::text source,nullif(j->>'order_id','')::uuid id from (values(v_old),(v_new)) x(j)
  union
  select distinct 'marketplace',nullif(j->>'marketplace_order_id','')::uuid from (values(v_old),(v_new)) x(j)
 ) ids where id is not null
 on conflict(source,order_id) do update set requested_at=excluded.requested_at,
 status=case when inbox_sync.jobs.status='in_flight' then 'in_flight' else 'pending' end,
 attempts=case when inbox_sync.jobs.status='in_flight' then inbox_sync.jobs.attempts else 0 end,available_at=now();
 if TG_OP='DELETE' then return old;end if;
 return new;
end $$;
revoke all on function inbox_sync.task_changed() from public,anon,authenticated;
