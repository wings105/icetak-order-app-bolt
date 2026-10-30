-- Run after the Inbox migration in a transaction. All test messages/jobs roll back.
do $$
declare cv uuid; mid uuid; rid uuid; data jsonb; jobs jsonb; lease uuid; n integer;
begin
 select id into cv from public.conversations where channel='whatsapp' limit 1;
 if cv is null then raise exception 'TEST_CONVERSATION_REQUIRED';end if;
 if has_function_privilege('anon','public.icetak_wa_automation(text,jsonb,text)','execute') then raise exception 'ANON_RPC_EXPOSED';end if;
 if has_schema_privilege('authenticated','wa_automation','usage') then raise exception 'PRIVATE_SCHEMA_EXPOSED';end if;
 perform public.icetak_wa_automation('save',jsonb_build_object('id','prepaid','revision',1,'keyword','#ok','mode','native','external_disabled',true,'request_id',gen_random_uuid()),'qa');
 perform public.icetak_wa_automation('save',jsonb_build_object('id','pickup','revision',1,'keyword','#noted','mode','native','external_disabled',true,'request_id',gen_random_uuid()),'qa');
 insert into public.messages(conversation_id,channel,direction,sender_type,source,status,message_type,text_content,provider_message_id,sent_at)
 values(cv,'whatsapp','outbound','seller','business_app','sent','text','QA #OK','qa-wa-auto-prepaid',clock_timestamp()) returning id into mid;
 select count(*) into n from wa_automation.runs where provider_message_id='qa-wa-auto-prepaid';
 if n<>1 then raise exception 'SELLER_CASE_INSENSITIVE_FAILED: %',n;end if;
 update public.messages set status='delivered' where id=mid;
 if (select count(*) from wa_automation.runs where provider_message_id='qa-wa-auto-prepaid')<>1 then raise exception 'REPLAY_DUPLICATED';end if;
 insert into public.messages(conversation_id,channel,direction,sender_type,source,status,message_type,text_content,provider_message_id,sent_at)
 values(cv,'whatsapp','inbound','customer','customer','received','text','QA #ok','qa-wa-auto-inbound',clock_timestamp()),
 (cv,'whatsapp','outbound','system','icetak_api','sent','text','QA #ok','qa-wa-auto-system',clock_timestamp());
 if exists(select 1 from wa_automation.runs where provider_message_id in ('qa-wa-auto-inbound','qa-wa-auto-system')) then raise exception 'NON_SELLER_TRIGGERED';end if;
 insert into public.messages(conversation_id,channel,direction,sender_type,source,status,message_type,text_content,provider_message_id,sent_at,is_history)
 values(cv,'whatsapp','outbound','seller','business_app','sent','text','QA #ok','qa-wa-auto-history',clock_timestamp(),true);
 if exists(select 1 from wa_automation.runs where provider_message_id='qa-wa-auto-history') then raise exception 'HISTORY_TRIGGERED';end if;
 insert into public.messages(conversation_id,channel,direction,sender_type,source,status,message_type,text_content,provider_message_id,sent_at)
 values(cv,'whatsapp','outbound','seller','business_app','sent','text','QA #ok #noted','qa-wa-auto-conflict',clock_timestamp());
 if (select count(*) from wa_automation.runs where provider_message_id='qa-wa-auto-conflict' and status='blocked' and reason='CONFLICTING_DRAFT_COMMANDS')<>2 then raise exception 'CONFLICT_FAILED';end if;
 insert into public.messages(conversation_id,channel,direction,sender_type,source,status,message_type,text_content,provider_message_id,sent_at)
 values(cv,'whatsapp','outbound','seller','business_app','sent','text','QA #noted','qa-wa-auto-pickup',clock_timestamp());
 jobs:=public.icetak_wa_automation('claim','{"limit":5}');
 if jsonb_array_length(jobs)<>2 then raise exception 'CLAIM_FAILED: %',jobs;end if;
 rid:=(jobs->0->>'id')::uuid;lease:=(jobs->0->>'lease_id')::uuid;
 data:=public.icetak_wa_automation('finish',jsonb_build_object('id',rid,'lease_id',gen_random_uuid(),'status','succeeded'));
 if data->>'stale'<>'true' then raise exception 'STALE_LEASE_ACCEPTED';end if;
 perform public.icetak_wa_automation('finish',jsonb_build_object('id',rid,'lease_id',lease,'status','succeeded','result',jsonb_build_object('draft_id',gen_random_uuid())));
 if (select status from wa_automation.runs where id=rid)<>'succeeded' then raise exception 'FINISH_FAILED';end if;
 data:=public.icetak_wa_automation('snapshot','{}');
 if jsonb_array_length(data->'rules')<>3 or (data->>'total')::integer<>4 then raise exception 'SNAPSHOT_FAILED: %',data->>'total';end if;
 data:=public.icetak_wa_automation('preview','{"text":"QA #ok","direction":"inbound"}');
 if data->>'eligible'<>'false' then raise exception 'PREVIEW_INBOUND_FAILED';end if;
 if (select last_worker_error from wa_automation.health) is not null then raise exception 'CAPTURE_EXCEPTION_HIDDEN';end if;
 raise notice 'PASS seller-only, case-insensitive, duplicate status update, history/system rejection, conflicting drafts, claim, stale lease, finish, snapshot, preview, grants';
end $$;
