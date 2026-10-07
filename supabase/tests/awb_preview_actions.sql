-- Controlled database receipts test: no external HTTP and all changes roll back.
begin;
insert into public.private_runtime_settings(setting_key,setting_value,updated_at)
values('awb_preview_action_webhook_url','https://hooks.example.com/controlled',now())
on conflict(setting_key) do update set setting_value=excluded.setting_value,updated_at=excluded.updated_at;
do $$
declare v text; r jsonb; id uuid:=gen_random_uuid(); unknown_id uuid:=gen_random_uuid(); fail_id uuid:=gen_random_uuid();
begin
 select updated_at::text into v from public.private_runtime_settings where setting_key='awb_preview_action_webhook_url';
 r:=public.claim_awb_preview_action(id,'261005SQ0C3Y1F','14zbjdpktr8',1,v);
 if r->>'state'<>'claimed' then raise exception 'first claim: %',r; end if;
 if public.claim_awb_preview_action(id,'261005SQ0C3Y1F','14zbjdpktr8',1,v)->>'state'<>'pending' then raise exception 'pending duplicate'; end if;
 perform public.finish_awb_preview_action(id,'sent',204);
 if public.claim_awb_preview_action(id,'261005SQ0C3Y1F','14zbjdpktr8',1,v)->>'state'<>'sent' then raise exception 'sent duplicate'; end if;
 if public.claim_awb_preview_action(id,'261005SQ0C3Y1F','14zbjdpktr8',2,v)->>'state'<>'rejected' then raise exception 'changed button reused ID'; end if;
 if public.claim_awb_preview_action(gen_random_uuid(),'UNRELATED123','14zbjdpktr8',1,v)->>'state'<>'rejected' then raise exception 'unrelated order allowed'; end if;
 if public.claim_awb_preview_action(gen_random_uuid(),'261005SQ0C3Y1F','14zbjdpktr8',1,'2000-01-01')->>'state'<>'rejected' then raise exception 'old config allowed'; end if;
 perform public.claim_awb_preview_action(unknown_id,'261005SQ0C3Y1F','14zbjdpktr8',3,v);
 update public.awb_preview_action_deliveries set updated_at=now()-interval '61 seconds' where request_id=unknown_id;
 if public.claim_awb_preview_action(unknown_id,'261005SQ0C3Y1F','14zbjdpktr8',3,v)->>'state'<>'unknown' then raise exception 'stale dispatch resend allowed'; end if;
 perform public.claim_awb_preview_action(fail_id,'261005SQ0C3Y1F','14zbjdpktr8',2,v);
 perform public.finish_awb_preview_action(fail_id,'failed',503);
 if public.claim_awb_preview_action(fail_id,'261005SQ0C3Y1F','14zbjdpktr8',2,v)->>'state'<>'claimed' then raise exception 'failed retry not allowed'; end if;
 perform public.finish_awb_preview_action(fail_id,'failed',503);
 perform public.claim_awb_preview_action(fail_id,'261005SQ0C3Y1F','14zbjdpktr8',2,v);
 perform public.finish_awb_preview_action(fail_id,'failed',503);
 if public.claim_awb_preview_action(fail_id,'261005SQ0C3Y1F','14zbjdpktr8',2,v)->>'state'<>'rejected' then raise exception 'retry attempt limit'; end if;
 if (select attempts from public.awb_preview_action_deliveries where request_id=fail_id)<>3 then raise exception 'attempt count'; end if;
 if has_table_privilege('anon','public.awb_preview_action_deliveries','SELECT') or has_table_privilege('authenticated','public.awb_preview_action_deliveries','UPDATE') then raise exception 'client table grants'; end if;
 if has_function_privilege('anon','public.claim_awb_preview_action(uuid,text,text,integer,text)','EXECUTE') or has_function_privilege('authenticated','public.finish_awb_preview_action(uuid,text,integer)','EXECUTE') then raise exception 'client function grants'; end if;
 if not (select relrowsecurity from pg_class where oid='public.awb_preview_action_deliveries'::regclass) then raise exception 'RLS disabled'; end if;
end $$;
select 'PASS: scoped claims, sent dedup, pending guard, stale/unknown no resend, failed retry bound, config version, RLS/private grants; all test changes rolled back.' as verification;
rollback;
