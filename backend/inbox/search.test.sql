-- Read-only production regression checks; run against Unified Inbox, not Order System.
begin;
set local role authenticated;
set local statement_timeout='8s';
do $test$
declare
  phone text;
  chat uuid;
  needle text;
begin
  if not exists(select 1 from public.search_unified_inbox(' 2610180jm6fm25 ',60) where result_type='order' and result_id='f2f1ee90-6bac-4915-8f30-cea612b3d4f3') then
    raise exception 'screenshot order missing';
  end if;
  if not exists(select 1 from public.search_unified_inbox('M6FM25',60) where result_id='f2f1ee90-6bac-4915-8f30-cea612b3d4f3') then
    raise exception 'partial order search missing';
  end if;
  if not exists(select 1 from public.search_unified_inbox('260803CMB63GR4',60) where result_type='conversation' and conversation_id='47f728da-c1e1-45ea-ac89-15606c12212b' and message_id is not null) then
    raise exception 'exact order must retain message-only conversation matches';
  end if;
  if exists(select 1 from public.search_unified_inbox('',60)) or exists(select 1 from public.search_unified_inbox('a',60))
    or exists(select 1 from public.search_unified_inbox('zz_no_results_938457',60)) then raise exception 'empty/unmatched search regression'; end if;
  select ci.normalized_phone,c.id into phone,chat from public.customer_identities ci join public.conversations c on c.customer_id=ci.customer_id
  where ci.normalized_phone ~ '^60[0-9]{9,10}$' order by c.last_message_at asc limit 1;
  if phone is null then raise exception 'phone fixture unavailable'; end if;
  if not exists(select 1 from public.search_unified_inbox(phone,100) where conversation_id=chat)
    or not exists(select 1 from public.search_unified_inbox('0'||substr(phone,3),100) where conversation_id=chat)
    or not exists(select 1 from public.search_unified_inbox('+'||substr(phone,1,2)||' '||substr(phone,3),100) where conversation_id=chat) then
    raise exception 'phone normalization or historical chat coverage failed';
  end if;
  select m.text_content,(array_agg(m.conversation_id))[1] into needle,chat from public.messages m
  where length(m.text_content) between 30 and 100 and m.text_content !~ '[%_\\]'
  group by m.text_content having count(*)=1
  order by min(m.created_at) asc limit 1;
  if needle is null then raise exception 'message fixture unavailable'; end if;
  if not exists(select 1 from public.search_unified_inbox(needle,100) where conversation_id=chat and message_id is not null) then
    raise exception 'historical message-only search failed';
  end if;
  if (select count(*) from public.search_unified_inbox('birthday',1))<>1 then raise exception 'limit regression'; end if;
  if has_function_privilege('anon','public.search_unified_inbox(text,integer)','execute') then raise exception 'anonymous search must be denied'; end if;
end
$test$;
rollback;
