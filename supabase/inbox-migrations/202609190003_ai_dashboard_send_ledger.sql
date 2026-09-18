-- Unified Inbox only: API sends are explicit admin actions with durable retry protection.
create table if not exists public.ai_dashboard_send_attempts (
 request_id uuid primary key, conversation_id uuid not null references public.conversations(id),
 actor text not null, text_content text not null, revision text not null,
 status text not null check(status in ('sending','sent','failed','unknown')),
 provider_message_id text, error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.ai_dashboard_send_attempts enable row level security;
revoke all on public.ai_dashboard_send_attempts from anon,authenticated;
grant all on public.ai_dashboard_send_attempts to service_role;
create or replace function public.icetak_ai_claim_send(p_request_id uuid,p_conversation_id uuid,p_actor text,p_text text,p_revision text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.ai_dashboard_send_attempts%rowtype; v_revision text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,1));
 select * into v from ai_dashboard_send_attempts where request_id=p_request_id;
 if found then
  if v.conversation_id<>p_conversation_id or v.text_content<>p_text or v.actor<>p_actor then raise exception 'Request ID conflict'; end if;
  return jsonb_build_object('claimed',false,'attempt',to_jsonb(v));
 end if;
 if exists(select 1 from ai_dashboard_send_attempts where conversation_id=p_conversation_id and status in ('sending','unknown')) then
  raise exception 'Satu penghantaran belum disahkan. Semak chat asal sebelum cuba semula.';
 end if;
 select m.id::text||'@'||coalesce(m.updated_at,m.created_at)::text into v_revision from messages m
 where m.conversation_id=p_conversation_id order by m.created_at desc,m.id desc limit 1;
 if coalesce(v_revision,'empty')<>p_revision then raise exception 'CHAT_CHANGED: Muat semula chat sebelum hantar.'; end if;
 insert into ai_dashboard_send_attempts(request_id,conversation_id,actor,text_content,revision,status)
 values(p_request_id,p_conversation_id,p_actor,p_text,p_revision,'sending') returning * into v;
 return jsonb_build_object('claimed',true,'attempt',to_jsonb(v));
end; $$;
revoke all on function public.icetak_ai_claim_send(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.icetak_ai_claim_send(uuid,uuid,text,text,text) to service_role;
