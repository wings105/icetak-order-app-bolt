-- Conversation feedback is isolated from QRPay/draft learning. No automatic sending or model training.
create table public.ai_dashboard_training (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 conversation_id uuid not null,
 inbound_revision text not null,
 channel text not null check(channel in ('whatsapp','shopee')),
 intent text not null,
 verdict text not null check(verdict in ('accepted','corrected','rejected')),
 evidence jsonb not null default '[]',
 original_response text not null default '',
 corrected_response text not null default '' check(length(corrected_response)<=4000),
 lesson text not null check(length(lesson) between 3 and 2000),
 reusable_response text not null default '' check(length(reusable_response)<=4000),
 engine text not null,
 confidence text not null,
 state text not null default 'candidate' check(state in ('candidate','approved','rejected')),
 created_by text not null,
 created_at timestamptz not null default now(),
 reviewed_by text,
 reviewed_at timestamptz,
 version integer not null default 1
);
create index ai_dashboard_training_conversation_idx on public.ai_dashboard_training(conversation_id,created_at desc);
create index ai_dashboard_training_scope_idx on public.ai_dashboard_training(channel,intent,state,created_at desc);
create table public.ai_dashboard_training_events (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 training_id uuid not null references public.ai_dashboard_training(id),
 actor text not null, action text not null, created_at timestamptz not null default now(),
 before_state jsonb, after_state jsonb not null, request_data jsonb not null
);
alter table public.ai_dashboard_training enable row level security;
alter table public.ai_dashboard_training_events enable row level security;
revoke all on public.ai_dashboard_training,public.ai_dashboard_training_events from public,anon,authenticated;
grant select on public.ai_dashboard_training,public.ai_dashboard_training_events to service_role;
create function public.icetak_ai_dashboard_training(p_action text,p_actor text,p_request_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.ai_dashboard_training%rowtype; v_old jsonb; v_event public.ai_dashboard_training_events%rowtype;
begin
 if p_actor is null or trim(p_actor)='' or p_request_id is null then raise exception 'Invalid training identity'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,7));
 select * into v_event from ai_dashboard_training_events where request_id=p_request_id;
 if found then
  if v_event.actor<>p_actor or v_event.action<>p_action or v_event.request_data<>p_data then raise exception 'Request ID conflict'; end if;
  return jsonb_build_object('example',v_event.after_state,'duplicate',true);
 end if;
 if p_action='capture' then
  if coalesce(p_data->>'intent','') not in ('complaint','shipping','design','payment','new_order','enquiry','followup','other') then raise exception 'Invalid intent'; end if;
  if nullif(p_data->>'inbound_revision','') is null then raise exception 'Missing revision'; end if;
  insert into ai_dashboard_training(request_id,conversation_id,inbound_revision,channel,intent,verdict,evidence,original_response,corrected_response,lesson,reusable_response,engine,confidence,created_by)
  values(p_request_id,(p_data->>'conversation_id')::uuid,p_data->>'inbound_revision',p_data->>'channel',p_data->>'intent',p_data->>'verdict',coalesce(p_data->'evidence','[]'),coalesce(p_data->>'original_response',''),coalesce(p_data->>'corrected_response',''),p_data->>'lesson',coalesce(p_data->>'reusable_response',''),p_data->>'engine',p_data->>'confidence',p_actor) returning * into v;
 elsif p_action in ('approve','reject') then
  select * into v from ai_dashboard_training where id=(p_data->>'id')::uuid for update;
  if not found then raise exception 'Training example not found'; end if;
  if (p_data->>'expected_version') is null or v.version<>(p_data->>'expected_version')::integer then raise exception 'TRAINING_CHANGED: Muat semula latihan.'; end if;
  if p_action='approve' and trim(v.reusable_response)='' then raise exception 'Contoh SOP umum diperlukan sebelum diluluskan.'; end if;
  v_old:=to_jsonb(v);
  update ai_dashboard_training set state=case when p_action='approve' then 'approved' else 'rejected' end,
   reviewed_by=p_actor,reviewed_at=now(),version=version+1 where id=v.id returning * into v;
 else raise exception 'Invalid training action'; end if;
 insert into ai_dashboard_training_events(request_id,training_id,actor,action,before_state,after_state,request_data)
 values(p_request_id,v.id,p_actor,p_action,v_old,to_jsonb(v),p_data);
 return jsonb_build_object('example',to_jsonb(v),'duplicate',false);
end $$;
revoke all on function public.icetak_ai_dashboard_training(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_ai_dashboard_training(text,text,uuid,jsonb) to service_role;
