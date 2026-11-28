create table public.awb_office_devices (
 token_hash text primary key,
 enabled boolean not null default true
);
alter table public.awb_office_devices enable row level security;
revoke all on public.awb_office_devices from public, anon, authenticated;
grant all on public.awb_office_devices to service_role;

create function public.awb_office_queue(p_key text) returns jsonb
language plpgsql security definer set search_path = pg_catalog,public as $$
begin
 if length(p_key) is distinct from 64 or not exists (
  select 1 from public.awb_office_devices where enabled and token_hash=encode(sha256(convert_to(p_key,'UTF8')),'hex')
 ) then raise exception 'Pautan PC pejabat tidak sah' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(q) order by oldest,order_reference),'[]') from (
  select order_reference,array_agg(task_id order by task_id) task_ids,min(source_updated_at) oldest
  from public.ai_clickup_work_snapshots where list_id='18375902' and lower(trim(clickup_status)) in ('print alamat','print awb')
  group by order_reference
 ) q);
end $$;
revoke all on function public.awb_office_queue(text) from public;
grant execute on function public.awb_office_queue(text) to anon,authenticated,service_role;
