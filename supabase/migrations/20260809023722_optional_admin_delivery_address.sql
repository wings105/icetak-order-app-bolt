-- Paid QR orders may be saved before a delivery address is available.

create or replace function public.icetak_upsert_admin_customer_address(p_order_id uuid,p_customer jsonb)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_master_id uuid;
  v_address_id uuid;
  v_line1 text:=nullif(trim(coalesce(p_customer->>'address_line1','')),'');
  v_line2 text:=nullif(trim(coalesce(p_customer->>'address_line2','')),'');
  v_city text:=nullif(trim(coalesce(p_customer->>'city','')),'');
  v_postcode text:=nullif(trim(coalesce(p_customer->>'postcode','')),'');
  v_state text:=nullif(trim(coalesce(p_customer->>'state','')),'');
begin
  select * into v_order from public.orders where id=p_order_id;
  if v_order.id is null then raise exception 'Order not found'; end if;
  if lower(coalesce(v_order.delivery_method,v_order.delivery,''))='pickup' then return null; end if;

  -- Keep the order editable when the customer has not supplied an address yet.
  if v_line1 is null or v_city is null or v_postcode is null or v_state is null then
    return null;
  end if;

  select customer_master_id into v_master_id from public.customers where id=v_order.customer_id;
  select a.id into v_address_id
  from public.customer_addresses a
  where a.archived_at is null
    and (a.customer_id=v_order.customer_id or (v_master_id is not null and a.customer_master_id=v_master_id))
    and lower(trim(coalesce(a.address_line1,'')))=lower(v_line1)
    and lower(trim(coalesce(a.city,'')))=lower(v_city)
    and trim(coalesce(a.postcode,''))=v_postcode
    and lower(trim(coalesce(a.state,'')))=lower(v_state)
  order by a.is_verified desc,a.last_used_at desc nulls last
  limit 1;

  if v_address_id is null then
    insert into public.customer_addresses(
      customer_id,customer_master_id,label,recipient_name,phone,address_line1,address_line2,
      city,postcode,state,country,is_default,source_provider,source_order_sn,raw_address,
      parse_status,is_verified,verified_at,customer_confirmed_at,last_used_at,usage_count,metadata
    ) values(
      v_order.customer_id,v_master_id,'WhatsApp',coalesce(p_customer->>'name',v_order.delivery_name),
      coalesce(p_customer->>'phone',v_order.delivery_phone),v_line1,v_line2,v_city,v_postcode,v_state,'Malaysia',
      not exists(select 1 from public.customer_addresses x where x.archived_at is null and (x.customer_id=v_order.customer_id or (v_master_id is not null and x.customer_master_id=v_master_id))),
      'admin_whatsapp',coalesce(v_order.order_no,v_order.order_id),concat_ws(', ',v_line1,v_line2,v_postcode||' '||v_city,v_state),
      'verified',true,now(),now(),now(),1,jsonb_build_object('verified_by_admin',true,'source','whatsapp_manual_qr')
    ) returning id into v_address_id;
  else
    update public.customer_addresses set
      recipient_name=coalesce(p_customer->>'name',recipient_name),phone=coalesce(p_customer->>'phone',phone),
      address_line2=coalesce(v_line2,address_line2),is_verified=true,verified_at=coalesce(verified_at,now()),
      customer_confirmed_at=now(),last_used_at=now(),usage_count=coalesce(usage_count,0)+1,updated_at=now()
    where id=v_address_id;
  end if;

  update public.orders set delivery_address_id=v_address_id,updated_at=now() where id=p_order_id;
  return v_address_id;
end;
$$;

revoke execute on function public.icetak_upsert_admin_customer_address(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_upsert_admin_customer_address(uuid,jsonb) to service_role;

comment on function public.icetak_upsert_admin_customer_address(uuid,jsonb) is 'Creates a verified address only when complete; incomplete delivery details remain editable on the order.';
