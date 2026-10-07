-- Private delivery receipts only; no order, payment or ClickUp business writes.
create table public.awb_preview_action_deliveries (
  request_id uuid primary key,
  order_reference text not null,
  task_id text not null,
  buton smallint not null check (buton in (1,2,3)),
  config_version text not null,
  state text not null check (state in ('dispatching','sent','failed','unknown')),
  attempts integer not null default 1 check (attempts between 1 and 3),
  http_status integer check (http_status between 100 and 599),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index awb_preview_action_scope_idx on public.awb_preview_action_deliveries
  (order_reference,task_id,buton,created_at desc);
alter table public.awb_preview_action_deliveries enable row level security;
revoke all on public.awb_preview_action_deliveries from public, anon, authenticated;
grant select,insert,update on public.awb_preview_action_deliveries to service_role;

create function public.claim_awb_preview_action(
  p_request_id uuid, p_order_reference text, p_task_id text, p_buton integer, p_config_version text
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare receipt public.awb_preview_action_deliveries%rowtype;
begin
  if p_request_id is null or p_buton is null or p_buton not in (1,2,3) or not exists (
    select 1 from public.clickup_awb_preview_tasks where task_id=p_task_id and order_reference=p_order_reference
  ) then return jsonb_build_object('state','rejected','error','Task tidak lagi berkaitan dengan order ini. Tekan Refresh.'); end if;
  if not exists (select 1 from public.private_runtime_settings where setting_key='awb_preview_action_webhook_url'
    and btrim(setting_value)<>'' and updated_at=p_config_version::timestamptz)
  then return jsonb_build_object('state','rejected','error','Tetapan webhook berubah. Tekan Refresh.'); end if;
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
    if receipt.state='dispatching' and receipt.updated_at>now()-interval '60 seconds' then return jsonb_build_object('state','pending'); end if;
    if receipt.state in ('dispatching','unknown') then
      update public.awb_preview_action_deliveries set state='unknown',updated_at=now() where request_id=p_request_id;
      return jsonb_build_object('state','unknown');
    end if;
    if receipt.attempts>=3 then return jsonb_build_object('state','rejected','error','Had cuba semula tercapai. Semak automation.'); end if;
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

create function public.finish_awb_preview_action(p_request_id uuid,p_state text,p_http_status integer)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if p_state is null or p_state not in ('sent','failed','unknown') then raise exception 'Invalid delivery state'; end if;
  update public.awb_preview_action_deliveries set state=p_state,http_status=p_http_status,updated_at=now()
    where request_id=p_request_id and state='dispatching';
end $$;
revoke all on function public.claim_awb_preview_action(uuid,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.finish_awb_preview_action(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.claim_awb_preview_action(uuid,text,text,integer,text) to service_role;
grant execute on function public.finish_awb_preview_action(uuid,text,integer) to service_role;
