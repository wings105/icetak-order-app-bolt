-- Read only the newest complete snapshot for the already matched preview tasks.
-- Uses clickup_events_focus_full_task_latest; no replay/backfill or task writes.
create function public.get_clickup_awb_links(p_task_ids text[])
returns table(task_id text, awb_url text)
language sql stable security invoker set search_path = pg_catalog,public
as $$
 select ids.task_id, coalesce(awb.url,'')
 from (select distinct unnest(p_task_ids) as task_id
       where cardinality(p_task_ids) between 1 and 200) ids
 left join lateral (
  select coalesce(e.raw_payload->'task',e.raw_payload->'data'->'task',e.raw_payload->'current_task') as task
  from public.clickup_webhook_events e
  where e.task_id=ids.task_id and
   jsonb_typeof(coalesce(e.raw_payload #> '{task,custom_fields}',e.raw_payload #> '{data,task,custom_fields}',e.raw_payload #> '{current_task,custom_fields}'))='array'
  order by e.task_updated_at desc nulls last,e.received_at desc limit 1
 ) snapshot on true
 left join lateral (
  select trim(f->>'value') as url
  from jsonb_array_elements(snapshot.task->'custom_fields') f
  where f->>'id'='8a8589f6-5a80-493c-902b-0ed8da4584be'
     or lower(trim(f->>'name'))='awb link'
  order by (f->>'id'='8a8589f6-5a80-493c-902b-0ed8da4584be') desc nulls last
  limit 1
 ) awb on true;
$$;
revoke all on function public.get_clickup_awb_links(text[]) from public,anon,authenticated;
grant execute on function public.get_clickup_awb_links(text[]) to service_role;
