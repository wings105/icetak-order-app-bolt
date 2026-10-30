create or replace function public.claim_awb_preview_action(
  p_request_id uuid, p_order_reference text, p_task_id text, p_buton integer, p_config_version text
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare receipt public.awb_preview_action_deliveries%rowtype;
begin
  if p_request_id is null or p_buton is null or p_buton not in (1,2,3) or not exists (
    select 1 from public.clickup_awb_preview_tasks where task_id=p_task_id and order_reference=p_order_reference
  ) then return jsonb_build_object('state','rejected','error','Task tidak lagi berkaitan dengan order ini. Tekan Refresh.'); end if;
  if not exists (select 1 from public.private_runtime_settings where setting_key='clickup_designer_api_token'
    and btrim(setting_value)<>'' and p_config_version like 'native-clickup-v1:%' and updated_at=(case when p_config_version like 'native-clickup-v1:%' then substring(p_config_version from 19)::timestamptz else null end))
  then return jsonb_build_object('state','rejected','error','Sambungan ClickUp berubah. Tekan Refresh.'); end if;
  -- Stable request ID deduplicates retries; scope lock also bounds distinct requests.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(p_order_reference||':'||p_task_id||':'||p_buton::text,1));
  select * into receipt from public.awb_preview_action_deliveries where request_id=p_request_id for update;
  if found then
    if receipt.order_reference<>p_order_reference or receipt.task_id<>p_task_id or receipt.buton<>p_buton
       or receipt.config_version<>p_config_version then
      return jsonb_build_object('state','rejected','error','Request ID telah digunakan untuk tindakan lain.');
    end if;
    if receipt.state='sent' then return jsonb_build_object('state','sent'); end if;
    if receipt.state='dispatching' and receipt.updated_at>now()-interval '2 minutes' then return jsonb_build_object('state','pending'); end if;
    if receipt.state in ('dispatching','unknown') then
      update public.awb_preview_action_deliveries set state='unknown',updated_at=now() where request_id=p_request_id;
      return jsonb_build_object('state','unknown');
    end if;
    if receipt.attempts>=3 then return jsonb_build_object('state','rejected','error','Had cuba semula tercapai. Semak task ClickUp.'); end if;
    update public.awb_preview_action_deliveries set state='dispatching',attempts=attempts+1,http_status=null,updated_at=now() where request_id=p_request_id;
  else
    if (select count(*) from public.awb_preview_action_deliveries where order_reference=p_order_reference
      and task_id=p_task_id and buton=p_buton and created_at>now()-interval '10 minutes')>=5
    then return jsonb_build_object('state','rejected','error','Terlalu banyak tindakan. Cuba lagi kemudian.'); end if;
    insert into public.awb_preview_action_deliveries(request_id,order_reference,task_id,buton,config_version,state)
      values(p_request_id,p_order_reference,p_task_id,p_buton,p_config_version,'dispatching');
  end if;
  return jsonb_build_object('state','claimed');
end $$;


-- Serialize native AWB actions with the existing designer/Inbox action ledgers.
-- Service-only receipt tables retain RLS and their original grants.
create or replace function public.guard_clickup_action_concurrency()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (TG_TABLE_NAME='awb_preview_action_deliveries' and new.state<>'dispatching')
 or (TG_TABLE_NAME<>'awb_preview_action_deliveries' and new.state<>'processing') then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.task_id,7821));
 if exists(select 1 from public.awb_preview_action_deliveries where task_id=new.task_id and state='dispatching' and updated_at>now()-interval '2 minutes' and (TG_TABLE_NAME<>'awb_preview_action_deliveries' or request_id<>new.request_id))
 or exists(select 1 from public.task_clickup_actions where task_id=new.task_id and state='processing' and updated_at>now()-interval '2 minutes' and (TG_TABLE_NAME<>'task_clickup_actions' or request_id<>new.request_id))
 or exists(select 1 from public.inbox_clickup_actions where task_id=new.task_id and state='processing' and updated_at>now()-interval '2 minutes' and (TG_TABLE_NAME<>'inbox_clickup_actions' or request_id<>new.request_id)) then
  raise exception 'TASK_ACTION_BUSY';
 end if;
 return new;
end $$;
revoke all on function public.guard_clickup_action_concurrency() from public,anon,authenticated;
grant execute on function public.guard_clickup_action_concurrency() to service_role;
create trigger awb_native_action_lock before insert or update on public.awb_preview_action_deliveries for each row execute function public.guard_clickup_action_concurrency();
create trigger awb_native_action_lock before insert or update on public.task_clickup_actions for each row execute function public.guard_clickup_action_concurrency();
create trigger awb_native_action_lock before insert or update on public.inbox_clickup_actions for each row execute function public.guard_clickup_action_concurrency();
notify pgrst,'reload schema';
