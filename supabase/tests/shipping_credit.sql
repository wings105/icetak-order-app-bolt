-- Run on Order System; all fixture mutations and pg_net enqueues roll back.
begin;
do $test$
declare sid uuid; initial numeric; baseline integer; first_episode uuid; next_episode uuid; v jsonb;
begin
 select id,charged_amount into sid,initial from public.shipments where provider='parceldaily' and charged_amount>0 and booked_at is not null limit 1;
 if sid is null then raise exception 'TEST_SHIPMENT_MISSING';end if;
 select count(*) into baseline from shipping_credit.entries where shipment_id=sid;
 update public.shipments set charged_amount=initial+1 where id=sid;
 update public.shipments set charged_amount=initial+1 where id=sid;
 if (select count(*) from shipping_credit.entries where shipment_id=sid)<>baseline+1 then raise exception 'REPLAY_DOUBLE_DEBIT';end if;
 update public.shipments set charged_amount=initial where id=sid;
 update shipping_credit.account set last_movement_at=null;
 perform public.icetak_credit_snapshot(20,clock_timestamp());
 if public.icetak_credit_claim_alert() is not null then raise exception 'THRESHOLD_INCLUSIVE';end if;
 perform public.icetak_credit_snapshot(19,clock_timestamp());v:=public.icetak_credit_claim_alert();first_episode:=(v->>'episode')::uuid;
 if first_episode is null then raise exception 'LOW_ALERT_NOT_CLAIMED';end if;
 if public.icetak_credit_claim_alert() is not null then raise exception 'DUPLICATE_ALERT';end if;
 perform public.icetak_credit_snapshot(18,clock_timestamp());
 if public.icetak_credit_claim_alert() is not null then raise exception 'EPISODE_DUPLICATE';end if;
 perform public.icetak_credit_snapshot(25,clock_timestamp());
 perform public.icetak_credit_snapshot(19,clock_timestamp());v:=public.icetak_credit_claim_alert();next_episode:=(v->>'episode')::uuid;
 if next_episode is null or first_episode=next_episode then raise exception 'ALERT_NOT_REARMED';end if;
 if has_function_privilege('anon','public.icetak_credit_read(text)','execute') or has_schema_privilege('authenticated','shipping_credit','usage') then raise exception 'CREDIT_PRIVACY_FAILED';end if;
end $test$;
rollback;
