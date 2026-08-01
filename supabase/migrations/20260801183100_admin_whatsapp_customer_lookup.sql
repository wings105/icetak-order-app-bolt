create or replace function public.icetak_admin_customer_lookup(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $$
declare
  q text:=trim(coalesce(p_query,''));
  digits text:=public.icetak_normalize_phone(p_query);
begin
  if not (public.icetak_admin_has_permission('create_order') or public.icetak_admin_has_permission('view_orders')) then
    raise exception 'Forbidden';
  end if;
  if q='' then return jsonb_build_object('matches','[]'::jsonb); end if;

  return jsonb_build_object('matches',coalesce((
    select jsonb_agg(row_data order by exact_phone desc,last_seen desc)
    from (
      select jsonb_build_object(
        'id',c.id,
        'customer_master_id',c.customer_master_id,
        'name',c.name,
        'phone',c.phone,
        'source',c.source,
        'addresses',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',a.id,'label',a.label,'recipient_name',a.recipient_name,'phone',a.phone,
            'address_line1',a.address_line1,'address_line2',a.address_line2,'city',a.city,
            'postcode',a.postcode,'state',a.state,'country',a.country,'is_default',a.is_default,
            'is_verified',a.is_verified,'last_used_at',a.last_used_at
          ) order by a.is_default desc,a.last_used_at desc nulls last,a.created_at desc)
          from public.customer_addresses a
          where a.archived_at is null
            and (a.customer_id=c.id or (c.customer_master_id is not null and a.customer_master_id=c.customer_master_id))
        ),'[]'::jsonb)
      ) row_data,
      (digits<>'' and public.icetak_normalize_phone(c.phone)=digits) exact_phone,
      coalesce(c.updated_at,c.created_at) last_seen
      from public.customers c
      where (digits<>'' and public.icetak_normalize_phone(c.phone)=digits)
         or c.name ilike '%'||q||'%'
         or c.phone ilike '%'||q||'%'
      order by exact_phone desc,last_seen desc
      limit 10
    ) matches
  ),'[]'::jsonb));
end;
$$;

create or replace function public.icetak_upsert_admin_customer_address(p_order_id uuid,p_customer jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public','pg_temp'
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
  if v_line1 is null or v_city is null or v_postcode is null or v_state is null then
    raise exception 'Complete delivery address required';
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
      recipient_name=coalesce(p_customer->>'name',recipient_name),
      phone=coalesce(p_customer->>'phone',phone),
      address_line2=coalesce(v_line2,address_line2),
      is_verified=true,verified_at=coalesce(verified_at,now()),customer_confirmed_at=now(),
      last_used_at=now(),usage_count=coalesce(usage_count,0)+1,updated_at=now()
    where id=v_address_id;
  end if;

  update public.orders set delivery_address_id=v_address_id,updated_at=now() where id=p_order_id;
  return v_address_id;
end;
$$;
