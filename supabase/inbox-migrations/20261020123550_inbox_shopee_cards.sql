-- Unified Inbox only. Canonical products remain in Order; search the existing iCetak cache.
create index if not exists inbox_catalog_shop_item_idx on public.product_catalog_cache
 ((metadata->>'shop_id'),(metadata->>'item_id')) where source_project='icetak-order-system' and source_channel='shopee' and active;

create or replace function public.icetak_inbox_shopee_product_search(
 p_conversation_id uuid,p_query text default '',p_offset integer default 0,p_limit integer default 20)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_shop text; v_query text:=lower(btrim(coalesce(p_query,''))); v_result jsonb;
begin
 if not exists(select 1 from public.workspace_members where auth_user_id=(select auth.uid()) and active and role in ('owner','admin','staff','agent')) then
  raise exception 'WORKSPACE_MEMBER_REQUIRED' using errcode='42501';
 end if;
 if length(v_query)>120 or p_offset is null or p_offset<0 or p_offset>100000 or p_limit is null or p_limit<1 or p_limit>40 then raise exception 'INVALID_SEARCH'; end if;
 select metadata->>'shop_id' into v_shop from public.conversations where id=p_conversation_id and channel='shopee';
 if coalesce(v_shop,'')!~'^[1-9][0-9]{0,14}$' then raise exception 'SHOPEE_CONVERSATION_REQUIRED'; end if;
 with matching as materialized (
  select c.* from public.product_catalog_cache c
  where c.source_project='icetak-order-system' and c.source_channel='shopee' and c.active
   and c.metadata->>'shop_id'=v_shop and c.metadata->>'item_id' ~ '^[1-9][0-9]{0,14}$'
   and c.external_product_id=v_shop||':'||(c.metadata->>'item_id')
   and coalesce(c.metadata->>'provider_status','NORMAL')='NORMAL'
   and not exists(select 1 from regexp_split_to_table(v_query,'\s+') term where term<>'' and
    strpos(lower(c.name||' '||c.external_product_id||' '||coalesce(c.metadata->'models','[]'::jsonb)::text),term)=0)
 ), page as (
  select * from matching order by (metadata->>'item_id'=v_query) desc,lower(name),id limit p_limit offset p_offset
 )
 select jsonb_build_object('shop_id',v_shop,'total',(select count(*) from matching),'offset',p_offset,'limit',p_limit,
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'image_url',p.image_url,'price',p.price,
   'max_price',(select max((m->>'price')::numeric) from jsonb_array_elements(coalesce(p.metadata->'models','[]'::jsonb)) m where m->>'price' ~ '^[0-9]+(\.[0-9]+)?$'),
   'currency',p.currency,'product_url',p.product_url,'shop_id',v_shop,'item_id',p.metadata->>'item_id','last_synced_at',p.last_synced_at)
   order by (p.metadata->>'item_id'=v_query) desc,lower(p.name),p.id) from page p),'[]'::jsonb)) into v_result;
 return v_result;
end $$;
revoke all on function public.icetak_inbox_shopee_product_search(uuid,text,integer,integer) from public,anon;
grant execute on function public.icetak_inbox_shopee_product_search(uuid,text,integer,integer) to authenticated;

-- Atomic claim + card snapshot, before any external send. Existing message enum and reply guards are preserved.
create or replace function public.claim_shopee_card_send(
 p_request_id uuid,p_conversation_id uuid,p_order_summary_id uuid,p_order_no text,p_staff_user_id uuid,
 p_actor_label text,p_text text,p_buyer_id text,p_type text,p_card jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_claim jsonb; v_message uuid; v_attempt public.shopee_chat_send_attempts%rowtype; v_shop text;
begin
 if coalesce(p_type,'') not in ('order','product') or coalesce(jsonb_typeof(p_card),'')<>'object' or octet_length(p_card::text)>20000 then raise exception 'INVALID_CARD'; end if;
 select metadata->>'shop_id' into v_shop from public.conversations where id=p_conversation_id and channel='shopee' and external_customer_id=p_buyer_id;
 if v_shop is null or p_card->>'shop_id' is distinct from v_shop then raise exception 'CARD_SHOP_MISMATCH'; end if;
 if (p_type='order' and (p_order_summary_id is null or p_card->>'order_sn' is distinct from p_order_no or p_text is distinct from '[Order #'||p_order_no||']'))
 or (p_type='product' and (coalesce(p_card->>'item_id','')!~'^[1-9][0-9]{0,14}$' or p_text is distinct from '[Product '||v_shop||':'||(p_card->>'item_id')||']')) then raise exception 'CARD_IDENTITY_MISMATCH'; end if;
 v_claim:=public.claim_shopee_send(p_request_id,p_conversation_id,p_order_summary_id,p_order_no,p_staff_user_id,p_actor_label,p_text,p_buyer_id);
 select * into v_attempt from public.shopee_chat_send_attempts where request_id=p_request_id;
 if v_attempt.staff_user_id is distinct from p_staff_user_id or v_attempt.buyer_identifier is distinct from p_buyer_id
 or v_attempt.order_summary_id is distinct from p_order_summary_id or v_attempt.order_no is distinct from p_order_no then raise exception 'Request ID conflict'; end if;
 if (v_claim->>'claimed')::boolean then
  v_message:=(v_claim->'attempt'->>'local_message_id')::uuid;
  update public.messages set provider_message_type=p_type,media_metadata=p_card,
   raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object('card_type',p_type,'card',p_card),updated_at=now()
  where id=v_message;
 end if;
 return v_claim;
end $$;
revoke all on function public.claim_shopee_card_send(uuid,uuid,uuid,text,uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_shopee_card_send(uuid,uuid,uuid,text,uuid,text,text,text,text,jsonb) to service_role;
