-- Draft address policy:
-- 1) Admin may approve/send a customer draft even when courier address is still empty.
-- 2) Customer must provide address before confirming a courier order.
-- 3) Pickup never requires address.

create or replace function public.icetak_admin_approve_draft_for_customer(p_review_token text, p_payload jsonb, p_actor text default 'admin-link'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  d public.qrpay_order_drafts%rowtype;
  totals jsonb;
  work jsonb;
  phone text;
  v_combine uuid:=nullif(p_payload->>'combine_with_order_id','')::uuid;
begin
  select * into d from public.qrpay_order_drafts where review_token=p_review_token for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.status in ('confirmed','rejected') then raise exception 'draft_locked'; end if;
  if jsonb_typeof(coalesce(p_payload->'items','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then raise exception 'At least one item required'; end if;
  if nullif(p_payload->>'date_need','') is null then raise exception 'Date Need is required'; end if;
  if lower(coalesce(p_payload->>'delivery','')) not in ('pickup','spx','jnt','ninja') then raise exception 'Shipping / Pickup required'; end if;
  phone:=regexp_replace(coalesce(p_payload#>>'{customer,phone}',d.customer_phone,''),'[^0-9]','','g');
  if left(phone,1)='0' then phone:='6'||phone; elsif left(phone,1)='1' then phone:='60'||phone; end if;
  if phone !~ '^60[1-9][0-9]{7,10}$' then raise exception 'Valid Malaysia phone required'; end if;
  if v_combine is not null and not exists(
    select 1 from public.orders o where o.id=v_combine
      and lower(coalesce(o.fulfillment_stage,'')) not in ('in_transit','collected','delivered','completed')
      and lower(coalesce(o.shipment_status_group,'')) not in ('in_transit','delivered','completed','shipped')
  ) then raise exception 'Selected order is no longer eligible to combine shipment'; end if;
  totals:=public.icetak_qrpay_draft_totals(p_payload);
  work:=coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('total',(totals->>'draft_total')::numeric,'draft_total',(totals->>'draft_total')::numeric,'delivery_fee',(totals->>'shipping_fee')::numeric,'payment_mode',d.payment_mode);
  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data) values(d.id,'admin_approved_for_customer',p_actor,d.working_draft,work);
  update public.qrpay_order_drafts set working_draft=work,combine_with_order_id=v_combine,customer_phone=phone,customer_name=coalesce(nullif(work#>>'{customer,name}',''),customer_name),item_subtotal=(totals->>'item_subtotal')::numeric,shipping_fee=(totals->>'shipping_fee')::numeric,draft_total=(totals->>'draft_total')::numeric,payment_difference=case when payment_amount is null then 0 else round((totals->>'draft_total')::numeric-payment_amount,2) end,admin_approved_at=now(),admin_approved_by=p_actor,customer_status='ready',status='ready_customer',version=version+1,updated_at=now() where id=d.id returning * into d;
  update public.order_sessions set status='ready_customer',updated_at=now() where id=d.order_session_id;
  return to_jsonb(d);
end
$function$;

create or replace function public.icetak_customer_confirm_draft(p_customer_token text, p_customer jsonb default '{}'::jsonb, p_actor text default 'customer-link'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  d public.qrpay_order_drafts%rowtype;
  work jsonb;
  r jsonb;
  v_delivery text;
  v_address text;
begin
  select * into d from public.qrpay_order_drafts where customer_review_token=p_customer_token for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.admin_approved_at is null then raise exception 'draft_not_ready'; end if;
  if d.status='confirmed' then return jsonb_build_object('success',true,'already_confirmed',true,'order_id',d.order_no); end if;
  work:=d.working_draft;
  if coalesce(p_customer,'{}'::jsonb)<>'{}'::jsonb then work=jsonb_set(work,'{customer}',coalesce(work->'customer','{}'::jsonb)||p_customer,true); end if;
  v_delivery:=lower(coalesce(work->>'delivery',''));
  v_address:=btrim(coalesce(work#>>'{customer,address_line1}',''));
  if v_delivery not in ('pickup','spx','jnt','ninja') then raise exception 'Shipping / Pickup required'; end if;
  if v_delivery<>'pickup' and v_address='' then raise exception 'Address required before confirming courier order'; end if;
  update public.qrpay_order_drafts set working_draft=work,customer_status='confirmed',customer_confirmed_at=now(),status='customer_confirmed',updated_at=now(),version=version+1 where id=d.id;
  update public.order_sessions set status='customer_confirmed',updated_at=now() where id=d.order_session_id;
  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data) values(d.id,'customer_confirmed',p_actor,d.working_draft,work);
  if not d.payment_required then r:=public.icetak_finalize_generic_order_draft(d.id,p_actor); return jsonb_build_object('success',true,'payment_required',false,'order',r); end if;
  return jsonb_build_object('success',true,'payment_required',true,'draft_id',d.id,'customer_token',d.customer_review_token);
end
$function$;

revoke all on function public.icetak_admin_approve_draft_for_customer(text,jsonb,text) from public, anon, authenticated;
grant execute on function public.icetak_admin_approve_draft_for_customer(text,jsonb,text) to service_role;
revoke all on function public.icetak_customer_confirm_draft(text,jsonb,text) from public, anon, authenticated;
grant execute on function public.icetak_customer_confirm_draft(text,jsonb,text) to service_role;
