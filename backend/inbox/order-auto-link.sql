-- Apply only to icetak-unified-inbox. Never make phone matches primary order context.
create or replace function public.auto_link_external_order_summary(p_summary_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare o public.external_order_summaries%rowtype; c record; v_count int:=0; v_phone_customers int;
begin
 select * into o from public.external_order_summaries where id=p_summary_id;
 if not found then return 0;end if;
 -- Username alone is a suggestion, not sufficient proof of an account match.
 if o.source_channel='shopee' and nullif(o.shopee_buyer_id,'') is not null and nullif(o.shop_id,'') is not null then
  for c in select distinct co.id from public.conversations co left join public.customer_identities ci on ci.customer_id=co.customer_id and ci.channel='shopee' where co.channel='shopee' and (co.external_customer_id=o.shopee_buyer_id or ci.external_id=o.shopee_buyer_id) and co.metadata->>'shop_id'=o.shop_id loop
   insert into public.conversation_order_links(conversation_id,source_project,external_order_id,order_system_order_id,order_no,is_primary,match_method,match_confidence,linked_by_label,metadata)
   values(c.id,o.source_project,o.external_order_id,o.order_system_order_id,o.order_no,false,'buyer_id',0.99,'Unified Inbox auto-link',jsonb_build_object('summary_id',o.id,'shop_id',o.shop_id,'identity_proof','buyer_id_shop_id','source_channel',o.source_channel))
   on conflict(conversation_id,source_project,order_no) where unlinked_at is null do update set external_order_id=excluded.external_order_id,order_system_order_id=excluded.order_system_order_id,metadata=public.conversation_order_links.metadata||excluded.metadata,updated_at=now();
   v_count:=v_count+1;
  end loop;
 end if;
 if nullif(o.customer_phone_normalized,'') is not null then
  select count(distinct co.customer_id) into v_phone_customers from public.conversations co join public.customer_identities ci on ci.customer_id=co.customer_id and ci.channel='whatsapp' where co.channel='whatsapp' and ci.normalized_phone=o.customer_phone_normalized and (ci.is_verified or co.external_customer_id=o.customer_phone_normalized or regexp_replace(ci.external_id,'[^0-9]','','g')=o.customer_phone_normalized);
  if v_phone_customers=1 then
   for c in select distinct co.id from public.conversations co join public.customer_identities ci on ci.customer_id=co.customer_id and ci.channel='whatsapp' where co.channel='whatsapp' and ci.normalized_phone=o.customer_phone_normalized and (ci.is_verified or co.external_customer_id=o.customer_phone_normalized or regexp_replace(ci.external_id,'[^0-9]','','g')=o.customer_phone_normalized) loop
    insert into public.conversation_order_links(conversation_id,source_project,external_order_id,order_system_order_id,order_no,is_primary,match_method,match_confidence,linked_by_label,metadata)
    values(c.id,o.source_project,o.external_order_id,o.order_system_order_id,o.order_no,false,'phone',0.95,'Unified Inbox auto-link',jsonb_build_object('summary_id',o.id,'source_channel',o.source_channel,'identity_proof','unique_phone_identity','context_requires_order_reference',true))
    on conflict(conversation_id,source_project,order_no) where unlinked_at is null do update set order_system_order_id=excluded.order_system_order_id,metadata=public.conversation_order_links.metadata||excluded.metadata,updated_at=now();
    v_count:=v_count+1;
   end loop;
  end if;
 end if;
 return v_count;
end $$;
revoke all on function public.auto_link_external_order_summary(uuid) from public,anon,authenticated;
grant execute on function public.auto_link_external_order_summary(uuid) to service_role;
