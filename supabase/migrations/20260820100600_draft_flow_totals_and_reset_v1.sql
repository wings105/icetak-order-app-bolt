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
  v_totals jsonb;
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
  v_totals:=public.icetak_qrpay_draft_totals(v_work);
  v_work:=v_work||jsonb_build_object(
    'total',(v_totals->>'draft_total')::numeric,
    'draft_total',(v_totals->>'draft_total')::numeric,
    'pricing_totals',v_totals
  );

  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data,metadata)
  values(d.id,'admin_flow_changed',coalesce(nullif(p_actor,''),'admin-v2'),d.working_draft,v_work,
    jsonb_build_object('from_payment_mode',d.payment_mode,'to_payment_mode',v_mode,'delivery',v_delivery));

  update public.qrpay_order_drafts set
    working_draft=v_work,
    item_subtotal=(v_totals->>'item_subtotal')::numeric,
    shipping_fee=(v_totals->>'shipping_fee')::numeric,
    draft_total=(v_totals->>'draft_total')::numeric,
    payment_difference=case when payment_amount is null then 0 else round((v_totals->>'draft_total')::numeric-payment_amount,2) end,
    payment_mode=v_mode,
    payment_required=(v_mode='prepaid'),
    payment_status=case when v_mode='cash_counter' then 'not_required' else 'unpaid' end,
    admin_approved_at=null,admin_approved_by=null,customer_link_sent_at=null,customer_confirmed_at=null,
    customer_status='not_sent',status='pending_admin',
    updated_at=now(),version=version+1,last_error=null
  where id=d.id returning * into d;
  return to_jsonb(d);
end;
$function$;

revoke all on function public.icetak_admin_set_draft_flow(text,text,text,text) from public, anon, authenticated;
grant execute on function public.icetak_admin_set_draft_flow(text,text,text,text) to service_role;
