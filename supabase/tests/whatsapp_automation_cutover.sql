-- Run against Unified Inbox in one transaction; no test message/job is retained.
begin;
do $$
declare r wa_automation.rules%rowtype; boundary timestamptz; before_save timestamptz;
 cv uuid; mid uuid; prefix text:='qa-wa-cutover-'||gen_random_uuid()::text;
begin
 select id into cv from public.conversations where channel='whatsapp' limit 1;
 if cv is null then raise exception 'TEST_CONVERSATION_REQUIRED';end if;
 select * into r from wa_automation.rules where id='prepaid';
 perform public.icetak_wa_automation('save',jsonb_build_object('id',r.id,'revision',r.revision,
  'keyword',r.keyword,'mode','observe','rate_per_hour',r.rate_per_hour,
  'case_sensitive',r.case_sensitive,'request_id',gen_random_uuid()),'cutover-qa');
 select * into r from wa_automation.rules where id=r.id;
 before_save:=clock_timestamp();
 perform public.icetak_wa_automation('save',jsonb_build_object('id',r.id,'revision',r.revision,
  'keyword',r.keyword,'mode','native','external_disabled',true,'rate_per_hour',r.rate_per_hour,
  'case_sensitive',r.case_sensitive,'request_id',gen_random_uuid()),'cutover-qa');
 select activated_at into boundary from wa_automation.rules where id=r.id;
 if boundary<before_save then raise exception 'NATIVE_BOUNDARY_NOT_ADVANCED';end if;
 insert into public.messages(conversation_id,channel,direction,sender_type,source,status,message_type,text_content,provider_message_id,sent_at)
 values(cv,'whatsapp','outbound','seller','business_app','sent','text','QA '||r.keyword,prefix||'-old',boundary-interval '1 second') returning id into mid;
 update public.messages set status='delivered' where id=mid;
 if exists(select 1 from wa_automation.runs where provider_message_id=prefix||'-old') then raise exception 'PRE_CUTOVER_ECHO_QUEUED';end if;
 insert into public.messages(conversation_id,channel,direction,sender_type,source,status,message_type,text_content,provider_message_id,sent_at)
 values(cv,'whatsapp','outbound','seller','business_app','sent','text','QA '||r.keyword,prefix||'-fresh',clock_timestamp()) returning id into mid;
 update public.messages set status='delivered' where id=mid;
 if (select count(*) from wa_automation.runs where provider_message_id=prefix||'-fresh' and status='pending')<>1 then raise exception 'POST_CUTOVER_MATCH_OR_REPLAY_FAILED';end if;
 select * into r from wa_automation.rules where id=r.id;
 perform public.icetak_wa_automation('save',jsonb_build_object('id',r.id,'revision',r.revision,
  'keyword',r.keyword,'mode','native','rate_per_hour',r.rate_per_hour,
  'case_sensitive',r.case_sensitive,'request_id',gen_random_uuid()),'cutover-qa');
 if (select activated_at from wa_automation.rules where id=r.id)<>boundary then raise exception 'EDIT_MOVED_ACTIVE_BOUNDARY';end if;
 if (select last_worker_error from wa_automation.health) like 'CAPTURE_FAILED:%' then raise exception 'CAPTURE_EXCEPTION_HIDDEN';end if;
 raise notice 'PASS native activation boundary, delayed pre-cutover status rejection, fresh event enqueue, replay dedupe and active edit stability';
end $$;
rollback;
select 'PASS native activation boundary, delayed echo rejection, fresh enqueue, replay dedupe and active edit stability; all QA writes rolled back' as result;
