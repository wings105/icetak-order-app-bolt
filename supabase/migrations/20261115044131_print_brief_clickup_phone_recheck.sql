create function clickup_gate.recheck_print_brief_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  worker_token text;
begin
  -- Keep the existing lease and retry contract. Never send a customer message.
  update public.clickup_order_brief_jobs j
     set next_poll_at=least(coalesce(j.next_poll_at,now()),now()),
         next_attempt_at=case when j.state='failed' then now() else j.next_attempt_at end,
         attempts=case when j.state='failed' then 0 else j.attempts end
    from public.clickup_autobrief_routes r
   where j.task_id=new.task_id and r.task_id=j.task_id
     and r.profile in ('edible','wafer') and r.confirmed_at is null
     and j.state in ('pending','review','failed')
     and (j.comment_id is null or j.brief->>'profile'='edible-wafer-v1')
     and exists (
       select 1
       from public.ai_clickup_work_snapshots s
       join public.marketplace_orders o on o.id=s.marketplace_order_id and o.provider='shopee'
       where s.task_id=j.task_id and s.list_id='18375902'
         and lower(btrim(s.clickup_status))=r.initial_status
     );
  if not found then return new; end if;

  if not exists (
    select 1 from public.clickup_order_brief_settings cfg
    where cfg.singleton and cfg.enabled and cfg.print_brief_rollout_after is not null
  ) then return new; end if;
  select setting_value into worker_token from public.private_runtime_settings
  where setting_key='order_brief_worker_token';

  if nullif(worker_token,'') is not null then
    begin
      perform net.http_post(
        url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-order-brief',
        body:=jsonb_build_object('action','print_run','task_id',new.task_id),
        headers:=jsonb_build_object('Content-Type','application/json','x-order-brief-token',worker_token),
        timeout_milliseconds:=120000
      );
    exception when others then
      -- The regular worker can pick up the due job if pg_net is unavailable.
      raise warning 'Could not dispatch print brief phone recheck (SQLSTATE %)',sqlstate;
    end;
  end if;
  return new;
end
$fn$;

revoke all on function clickup_gate.recheck_print_brief_phone() from public,anon,authenticated;

create trigger recheck_print_brief_phone after insert on public.clickup_webhook_events
for each row when (
  new.list_id='18375902'
  and (
    new.custom_field_id='1a42fde0-d52a-4911-827d-d89e7bd3b7bd'
    or lower(new.custom_field_name)='phone'
    or lower(new.changed_field)='phone'
  )
  and new.before_value is distinct from new.after_value
  and regexp_replace(coalesce(new.after_value #>> '{}',''),'[^0-9]','','g') ~ '^[0-9]{9,15}$'
)
execute function clickup_gate.recheck_print_brief_phone();
