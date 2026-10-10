-- Apply to Inbox. Staff and bridge use the same idempotent sending ledger.
alter table public.shopee_chat_send_attempts alter column order_summary_id drop not null;
alter table public.shopee_chat_send_attempts alter column order_no drop not null;
alter table public.shopee_chat_send_attempts add column request_id uuid unique;
alter table public.shopee_chat_send_attempts add column actor_label text;
alter table public.shopee_chat_send_attempts add column local_message_id uuid references public.messages(id) on delete set null;
alter table public.shopee_chat_send_attempts drop constraint shopee_chat_send_attempts_status_check;
alter table public.shopee_chat_send_attempts add constraint shopee_chat_send_attempts_status_check check(status in ('configuration_required','sending','sent','failed','unknown'));
alter table public.shopee_chat_send_attempts enable row level security;
revoke all on public.shopee_chat_send_attempts from anon,authenticated;
create function public.claim_shopee_send(p_request_id uuid,p_conversation_id uuid,p_order_summary_id uuid,p_order_no text,p_staff_user_id uuid,p_actor_label text,p_text text,p_buyer_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.shopee_chat_send_attempts%rowtype; v_message uuid;
begin
 insert into public.shopee_chat_send_attempts(request_id,conversation_id,order_summary_id,order_no,staff_user_id,actor_label,message_preview,buyer_identifier,status)
 values(p_request_id,p_conversation_id,p_order_summary_id,p_order_no,p_staff_user_id,p_actor_label,p_text,p_buyer_id,'sending')
 on conflict(request_id) do nothing returning * into a;
 if a.id is null then
  select * into a from public.shopee_chat_send_attempts where request_id=p_request_id;
  if a.conversation_id is distinct from p_conversation_id or a.message_preview is distinct from p_text or a.actor_label is distinct from p_actor_label then raise exception 'Request ID conflict';end if;
  return jsonb_build_object('claimed',false,'attempt',to_jsonb(a));
 end if;
 insert into public.messages(conversation_id,channel,direction,sender_type,message_type,text_content,status,source,raw_payload)
 values(p_conversation_id,'shopee','outbound','seller','text',p_text,'pending','icetak-panel',jsonb_build_object('send_request_id',p_request_id,'staff_user_id',p_staff_user_id,'actor_label',p_actor_label)) returning id into v_message;
 update public.shopee_chat_send_attempts set local_message_id=v_message where id=a.id returning * into a;
 return jsonb_build_object('claimed',true,'attempt',to_jsonb(a));
end $$;
revoke all on function public.claim_shopee_send(uuid,uuid,uuid,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_shopee_send(uuid,uuid,uuid,text,uuid,text,text,text) to service_role;
create index shopee_send_local_message_idx on public.shopee_chat_send_attempts(local_message_id);
