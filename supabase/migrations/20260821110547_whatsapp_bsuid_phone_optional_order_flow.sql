-- Preserve phone-based orders while allowing a verified WhatsApp BSUID for phone-hidden pickup customers.
alter table public.customers alter column phone drop not null;

create or replace function public.icetak_customers_phone_normalize_trigger()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.phone:=nullif(public.icetak_normalize_phone(new.phone),'');
  return new;
end;
$function$;

create unique index if not exists customers_phone_hidden_master_unique
  on public.customers(customer_master_id)
  where phone is null and customer_master_id is not null;

create or replace function public.icetak_ensure_whatsapp_customer_master(
  p_bsuid text,
  p_username text default null,
  p_phone text default null,
  p_display_name text default null,
  p_scope text default 'waba:939302461880264'
)
returns jsonb
language plpgsql
security definer
set search_path = 'public','pg_temp'
as $function$
declare
  v_bsuid text:=nullif(btrim(coalesce(p_bsuid,'')),'');
  v_username text:=nullif(ltrim(btrim(coalesce(p_username,'')),'@'),'');
  v_phone text:=nullif(public.icetak_normalize_phone(p_phone),'');
  v_scope text:=coalesce(nullif(btrim(p_scope),''),'waba:939302461880264');
  v_name text:=coalesce(nullif(btrim(p_display_name),''),v_username,v_phone,'WhatsApp Customer');
  v_master uuid;
  v_contact uuid;
begin
  if v_bsuid is null or v_bsuid !~* '^[A-Z]{2}\.(ENT\.)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then
    raise exception 'Valid WhatsApp user ID required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||v_bsuid,0));
  select customer_master_id into v_master
    from public.customer_identifiers_master
   where identifier_type='whatsapp_bsuid' and normalized_value=v_bsuid and scope=v_scope;
  if v_master is null and v_phone is not null then
    select customer_master_id into v_master
      from public.customer_identifiers_master
     where identifier_type='phone' and normalized_value=v_phone and scope='global'
     limit 1;
  end if;
  if v_master is null then
    insert into public.customer_master(display_name,primary_phone_normalized,metadata)
    values(v_name,v_phone,jsonb_build_object('origin','whatsapp_bsuid','username',v_username))
    returning id into v_master;
  else
    update public.customer_master
       set display_name=coalesce(nullif(admin_name_override,''),nullif(display_name,''),v_name),
           primary_phone_normalized=coalesce(primary_phone_normalized,v_phone),
           metadata=metadata||jsonb_build_object('whatsapp_username',v_username),
           last_seen_at=now(),updated_at=now()
     where id=v_master;
  end if;
  insert into public.customer_identifiers_master(
    customer_master_id,identifier_type,channel,identifier_value,normalized_value,scope,
    is_verified,confidence,source_system,metadata
  ) values(
    v_master,'whatsapp_bsuid','whatsapp',v_bsuid,v_bsuid,v_scope,
    true,1.000,'icetak-unified-inbox',
    jsonb_build_object('current_username',v_username,'last_phone_seen',v_phone,'lazy_synced_at',now())
  )
  on conflict(identifier_type,normalized_value,scope) do update
     set last_seen_at=now(),updated_at=now(),
         metadata=public.customer_identifiers_master.metadata||excluded.metadata
  returning customer_master_id into v_master;
  if v_phone is not null then
    insert into public.customer_identifiers_master(
      customer_master_id,identifier_type,channel,identifier_value,normalized_value,scope,
      is_verified,confidence,source_system
    ) values(v_master,'phone','whatsapp',v_phone,v_phone,'global',true,1.000,'icetak-unified-inbox')
    on conflict(identifier_type,normalized_value,scope) do update set last_seen_at=now(),updated_at=now();
  end if;
  select id into v_contact from public.whatsapp_contacts
   where bsuid=v_bsuid or (v_phone is not null and normalized_phone=v_phone)
   order by case when bsuid=v_bsuid then 0 else 1 end
   limit 1;
  if v_contact is null then
    insert into public.whatsapp_contacts(phone,normalized_phone,bsuid,username,name,source,updated_at)
    values(v_phone,v_phone,v_bsuid,v_username,v_name,'unified-inbox-bsuid',now());
  else
    update public.whatsapp_contacts
       set phone=coalesce(phone,v_phone),normalized_phone=coalesce(normalized_phone,v_phone),
           bsuid=coalesce(bsuid,v_bsuid),username=coalesce(v_username,username),
           name=coalesce(nullif(name,''),v_name),updated_at=now()
     where id=v_contact;
  end if;
  return jsonb_build_object('customer_master_id',v_master,'bsuid',v_bsuid,'username',v_username,'phone',v_phone,'scope',v_scope);
