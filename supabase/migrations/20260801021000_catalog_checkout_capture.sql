create or replace function public.icetak_create_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_customer jsonb:=coalesce(payload->'customer','{}'::jsonb); v_items jsonb:=coalesce(payload->'items','[]'::jsonb);
  v_customer_id uuid; v_customer_token text; v_account_customer_id uuid:=nullif(payload->>'account_customer_id','')::uuid; v_address_id uuid:=nullif(payload->>'address_id','')::uuid; v_customer_master_id uuid;
  v_order_db_id uuid; v_order_no text; v_public_token text; v_confirm_token text:=null; v_phone text; v_notify_phone text; v_name text;
  v_total numeric:=coalesce(nullif(payload->>'total','')::numeric,0); v_date_need date; v_delivery_input text:=lower(coalesce(payload->>'delivery','pickup')); v_delivery text;
  v_payment_input text:=coalesce(payload->>'payment','QR Pay'); v_payment text; v_payment_status text; v_status text; v_tab text; v_admin_status text;
  v_item jsonb; v_item_id uuid; v_k text; v_title text; v_review_required boolean; v_source text:=coalesce(payload->>'source','customer'); v_external_id text:=nullif(payload->>'external_order_id',''); v_notify boolean:=coalesce((payload->>'notify_whatsapp')::boolean,true);
  v_catalog_slug text; v_catalog jsonb; v_product_id uuid; v_product_variant_id uuid; v_catalog_clickup_task_id text; v_wording_mode text; v_custom_text text; v_item_size text; v_item_style text; v_item_price numeric; v_customization jsonb; v_product_snapshot jsonb;
