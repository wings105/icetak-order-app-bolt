-- QRPay draft final confirmation gate.
-- Hard guards: item, Date Need, Malaysia phone, shipping selection,
-- courier address, exact payment reconciliation. Only this RPC may create the
-- real order/payment/ClickUp outbox from a QRPay draft.

create or replace function public.icetak_confirm_qrpay_order_draft(
  p_review_token text,
  p_payload jsonb,
  p_corrections jsonb default '[]'::jsonb,
  p_learning_candidates jsonb default '[]'::jsonb,
  p_actor text default 'admin-link'
)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare
  v_draft public.qrpay_order_drafts%rowtype;
  v_job public.qrpay_ai_jobs%rowtype;
  v_unmatched public.unmatched_payment_transactions%rowtype;
  v_totals jsonb;v_final jsonb;v_result jsonb;
  v_order_id uuid;v_order_no text;v_outbox uuid;v_payment_id uuid;v_date_need date;
  c jsonb;v_rule_ids jsonb;v_rule_id uuid;v_phone text;
begin
  select * into v_draft from public.qrpay_order_drafts where review_token=p_review_token for update;
  if not found then raise exception 'draft_not_found';end if;
  if v_draft.status='confirmed' then return jsonb_build_object('success',true,'duplicate',true,'draft_id',v_draft.id,'order_db_id',v_draft.order_id,'order_id',v_draft.order_no);end if;
  if v_draft.status='rejected' then raise exception 'rejected_draft_cannot_be_confirmed';end if;
  if jsonb_typeof(coalesce(p_payload->'items','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then raise exception 'At least one item is required';end if;
  if nullif(p_payload->>'date_need','') is null then raise exception 'Date Need is required';end if;
  begin v_date_need:=(p_payload->>'date_need')::date;exception when others then raise exception 'Invalid Date Need';end;
  v_phone:=regexp_replace(coalesce(p_payload#>>'{customer,phone}',''),'[^0-9]','','g');
  if left(v_phone,1)='0' then v_phone:='6'||v_phone;elsif left(v_phone,1)='1' then v_phone:='60'||v_phone;end if;
  if v_phone !~ '^60[1-9][0-9]{7,10}$' then raise exception 'Valid Malaysia customer phone is required';end if;
  if lower(coalesce(p_payload->>'delivery','')) not in('pickup','spx','jnt','ninja') then raise exception 'Shipping / Pickup selection is required';end if;
  if lower(coalesce(p_payload->>'delivery',''))<>'pickup' and nullif(btrim(coalesce(p_payload#>>'{customer,address_line1}','')),'')is null then raise exception 'Delivery address is required for courier';end if;
  v_totals:=public.icetak_qrpay_draft_totals(p_payload);
  if abs((v_totals->>'draft_total')::numeric-v_draft.payment_amount)>=0.01 then raise exception 'Draft total RM% must equal payment received RM%',to_char((v_totals->>'draft_total')::numeric,'FM999999990.00'),to_char(v_draft.payment_amount,'FM999999990.00');end if;

  v_final:=coalesce(p_payload,'{}'::jsonb)||jsonb_build_object(
    'customer',coalesce(p_payload->'customer','{}'::jsonb)||jsonb_build_object('phone',v_phone),
    'payment','Paid','total',v_draft.payment_amount,'delivery_fee',(v_totals->>'shipping_fee')::numeric,'date_need',v_date_need,
    'source','qrpay_ai','created_by',coalesce(nullif(p_actor,''),'admin-link'),'notify_whatsapp',false,
    'external_order_id','qrpay-ai:'||v_draft.transaction_id,
    'admin_remark',left(concat_ws(E'\n',nullif(p_payload->>'admin_remark',''),'QRPay AI DRAFT CONFIRMED BY ADMIN','Transaction: '||v_draft.transaction_id||' | RM'||to_char(v_draft.payment_amount,'FM999999990.00'),'AI draft preserved; human corrections recorded for learning.'),3000)
  );

  select * into v_job from public.qrpay_ai_jobs where id=v_draft.qrpay_job_id for update;
  if v_job.unmatched_payment_id is not null then select * into v_unmatched from public.unmatched_payment_transactions where id=v_job.unmatched_payment_id for update;end if;
  if v_unmatched.id is null then select * into v_unmatched from public.unmatched_payment_transactions where transaction_id=v_draft.transaction_id order by created_at desc limit 1 for update;end if;

  v_result:=public.icetak_create_order(v_final);
  v_order_id:=nullif(v_result->>'order_db_id','')::uuid;
  if v_order_id is null and coalesce((v_result->>'duplicate')::boolean,false) then select id into v_order_id from public.orders where external_order_id='qrpay-ai:'||v_draft.transaction_id limit 1;end if;
  if v_order_id is null then raise exception 'order_creation_returned_no_uuid';end if;
  select coalesce(order_no,order_id) into v_order_no from public.orders where id=v_order_id;

  update public.orders set payment_method='QRPay AI + Admin Confirmed',payment_transaction_id=v_draft.transaction_id,payment_verified_at=now(),payment_verified_by=coalesce(nullif(p_actor,''),'admin-link'),customer_confirmed=true,customer_confirmed_at=coalesce(customer_confirmed_at,now()),production_approved=true,payment='Paid',payment_status='paid',status='Ready to Process',admin_status='Ready to Process',tab='progress',date_need=v_date_need,delivery_fee=(v_totals->>'shipping_fee')::numeric,updated_at=now() where id=v_order_id;

  -- Preserve human-confirmed AI metadata independent of the base create-order implementation.
  with src as(
    select ord::int rn,item from jsonb_array_elements(v_final->'items')with ordinality x(item,ord)
  ),dst as(
    select id,row_number()over(order by created_at,id)::int rn from public.order_items where order_id=v_order_id
  )
  update public.order_items oi set
    customization=coalesce(src.item->'customization',oi.customization,'{}'::jsonb),
    product_snapshot=coalesce(src.item->'product_snapshot',oi.product_snapshot,'{}'::jsonb),
    wording=coalesce(nullif(src.item->>'wording',''),nullif(src.item->>'custom_text',''),oi.wording),
    custom_text=coalesce(nullif(src.item->>'custom_text',''),nullif(src.item->>'wording',''),oi.custom_text),
    wording_mode=coalesce(nullif(src.item->>'wording_mode',''),oi.wording_mode),updated_at=now()
  from src join dst on dst.rn=src.rn where oi.id=dst.id;

  update public.order_items set review_required=true,workflow='Order Received',updated_at=now() where order_id=v_order_id;
  update public.production_components set review_required=true,review_status='pending',workflow='Order Received',updated_at=now() where order_id=v_order_id;

  if not exists(select 1 from public.payment_transactions where transaction_id=v_draft.transaction_id) then
    insert into public.payment_transactions(order_id,payment_session_id,provider,transaction_id,amount,paid_at,sender_name,raw_payload)
    values(v_order_id,null,'qrpay_ai',v_draft.transaction_id,v_draft.payment_amount,v_draft.payment_received_at,coalesce(v_unmatched.sender_name,v_draft.payment_snapshot->>'sender_name',v_final#>>'{customer,name}'),coalesce(v_unmatched.raw_payload,v_draft.payment_snapshot->'raw_payload','{}'::jsonb)||jsonb_build_object('qrpay_ai_job_id',v_draft.qrpay_job_id,'qrpay_draft_id',v_draft.id,'admin_confirmed',true,'confirmed_by',coalesce(nullif(p_actor,''),'admin-link'),'matched_conversation_id',v_draft.conversation_id,'matched_phone',v_phone,'match_score',v_draft.match_score,'match_reason',v_draft.match_reason,'webhook_snapshot',v_draft.payment_snapshot,'ai_draft',v_draft.ai_draft,'human_final',v_final,'corrections',coalesce(p_corrections,'[]'::jsonb))) returning id into v_payment_id;
  else
    select id into v_payment_id from public.payment_transactions where transaction_id=v_draft.transaction_id limit 1;
    update public.payment_transactions set order_id=v_order_id,raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object('qrpay_draft_id',v_draft.id,'admin_confirmed',true,'confirmed_by',coalesce(nullif(p_actor,''),'admin-link'),'human_final',v_final,'corrections',coalesce(p_corrections,'[]'::jsonb)) where id=v_payment_id;
  end if;

  v_outbox:=public.enqueue_clickup_production_order(v_order_id);
  v_rule_ids:=public.icetak_upsert_qrpay_learning_candidates(v_draft.id,p_learning_candidates,p_actor);
  if jsonb_typeof(coalesce(p_corrections,'[]'::jsonb))='array' then
    for c in select * from jsonb_array_elements(coalesce(p_corrections,'[]'::jsonb)) loop
      select id into v_rule_id from public.qrpay_ai_learning_rules where signature=c->>'signature';
      insert into public.qrpay_ai_corrections(draft_id,transaction_id,field_path,correction_type,ai_value,human_value,signature,strategy_key,learning_rule_id,evidence)
      values(v_draft.id,v_draft.transaction_id,coalesce(c->>'field_path','unknown'),coalesce(c->>'correction_type','changed'),c->'ai_value',c->'human_value',coalesce(c->>'signature','unknown'),coalesce(c->>'strategy_key','manual_correction'),v_rule_id,coalesce(c->'evidence','{}'::jsonb)) on conflict(draft_id,field_path,signature)do nothing;
    end loop;
  end if;
  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data,diff,metadata)values(v_draft.id,'admin_confirmed',coalesce(nullif(p_actor,''),'admin-link'),v_draft.ai_draft,v_final,coalesce(p_corrections,'[]'::jsonb),jsonb_build_object('order_id',v_order_id,'order_no',v_order_no,'payment_id',v_payment_id,'outbox_id',v_outbox,'learning_rule_ids',v_rule_ids));
  update public.qrpay_order_drafts set working_draft=v_final,confirmed_draft=v_final,status='confirmed',confirmed_at=now(),confirmed_by=coalesce(nullif(p_actor,''),'admin-link'),customer_phone=v_phone,customer_name=coalesce(nullif(v_final#>>'{customer,name}',''),customer_name),item_subtotal=(v_totals->>'item_subtotal')::numeric,shipping_fee=(v_totals->>'shipping_fee')::numeric,draft_total=(v_totals->>'draft_total')::numeric,payment_difference=0,order_id=v_order_id,order_no=v_order_no,learning_processed_at=now(),version=version+1,updated_at=now(),last_error=null where id=v_draft.id;
  update public.admin_order_reviews set status='created',order_id=v_order_id,order_no=v_order_no,approved_at=now(),completed_at=now(),extraction=v_final,updated_at=now(),last_error=null where draft_id=v_draft.id;
  update public.qrpay_ai_jobs set order_id=v_order_id,order_no=v_order_no,outbox_id=v_outbox,status='completed',completed_at=now(),locked_at=null,extraction=v_final,updated_at=now(),last_error=null where id=v_draft.qrpay_job_id;
  if v_unmatched.id is not null then delete from public.unmatched_payment_transactions where id=v_unmatched.id;end if;
  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)values(v_order_id::text,v_order_no,'confirm_qrpay_ai_draft',coalesce(nullif(p_actor,''),'admin-link'),jsonb_build_object('draft_id',v_draft.id,'transaction_id',v_draft.transaction_id,'payment_amount',v_draft.payment_amount,'corrections',coalesce(p_corrections,'[]'::jsonb),'learning_rule_ids',v_rule_ids));
  return v_result||jsonb_build_object('success',true,'draft_id',v_draft.id,'payment_id',v_payment_id,'outbox_id',v_outbox,'order_db_id',v_order_id,'order_id',v_order_no,'learning_rule_ids',v_rule_ids);
end;$$;

revoke all on function public.icetak_confirm_qrpay_order_draft(text,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.icetak_confirm_qrpay_order_draft(text,jsonb,jsonb,jsonb,text) to service_role;
