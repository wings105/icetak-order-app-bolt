create table public.ai_dashboard_case_orders(
 conversation_id uuid primary key,inbound_revision text not null,session_key text not null,
 order_kind text check(order_kind in ('icetak','shopee')),order_id uuid,order_reference text,
 version integer not null default 1,updated_by text not null,updated_at timestamptz not null default now(),
 check((order_kind is null and order_id is null and order_reference is null) or (order_kind is not null and order_id is not null and order_reference is not null))
);
create table public.ai_dashboard_case_order_events(
 request_id uuid primary key,conversation_id uuid not null,actor text not null,payload jsonb not null,
 before_state jsonb,after_state jsonb not null,created_at timestamptz not null default now()
);
create index ai_dashboard_case_order_events_conv_idx on public.ai_dashboard_case_order_events(conversation_id,created_at desc);
alter table public.ai_dashboard_case_orders enable row level security;
alter table public.ai_dashboard_case_order_events enable row level security;
revoke all on public.ai_dashboard_case_orders,public.ai_dashboard_case_order_events from public,anon,authenticated;
grant select on public.ai_dashboard_case_orders,public.ai_dashboard_case_order_events to service_role;
create function public.icetak_ai_case_order(p_actor text,p_request_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.ai_dashboard_case_orders%rowtype;v_new public.ai_dashboard_case_orders%rowtype;e public.ai_dashboard_case_order_events%rowtype;cid uuid:=(p_data->>'conversation_id')::uuid;
begin
 if cid is null or p_actor is null or trim(p_actor)='' or p_request_id is null or nullif(p_data->>'inbound_revision','') is null or p_data->>'session_key' is null then raise exception 'Invalid case identity';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,10));
 perform pg_advisory_xact_lock(hashtextextended(cid::text,11));
 select * into e from ai_dashboard_case_order_events where request_id=p_request_id;
 if found then
  if e.actor<>p_actor or e.payload<>p_data then raise exception 'Request ID conflict';end if;
  return jsonb_build_object('binding',e.after_state,'duplicate',true);
 end if;
 select * into v_old from ai_dashboard_case_orders where conversation_id=cid for update;
 if p_data->>'expected_version' is null or coalesce(v_old.version,0)<>(p_data->>'expected_version')::integer then raise exception 'CASE_CHANGED: Muat semula padanan order.';end if;
 insert into ai_dashboard_case_orders(conversation_id,inbound_revision,session_key,order_kind,order_id,order_reference,version,updated_by)
 values(cid,p_data->>'inbound_revision',p_data->>'session_key',p_data->>'order_kind',nullif(p_data->>'order_id','')::uuid,p_data->>'order_reference',coalesce(v_old.version,0)+1,p_actor)
 on conflict(conversation_id) do update set inbound_revision=excluded.inbound_revision,session_key=excluded.session_key,order_kind=excluded.order_kind,order_id=excluded.order_id,order_reference=excluded.order_reference,version=excluded.version,updated_by=excluded.updated_by,updated_at=now() returning * into v_new;
 insert into ai_dashboard_case_order_events(request_id,conversation_id,actor,payload,before_state,after_state) values(p_request_id,cid,p_actor,p_data,case when v_old.conversation_id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));
 return jsonb_build_object('binding',to_jsonb(v_new),'duplicate',false);
end $$;
revoke all on function public.icetak_ai_case_order(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_ai_case_order(text,uuid,jsonb) to service_role;