begin
  if jsonb_typeof(v_items)<>'array' or jsonb_array_length(v_items)=0 then raise exception 'Order items are required'; end if;
  v_phone:=regexp_replace(coalesce(v_customer->>'phone',payload->>'phone',''),'[^0-9]','','g');
  if v_phone like '0%' then v_phone:='60'||substring(v_phone from 2); end if; if v_phone like '1%' then v_phone:='60'||v_phone; end if; if v_phone not like '60%' then v_phone:='60'||v_phone; end if; v_phone:='+'||v_phone;
  if v_phone !~ '^\\+601[0-9]{8,9}$' then raise exception 'Valid Malaysia phone required'; end if;
  v_name:=nullif(coalesce(v_customer->>'name',payload->>'name','Customer'),''); v_date_need:=coalesce(nullif(payload->>'date_need','')::date,current_date); v_delivery:=case when v_delivery_input='pickup' then 'Pickup' else upper(v_delivery_input) end;
  if v_external_id is not null then select id,order_id,public_token,customer_token into v_order_db_id,v_order_no,v_public_token,v_customer_token from public.orders where external_order_id=v_external_id limit 1; if v_order_db_id is not null then return jsonb_build_object('success',true,'duplicate',true,'external_order_id',v_external_id,'order_id',v_order_no,'order_token',v_public_token,'customer_token',v_customer_token); end if; end if;
  if v_account_customer_id is not null then
    select id,public_token,customer_master_id,'+'||public.icetak_normalize_phone(phone) into v_customer_id,v_customer_token,v_customer_master_id,v_notify_phone from public.customers where id=v_account_customer_id;
    if v_customer_id is null then raise exception 'Authenticated customer not found'; end if;
  else
    insert into public.customers(name,phone,source,public_token) values(coalesce(v_name,'Customer'),v_phone,v_source,'c_'||replace(gen_random_uuid()::text,'-','')) on conflict(phone) do update set name=excluded.name,updated_at=now() returning id,public_token,customer_master_id into v_customer_id,v_customer_token,v_customer_master_id;
    if v_customer_master_id is null then select customer_master_id into v_customer_master_id from public.customers where id=v_customer_id; end if; v_notify_phone:=v_phone;
  end if;
  if v_address_id is not null and not exists(select 1 from public.customer_addresses where id=v_address_id and customer_master_id=v_customer_master_id and archived_at is null) then raise exception 'Saved address does not belong to customer'; end if;
  v_order_no:='IC'||to_char(now(),'YYMMDD')||'-'||floor(1000+random()*9000)::int::text; while exists(select 1 from public.orders where order_id=v_order_no or order_no=v_order_no) loop v_order_no:='IC'||to_char(now(),'YYMMDD')||'-'||floor(1000+random()*9000)::int::text; end loop; v_public_token:='o_'||substr(replace(gen_random_uuid()::text,'-',''),1,24);
  v_payment:=case when lower(v_payment_input) like '%cash%' and v_delivery='Pickup' then 'Cash at Counter' when lower(v_payment_input)='paid' then 'Paid' else 'Unpaid' end; v_payment_status:=case when v_payment='Paid' then 'paid' when v_payment='Cash at Counter' then 'cash_counter' else 'unpaid' end; v_status:=case when v_payment='Cash at Counter' then 'Waiting Customer Confirmation' when v_payment='Paid' then 'Ready to Process' else 'Waiting Payment' end; v_tab:=case when v_payment='Unpaid' then 'to_pay' else 'progress' end; v_admin_status:=case when v_payment='Cash at Counter' then 'Awaiting Customer Confirmation' when v_payment='Paid' then 'Ready to Process' else 'New Order' end; if v_payment='Cash at Counter' then v_confirm_token:='cf_'||substr(replace(gen_random_uuid()::text,'-',''),1,24); end if;
  insert into public.orders(order_no,order_id,public_token,customer_id,customer_token,status,payment_status,payment,total,date_need,delivery_method,delivery,delivery_name,delivery_phone,delivery_address,delivery_city,delivery_postcode,delivery_state,delivery_address_id,tab,admin_status,admin_remark,production_approved,customer_confirmed,customer_confirm_token,source,external_order_id,created_by)
  values(v_order_no,v_order_no,v_public_token,v_customer_id,v_customer_token,v_status,v_payment_status,v_payment,v_total,v_date_need,v_delivery_input,v_delivery,coalesce(v_customer->>'name',v_name,'Customer'),v_phone,coalesce(v_customer->>'address_line1',''),coalesce(v_customer->>'city',''),coalesce(v_customer->>'postcode',''),coalesce(v_customer->>'state',''),v_address_id,v_tab,v_admin_status,coalesce(payload->>'admin_remark',''),false,v_payment<>'Cash at Counter',v_confirm_token,v_source,v_external_id,payload->>'created_by') returning id into v_order_db_id;
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_catalog_slug:=nullif(trim(coalesce(v_item->>'catalogSlug',v_item->>'catalog_slug','')),'');
    v_product_id:=null; v_product_variant_id:=null; v_catalog_clickup_task_id:=null; v_wording_mode:=null; v_customization:='{}'::jsonb; v_product_snapshot:='{}'::jsonb;
    if v_catalog_slug is not null then
      v_catalog:=public.icetak_validate_catalog_selection(v_catalog_slug,coalesce(v_item->>'wordingMode',v_item->>'wording_mode',''),coalesce(v_item->>'customText',v_item->>'custom_text',v_item->>'wording',''),coalesce(v_item->>'sizeCode',v_item->>'size_code',''));
      v_product_id:=nullif(v_catalog->>'product_id','')::uuid;
      v_product_variant_id:=nullif(coalesce(v_item->>'productVariantId',v_item->>'product_variant_id',''),'')::uuid;
      v_catalog_clickup_task_id:=nullif(v_catalog->>'catalog_clickup_task_id',''); v_wording_mode:=v_catalog->>'wording_mode';
      v_custom_text:=coalesce(v_catalog->>'custom_text',''); v_item_size:=coalesce(v_catalog->>'size',''); v_item_style:=coalesce(v_item->>'style','');
      v_item_price:=coalesce(nullif(v_catalog->>'price','')::numeric,0); v_k:=coalesce(v_catalog->>'product_type','edible'); v_title:=coalesce(v_catalog->>'title','Item');
      v_review_required:=coalesce((v_catalog->>'review_required')::boolean,false); v_customization:=coalesce(v_catalog->'customization','{}'::jsonb); v_product_snapshot:=coalesce(v_catalog->'product_snapshot','{}'::jsonb);
    else
      v_k:=coalesce(v_item->>'k',v_item->>'kind',v_item->>'product_type',v_item->>'productType','edible'); v_title:=coalesce(v_item->>'title',v_item->>'name','Item');
      v_review_required:=coalesce(v_item->>'review','')='Need Review' or coalesce(nullif(v_item->>'review_required','')::boolean,false) or coalesce(nullif(v_item->>'reviewRequired','')::boolean,false);
      v_custom_text:=coalesce(v_item->>'customText',v_item->>'custom_text',v_item->>'wording',''); v_item_size:=coalesce(v_item->>'size',''); v_item_style:=coalesce(v_item->>'style',''); v_item_price:=coalesce(nullif(v_item->>'price','')::numeric,0);
    end if;
    insert into public.order_items(order_id,order_token,product_type,k,title,qty,price,size,style,wording,custom_text,review_required,workflow,product_id,product_variant_id,catalog_slug,catalog_clickup_task_id,wording_mode,customization,product_snapshot)
    values(v_order_db_id,v_public_token,v_k,v_k,v_title,coalesce(nullif(v_item->>'qty','')::int,1),v_item_price,v_item_size,v_item_style,v_custom_text,v_custom_text,v_review_required,'Order Received',v_product_id,v_product_variant_id,v_catalog_slug,v_catalog_clickup_task_id,v_wording_mode,v_customization,v_product_snapshot) returning id into v_item_id;
    if v_k='burnaway' then
      insert into public.production_components(order_id,order_item_id,order_token,item_id,component_type,label,workflow,review_required,review_status)
      values(v_order_db_id,v_item_id,v_public_token,v_item_id::text,'edible','Edible Layer','Order Received',v_review_required,case when v_review_required then 'pending' else 'not_required' end),
            (v_order_db_id,v_item_id,v_public_token,v_item_id::text,'wafer','Wafer Layer','Order Received',v_review_required,case when v_review_required then 'pending' else 'not_required' end);
    else
      insert into public.production_components(order_id,order_item_id,order_token,item_id,component_type,label,workflow,review_required,review_status)
      values(v_order_db_id,v_item_id,v_public_token,v_item_id::text,v_k,case when v_catalog_slug is not null then v_title when v_k='edible' then 'Edible Image' when v_k='wafer' then 'Wafer Paper' when v_k='printed' then 'Cake Topper' when v_k='mirror' then 'Mirror Gold Topper' when v_k='acrylic' then 'Acrylic Topper' else v_title end,'Order Received',v_review_required,case when v_review_required then 'pending' else 'not_required' end);
    end if;
  end loop;
  if v_address_id is not null and v_customer_master_id is not null then perform public.icetak_touch_customer_address(v_customer_master_id,v_address_id); end if;
  if v_notify then insert into public.notification_outbox(event_type,channel,phone,customer_name,order_id,order_token,confirm_token,status,source,external_order_id,total,date_need,delivery,created_by) values('order_created','whatsapp',coalesce(v_notify_phone,v_phone),coalesce(v_name,'Customer'),v_order_no,v_public_token,coalesce(v_confirm_token,''),'pending',v_source,v_external_id,v_total,v_date_need::text,v_delivery_input,payload->>'created_by'); end if;
  insert into public.admin_audit(order_db_id,order_id,action,actor) values(v_order_db_id::text,v_order_no,'create_order',v_source);
  return jsonb_build_object('success',true,'duplicate',false,'order_id',v_order_no,'order_db_id',v_order_db_id,'order_token',v_public_token,'customer_token',v_customer_token,'confirm_token',v_confirm_token,'total',v_total,'delivery_address_id',v_address_id);
end;
$function$;
