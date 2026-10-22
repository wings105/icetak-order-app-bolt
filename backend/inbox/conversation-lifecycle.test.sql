-- Isolated native source/permission/override proof; all fixtures roll back.
begin;
do $$declare
 u uuid:=gen_random_uuid();v uuid:=gen_random_uuid();cu uuid:=gen_random_uuid();co uuid:=gen_random_uuid();eo uuid:=gen_random_uuid();canonical_id uuid:=gen_random_uuid();r jsonb;
begin
 insert into public.workspace_members(auth_user_id,display_name,role,active) values(u,'QA Lifecycle','support',true),(v,'QA Viewer','viewer',true);
 insert into public.customers(id,display_name) values(cu,'QA Lifecycle');
 insert into public.conversations(id,customer_id,channel,external_customer_id,external_conversation_id) values(co,cu,'whatsapp','qa-lifecycle',co::text);
 insert into public.messages(conversation_id,channel,direction,sender_type,message_type,text_content) values(co,'whatsapp','inbound','customer','text','QA ask harga edible');
 insert into public.external_order_summaries(id,order_system_order_id,source_project,source_channel,order_no,order_status,payment_status,items,metadata)
 values(eo,canonical_id,'icetak-order-system','whatsapp','QA-HEADER-LIFECYCLE','Ready to Process','paid','[{"title":"QA Edible","quantity":2}]','{"secret_for_test":"never_return","design_work":{"version":1,"stage":"done","tasks":[{"id":"qa-task","status":"complete"}]}}');
 insert into public.conversation_order_links(conversation_id,source_project,order_no,is_primary,match_method,match_confidence)
 values(co,'icetak-order-system','QA-HEADER-LIFECYCLE',true,'manual',1);
 perform set_config('request.jwt.claim.sub',u::text,true);
 execute 'set local role authenticated';
 r:=public.icetak_conversation_lifecycle_source(co);
 if jsonb_array_length(r->'orders')<>1 or r#>>'{orders,0,order_no}'<>'QA-HEADER-LIFECYCLE' or r#>>'{orders,0,metadata,design_work,tasks,0,status}'<>'complete' then raise exception 'Exact linked source missing';end if;
 if r#>>'{orders,0,canonical_id}'<>canonical_id::text or r#>>'{orders,0,id}'<>eo::text then raise exception 'Canonical/cache IDs conflated';end if;
 if r::text like '%secret_for_test%' or r#>'{orders,0,customer_phone}' is not null then raise exception 'Unnecessary order/private fields exposed';end if;
 if not (r->>'can_edit_prospect')::boolean or jsonb_array_length(r->'messages')<>1 then raise exception 'Staff context missing';end if;
 perform public.icetak_set_conversation_prospect(co,'qa-scope','interested');
 r:=public.icetak_conversation_lifecycle_source(co);
 if r#>>'{prospect,stage}'<>'interested' then raise exception 'Manual stage not persisted';end if;
 perform public.icetak_set_conversation_prospect(co,'qa-scope',null);
 if (select stage from public.conversation_prospect_labels where conversation_id=co) is not null then raise exception 'Automatic reset failed';end if;
 begin perform public.icetak_set_conversation_prospect(co,'qa-scope','completed');raise exception 'Fulfillment override allowed';exception when invalid_parameter_value then null;end;
 perform set_config('request.jwt.claim.sub',v::text,true);
 r:=public.icetak_conversation_lifecycle_source(co);
 if (r->>'can_edit_prospect')::boolean then raise exception 'Viewer received edit permission';end if;
 begin perform public.icetak_set_conversation_prospect(co,'qa','survey');raise exception 'Viewer write allowed';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform public.icetak_conversation_lifecycle_source(co);raise exception 'Nonmember read allowed';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',u::text,true);
 update public.workspace_members set active=false where auth_user_id=u;
 begin perform public.icetak_conversation_lifecycle_source(co);raise exception 'Inactive staff read allowed';exception when insufficient_privilege then null;end;
 if has_function_privilege('anon','public.icetak_conversation_lifecycle_source(uuid)','execute') or has_function_privilege('anon','public.icetak_set_conversation_prospect(uuid,text,text)','execute') then raise exception 'Anonymous execute';end if;
end $$;
rollback;
