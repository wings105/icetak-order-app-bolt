create or replace function public.icetak_customer_confirm_draft(p_customer_token text, p_customer jsonb default '{}'::jsonb, p_actor text default 'customer-link'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  d public.qrpay_order_drafts%rowtype;
  work jsonb;
  r jsonb;
  v_delivery text;
  v_address text;
  v_address_id uuid;
  v_phone text;
begin
  select * into d from public.qrpay_order_drafts where customer_review_token=p_customer_token for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.admin_approved_at is null then raise exception 'draft_not_ready'; end if;
  if d.status='confirmed' then return jsonb_build_object('success',true,'already_confirmed',true,'order_id',d.order_no); end if;

  work:=d.working_draft;
  if coalesce(p_customer,'{}'::jsonb)<>'{}'::jsonb then
    if p_customer ? 'address_id' then
      if nullif(btrim(coalesce(p_customer->>'address_id','')),'') is null then
        work:=work-'address_id';
      else
        v_address_id:=(p_customer->>'address_id')::uuid;
        v_phone:=public.icetak_normalize_phone(coalesce(p_customer->>'phone',work#>>'{customer,phone}',d.customer_phone,''));
        if not exists(
          select 1
          from public.customer_addresses a
          where a.id=v_address_id
            and a.archived_at is null
            and (
              public.icetak_normalize_phone(a.phone)=v_phone
              or exists(
                select 1 from public.customers c
                where c.customer_master_id=a.customer_master_id
                  and public.icetak_normalize_phone(c.phone)=v_phone
              )
              or exists(
                select 1 from public.customers c
                where c.id=a.customer_id
                  and public.icetak_normalize_phone(c.phone)=v_phone
              )
            )
        ) then
          raise exception 'Saved address does not belong to this customer';
        end if;
        work:=jsonb_set(work,'{address_id}',to_jsonb(v_address_id::text),true);
      end if;
    end if;
    work=jsonb_set(work,'{customer}',coalesce(work->'customer','{}'::jsonb)||p_customer,true);
  end if;

  v_delivery:=lower(coalesce(work->>'delivery',''));
  v_address:=btrim(coalesce(work#>>'{customer,address_line1}',''));
  if v_delivery not in ('pickup','spx','jnt','ninja') then raise exception 'Shipping / Pickup required'; end if;
  if v_delivery<>'pickup' and v_address='' then raise exception 'Address required before confirming courier order'; end if;

  update public.qrpay_order_drafts
  set working_draft=work,customer_status='confirmed',customer_confirmed_at=now(),status='customer_confirmed',updated_at=now(),version=version+1
  where id=d.id;
  update public.order_sessions set status='customer_confirmed',updated_at=now() where id=d.order_session_id;
  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data)
  values(d.id,'customer_confirmed',p_actor,d.working_draft,work);

  if not d.payment_required then
    r:=public.icetak_finalize_generic_order_draft(d.id,p_actor);
    return jsonb_build_object('success',true,'payment_required',false,'order',r);
  end if;
  return jsonb_build_object('success',true,'payment_required',true,'draft_id',d.id,'customer_token',d.customer_review_token);
end
$$;

create or replace function public.icetak_capture_draft_order_address()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_master_id uuid;
  v_address_id uuid;
  v_is_default boolean;
begin
  if coalesce(new.external_order_id,'') not like 'draft:%' then return new; end if;
  if lower(coalesce(new.delivery_method,new.delivery,''))='pickup' then return new; end if;
  if new.delivery_address_id is not null then return new; end if;
  if nullif(btrim(coalesce(new.delivery_address,'')),'') is null
     or nullif(btrim(coalesce(new.delivery_city,'')),'') is null
     or nullif(btrim(coalesce(new.delivery_postcode,'')),'') is null
     or nullif(btrim(coalesce(new.delivery_state,'')),'') is null then
    return new;
  end if;

  select customer_master_id into v_master_id from public.customers where id=new.customer_id;

  select a.id into v_address_id
  from public.customer_addresses a
  where a.archived_at is null
    and (a.customer_id=new.customer_id or (v_master_id is not null and a.customer_master_id=v_master_id))
    and lower(btrim(coalesce(a.address_line1,'')))=lower(btrim(new.delivery_address))
    and lower(btrim(coalesce(a.city,'')))=lower(btrim(new.delivery_city))
    and regexp_replace(coalesce(a.postcode,''),'[^0-9]','','g')=regexp_replace(new.delivery_postcode,'[^0-9]','','g')
    and lower(btrim(coalesce(a.state,'')))=lower(btrim(new.delivery_state))
  order by a.is_verified desc,a.last_used_at desc nulls last,a.created_at desc
  limit 1;

  if v_address_id is null then
    select not exists(
      select 1 from public.customer_addresses a
      where a.archived_at is null
        and (a.customer_id=new.customer_id or (v_master_id is not null and a.customer_master_id=v_master_id))
        and a.is_default
    ) into v_is_default;

    insert into public.customer_addresses(
      customer_id,customer_master_id,label,recipient_name,phone,address_line1,address_line2,
      city,postcode,state,country,is_default,source_provider,source_order_sn,raw_address,
      parse_status,parse_confidence,is_verified,verified_at,customer_confirmed_at,last_used_at,usage_count,metadata
    ) values(
      new.customer_id,v_master_id,'Checkout',new.delivery_name,new.delivery_phone,new.delivery_address,null,
      new.delivery_city,new.delivery_postcode,new.delivery_state,'Malaysia',coalesce(v_is_default,false),
      'draft_checkout',coalesce(new.order_no,new.order_id),
      concat_ws(', ',new.delivery_address,new.delivery_postcode||' '||new.delivery_city,new.delivery_state),
      'confirmed',1,true,now(),now(),now(),1,
      jsonb_build_object('source','draft_customer_review','order_id',new.id)
    ) returning id into v_address_id;
  else
    update public.customer_addresses
    set recipient_name=coalesce(nullif(new.delivery_name,''),recipient_name),
        phone=coalesce(nullif(new.delivery_phone,''),phone),
        is_verified=true,
        verified_at=coalesce(verified_at,now()),
        customer_confirmed_at=now(),
        last_used_at=now(),
        usage_count=coalesce(usage_count,0)+1,
        updated_at=now()
    where id=v_address_id;
  end if;

  update public.orders set delivery_address_id=v_address_id,updated_at=now()
  where id=new.id and delivery_address_id is null;
  return new;
end
$$;

revoke all on function public.icetak_capture_draft_order_address() from public,anon,authenticated;

drop trigger if exists trg_capture_draft_order_address on public.orders;
create trigger trg_capture_draft_order_address
after insert on public.orders
for each row
when (new.external_order_id like 'draft:%')
execute function public.icetak_capture_draft_order_address();