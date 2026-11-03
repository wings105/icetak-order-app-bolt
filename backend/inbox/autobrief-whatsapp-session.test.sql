begin;
do $$
declare c uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); se uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); result jsonb; scope jsonb;
begin
 insert into public.customers(id,display_name) values(customer,'QA Website AutoBrief');
 insert into public.customer_identities(customer_id,channel,external_id,normalized_phone) values(customer,'whatsapp','qa-phone-session-'||customer,'601199999991');
 insert into public.conversations(id,customer_id,channel,external_conversation_id) values(c,customer,'whatsapp','qa-autobrief-session-'||c);
 scope:=jsonb_build_object('eligible',true,'order_id',o,'session_id',se,'conversation_id',c,'start_at',now()-interval '3 days','end_at',now()-interval '1 day');
 insert into public.messages(conversation_id,channel,direction,sender_type,message_type,text_content,created_at,is_history) values
 (c,'whatsapp','inbound','customer','text','OLD',now()-interval '4 days',false),
 (c,'whatsapp','inbound','customer','text','CURRENT',now()-interval '2 days',false),
 (c,'whatsapp','inbound','customer','text','NEXT',now()-interval '12 hours',false),
 (c,'whatsapp','inbound','customer','text','HISTORY',now()-interval '2 days',true),
 (c,'whatsapp','outbound','seller','text','SELLER',now()-interval '2 days',false);
 result:=public.icetak_autobrief_whatsapp_context(scope);
 if jsonb_array_length(result->'messages')<>1 or result->'messages'->0->>'text_content'<>'CURRENT' then raise exception 'session boundary/direction/history leak';end if;
 result:=public.icetak_autobrief_whatsapp_context((scope-'conversation_id'-'session_id')||jsonb_build_object('phone','601199999991'));
 if jsonb_array_length(result->'messages')<>1 or result->'messages'->0->>'text_content'<>'CURRENT' then raise exception 'website phone lookup/window failed';end if;
 insert into public.conversations(customer_id,channel,external_conversation_id) values(customer,'whatsapp','qa-duplicate-session-'||c);
 result:=public.icetak_autobrief_whatsapp_context((scope-'conversation_id'-'session_id')||jsonb_build_object('phone','601199999991'));
 if (result->>'ambiguous')::boolean is not true or jsonb_array_length(result->'messages')<>0 then raise exception 'ambiguous phone accepted';end if;
 result:=public.icetak_autobrief_whatsapp_context(scope||jsonb_build_object('conversation_id',gen_random_uuid()));
 if (result->>'ambiguous')::boolean is not true or jsonb_array_length(result->'messages')<>0 then raise exception 'identity fail open';end if;
 insert into public.messages(conversation_id,channel,direction,sender_type,message_type,text_content,created_at) select c,'whatsapp','inbound','customer','text','QA bulk',now()-interval '2 days' from generate_series(1,121);
 result:=public.icetak_autobrief_whatsapp_context(scope);
 if (result->>'truncated')::boolean is not true then raise exception 'truncation not flagged';end if;
 if has_function_privilege('anon','public.icetak_autobrief_whatsapp_context(jsonb)','execute') or has_function_privilege('authenticated','public.icetak_autobrief_whatsapp_context(jsonb)','execute') then raise exception 'browser permission leak';end if;
end $$;
rollback;
select 'PASS private native WhatsApp session windows, next/old/history/seller exclusion, identity and truncation; rollback' result;
