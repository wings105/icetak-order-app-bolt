create or replace function public.icetak_save_qrpay_order_draft(p_review_token text,p_payload jsonb,p_actor text default 'admin-link')
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_draft public.qrpay_order_drafts%rowtype;
  v_totals jsonb;
  v_work jsonb;
  v_combine uuid;
begin
  p_payload:=public.icetak_apply_draft_price_overrides_v15(coalesce(p_payload,'{}'::jsonb));
  v_combine:=nullif(p_payload->>'combine_with_order_id','')::uuid;
  select * into v_draft from public.qrpay_order_drafts where review_token=p_review_token for update;
  if not found then raise exception 'draft_not_found'; end if;
  if v_draft.status in ('confirmed','rejected') then raise exception 'draft_locked:%',v_draft.status; end if;
  if jsonb_typeof(coalesce(p_payload->'items','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then raise exception 'At least one item is required'; end if;
  v_totals:=public.icetak_qrpay_draft_totals(p_payload);
  v_work:=coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('payment_amount',v_draft.payment_amount,'total',(v_totals->>'draft_total')::numeric,'draft_total',(v_totals->>'draft_total')::numeric,'delivery_fee',(v_totals->>'shipping_fee')::numeric,'pricing_totals',v_totals,'transaction_id',v_draft.transaction_id,'payment_received_at',v_draft.payment_received_at,'source_type',v_draft.source_type,'payment_mode',v_draft.payment_mode);
  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data) values(v_draft.id,'admin_saved',coalesce(nullif(p_actor,''),'admin-link'),v_draft.working_draft,v_work);
  update public.qrpay_order_drafts set working_draft=v_work,combine_with_order_id=v_combine,customer_phone=nullif(regexp_replace(coalesce(v_work#>>'{customer,phone}',customer_phone,''),'[^0-9]','','g'),''),customer_name=coalesce(nullif(v_work#>>'{customer,name}',''),customer_name),item_subtotal=(v_totals->>'item_subtotal')::numeric,shipping_fee=(v_totals->>'shipping_fee')::numeric,draft_total=(v_totals->>'draft_total')::numeric,payment_difference=case when payment_amount is null then 0 else round((v_totals->>'draft_total')::numeric-payment_amount,2) end,status=case when source_type='qrpay_payment' then 'saved' else 'pending_admin' end,version=version+1,updated_at=now(),last_error=null where id=v_draft.id;
  return (select to_jsonb(x) from public.qrpay_order_drafts x where x.id=v_draft.id);
end
$function$;

create or replace function public.icetak_admin_approve_draft_for_customer(p_review_token text,p_payload jsonb,p_actor text default 'admin-link')
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
  v_combine uuid;
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
  if phone !~ '^60[1-9][0-9]{7,10}$' then raise exception 'Valid Malaysia phone required'; end if;
  if v_combine is not null and not exists(select 1 from public.orders o where o.id=v_combine and lower(coalesce(o.fulfillment_stage,'')) not in ('in_transit','collected','delivered','completed') and lower(coalesce(o.shipment_status_group,'')) not in ('in_transit','delivered','completed','shipped')) then raise exception 'Selected order is no longer eligible to combine shipment'; end if;
  totals:=public.icetak_qrpay_draft_totals(p_payload);
  work:=coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('total',(totals->>'draft_total')::numeric,'draft_total',(totals->>'draft_total')::numeric,'delivery_fee',(totals->>'shipping_fee')::numeric,'pricing_totals',totals,'payment_mode',d.payment_mode);
  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data) values(d.id,'admin_approved_for_customer',p_actor,d.working_draft,work);
  update public.qrpay_order_drafts set working_draft=work,combine_with_order_id=v_combine,customer_phone=phone,customer_name=coalesce(nullif(work#>>'{customer,name}',''),customer_name),item_subtotal=(totals->>'item_subtotal')::numeric,shipping_fee=(totals->>'shipping_fee')::numeric,draft_total=(totals->>'draft_total')::numeric,payment_difference=case when payment_amount is null then 0 else round((totals->>'draft_total')::numeric-payment_amount,2) end,admin_approved_at=now(),admin_approved_by=p_actor,customer_status='ready',status='ready_customer',version=version+1,updated_at=now() where id=d.id returning * into d;
  update public.order_sessions set status='ready_customer',updated_at=now() where id=d.order_session_id;
  return to_jsonb(d);
end
$function$;
