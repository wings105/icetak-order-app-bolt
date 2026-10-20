create or replace function public.icetak_task_detail_intake_record(p_run uuid,p_key text,p_version integer,p_revision text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.order_detail_automation;changed boolean;
begin
 if not exists(select 1 from task_detail_private.runtime where id and lease_id=p_run and lease_until>now()) then raise exception 'LEASE_EXPIRED';end if;
 if p_key !~ '^(icetak|shopee):[a-f0-9-]{36}$' or jsonb_typeof(p_data)<>'object' or length(p_data::text)>600000 then raise exception 'INVALID_INTAKE';end if;
 if public.icetak_task_detail_order_revision(split_part(p_key,':',1),split_part(p_key,':',2)::uuid) is distinct from p_revision then raise exception 'SOURCE_CHANGED_REFRESH';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key,27));
 select * into old from public.order_detail_automation where row_key=p_key for update;
 if coalesce(old.version,0)<>p_version then raise exception 'VERSION_CONFLICT_REFRESH';end if;
 changed:=old.row_key is null or (old.data-'checked_at') is distinct from (p_data-'checked_at');
 -- Per-item check timestamps are observational and cannot grow duplicate history every minute.
 if old.row_key is not null and jsonb_array_length(coalesce(old.data->'items','[]'))=jsonb_array_length(coalesce(p_data->'items','[]')) then
  changed:=(old.data-'items'-'checked_at') is distinct from (p_data-'items'-'checked_at') or
   (select jsonb_agg((i-'observation')||jsonb_build_object('observation',(i->'observation')-'checked_at')) from jsonb_array_elements(old.data->'items') i) is distinct from
   (select jsonb_agg((i-'observation')||jsonb_build_object('observation',(i->'observation')-'checked_at')) from jsonb_array_elements(p_data->'items') i);
 end if;
 if changed then
  insert into public.order_detail_automation(row_key,version,data) values(p_key,coalesce(old.version,0)+1,p_data)
  on conflict(row_key) do update set version=excluded.version,data=excluded.data,last_checked_at=now(),updated_at=now();
  insert into public.order_detail_automation_events(row_key,version,data) values(p_key,coalesce(old.version,0)+1,p_data);
 else update public.order_detail_automation set last_checked_at=now() where row_key=p_key;end if;
 return jsonb_build_object('ok',true,'changed',changed);
end;$$;
