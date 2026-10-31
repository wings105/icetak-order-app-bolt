begin;
do $$declare
 cu uuid:=gen_random_uuid();old_id uuid:=gen_random_uuid();new_id uuid:=gen_random_uuid();capped_id uuid:=gen_random_uuid();picked uuid;
begin
 update public.conversation_ai_jobs set run_after=now()+interval '1 day' where status in ('pending','failed');
 insert into public.customers(id,display_name) values(cu,'QA queue fairness');
 insert into public.conversations(id,customer_id,channel,external_customer_id,external_conversation_id,last_message_at,needs_reply) values(old_id,cu,'whatsapp',old_id::text,old_id::text,now()-interval '1 day',false),(new_id,cu,'whatsapp',new_id::text,new_id::text,now(),true),(capped_id,cu,'whatsapp',capped_id::text,capped_id::text,now(),true);
 insert into public.conversation_ai_jobs(conversation_id,status,attempts,run_after) values(old_id,'pending',0,now()-interval '20 minutes'),(new_id,'pending',0,now()-interval '1 minute'),(capped_id,'failed',5,now()-interval '1 day');
 select conversation_id into picked from public.claim_conversation_ai_jobs(1);
 if picked<>old_id then raise exception 'Older work starved';end if;
 select conversation_id into picked from public.claim_conversation_ai_jobs(1);
 if picked<>new_id then raise exception 'Live work not next or exhausted work selected';end if;
 if exists(select 1 from public.claim_conversation_ai_jobs(1)) then raise exception 'Exhausted work retried';end if;
end $$;
rollback;
