begin;
do $$
declare cid uuid:=gen_random_uuid(); r jsonb; p jsonb; s reply_style; result jsonb; v integer;
begin
 if has_table_privilege('authenticated','public.reply_knowledge','select') or has_function_privilege('authenticated','public.reply_knowledge_save(text,text,jsonb)','execute') then raise exception 'Unexpected client access';end if;
 r=reply_knowledge_save('save','controlled-qa',jsonb_build_object('draft',jsonb_build_object('title','Controlled QA','answer','Kami boleh hantar wording.','source','controlled-qa','channels',jsonb_build_array('whatsapp'),'review_note','')));
 if r->'published'<>'null'::jsonb then raise exception 'Draft was published prematurely';end if;
 p=reply_knowledge_save('publish','controlled-qa',jsonb_build_object('id',r->>'id','version',1));
 if p->>'published_version'<>'2' then raise exception 'Publish version incorrect';end if;
 begin
  perform reply_knowledge_save('save','controlled-qa',jsonb_build_object('id',r->>'id','version',1,'draft',r->'draft'));raise exception 'Expected version conflict';
 exception when others then if sqlerrm not like '%VERSION_CONFLICT%' then raise;end if;end;
 select * into s from reply_style where channel='whatsapp';
 perform reply_suggestion_remember(jsonb_build_object('conversation_id',cid,'inbound_revision','qa','text','Kami boleh hantar wording.','article_id',r->>'id','article_version',2));
 for v in 1..3 loop
  result=reply_style_learn(jsonb_build_object('message_id',format('44444444-4444-4444-8444-%s',lpad(v::text,12,'0')),'conversation_id',cid,'channel','whatsapp','actual','Baik, saya boleh berikan wording. Terima kasih.','features',jsonb_build_object('pronoun','saya','request','berikan','greeting','Baik,','closing','Terima kasih.'),'wording','Baik, saya boleh berikan wording. Terima kasih.','article_id',r->>'id','article_version',2));
  if result->>'learned'<>'true' then raise exception 'Human correction was not learned';end if;
 end loop;
 if (select samples from reply_style where channel='whatsapp')<>s.samples+3 then raise exception 'Count incorrect';end if;
 if (select preferences->>'pronoun' from reply_style where channel='whatsapp')<>'saya' then raise exception 'Learned style not active';end if;
 if (select uses from reply_wording where article_id=(r->>'id')::uuid and article_version=2 and channel='whatsapp')<>3 then raise exception 'FAQ wording not accumulated';end if;
 result=reply_style_learn(jsonb_build_object('message_id','44444444-4444-4444-8444-000000000003','conversation_id',cid,'channel','whatsapp','actual','different','features','{}'::jsonb));
 if result->>'duplicate'<>'true' then raise exception 'Duplicate counted';end if;
 perform reply_suggestion_remember(jsonb_build_object('conversation_id',cid,'inbound_revision','qa-new','text','A newly recalculated draft','article_id',r->>'id','article_version',2));
 result=reply_style_learn(jsonb_build_object('message_id','44444444-4444-4444-8444-000000000004','conversation_id',cid,'channel','whatsapp','actual','Kami boleh hantar wording.','features','{}'::jsonb));
 if result->>'learned'<>'false' then raise exception 'Delayed earlier-suggestion feedback loop';end if;
 perform reply_knowledge_save('style','controlled-qa','{"channel":"whatsapp","enabled":false}'::jsonb);
 result=reply_style_learn(jsonb_build_object('message_id','44444444-4444-4444-8444-000000000005','conversation_id',cid,'channel','whatsapp','actual','Hi','features','{}'::jsonb));
 if result->>'learned'<>'false' then raise exception 'Disabled learning executed';end if;
 perform reply_knowledge_save('reset_style','controlled-qa','{"channel":"whatsapp"}'::jsonb);
 if (select samples from reply_style where channel='whatsapp')<>0 or (select uses from reply_wording where article_id=(r->>'id')::uuid and channel='whatsapp')<>0 then raise exception 'Reset not effective';end if;
 p=reply_knowledge_save('unpublish','controlled-qa',jsonb_build_object('id',r->>'id','version',2));
 if p->'published'<>'null'::jsonb then raise exception 'Unpublish failed';end if;
 if (select count(*) from reply_knowledge_events where article_id=(r->>'id')::uuid)<>3 then raise exception 'Version history incorrect';end if;
end;$$;
rollback;
select 'PASS: canonical live SQL CRUD/version/history/RLS, auto style after 3 corrections, fact-equivalent wording, duplicate/copy/disabled guards, reset and unpublish; all fixture changes rolled back' as verification;
