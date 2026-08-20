create or replace function public.finance_admin_draft_orders(
  p_query text default null,
  p_status text default null,
  p_limit integer default 100
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
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
        or coalesce(d.customer_phone,'') ilike '%'||regexp_replace(p_query,'[^0-9]','','g')||'%'
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
$function$;

create or replace function public.icetak_admin_create_manual_order_draft(
  p_customer_name text default null,
  p_customer_phone text default null,
  p_date_need date default null,
  p_delivery text default 'unknown',
  p_payment_mode text default 'prepaid',
  p_actor text default 'admin-v2'
)
returns jsonb
language plpgsql
security definer
set search_path = 'public','pg_temp'
as $function$
declare
  v_delivery text := lower(btrim(coalesce(p_delivery,'unknown')));
  v_mode text := lower(btrim(coalesce(p_payment_mode,'prepaid')));
  v_phone text := nullif(regexp_replace(coalesce(p_customer_phone,''),'[^0-9]','','g'),'');
  v_work jsonb;
  v_row public.qrpay_order_drafts%rowtype;
begin
  if v_delivery not in ('unknown','pickup','spx','jnt','ninja') then raise exception 'Invalid delivery mode'; end if;
  if v_mode in ('cash_at_counter','cash') then v_mode := 'cash_counter'; end if;
  if v_mode not in ('prepaid','cash_counter') then raise exception 'Invalid payment mode'; end if;
  if v_mode='cash_counter' and v_delivery not in ('pickup','unknown') then raise exception 'Cash at Counter is only available for Pickup'; end if;
  if v_phone is not null then
    if left(v_phone,1)='0' then v_phone:='6'||v_phone;
    elsif left(v_phone,1)='1' then v_phone:='60'||v_phone;
    end if;
  end if;

  v_work := jsonb_build_object(
    'customer', jsonb_build_object('name',coalesce(nullif(btrim(p_customer_name),''),''),'phone',coalesce(v_phone,'')),
    'items','[]'::jsonb,
    'date_need',case when p_date_need is null then null else to_jsonb(p_date_need::text) end,
    'delivery',v_delivery,
    'delivery_fee',case v_delivery when 'spx' then 4.50 when 'jnt' then 5.90 when 'ninja' then 6.90 else 0 end,
    'payment_mode',v_mode,
    'price_adjustments','{}'::jsonb,
    'source_type','admin_manual'
  );

  insert into public.qrpay_order_drafts(
    source_type,request_key,customer_phone,customer_name,
    ai_draft,working_draft,evidence,status,customer_status,
    payment_required,payment_status,payment_mode,item_subtotal,shipping_fee,draft_total,
    ai_worker_version,prompt_version
  ) values (
    'admin_manual','admin-manual:'||gen_random_uuid()::text,v_phone,nullif(btrim(p_customer_name),''),
    '{}'::jsonb,v_work,jsonb_build_object('source','admin_v2_manual','actor',coalesce(nullif(p_actor,''),'admin-v2')),
    'pending_admin','not_sent',v_mode='prepaid',case when v_mode='cash_counter' then 'not_required' else 'unpaid' end,v_mode,
    0,case v_delivery when 'spx' then 4.50 when 'jnt' then 5.90 when 'ninja' then 6.90 else 0 end,0,
    'admin-manual-v1','admin-manual-v1'
  ) returning * into v_row;

  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,after_data,metadata)
  values(v_row.id,'manual_draft_created',coalesce(nullif(p_actor,''),'admin-v2'),v_work,jsonb_build_object('source_type','admin_manual'));
  return to_jsonb(v_row);
end;
$function$;

create or replace function public.icetak_admin_set_draft_flow(
  p_review_token text,
  p_delivery text,
  p_payment_mode text,
  p_actor text default 'admin-v2'
)
returns jsonb
language plpgsql
security definer
set search_path = 'public','pg_temp'
as $function$
declare
  d public.qrpay_order_drafts%rowtype;
  v_delivery text := lower(btrim(coalesce(p_delivery,'')));
  v_mode text := lower(btrim(coalesce(p_payment_mode,'')));
  v_work jsonb;
  v_fee numeric := 0;
begin
  select * into d from public.qrpay_order_drafts where review_token=p_review_token for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.status in ('confirmed','rejected') or d.order_id is not null then raise exception 'draft_locked'; end if;
  if d.source_type='qrpay_payment' then raise exception 'QRPay payment draft flow cannot be changed'; end if;
  if v_delivery not in ('pickup','spx','jnt','ninja') then raise exception 'Shipping / Pickup required'; end if;
  if v_mode in ('cash_at_counter','cash') then v_mode:='cash_counter'; end if;
  if v_mode not in ('prepaid','cash_counter') then raise exception 'Invalid payment mode'; end if;
  if v_mode='cash_counter' and v_delivery<>'pickup' then raise exception 'Cash at Counter is only available for Pickup'; end if;
  if d.payment_status='paid' or d.transaction_id is not null then raise exception 'Paid/linked draft flow cannot be changed'; end if;

  v_fee:=case v_delivery when 'spx' then 4.50 when 'jnt' then 5.90 when 'ninja' then 6.90 else 0 end;
  v_work:=coalesce(d.working_draft,'{}'::jsonb)||jsonb_build_object('delivery',v_delivery,'delivery_fee',v_fee,'payment_mode',v_mode);

  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data,metadata)
  values(d.id,'admin_flow_changed',coalesce(nullif(p_actor,''),'admin-v2'),d.working_draft,v_work,
    jsonb_build_object('from_payment_mode',d.payment_mode,'to_payment_mode',v_mode,'delivery',v_delivery));

  update public.qrpay_order_drafts set
    working_draft=v_work,
    shipping_fee=v_fee,
    draft_total=greatest(0,coalesce(item_subtotal,0)+v_fee),
    payment_mode=v_mode,
    payment_required=(v_mode='prepaid'),
    payment_status=case when v_mode='cash_counter' then 'not_required' else 'unpaid' end,
    customer_status=case when admin_approved_at is null then 'not_sent' else customer_status end,
    updated_at=now(),version=version+1,last_error=null
  where id=d.id returning * into d;
  return to_jsonb(d);
end;
$function$;

revoke all on function public.icetak_admin_create_manual_order_draft(text,text,date,text,text,text) from public, anon, authenticated;
revoke all on function public.icetak_admin_set_draft_flow(text,text,text,text) from public, anon, authenticated;
grant execute on function public.icetak_admin_create_manual_order_draft(text,text,date,text,text,text) to service_role;
grant execute on function public.icetak_admin_set_draft_flow(text,text,text,text) to service_role;
