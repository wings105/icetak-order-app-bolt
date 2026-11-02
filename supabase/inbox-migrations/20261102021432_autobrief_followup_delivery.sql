-- Unified Inbox only. Same Shopee credentials/transport, private order-stage receipts.
create table public.autobrief_followup_control (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
insert into public.autobrief_followup_control(singleton) values(true);
create table public.autobrief_followup_context (
 shop_id text not null, buyer_id text not null, conversation_id text not null,
 updated_at timestamptz not null default now(), primary key(shop_id,buyer_id)
);
create table public.autobrief_followup_deliveries (
 shop_id text not null, order_sn text not null, phase text not null check(phase in ('first','deadline')),
 buyer_id text not null, request_id uuid not null default gen_random_uuid() unique,
 state text not null check(state in ('sending','sent','manual','unknown','failed','blocked')),
 text_content text not null, provider_message_id text, conversation_id text,
 attempts int not null default 0, next_retry_at timestamptz, error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),sent_at timestamptz,
 primary key(shop_id,order_sn,phase)
);
alter table public.autobrief_followup_control enable row level security;
alter table public.autobrief_followup_context enable row level security;
alter table public.autobrief_followup_deliveries enable row level security;
revoke all on public.autobrief_followup_control,public.autobrief_followup_context,public.autobrief_followup_deliveries from public,anon,authenticated;
grant select,insert,update on public.autobrief_followup_control,public.autobrief_followup_context,public.autobrief_followup_deliveries to service_role;

create function public.icetak_autobrief_delivery(p_action text,p_shop text,p_order text,p_phase text,p_body jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare r public.autobrief_followup_deliveries; fresh boolean:=false; result_state text;
begin
 if p_shop !~ '^[0-9]{1,20}$' or p_order !~ '^[A-Z0-9]{10,24}$' or p_phase not in ('first','deadline') then raise exception 'INVALID_DELIVERY_ID';end if;
 if p_action='status' then
  select * into r from public.autobrief_followup_deliveries where shop_id=p_shop and order_sn=p_order and phase=p_phase;
  return coalesce(to_jsonb(r),'{}'::jsonb);
 end if;
 if p_action in ('claim','manual','observe') then
  if coalesce(p_body->>'buyer_id','') !~ '^[0-9]{1,15}$' or length(coalesce(p_body->>'text','')) not between 1 and 4000 then raise exception 'INVALID_DELIVERY_BODY';end if;
  if p_action='manual' and p_phase<>'first' then raise exception 'MANUAL_FIRST_ONLY';end if;
  if p_action='claim' and not (select enabled from public.autobrief_followup_control where singleton) then return jsonb_build_object('claimed',false,'state','disabled');end if;
  if p_action='observe' and coalesce(p_body->>'provider_message_id','')='' then raise exception 'PROVIDER_PROOF_REQUIRED';end if;
  result_state:=case p_action when 'manual' then 'manual' when 'observe' then 'sent' else 'sending' end;
  insert into public.autobrief_followup_deliveries(shop_id,order_sn,phase,buyer_id,state,text_content,provider_message_id,conversation_id,attempts,sent_at)
  values(p_shop,p_order,p_phase,p_body->>'buyer_id',result_state,p_body->>'text',p_body->>'provider_message_id',p_body->>'conversation_id',case when p_action='claim' then 1 else 0 end,
   case when p_action='observe' then (p_body->>'sent_at')::timestamptz else null end)
  on conflict do nothing returning * into r;
  fresh:=found;
  if not fresh then
   select * into r from public.autobrief_followup_deliveries where shop_id=p_shop and order_sn=p_order and phase=p_phase for update;
   if r.buyer_id<>p_body->>'buyer_id' or r.text_content<>p_body->>'text' then raise exception 'DELIVERY_IDENTITY_CONFLICT';end if;
   if p_action='observe' and r.state in ('sending','unknown','manual','failed') then
    update public.autobrief_followup_deliveries set state='sent',provider_message_id=p_body->>'provider_message_id',conversation_id=p_body->>'conversation_id',sent_at=(p_body->>'sent_at')::timestamptz,error=null,updated_at=now()
    where shop_id=p_shop and order_sn=p_order and phase=p_phase returning * into r;
   elsif p_action='claim' and r.state='failed' and r.attempts<3 and r.next_retry_at<=now() then
    update public.autobrief_followup_deliveries set state='sending',attempts=attempts+1,updated_at=now(),error=null where shop_id=p_shop and order_sn=p_order and phase=p_phase returning * into r;
    fresh:=true;
   end if;
  end if;
  return to_jsonb(r)||jsonb_build_object('claimed',fresh and p_action='claim');
 end if;
 if p_action='record' then
  result_state:=p_body->>'state';
  if result_state not in ('sent','unknown','failed','blocked') then raise exception 'INVALID_DELIVERY_STATE';end if;
  if result_state='sent' and coalesce(p_body->>'provider_message_id','')='' then raise exception 'PROVIDER_PROOF_REQUIRED';end if;
  update public.autobrief_followup_deliveries set state=result_state,provider_message_id=p_body->>'provider_message_id',error=left(p_body->>'error',200),updated_at=now(),
   next_retry_at=case when result_state='failed' then now()+interval '5 minutes' else null end,
   sent_at=case when result_state='sent' then now() else sent_at end
  where shop_id=p_shop and order_sn=p_order and phase=p_phase and request_id=(p_body->>'request_id')::uuid and state='sending' returning * into r;
  if not found then raise exception 'DELIVERY_CLAIM_CHANGED';end if;
  return to_jsonb(r);
 end if;
 raise exception 'INVALID_DELIVERY_ACTION';
end $fn$;
revoke all on function public.icetak_autobrief_delivery(text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_autobrief_delivery(text,text,text,text,jsonb) to service_role;
