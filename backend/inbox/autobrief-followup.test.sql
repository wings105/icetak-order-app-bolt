-- Execute against Unified Inbox; all synthetic state rolls back.
begin;
update public.autobrief_followup_control set enabled=true where singleton;
do $test$
declare a jsonb; b jsonb; c jsonb;
begin
 b:=public.icetak_autobrief_delivery('claim','111','QA000000000001','first','{"buyer_id":"222","text":"synthetic"}');
 if (b->>'claimed')::boolean or b->>'error'<>'ORDER_CARD_NOT_CONFIRMED' then raise exception 'card-first gate missing';end if;
 c:=public.icetak_autobrief_delivery('claim','111','QA000000000001','order_card','{"buyer_id":"222","text":"card"}');
 b:=public.icetak_autobrief_delivery('record','111','QA000000000001','order_card',jsonb_build_object('state','sent','provider_message_id','998','request_id',c->>'request_id'));
 a:=public.icetak_autobrief_delivery('claim','111','QA000000000001','first','{"buyer_id":"222","text":"synthetic"}');
 b:=public.icetak_autobrief_delivery('claim','111','QA000000000001','first','{"buyer_id":"222","text":"synthetic"}');
 if not (a->>'claimed')::boolean or (b->>'claimed')::boolean or a->>'request_id'<>b->>'request_id' then raise exception 'claim dedupe failed';end if;
 c:=public.icetak_autobrief_delivery('record','111','QA000000000001','first',jsonb_build_object('state','unknown','request_id',a->>'request_id'));
 b:=public.icetak_autobrief_delivery('claim','111','QA000000000001','first','{"buyer_id":"222","text":"synthetic"}');
 if (b->>'claimed')::boolean or b->>'state'<>'unknown' then raise exception 'unknown resend';end if;
 c:=public.icetak_autobrief_delivery('observe','111','QA000000000001','first','{"buyer_id":"222","text":"synthetic","provider_message_id":"999","sent_at":"2026-11-02T01:00:00Z"}');
 if c->>'state'<>'sent' then raise exception 'reconciliation failed';end if;
 b:=public.icetak_autobrief_delivery('manual','111','QA000000000002','first','{"buyer_id":"222","text":"synthetic"}');
 if b->>'state'<>'manual' or b->>'provider_message_id' is not null then raise exception 'manual proof mislabelled';end if;
 -- One recovery attempt after the proven first-chat failure is unlocked only by a card.
 insert into public.autobrief_followup_deliveries(shop_id,order_sn,phase,buyer_id,state,text_content,attempts,next_retry_at,error)
 values('111','QA000000000003','first','222','failed','synthetic',3,now()-interval '1 minute','SHOPEE_first_chat_without_order_info');
 b:=public.icetak_autobrief_delivery('claim','111','QA000000000003','first','{"buyer_id":"222","text":"synthetic"}');
 if (b->>'claimed')::boolean then raise exception 'recovery without card';end if;
 c:=public.icetak_autobrief_delivery('observe','111','QA000000000003','order_card','{"buyer_id":"222","text":"card","provider_message_id":"997","sent_at":"2026-11-03T01:00:00Z"}');
 b:=public.icetak_autobrief_delivery('claim','111','QA000000000003','first','{"buyer_id":"222","text":"synthetic"}');
 if not (b->>'claimed')::boolean or (b->>'attempts')::integer<>4 then raise exception 'post-card recovery not claimed';end if;
 c:=public.icetak_autobrief_delivery('record','111','QA000000000003','first',jsonb_build_object('state','failed','error','SHOPEE_first_chat_without_order_info','request_id',b->>'request_id'));
 update public.autobrief_followup_deliveries set next_retry_at=now()-interval '1 minute' where shop_id='111' and order_sn='QA000000000003' and phase='first';
 b:=public.icetak_autobrief_delivery('claim','111','QA000000000003','first','{"buyer_id":"222","text":"synthetic"}');
 if (b->>'claimed')::boolean then raise exception 'recovery exceeded bound';end if;
 if has_function_privilege('anon','public.icetak_autobrief_delivery(text,text,text,text,jsonb)','execute')
  or has_function_privilege('authenticated','public.icetak_autobrief_delivery(text,text,text,text,jsonb)','execute') then raise exception 'browser execute granted';end if;
 if has_table_privilege('authenticated','public.autobrief_followup_deliveries','select') then raise exception 'browser table granted';end if;
end $test$;
rollback;