end;
$function$;

revoke all on function public.icetak_ensure_whatsapp_customer_master(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.icetak_ensure_whatsapp_customer_master(text,text,text,text,text) to service_role;

CREATE OR REPLACE FUNCTION public.icetak_admin_approve_draft_for_customer(p_review_token text, p_payload jsonb, p_actor text DEFAULT 'admin-link'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d public.qrpay_order_drafts%rowtype;
  totals jsonb;
  work jsonb;
  phone text;
  v_combine uuid;
  v_bsuid text;
begin
  p_payload:=public.icetak_apply_draft_price_overrides_v15(coalesce(p_payload,'{}'::jsonb));
  v_combine:=nullif(p_payload->>'combine_with_order_id','')::uuid;
  select * into d from public.qrpay_order_drafts where review_token=p_review_token for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.status in ('confirmed','rejected') then raise exception 'draft_locked'; end if;
  if jsonb_typeof(coalesce(p_payload->'items','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then raise exception 'At least one item required'; end if;
  if nullif(p_payload->>'date_need','') is null then raise exception 'Date Need is required'; end if;
  if lower(coalesce(p_payload->>'delivery','')) not in ('pickup','spx','jnt','ninja') then raise exception 'Shipping / Pickup required'; end if;
  phone:=regexp_replace(coalesce(p_payload#>>'{customer,phone}',d.customer_phone,''),'[^0-9]','','g');
  if left(phone,1)='0' then phone:='6'||phone; elsif left(phone,1)='1' then phone:='60'||phone; end if;
  v_bsuid:=nullif(btrim(coalesce(p_payload#>>'{whatsapp_identity,bsuid}',d.working_draft#>>'{whatsapp_identity,bsuid}',d.evidence#>>'{whatsapp_identity,bsuid}','')),'');
  if phone='' then phone:=null; end if;
  if phone is not null and phone !~ '^60[1-9][0-9]{7,10}$' then raise exception 'Valid Malaysia phone required'; end if;
  if phone is null and (v_bsuid is null or v_bsuid !~* '^[A-Z]{2}\.(ENT\.)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') then raise exception 'Valid WhatsApp phone or user ID required'; end if;
  if v_combine is not null and not exists(
    select 1 from public.orders o where o.id=v_combine
      and lower(coalesce(o.fulfillment_stage,'')) not in ('in_transit','collected','delivered','completed')
      and lower(coalesce(o.shipment_status_group,'')) not in ('in_transit','delivered','completed','shipped')
  ) then raise exception 'Selected order is no longer eligible to combine shipment'; end if;
  totals:=public.icetak_qrpay_draft_totals(p_payload);
  work:=coalesce(p_payload,'{}'::jsonb)||jsonb_build_object(
    'total',(totals->>'draft_total')::numeric,
    'draft_total',(totals->>'draft_total')::numeric,
    'delivery_fee',(totals->>'shipping_fee')::numeric,
    'pricing_totals',totals,
    'payment_mode',d.payment_mode
  );
  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data)
  values(d.id,'admin_approved_for_customer',p_actor,d.working_draft,work);
  update public.qrpay_order_drafts set
    working_draft=work,combine_with_order_id=v_combine,customer_phone=phone,
    customer_name=coalesce(nullif(work#>>'{customer,name}',''),customer_name),
    item_subtotal=(totals->>'item_subtotal')::numeric,
    shipping_fee=(totals->>'shipping_fee')::numeric,
    draft_total=(totals->>'draft_total')::numeric,
    payment_difference=case when payment_amount is null then 0 else round((totals->>'draft_total')::numeric-payment_amount,2) end,
    admin_approved_at=now(),admin_approved_by=p_actor,customer_status='ready',status='ready_customer',version=version+1,updated_at=now()
  where id=d.id returning * into d;
  update public.order_sessions set status='ready_customer',updated_at=now() where id=d.order_session_id;
  return to_jsonb(d);
end
$function$
;

CREATE OR REPLACE FUNCTION public.finance_admin_draft_orders(p_query text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with rows as materialized (
    select *
    from public.qrpay_order_drafts d
    where d.order_id is null
      and d.status not in ('confirmed','rejected')
      and (nullif(btrim(coalesce(p_status,'')),'') is null or d.status=p_status)
      and (
        nullif(btrim(coalesce(p_query,'')),'') is null
        or d.id::text ilike '%'||btrim(p_query)||'%'
        or coalesce(d.customer_name,'') ilike '%'||btrim(p_query)||'%'
        or (regexp_replace(p_query,'[^0-9]','','g')<>'' and coalesce(d.customer_phone,'') ilike '%'||regexp_replace(p_query,'[^0-9]','','g')||'%')
        or coalesce(d.working_draft#>>'{whatsapp_identity,username}',d.evidence#>>'{whatsapp_identity,username}','') ilike '%'||ltrim(btrim(p_query),'@')||'%'
        or coalesce(d.working_draft#>>'{whatsapp_identity,bsuid}',d.evidence#>>'{whatsapp_identity,bsuid}','') ilike '%'||btrim(p_query)||'%'
        or coalesce(d.transaction_id,'') ilike '%'||btrim(p_query)||'%'
      )
    order by d.updated_at desc
    limit least(greatest(coalesce(p_limit,100),1),300)
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'all', count(*),
      'linked', count(*) filter (where transaction_id is not null),
      'unlinked', count(*) filter (where transaction_id is null)
    ),
    'drafts', coalesce(jsonb_agg(jsonb_build_object(
      'id', id,'status',status,'source_type',source_type,
      'customer_name',customer_name,'customer_phone',customer_phone,
      'customer_bsuid',coalesce(working_draft#>>'{whatsapp_identity,bsuid}',evidence#>>'{whatsapp_identity,bsuid}'),
      'customer_username',coalesce(working_draft#>>'{whatsapp_identity,username}',evidence#>>'{whatsapp_identity,username}'),
      'conversation_id',conversation_id,
      'draft_total',draft_total,'payment_status',payment_status,
      'payment_required',payment_required,'payment_mode',payment_mode,
      'transaction_id',transaction_id,
      'payment_amount',payment_amount,'review_token',review_token,
      'admin_approved_at',admin_approved_at,'customer_confirmed_at',customer_confirmed_at,
      'date_need',working_draft->>'date_need','delivery',working_draft->>'delivery',
      'item_count',jsonb_array_length(coalesce(working_draft->'items','[]'::jsonb)),
      'created_at',created_at,'updated_at',updated_at,
      'payment_available',case when transaction_id is null then null else exists(
        select 1 from public.unmatched_payment_transactions u where u.transaction_id=rows.transaction_id
      ) end
    ) order by updated_at desc),'[]'::jsonb)
  ) from rows;
$function$
;

CREATE OR REPLACE FUNCTION public.icetak_customer_confirm_draft_legacy_v17(p_customer_token text, p_customer jsonb DEFAULT '{}'::jsonb, p_actor text DEFAULT 'customer-link'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d public.qrpay_order_drafts%rowtype;
  work jsonb;
  r jsonb;
  v_delivery text;
  v_address text;
  v_postcode text;
  v_city text;
  v_state text;
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
              or exists(select 1 from public.customers c where c.customer_master_id=a.customer_master_id and public.icetak_normalize_phone(c.phone)=v_phone)
              or exists(select 1 from public.customers c where c.id=a.customer_id and public.icetak_normalize_phone(c.phone)=v_phone)
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
  v_postcode:=regexp_replace(coalesce(work#>>'{customer,postcode}',''),'[^0-9]','','g');
  v_city:=btrim(coalesce(work#>>'{customer,city}',''));
  v_state:=btrim(coalesce(work#>>'{customer,state}',''));

  if v_delivery not in ('pickup','spx','jnt','ninja') then raise exception 'Shipping / Pickup required'; end if;
  if v_delivery<>'pickup' then
    v_phone:=public.icetak_normalize_phone(coalesce(work#>>'{customer,phone}',d.customer_phone,''));
    if v_phone !~ '^60[1-9][0-9]{7,10}$' then raise exception 'Valid recipient phone required for courier delivery'; end if;
    if length(regexp_replace(v_address,'[^[:alnum:]]','','g')) < 3
       or v_postcode !~ '^[0-9]{5}$'
       or length(regexp_replace(v_city,'[^[:alnum:]]','','g')) < 2
       or length(regexp_replace(v_state,'[^[:alnum:]]','','g')) < 2 then
      raise exception 'Complete valid delivery address required';
    end if;
  end if;

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
$function$
;

CREATE OR REPLACE FUNCTION public.icetak_create_order(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_customer jsonb:=coalesce(payload->'customer','{}'::jsonb); v_items jsonb:=coalesce(payload->'items','[]'::jsonb);
  v_customer_id uuid; v_customer_token text; v_account_customer_id uuid:=nullif(payload->>'account_customer_id','')::uuid; v_address_id uuid:=nullif(payload->>'address_id','')::uuid; v_customer_master_id uuid;
  v_order_db_id uuid; v_order_no text; v_public_token text; v_confirm_token text:=null; v_phone text; v_notify_phone text; v_name text;
  v_total numeric:=coalesce(nullif(payload->>'total','')::numeric,0); v_delivery_fee numeric:=coalesce(nullif(payload->>'delivery_fee','')::numeric,case lower(coalesce(payload->>'delivery','pickup')) when 'spx' then 4.50 when 'jnt' then 5.90 when 'ninja' then 6.90 else 0 end); v_date_need date; v_delivery_input text:=lower(coalesce(payload->>'delivery','pickup')); v_delivery text;
  v_payment_input text:=coalesce(payload->>'payment','QR Pay'); v_payment text; v_payment_status text; v_status text; v_tab text; v_admin_status text;
  v_item jsonb; v_item_id uuid; v_k text; v_title text; v_review_required boolean; v_source text:=coalesce(payload->>'source','customer'); v_external_id text:=nullif(payload->>'external_order_id',''); v_notify boolean:=coalesce((payload->>'notify_whatsapp')::boolean,true);
  v_bsuid text:=nullif(btrim(coalesce(payload#>>'{whatsapp_identity,bsuid}',payload#>>'{evidence,whatsapp_identity,bsuid}','')),''); v_username text:=nullif(btrim(coalesce(payload#>>'{whatsapp_identity,username}',payload#>>'{evidence,whatsapp_identity,username}','')),''); v_identity_scope text:=coalesce(nullif(payload#>>'{whatsapp_identity,scope}',''),'waba:939302461880264');
  v_catalog_slug text; v_catalog jsonb; v_product_id uuid; v_product_variant_id uuid; v_catalog_clickup_task_id text; v_wording_mode text; v_custom_text text; v_item_size text; v_item_style text; v_item_price numeric; v_customization jsonb; v_product_snapshot jsonb;
begin
  if jsonb_typeof(v_items)<>'array' or jsonb_array_length(v_items)=0 then raise exception 'Order items are required'; end if;
  v_phone:=nullif(regexp_replace(coalesce(v_customer->>'phone',payload->>'phone',''),'[^0-9]','','g'),'');
  if v_phone is not null then
    if v_phone like '0%' then v_phone:='60'||substring(v_phone from 2); end if; if v_phone like '1%' then v_phone:='60'||v_phone; end if; if v_phone not like '60%' then v_phone:='60'||v_phone; end if; v_phone:='+'||v_phone;
    if left(v_phone,4) <> '+601' or length(v_phone) not in (12,13) or regexp_replace(v_phone,'[+0-9]','','g') <> '' then raise exception 'Valid Malaysia phone required'; end if;
  elsif v_delivery_input<>'pickup' then
    raise exception 'Valid recipient phone required for courier delivery';
  elsif v_bsuid is null or v_bsuid !~* '^[A-Z]{2}\.(ENT\.)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then
    raise exception 'Valid WhatsApp phone or user ID required';
  end if;
  v_name:=nullif(coalesce(v_customer->>'name',payload->>'name','Customer'),''); v_date_need:=coalesce(nullif(payload->>'date_need','')::date,current_date); v_delivery:=case when v_delivery_input='pickup' then 'Pickup' else upper(v_delivery_input) end;
  if v_external_id is not null then select id,order_id,public_token,customer_token into v_order_db_id,v_order_no,v_public_token,v_customer_token from public.orders where external_order_id=v_external_id limit 1; if v_order_db_id is not null then return jsonb_build_object('success',true,'duplicate',true,'external_order_id',v_external_id,'order_id',v_order_no,'order_token',v_public_token,'customer_token',v_customer_token); end if; end if;
  if v_account_customer_id is not null then
    select id,public_token,customer_master_id,'+'||public.icetak_normalize_phone(phone) into v_customer_id,v_customer_token,v_customer_master_id,v_notify_phone from public.customers where id=v_account_customer_id;
    if v_customer_id is null then raise exception 'Authenticated customer not found'; end if;
  elsif v_phone is not null then
    insert into public.customers(name,phone,source,public_token) values(coalesce(v_name,'Customer'),v_phone,v_source,'c_'||replace(gen_random_uuid()::text,'-','')) on conflict(phone) do update set name=excluded.name,updated_at=now() returning id,public_token,customer_master_id into v_customer_id,v_customer_token,v_customer_master_id;
    if v_customer_master_id is null then select customer_master_id into v_customer_master_id from public.customers where id=v_customer_id; end if; v_notify_phone:=v_phone;
  else
    v_customer_master_id:=nullif(payload#>>'{whatsapp_identity,customer_master_id}','')::uuid;
    if v_customer_master_id is null then
      select customer_master_id into v_customer_master_id from public.customer_identifiers_master where identifier_type='whatsapp_bsuid' and normalized_value=v_bsuid and scope=v_identity_scope limit 1;
    end if;
    if v_customer_master_id is null then
      v_customer_master_id:=(public.icetak_ensure_whatsapp_customer_master(v_bsuid,v_username,null,v_name,v_identity_scope)->>'customer_master_id')::uuid;
    end if;
    insert into public.customers(name,phone,source,public_token,customer_master_id)
      values(coalesce(v_name,'Customer'),null,v_source,'c_'||replace(gen_random_uuid()::text,'-',''),v_customer_master_id)
      on conflict(customer_master_id) where phone is null and customer_master_id is not null do update set name=excluded.name,updated_at=now()
      returning id,public_token,customer_master_id into v_customer_id,v_customer_token,v_customer_master_id;
    v_notify_phone:=null;
  end if;
  if v_address_id is not null and not exists(select 1 from public.customer_addresses where id=v_address_id and customer_master_id=v_customer_master_id and archived_at is null) then raise exception 'Saved address does not belong to customer'; end if;
  v_order_no:='IC'||to_char(now(),'YYMMDD')||'-'||floor(1000+random()*9000)::int::text; while exists(select 1 from public.orders where order_id=v_order_no or order_no=v_order_no) loop v_order_no:='IC'||to_char(now(),'YYMMDD')||'-'||floor(1000+random()*9000)::int::text; end loop; v_public_token:='o_'||substr(replace(gen_random_uuid()::text,'-',''),1,24);
  v_payment:=case when lower(v_payment_input) like '%cash%' and v_delivery='Pickup' then 'Cash at Counter' when lower(v_payment_input)='paid' then 'Paid' else 'Unpaid' end; v_payment_status:=case when v_payment='Paid' then 'paid' when v_payment='Cash at Counter' then 'cash_counter' else 'unpaid' end; v_status:=case when v_payment='Cash at Counter' then 'Waiting Customer Confirmation' when v_payment='Paid' then 'Ready to Process' else 'Waiting Payment' end; v_tab:=case when v_payment='Unpaid' then 'to_pay' else 'progress' end; v_admin_status:=case when v_payment='Cash at Counter' then 'Awaiting Customer Confirmation' when v_payment='Paid' then 'Ready to Process' else 'New Order' end; if v_payment='Cash at Counter' then v_confirm_token:='cf_'||substr(replace(gen_random_uuid()::text,'-',''),1,24); end if;
  insert into public.orders(order_no,order_id,public_token,customer_id,customer_token,status,payment_status,payment,total,delivery_fee,date_need,delivery_method,delivery,delivery_name,delivery_phone,delivery_address,delivery_city,delivery_postcode,delivery_state,delivery_address_id,tab,admin_status,admin_remark,production_approved,customer_confirmed,customer_confirm_token,source,external_order_id,created_by)
  values(v_order_no,v_order_no,v_public_token,v_customer_id,v_customer_token,v_status,v_payment_status,v_payment,v_total,v_delivery_fee,v_date_need,v_delivery_input,v_delivery,coalesce(v_customer->>'name',v_name,'Customer'),v_phone,coalesce(v_customer->>'address_line1',''),coalesce(v_customer->>'city',''),coalesce(v_customer->>'postcode',''),coalesce(v_customer->>'state',''),v_address_id,v_tab,v_admin_status,coalesce(payload->>'admin_remark',''),false,v_payment<>'Cash at Counter',v_confirm_token,v_source,v_external_id,payload->>'created_by') returning id into v_order_db_id;
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_catalog_slug:=nullif(trim(coalesce(v_item->>'catalogSlug',v_item->>'catalog_slug','')),'');
    v_product_id:=null; v_product_variant_id:=null; v_catalog_clickup_task_id:=null; v_wording_mode:=null; v_customization:='{}'::jsonb; v_product_snapshot:='{}'::jsonb;
    if v_catalog_slug is not null then
      v_catalog:=public.icetak_validate_catalog_selection(v_catalog_slug,coalesce(v_item->>'wordingMode',v_item->>'wording_mode',''),coalesce(v_item->>'customText',v_item->>'custom_text',v_item->>'wording',''),coalesce(v_item->>'sizeCode',v_item->>'size_code',v_item->>'size',''));
      v_product_id:=nullif(v_catalog->>'product_id','')::uuid; v_product_variant_id:=nullif(coalesce(v_item->>'productVariantId',v_item->>'product_variant_id',''),'')::uuid; v_catalog_clickup_task_id:=nullif(v_catalog->>'catalog_clickup_task_id',''); v_wording_mode:=v_catalog->>'wording_mode'; v_custom_text:=coalesce(v_catalog->>'custom_text',''); v_item_size:=coalesce(v_catalog->>'size',''); v_item_style:=coalesce(v_item->>'style',''); v_item_price:=coalesce(nullif(v_catalog->>'price','')::numeric,0); v_k:=coalesce(v_catalog->>'product_type','edible'); v_title:=coalesce(v_catalog->>'title','Item'); v_review_required:=coalesce((v_catalog->>'review_required')::boolean,false); v_customization:=coalesce(v_catalog->'customization','{}'::jsonb); v_product_snapshot:=coalesce(v_catalog->'product_snapshot','{}'::jsonb);
    else
      v_k:=coalesce(v_item->>'k',v_item->>'kind',v_item->>'product_type',v_item->>'productType','edible'); v_title:=coalesce(v_item->>'title',v_item->>'name','Item'); v_review_required:=coalesce(v_item->>'review','')='Need Review' or coalesce(nullif(v_item->>'review_required','')::boolean,false) or coalesce(nullif(v_item->>'reviewRequired','')::boolean,false);
      v_custom_text:=coalesce(v_item->>'customText',v_item->>'custom_text',v_item->>'wording',''); v_item_size:=coalesce(v_item->>'size',''); v_item_style:=coalesce(v_item->>'style',''); v_item_price:=coalesce(nullif(v_item->>'price','')::numeric,0);
      v_customization:=coalesce(v_item->'customization','{}'::jsonb)||jsonb_build_object('admin_process',coalesce(nullif(v_item->>'process',''),'Pre-order')); v_product_snapshot:=coalesce(v_item->'product_snapshot','{}'::jsonb); v_wording_mode:=nullif(v_item->>'wording_mode','');
    end if;
    insert into public.order_items(order_id,order_token,product_type,k,title,qty,price,size,style,wording,custom_text,review_required,workflow,product_id,product_variant_id,catalog_slug,catalog_clickup_task_id,wording_mode,customization,product_snapshot)
    values(v_order_db_id,v_public_token,v_k,v_k,v_title,coalesce(nullif(v_item->>'qty','')::int,1),v_item_price,v_item_size,v_item_style,v_custom_text,v_custom_text,v_review_required,'Order Received',v_product_id,v_product_variant_id,v_catalog_slug,v_catalog_clickup_task_id,v_wording_mode,v_customization,v_product_snapshot) returning id into v_item_id;
    update public.order_items set design_preview_url=coalesce(nullif(v_customization->>'reference_url',''),nullif(v_product_snapshot->>'image_url',''),design_preview_url) where id=v_item_id;
    if v_k='burnaway' then insert into public.production_components(order_id,order_item_id,order_token,item_id,component_type,label,workflow,review_required,review_status) values(v_order_db_id,v_item_id,v_public_token,v_item_id::text,'edible','Edible Layer','Order Received',v_review_required,case when v_review_required then 'pending' else 'not_required' end),(v_order_db_id,v_item_id,v_public_token,v_item_id::text,'wafer','Wafer Layer','Order Received',v_review_required,case when v_review_required then 'pending' else 'not_required' end); else insert into public.production_components(order_id,order_item_id,order_token,item_id,component_type,label,workflow,review_required,review_status) values(v_order_db_id,v_item_id,v_public_token,v_item_id::text,v_k,case when v_catalog_slug is not null then v_title when v_k='edible' then 'Edible Image' when v_k='wafer' then 'Wafer Paper' when v_k='printed' then 'Cake Topper' when v_k='mirror' then 'Mirror Gold Topper' when v_k='acrylic' then 'Acrylic Topper' else v_title end,'Order Received',v_review_required,case when v_review_required then 'pending' else 'not_required' end); end if;
  end loop;
  if v_address_id is not null and v_customer_master_id is not null then perform public.icetak_touch_customer_address(v_customer_master_id,v_address_id); end if;
  if v_notify then insert into public.notification_outbox(event_type,channel,phone,recipient_bsuid,recipient_username,customer_name,order_id,order_token,confirm_token,status,source,external_order_id,total,date_need,delivery,created_by) values('order_created','whatsapp',coalesce(v_notify_phone,v_phone),v_bsuid,v_username,coalesce(v_name,'Customer'),v_order_no,v_public_token,coalesce(v_confirm_token,''),'pending',v_source,v_external_id,v_total,v_date_need::text,v_delivery_input,payload->>'created_by'); end if;
  insert into public.admin_audit(order_db_id,order_id,action,actor) values(v_order_db_id::text,v_order_no,'create_order',v_source);
  return jsonb_build_object('success',true,'duplicate',false,'order_id',v_order_no,'order_db_id',v_order_db_id,'order_token',v_public_token,'customer_token',v_customer_token,'confirm_token',v_confirm_token,'total',v_total,'delivery_address_id',v_address_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.icetak_enqueue_whatsapp_event(p_event_type text, p_order_id uuid, p_extra jsonb DEFAULT '{}'::jsonb, p_suffix text DEFAULT NULL::text, p_scheduled_at timestamp with time zone DEFAULT now())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o public.orders%rowtype;
  c public.customers%rowtype;
  r public.whatsapp_notification_rules%rowtype;
  qid uuid;
  idem text;
  vars jsonb;
  enabled_global text;
  v_lifecycle boolean;
  v_bsuid text;
  v_username text;
  v_phone text;
begin
  select * into o from public.orders where id=p_order_id;
  if o.id is null or coalesce(o.whatsapp_opt_in,false)=false then return null; end if;

  v_lifecycle := p_event_type = any(array[
    'order_created','payment_pending','payment_received','production_started','review_ready',
    'order_ready_pickup','order_shipped','order_delivered','order_cancelled'
  ]::text[]);

  if v_lifecycle then
    if p_event_type='order_cancelled' then
      if not public.icetak_order_is_cancelled(o.id) then return null; end if;
    elsif public.icetak_order_is_cancelled(o.id) then
      return null;
    end if;
    if p_event_type='payment_pending' and public.icetak_order_is_paid(o.id) then return null; end if;
  end if;

  select * into r from public.whatsapp_notification_rules where event_type=p_event_type limit 1;
  if r.id is null or not coalesce(r.enabled,false) then return null; end if;

  select text_value into enabled_global
  from public.whatsapp_settings where key='enabled' limit 1;
  if lower(coalesce(enabled_global,'false')) not in ('true','1','yes','enabled','on') then return null; end if;

  select * into c from public.customers where id=o.customer_id;
  v_phone:=nullif(public.icetak_normalize_phone(coalesce(c.phone,o.delivery_phone)),'');
  select normalized_value,nullif(metadata->>'current_username','') into v_bsuid,v_username
    from public.customer_identifiers_master
   where customer_master_id=c.customer_master_id and identifier_type='whatsapp_bsuid'
   order by last_seen_at desc limit 1;
  if v_phone is null and v_bsuid is null then return null; end if;
  vars := public.icetak_whatsapp_vars(p_order_id,p_extra)
    || jsonb_build_object('order_db_id',o.id::text);
  idem := p_event_type||':'||p_order_id::text||':'||coalesce(nullif(p_suffix,''),'default');

  insert into public.notification_queue(
    event_type,channel,order_id,customer_id,phone,payload,status,attempts,
    scheduled_at,created_at,idempotency_key
  )
  values(
    p_event_type,'whatsapp',o.id,o.customer_id,
    v_phone,
    jsonb_build_object(
      'event_type',p_event_type,
      'phone',v_phone,
      'recipient_bsuid',v_bsuid,
      'bsuid',v_bsuid,
      'recipient_username',v_username,
      'order_db_id',o.id,
      'vars',vars,
      'source','database_trigger',
      'idempotency_key',idem
    ),
    'pending',0,coalesce(p_scheduled_at,now()),now(),idem
  )
  on conflict(idempotency_key) do nothing
  returning id into qid;
  return qid;
end;
$function$;

revoke all on function public.icetak_admin_approve_draft_for_customer(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.icetak_admin_approve_draft_for_customer(text,jsonb,text) to service_role;
revoke all on function public.icetak_customer_confirm_draft_legacy_v17(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.icetak_customer_confirm_draft_legacy_v17(text,jsonb,text) to service_role;
