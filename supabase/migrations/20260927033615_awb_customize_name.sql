alter table public.clickup_awb_preview_tasks add column customize_name text not null default '';

create or replace function public.project_clickup_awb_preview(p_task_id text,p_raw jsonb,p_snapshot_at timestamptz,p_received_at timestamptz)
returns void language plpgsql security invoker set search_path = pg_catalog,public as $$
declare
 t jsonb; f jsonb; opt jsonb; h jsonb; c jsonb; imgs jsonb;
 custom_name text := ''; ref text := ''; pos integer := 999; label text; at_time timestamptz;
begin
 t := coalesce(p_raw->'task',p_raw->'data'->'task',p_raw->'current_task');
 if nullif(p_task_id,'') is null then return; end if;
 -- Only a full Get Task snapshot can replace membership or clear attachments.
 if jsonb_typeof(t->'custom_fields') = 'array' then
  for f in select value from jsonb_array_elements(t->'custom_fields') loop
   if lower(trim(f->>'name')) = 'order id / customer name' then ref := trim(coalesce(f->>'value','')); end if;
   if lower(trim(f->>'name')) = 'customize name' then custom_name := trim(coalesce(f->>'value','')); end if;
   if lower(trim(f->>'name')) = 'set' and jsonb_typeof(f->'value')='array' then
    for opt in select value from jsonb_array_elements(coalesce(f->'type_config'->'options','[]'::jsonb)) loop
     if (f->'value') ? (opt->>'id') then
      label := coalesce(opt->>'label',opt->>'name','');
      if label ~ '[0-9]+' then pos := least(pos,substring(label from '[0-9]+')::integer); end if;
     end if;
    end loop;
   end if;
  end loop;
  insert into public.clickup_awb_preview_tasks(task_id,order_reference,title,customize_name,set_position,attachments,snapshot_at,received_at)
  values(p_task_id,ref,coalesce(t->>'name',''),custom_name,pos,
   case when jsonb_typeof(t->'attachments')='array' then t->'attachments' else '[]'::jsonb end,
   coalesce(p_snapshot_at,p_received_at),p_received_at)
  on conflict(task_id) do update set order_reference=excluded.order_reference,title=excluded.title,customize_name=excluded.customize_name,
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

-- Populate only the new derived field using each task's newest complete snapshot.
with latest as (
 select distinct on(task_id) task_id,raw_payload->'task' as task
 from public.clickup_webhook_events
 where jsonb_typeof(raw_payload->'task'->'custom_fields')='array'
 order by task_id,task_updated_at desc nulls last,received_at desc
)
update public.clickup_awb_preview_tasks p set customize_name=coalesce((
 select trim(f->>'value') from jsonb_array_elements(l.task->'custom_fields') f
 where lower(trim(f->>'name'))='customize name' limit 1),'')
from latest l where p.task_id=l.task_id;
