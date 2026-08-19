create or replace function public.icetak_clean_draft_address_v14(p_payload jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v jsonb:=coalesce(p_payload,'{}'::jsonb);
  raw text:=btrim(coalesce(v#>>'{customer,address_line1}',''));
  clean text:='';
  line text;
  digits text;
  phone_like boolean;
  pc text:=regexp_replace(coalesce(v#>>'{customer,postcode}',''),'[^0-9]','','g');
  city text:=btrim(coalesce(v#>>'{customer,city}',''));
  state text:=btrim(coalesce(v#>>'{customer,state}',''));
  state_key text;
  m text[];
begin
  state:=btrim(regexp_replace(state,'[[:space:][:punct:]]+$','','g'));
  state_key:=btrim(lower(regexp_replace(state,'[^[:alnum:]]+',' ','g')));
  state:=case state_key
    when 'johor' then 'Johor'
    when 'kedah' then 'Kedah'
    when 'kelantan' then 'Kelantan'
    when 'melaka' then 'Melaka'
    when 'malacca' then 'Melaka'
    when 'negeri sembilan' then 'Negeri Sembilan'
    when 'pahang' then 'Pahang'
    when 'perak' then 'Perak'
    when 'perlis' then 'Perlis'
    when 'pulau pinang' then 'Pulau Pinang'
    when 'penang' then 'Pulau Pinang'
    when 'sabah' then 'Sabah'
    when 'sarawak' then 'Sarawak'
    when 'selangor' then 'Selangor'
    when 'terengganu' then 'Terengganu'
    when 'kuala lumpur' then 'Kuala Lumpur'
    when 'wp kuala lumpur' then 'Kuala Lumpur'
    when 'w p kuala lumpur' then 'Kuala Lumpur'
    when 'wilayah persekutuan kuala lumpur' then 'Kuala Lumpur'
    when 'labuan' then 'Labuan'
    when 'wp labuan' then 'Labuan'
    when 'w p labuan' then 'Labuan'
    when 'wilayah persekutuan labuan' then 'Labuan'
    when 'putrajaya' then 'Putrajaya'
    when 'wp putrajaya' then 'Putrajaya'
    when 'w p putrajaya' then 'Putrajaya'
    when 'wilayah persekutuan putrajaya' then 'Putrajaya'
    else state
  end;

  for line in select btrim(x) from regexp_split_to_table(raw,E'\\n+') x loop
    if line='' then continue; end if;

    digits:=regexp_replace(line,'[^0-9]','','g');
    phone_like:=digits ~ '^(60)?1[0-9]{8,9}$' or digits ~ '^01[0-9]{8,9}$';

    -- Only strip a standalone phone line (or a clearly labelled phone line).
    -- Address lines containing words must never be discarded just because their
    -- combined digits happen to look like a Malaysian phone number.
    if phone_like and (
      line !~ '[[:alpha:]]'
      or line ~* '^[[:space:]]*(phone|tel|telefon|whatsapp|wasap|wa)[[:space:]:-]*'
    ) then
      continue;
    end if;

    clean:=case when clean='' then line else clean||E'\n'||line end;
  end loop;
  clean:=btrim(clean);

  -- The checkout form stores postcode and city in their own fields. Preserve
  -- those explicit values; derive them from the address only as a fallback for
  -- older payloads that did not have structured fields.
  if pc !~ '^[0-9]{5}$' or pc='00000' then
    pc:='';
  end if;

  if pc='' then
    select (regexp_match(clean,'(^|[^0-9])([0-9]{5})([^0-9]|$)'))[2] into pc;
    pc:=coalesce(pc,'');
  end if;

  if city='' and pc<>'' then
    m:=regexp_match(clean,pc||'[[:space:],-]+([^,\n]{2,50})','i');
    if m is not null then city:=initcap(btrim(m[1])); end if;
    if state<>'' then
      city:=btrim(regexp_replace(city,'[[:space:]]*'||state||'[[:space:]]*$','','i'));
    end if;
  end if;

  v:=jsonb_set(v,'{customer}',coalesce(v->'customer','{}'::jsonb)||jsonb_build_object(
    'address_line1',clean,
    'postcode',pc,
    'city',city,
    'state',state
  ),true);
  return v;
end
$$;

do $$
declare
  r record;
  recovered_payload jsonb;
  recovered_customer jsonb;
  recovered_address text;
  recovered_postcode text;
  recovered_city text;
  recovered_state text;
  v_master_id uuid;
  v_address_id uuid;
  v_is_default boolean;
  v_before jsonb;
  v_recovered_count integer:=0;
begin
  for r in
    select
      o.*,
      d.id as draft_id,
      e.before_data->'customer' as submitted_customer
    from public.orders o
    join public.qrpay_order_drafts d on d.order_id=o.id
    cross join lateral (
      select ev.before_data
      from public.qrpay_order_draft_events ev
      where ev.draft_id=d.id
        and ev.event_type='draft_converted_to_order'
      order by ev.created_at desc
      limit 1
    ) e
    where lower(coalesce(o.delivery_method,o.delivery,''))<>'pickup'
      and (coalesce(o.delivery_address,'')='' or left(o.delivery_address,1)=E'\n')
      and (
        nullif(btrim(coalesce(o.delivery_address,'')),'') is null
        or nullif(btrim(coalesce(o.delivery_city,'')),'') is null
        or regexp_replace(coalesce(o.delivery_postcode,''),'[^0-9]','','g') !~ '^[0-9]{5}$'
      )
      and nullif(btrim(coalesce(e.before_data#>>'{customer,address_line1}','')),'') is not null
      and regexp_replace(coalesce(e.before_data#>>'{customer,postcode}',''),'[^0-9]','','g') ~ '^[0-9]{5}$'
      and regexp_replace(coalesce(e.before_data#>>'{customer,postcode}',''),'[^0-9]','','g')<>'00000'
      and nullif(btrim(coalesce(e.before_data#>>'{customer,city}','')),'') is not null
      and nullif(btrim(coalesce(e.before_data#>>'{customer,state}','')),'') is not null
    order by o.created_at,o.id
    for update of o
  loop
    recovered_payload:=public.icetak_clean_draft_address_v14(
      jsonb_build_object('customer',r.submitted_customer)
    );
    recovered_customer:=recovered_payload->'customer';
    recovered_address:=btrim(coalesce(recovered_customer->>'address_line1',''));
    recovered_postcode:=regexp_replace(coalesce(recovered_customer->>'postcode',''),'[^0-9]','','g');
    recovered_city:=btrim(coalesce(recovered_customer->>'city',''));
    recovered_state:=btrim(coalesce(recovered_customer->>'state',''));

    if recovered_address=''
       or recovered_postcode !~ '^[0-9]{5}$'
       or recovered_postcode='00000'
       or recovered_city=''
       or recovered_state='' then
      raise exception 'Cannot safely recover complete address for order %',r.order_no;
    end if;

    v_before:=jsonb_build_object(
      'delivery_address',r.delivery_address,
      'delivery_postcode',r.delivery_postcode,
      'delivery_city',r.delivery_city,
      'delivery_state',r.delivery_state,
      'delivery_address_id',r.delivery_address_id
    );

    update public.orders
    set delivery_address=recovered_address,
        delivery_postcode=recovered_postcode,
        delivery_city=recovered_city,
        delivery_state=recovered_state,
        delivery_address_id=null,
        updated_at=now()
    where id=r.id;

    select customer_master_id into v_master_id
    from public.customers
    where id=r.customer_id;

    v_address_id:=null;
    select a.id into v_address_id
    from public.customer_addresses a
    where a.archived_at is null
      and (a.customer_id=r.customer_id or (v_master_id is not null and a.customer_master_id=v_master_id))
      and lower(btrim(coalesce(a.address_line1,'')))=lower(recovered_address)
      and lower(btrim(coalesce(a.city,'')))=lower(recovered_city)
      and regexp_replace(coalesce(a.postcode,''),'[^0-9]','','g')=recovered_postcode
      and lower(btrim(coalesce(a.state,'')))=lower(recovered_state)
    order by a.is_verified desc,a.last_used_at desc nulls last,a.created_at desc
    limit 1;

    if v_address_id is null then
      select not exists(
        select 1
        from public.customer_addresses a
        where a.archived_at is null
          and (a.customer_id=r.customer_id or (v_master_id is not null and a.customer_master_id=v_master_id))
          and a.is_default
      ) into v_is_default;

      insert into public.customer_addresses(
        customer_id,customer_master_id,label,recipient_name,phone,address_line1,address_line2,
        city,postcode,state,country,is_default,source_provider,source_order_sn,raw_address,
        parse_status,parse_confidence,is_verified,verified_at,customer_confirmed_at,last_used_at,usage_count,metadata
      ) values(
        r.customer_id,v_master_id,'Checkout',r.delivery_name,r.delivery_phone,recovered_address,null,
        recovered_city,recovered_postcode,recovered_state,'Malaysia',coalesce(v_is_default,false),
        'draft_checkout',coalesce(r.order_no,r.order_id),
        concat_ws(', ',recovered_address,recovered_postcode||' '||recovered_city,recovered_state),
        'confirmed',1,true,now(),now(),now(),1,
        jsonb_build_object(
          'source','draft_customer_review_backfill',
          'draft_id',r.draft_id,
          'order_id',r.id
        )
      ) returning id into v_address_id;
    else
      update public.customer_addresses
      set recipient_name=coalesce(nullif(r.delivery_name,''),recipient_name),
          phone=coalesce(nullif(r.delivery_phone,''),phone),
          is_verified=true,
          verified_at=coalesce(verified_at,now()),
          customer_confirmed_at=coalesce(customer_confirmed_at,now()),
          last_used_at=now(),
          usage_count=coalesce(usage_count,0)+1,
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'address_recovered_from_draft_id',r.draft_id,
            'address_recovered_for_order_id',r.id
          ),
          updated_at=now()
      where id=v_address_id;
    end if;

    update public.orders
    set delivery_address_id=v_address_id,
        updated_at=now()
    where id=r.id;

    insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
    values(
      r.id::text,
      coalesce(r.order_no,r.order_id),
      'backfill_draft_customer_address',
      'migration:20260819024857',
      jsonb_build_object(
        'draft_id',r.draft_id,
        'address_id',v_address_id,
        'before',v_before,
        'after',jsonb_build_object(
          'delivery_address',recovered_address,
          'delivery_postcode',recovered_postcode,
          'delivery_city',recovered_city,
          'delivery_state',recovered_state,
          'delivery_address_id',v_address_id
        )
      )
    );

    v_recovered_count:=v_recovered_count+1;
  end loop;

  raise notice 'Recovered % draft order addresses from immutable conversion events',v_recovered_count;
end
$$;
