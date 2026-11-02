-- Execute against Unified Inbox; all synthetic state rolls back.
begin;
update public.autobrief_followup_control set enabled=true where singleton;
do $test$
declare a jsonb; b jsonb; c jsonb;
begin
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
 if has_function_privilege('anon','public.icetak_autobrief_delivery(text,text,text,text,jsonb)','execute')
  or has_function_privilege('authenticated','public.icetak_autobrief_delivery(text,text,text,text,jsonb)','execute') then raise exception 'browser execute granted';end if;
 if has_table_privilege('authenticated','public.autobrief_followup_deliveries','select') then raise exception 'browser table granted';end if;
end $test$;
rollback;
