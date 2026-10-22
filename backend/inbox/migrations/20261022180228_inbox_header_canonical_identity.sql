create or replace function public.icetak_conversation_lifecycle_source(p_conversation_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare c public.conversations%rowtype; v_phone text; v_ambiguous boolean; v_result jsonb;v_links int;
begin
 if not exists(select 1 from public.workspace_members where auth_user_id=auth.uid() and active and role in ('owner','admin','designer','production','support','viewer')) then raise exception 'Active staff required' using errcode='42501';end if;
 select * into c from public.conversations where id=p_conversation_id;
 if not found then raise exception 'Conversation not found' using errcode='P0002';end if;
 select case when count(distinct normalized_phone)=1 then min(normalized_phone) end,count(distinct normalized_phone)>1 into v_phone,v_ambiguous
 from public.customer_identities where customer_id=c.customer_id and nullif(normalized_phone,'') is not null;
 if v_phone is not null and exists(select 1 from public.customer_identities where normalized_phone=v_phone and customer_id<>c.customer_id) then v_ambiguous:=true;v_phone:=null;end if;
 select count(*) into v_links from public.conversation_order_links l where l.conversation_id=c.id and l.unlinked_at is null
  and not exists(select 1 from public.external_order_summaries e where e.source_project=l.source_project and e.order_no=l.order_no);
 with candidates as materialized (
  select e.*,coalesce(l.is_primary,false) as header_primary,l.id is not null as header_linked
  from public.external_order_summaries e
  left join lateral(select id,is_primary from public.conversation_order_links l where l.conversation_id=c.id and l.unlinked_at is null and l.source_project=e.source_project and l.order_no=e.order_no order by is_primary desc,linked_at desc limit 1)l on true
  where e.source_project='icetak-order-system' and lower(coalesce(e.metadata->>'dashboard_excluded','false')) not in ('true','1')
   and (l.id is not null or (c.channel='shopee' and e.source_channel='shopee' and e.shopee_buyer_id=c.external_customer_id
    and (nullif(c.metadata->>'shop_id','') is null or e.shop_id=c.metadata->>'shop_id'))
    or (v_phone is not null and e.customer_phone_normalized=v_phone))
  order by header_linked desc,header_primary desc,e.placed_at desc nulls last,e.id limit 21
 ), msg as (
  select id,direction,sender_type,message_type,left(coalesce(text_content,caption,''),2000) as text_content,created_at
  from public.messages where conversation_id=c.id order by created_at desc,id desc limit 50
 )
 select jsonb_build_object('conversation',jsonb_build_object('id',c.id,'channel',c.channel,'created_at',c.created_at),
  'can_edit_prospect',exists(select 1 from public.workspace_members where auth_user_id=auth.uid() and active and role<>'viewer'),'identity_ambiguous',coalesce(v_ambiguous,false),'missing_links',v_links,'truncated',(select count(*)>20 from candidates),
  'messages',coalesce((select jsonb_agg(to_jsonb(msg) order by created_at,id) from msg),'[]'),
  'prospect',(select jsonb_build_object('stage',stage,'scope_key',scope_key,'updated_at',updated_at) from public.conversation_prospect_labels where conversation_id=c.id),
  'orders',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'canonical_id',e.order_system_order_id::text,'order_no',e.order_no,'source_channel',e.source_channel,
    'order_status',e.order_status,'payment_status',e.payment_status,'payment_method',e.payment_method,'delivery_method',e.delivery_method,
    'shipment_status',e.shipment_status,'fulfillment_status',e.fulfillment_status,'shipped_at',e.shipped_at,'date_need',e.date_need,'ship_by_at',e.ship_by_at,
    'placed_at',e.placed_at,'order_updated_at',e.order_updated_at,'last_synced_at',e.last_synced_at,'balance_amount',e.balance_amount,
    'tracking_no',e.tracking_no,'public_order_url',e.public_order_url,'linked',e.header_linked,'is_primary',e.header_primary,
    'items',(select coalesce(jsonb_agg(jsonb_build_object('title',i->>'title','quantity',i->'quantity')),'[]') from jsonb_array_elements(e.items)i),
    'metadata',jsonb_build_object('design_work',e.metadata->'design_work','payment_mode',e.metadata->>'payment_mode')))
    from (select * from candidates limit 20)e),'[]')) into v_result;
 return v_result;
end $$;
revoke all on function public.icetak_conversation_lifecycle_source(uuid) from public,anon;
grant execute on function public.icetak_conversation_lifecycle_source(uuid) to authenticated;

notify pgrst,'reload schema';
