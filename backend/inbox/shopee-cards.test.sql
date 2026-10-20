-- Native production-schema verification, fully rolled back; no provider call.
begin;
do $$declare member uuid; begin
 select auth_user_id into member from public.workspace_members where active and role in ('owner','admin','staff','agent') order by role limit 1;
 if member is null then raise exception 'No active member for controlled read check';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true);
end $$;
set local role authenticated;
do $$declare r jsonb; next_page jsonb; begin
 r:=public.icetak_inbox_shopee_product_search('9927bfe9-bf5f-4d1e-a65b-2482d7db54b8','',0,20);
 if (r->>'total')::int<30 or jsonb_array_length(r->'items')<>20 or r->>'shop_id'<>'188218638' then raise exception 'Catalogue paging failed';end if;
 next_page:=public.icetak_inbox_shopee_product_search('9927bfe9-bf5f-4d1e-a65b-2482d7db54b8','',20,20);
 if r->'items'->0->>'id'=next_page->'items'->0->>'id' then raise exception 'Page did not change';end if;
 r:=public.icetak_inbox_shopee_product_search('9927bfe9-bf5f-4d1e-a65b-2482d7db54b8','43514960885',0,20);
 if (r->>'total')::int<>1 or r->'items'->0->>'item_id'<>'43514960885' then raise exception 'Exact Product ID failed';end if;
 r:=public.icetak_inbox_shopee_product_search('9927bfe9-bf5f-4d1e-a65b-2482d7db54b8','acrylic topper',0,20);
 if (r->>'total')::int<1 then raise exception 'Token name search failed';end if;
 r:=public.icetak_inbox_shopee_product_search('9927bfe9-bf5f-4d1e-a65b-2482d7db54b8','%___no_such_item',0,20);
 if (r->>'total')::int<>0 then raise exception 'Literal query search failed';end if;
 begin perform public.icetak_inbox_shopee_product_search('00000000-0000-0000-0000-000000000000','',0,20);raise exception 'Unknown chat accepted';exception when raise_exception then if sqlerrm='Unknown chat accepted' then raise;end if;end;
end $$;
reset role;
set local role service_role;
do $$declare r jsonb; duplicate jsonb; request uuid:=gen_random_uuid(); message uuid; card jsonb:='{"shop_id":"188218638","item_id":"43514960885","product_name":"QA rollback"}';begin
 r:=public.claim_shopee_card_send(request,'9927bfe9-bf5f-4d1e-a65b-2482d7db54b8',null,null,null,'QA rollback','[Product 188218638:43514960885]','129377585','product',card);
 message:=(r->'attempt'->>'local_message_id')::uuid;
 if not (r->>'claimed')::boolean or not exists(select 1 from public.messages where id=message and provider_message_type='product' and media_metadata=card and status='pending') then raise exception 'Atomic card snapshot failed';end if;
 duplicate:=public.claim_shopee_card_send(request,'9927bfe9-bf5f-4d1e-a65b-2482d7db54b8',null,null,null,'QA rollback','[Product 188218638:43514960885]','129377585','product',card);
 if (duplicate->>'claimed')::boolean or duplicate->'attempt'->>'local_message_id'<>message::text then raise exception 'Duplicate claim';end if;
 begin perform public.claim_shopee_card_send(request,'9927bfe9-bf5f-4d1e-a65b-2482d7db54b8',null,null,null,'QA rollback','[Product 188218638:43514960885]','129377585','product',card||'{"shop_id":"999"}'::jsonb);raise exception 'Wrong shop accepted';exception when raise_exception then if sqlerrm='Wrong shop accepted' then raise;end if;end;
end $$;
reset role;
do $$begin
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}',true);
 begin perform public.icetak_inbox_shopee_product_search('9927bfe9-bf5f-4d1e-a65b-2482d7db54b8','',0,20);raise exception 'Nonmember accepted';exception when insufficient_privilege then null;end;
end $$;
rollback;
