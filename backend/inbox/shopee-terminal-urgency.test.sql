-- Execute inside BEGIN / ROLLBACK. No provider sends.
set local role service_role;
do $$
declare c uuid;u uuid;t uuid;begin
 insert into public.customers(display_name) values('QA terminal urgency') returning id into u;
 insert into public.conversations(customer_id,channel,external_conversation_id,external_customer_id,metadata)
 values(u,'shopee','qa-terminal-urgency','99123988777',jsonb_build_object('shop_id','188218638','username','qa_terminal_urgency')) returning id into c;
 select id into t from public.tags where slug='urgent';
 if t is null then raise exception 'urgent_tag_missing';end if;
 insert into public.external_order_summaries(source_project,source_channel,external_order_id,order_no,shopee_username,shopee_buyer_id,shop_id,order_status,active_order,placed_at)
 values('icetak-order-system','shopee','QATERMINAL001','QATERMINAL001','qa_terminal_urgency','99123988777','188218638','READY_TO_SHIP',true,now()-interval '2 days');
 update public.conversations set priority='urgent',needs_reply=true,unread_count=2,last_inbound_at=now()-interval '1 hour',manual_replied_at=null where id=c;
 insert into public.conversation_tags(conversation_id,tag_id,source) values(c,t,'manual');
 update public.external_order_summaries set order_status='SHIPPED',active_order=false,shipped_at=now() where order_no='QATERMINAL001';
 if not (select needs_reply and unread_count=2 and priority='normal' from public.conversations where id=c) then raise exception 'shipped_reply_or_priority_wrong';end if;
 if exists(select 1 from public.conversation_tags where conversation_id=c and tag_id=t) then raise exception 'shipped_urgent_tag_retained';end if;
 update public.conversations set priority='urgent',ai_urgency='critical',ai_priority_score=95 where id=c;
 insert into public.conversation_tags(conversation_id,tag_id,source) values(c,t,'ai');
 if (select priority='urgent' or ai_urgency='critical' or ai_priority_score>30 from public.conversations where id=c) or exists(select 1 from public.conversation_tags where conversation_id=c and tag_id=t) then raise exception 'terminal_urgent_readded';end if;
 insert into public.external_order_summaries(source_project,source_channel,external_order_id,order_no,shopee_username,shopee_buyer_id,shop_id,order_status,active_order,placed_at)
 values('icetak-order-system','shopee','QATERMINAL002','QATERMINAL002','qa_terminal_urgency','99123988777','188218638','READY_TO_SHIP',true,now());
 update public.conversations set priority='urgent' where id=c;
 insert into public.conversation_tags(conversation_id,tag_id,source) values(c,t,'manual');
 if not (select priority='urgent' from public.conversations where id=c) then raise exception 'new_active_order_urgent_blocked';end if;
 update public.external_order_summaries set updated_at=now() where order_no='QATERMINAL001';
 if not (select priority='urgent' from public.conversations where id=c) then raise exception 'older_shipped_order_cleared_new_urgent';end if;
 update public.external_order_summaries set order_status='CANCELLED',active_order=false where order_no='QATERMINAL002';
 if not (select needs_reply and unread_count=2 and priority='normal' from public.conversations where id=c) then raise exception 'cancelled_cleared_reply_or_retained_urgent';end if;
 if exists(select 1 from public.conversation_tags where conversation_id=c and tag_id=t) then raise exception 'cancelled_urgent_tag_retained';end if;
 update public.conversations set manual_replied_at=now(),needs_reply=false,unread_count=0 where id=c;
 update public.conversations set needs_reply=true,unread_count=1 where id=c;
 if (select needs_reply from public.conversations where id=c) then raise exception 'stale_inbound_reopened_manual_reply';end if;
 update public.conversations set last_inbound_at=now()+interval '1 second',needs_reply=true,unread_count=1 where id=c;
 if not (select needs_reply from public.conversations where id=c) then raise exception 'new_inbound_after_cancelled_blocked';end if;
 if not exists(select 1 from public.shopee_order_sessions where order_no='QATERMINAL002' and status='closed') then raise exception 'cancelled_session_reopened';end if;
end $$;
reset role;
select 'TERMINAL_URGENCY_REPLY_PASS' result;
