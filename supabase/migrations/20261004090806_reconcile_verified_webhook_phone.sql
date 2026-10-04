create or replace function public.icetak_reconcile_webhook_phone(p_order_sn text,p_phone text,p_marketplace_customer_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 v_phone text:=public.icetak_normalize_phone(p_phone);
 v_mc marketplace_customers%rowtype; v_order marketplace_orders%rowtype;
 v_target customer_master%rowtype; v_keep customer_master%rowtype;
 v_verified uuid; v_other uuid; v_n integer; v_merge uuid;
begin
 if coalesce(v_phone,'') !~ '^601[0-9]{8,9}$' or nullif(btrim(p_order_sn),'') is null then
  return jsonb_build_object('status','manual_review','reason','verified_order_and_mobile_required');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('webhook_phone:'||v_phone,0));
 select * into v_order from marketplace_orders where provider='shopee' and order_sn=p_order_sn for update;
 select * into v_mc from marketplace_customers where id=p_marketplace_customer_id and provider='shopee' for update;
 if v_order.id is null or v_mc.id is null or
 (v_order.buyer_customer_id is not null and v_order.buyer_customer_id<>v_mc.id) or
 (v_order.buyer_customer_id is null and lower(coalesce(v_order.buyer_username,''))<>lower(coalesce(v_mc.username,''))) then
  return jsonb_build_object('status','identity_conflict','reason','order_customer_mismatch');
 end if;
 select * into v_target from customer_master where id=v_mc.customer_master_id for update;
 if v_target.id is not null and v_target.status<>'active' then
  return jsonb_build_object('status','manual_review','reason','inactive_marketplace_master');
 end if;
 if v_target.primary_phone_normalized is not null and v_target.primary_phone_normalized<>v_phone then
  return jsonb_build_object('status','identity_conflict','reason','customer_has_different_phone');
 end if;
 -- Verified inbound WhatsApp phone is canonical, even if its master has no primary phone yet.
 select i.customer_master_id into v_verified from customer_identifiers_master i join customer_master m on m.id=i.customer_master_id
 where i.identifier_type='phone' and i.scope='global' and i.normalized_value=v_phone and i.is_verified
 and i.source_system='icetak-unified-inbox' and m.status='active';
 select count(*),min(id::text)::uuid into v_n,v_other from customer_master
 where status='active' and primary_phone_normalized=v_phone and id is distinct from v_target.id;
 if v_n>1 or (v_verified is not null and v_n=1 and v_other<>v_verified) then
  return jsonb_build_object('status','identity_conflict','reason','phone_has_multiple_active_owners');
 end if;
 select * into v_keep from customer_master where id=coalesce(v_verified,v_other,v_target.id) for update;
 if v_keep.id is null then return jsonb_build_object('status','unchanged','customer_master_id',v_target.id);end if;
 if (v_keep.primary_phone_normalized is not null and v_keep.primary_phone_normalized<>v_phone) or exists(
  select 1 from customer_identifiers_master where customer_master_id in (v_keep.id,v_target.id)
  and identifier_type='phone' and is_verified and normalized_value<>v_phone
 ) then return jsonb_build_object('status','identity_conflict','reason','verified_phone_conflict');end if;
 if v_target.id is not null and v_target.id<>v_keep.id then
  v_merge:=v_target.id;
  perform public.merge_customer_master(v_keep.id,v_merge,'crm_identity_ingest_make_verified_order_phone');
  -- Legacy staging references are not covered by merge_customer_master.
  update crm_clickup_import_rows set customer_master_id=v_keep.id,updated_at=now() where customer_master_id=v_merge;
 elsif v_target.id is null then
  update marketplace_customers set customer_master_id=v_keep.id where id=v_mc.id;
 end if;
 update customer_master set primary_phone_normalized=v_phone,updated_at=now() where id=v_keep.id and primary_phone_normalized is null;
 return jsonb_build_object('status',case when v_merge is not null then 'merged' when v_target.id is null then 'linked' when v_target.primary_phone_normalized is null then 'updated' else 'unchanged' end,
 'customer_master_id',v_keep.id,'merged_customer_master_id',v_merge,'phone',v_phone,'order_sn',p_order_sn);
end;$$;
revoke all on function public.icetak_reconcile_webhook_phone(text,text,uuid) from public,anon,authenticated;
grant execute on function public.icetak_reconcile_webhook_phone(text,text,uuid) to service_role;
