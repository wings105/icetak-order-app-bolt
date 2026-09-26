-- Read-only projection for public print references. No changes to orders or notifications.
create table public.clickup_awb_preview_tasks (
 task_id text primary key,
 order_reference text not null default '',
 title text not null default '',
 set_position integer not null default 999,
 attachments jsonb not null default '[]'::jsonb,
 snapshot_at timestamptz not null,
 received_at timestamptz not null,
 comment_images jsonb not null default '[]'::jsonb,
 comment_at timestamptz,
 comment_id text
);
create index clickup_awb_preview_order_idx on public.clickup_awb_preview_tasks(order_reference,set_position,task_id);
alter table public.clickup_awb_preview_tasks enable row level security;
revoke all on public.clickup_awb_preview_tasks from public,anon,authenticated;
grant select,insert,update,delete on public.clickup_awb_preview_tasks to service_role;

create function public.project_clickup_awb_preview(p_task_id text,p_raw jsonb,p_snapshot_at timestamptz,p_received_at timestamptz)
returns void language plpgsql security invoker set search_path = pg_catalog,public as $$
declare
 t jsonb; f jsonb; opt jsonb; h jsonb; c jsonb; imgs jsonb;
 ref text := ''; pos integer := 999; label text; at_time timestamptz;
begin
 t := coalesce(p_raw->'task',p_raw->'data'->'task',p_raw->'current_task');
 if nullif(p_task_id,'') is null then return; end if;
 -- Only a full Get Task snapshot can replace membership or clear attachments.
 if jsonb_typeof(t->'custom_fields') = 'array' then
  for f in select value from jsonb_array_elements(t->'custom_fields') loop
   if lower(trim(f->>'name')) = 'order id / customer name' then ref := trim(coalesce(f->>'value','')); end if;
   if lower(trim(f->>'name')) = 'set' and jsonb_typeof(f->'value')='array' then
    for opt in select value from jsonb_array_elements(coalesce(f->'type_config'->'options','[]'::jsonb)) loop
     if (f->'value') ? (opt->>'id') then
      label := coalesce(opt->>'label',opt->>'name','');
      if label ~ '[0-9]+' then pos := least(pos,substring(label from '[0-9]+')::integer); end if;
     end if;
    end loop;
   end if;
  end loop;
  insert into public.clickup_awb_preview_tasks(task_id,order_reference,title,set_position,attachments,snapshot_at,received_at)
  values(p_task_id,ref,coalesce(t->>'name',''),pos,
   case when jsonb_typeof(t->'attachments')='array' then t->'attachments' else '[]'::jsonb end,
   coalesce(p_snapshot_at,p_received_at),p_received_at)
  on conflict(task_id) do update set order_reference=excluded.order_reference,title=excluded.title,
   set_position=excluded.set_position,attachments=excluded.attachments,snapshot_at=excluded.snapshot_at,received_at=excluded.received_at
  where (excluded.snapshot_at,excluded.received_at) >= (clickup_awb_preview_tasks.snapshot_at,clickup_awb_preview_tasks.received_at);
 end if;
 for h in select value from jsonb_array_elements(case when jsonb_typeof(p_raw->'history_items')='array' then p_raw->'history_items' else '[]'::jsonb end) loop
  c := h->'comment';
  if jsonb_typeof(c->'comment') <> 'array' or c is null then continue; end if;
  select coalesce(jsonb_agg(part->'image' order by ord),'[]'::jsonb) into imgs
  from jsonb_array_elements(c->'comment') with ordinality as parts(part,ord)
  where part->>'type'='image' and nullif(part->'image'->>'url','') is not null;
  if jsonb_array_length(imgs)=0 then continue; end if;
  at_time := case when coalesce(c->>'date',h->>'date','') ~ '^[0-9]{10,16}$'
   then to_timestamp(coalesce(c->>'date',h->>'date')::numeric/1000) else p_received_at end;
  update public.clickup_awb_preview_tasks set comment_images=imgs,comment_at=at_time,comment_id=c->>'id'
  where task_id=p_task_id and (comment_at is null or at_time>=comment_at);
 end loop;
end $$;
revoke all on function public.project_clickup_awb_preview(text,jsonb,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.project_clickup_awb_preview(text,jsonb,timestamptz,timestamptz) to service_role;

create function public.capture_clickup_awb_preview() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 perform public.project_clickup_awb_preview(new.task_id,new.raw_payload,new.task_updated_at,new.received_at);
 return new;
end $$;
revoke all on function public.capture_clickup_awb_preview() from public,anon,authenticated;
create trigger capture_clickup_awb_preview after insert on public.clickup_webhook_events
for each row execute function public.capture_clickup_awb_preview();

-- Seed only this derived cache from existing raw events; source data stays unchanged.
select public.project_clickup_awb_preview(task_id,raw_payload,task_updated_at,received_at)
from (select distinct on(task_id) task_id,raw_payload,task_updated_at,received_at
 from public.clickup_webhook_events where jsonb_typeof(raw_payload->'task'->'custom_fields')='array'
 order by task_id,task_updated_at desc nulls last,received_at desc) snapshots;
select public.project_clickup_awb_preview(task_id,raw_payload,task_updated_at,received_at)
from (select distinct on(e.task_id) e.task_id,e.raw_payload,e.task_updated_at,e.received_at
 from public.clickup_webhook_events e
 where exists (select 1 from jsonb_array_elements(coalesce(e.raw_payload->'history_items','[]'::jsonb)) h
  where jsonb_path_exists(h,'$.comment.comment[*] ? (@.type == "image")'))
 order by e.task_id,e.received_at desc) comments;
