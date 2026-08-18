-- Admin Draft Orders workspace: list active drafts and safely detach a wrongly assigned QRPay.
create or replace function public.finance_admin_draft_orders(p_query text default null,p_status text default null,p_limit integer default 100)
returns jsonb language sql stable security definer set search_path to ''
as $function$
with rows as materialized (
  select * from public.qrpay_order_drafts d
  where d.order_id is null and d.status not in ('confirmed','rejected')
    and (nullif(btrim(coalesce(p_status,'')),'') is null or d.status=p_status)
    and (nullif(btrim(coalesce(p_query,'')),'') is null
      or d.id::text ilike '%'||btrim(p_query)||'%'
      or coalesce(d.customer_name,'') ilike '%'||btrim(p_query)||'%'
      or coalesce(d.customer_phone,'') ilike '%'||regexp_replace(p_query,'[^0-9]','','g')||'%'
      or coalesce(d.transaction_id,'') ilike '%'||btrim(p_query)||'%')
  order by d.updated_at desc limit least(greatest(coalesce(p_limit,100),1),300)
)
select jsonb_build_object(
  'counts',jsonb_build_object('all',count(*),'linked',count(*) filter(where transaction_id is not null),'unlinked',count(*) filter(where transaction_id is null)),
  'drafts',coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'status',status,'source_type',source_type,'customer_name',customer_name,'customer_phone',customer_phone,
    'draft_total',draft_total,'payment_status',payment_status,'payment_required',payment_required,'transaction_id',transaction_id,
    'payment_amount',payment_amount,'review_token',review_token,'admin_approved_at',admin_approved_at,
    'customer_confirmed_at',customer_confirmed_at,'date_need',working_draft->>'date_need','delivery',working_draft->>'delivery',
    'item_count',jsonb_array_length(coalesce(working_draft->'items','[]'::jsonb)),'created_at',created_at,'updated_at',updated_at,
    'payment_available',case when transaction_id is null then null else exists(select 1 from public.unmatched_payment_transactions u where u.transaction_id=rows.transaction_id) end
  ) order by updated_at desc),'[]'::jsonb)
) from rows;
$function$;
revoke all on function public.finance_admin_draft_orders(text,text,integer) from public,anon,authenticated;
grant execute on function public.finance_admin_draft_orders(text,text,integer) to service_role;

create or replace function public.finance_admin_detach_qrpay_from_draft(p_draft_id uuid,p_actor text default 'admin1')
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare d public.qrpay_order_drafts%rowtype;v_transaction_id text;v_actor text:=coalesce(nullif(btrim(coalesce(p_actor,'')),''),'admin1');
begin
  perform pg_advisory_xact_lock(hashtextextended('draft-payment-detach:'||p_draft_id::text,0));
  select * into d from public.qrpay_order_drafts where id=p_draft_id for update;
  if not found then raise exception 'Draft not found';end if;
  if d.order_id is not null or d.status in ('confirmed','rejected') then raise exception 'Only an active draft can detach payment';end if;
  v_transaction_id:=nullif(btrim(coalesce(d.transaction_id,'')),'');
  if v_transaction_id is null then return jsonb_build_object('success',true,'duplicate',true,'draft_id',d.id,'transaction_id',null);end if;
  update public.qrpay_order_drafts set
    source_type=case when source_type='qrpay_payment' then 'chat_trigger' else source_type end,
    transaction_id=null,payment_amount=null,payment_received_at=null,payment_status='unpaid',payment_required=true,payment_session_id=null,
    admin_approved_at=null,customer_link_sent_at=null,customer_status='pending_admin',
    working_draft=(coalesce(working_draft,'{}'::jsonb)-'transaction_id'-'payment_amount'-'payment_received_at')
      ||jsonb_build_object('payment_detached',true,'payment_detached_at',now(),'payment_detached_by',v_actor),
    updated_at=now(),version=version+1 where id=d.id;
  update public.qrpay_ai_jobs set order_id=null,order_no=null,status='needs_review',completed_at=null,locked_at=null,
    match_reason='manual_admin_detached_wrong_draft',updated_at=now(),
    evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object('payment_detached_from_draft_id',d.id,'payment_detached_by',v_actor,'payment_detached_at',now())
    where transaction_id=v_transaction_id;
  update public.admin_order_reviews set order_id=null,order_no=null,status='pending_admin',approved_at=null,completed_at=null,
    evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object('payment_detached_from_draft_id',d.id,'payment_detached_by',v_actor,'payment_detached_at',now()),updated_at=now()
    where transaction_id=v_transaction_id;
  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data,metadata)
    select d.id,'payment_detached_wrong_customer',v_actor,d.working_draft,q.working_draft,jsonb_build_object('transaction_id',v_transaction_id,'reason','wrong_customer')
    from public.qrpay_order_drafts q where q.id=d.id;
  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
    values(d.id::text,'DRAFT:'||d.id::text,'detach_qrpay_from_draft',v_actor,jsonb_build_object('transaction_id',v_transaction_id,'reason','wrong_customer'));
  return jsonb_build_object('success',true,'duplicate',false,'draft_id',d.id,'transaction_id',v_transaction_id,
    'payment_returned_to_review',exists(select 1 from public.unmatched_payment_transactions u where u.transaction_id=v_transaction_id));
end;
$function$;
revoke all on function public.finance_admin_detach_qrpay_from_draft(uuid,text) from public,anon,authenticated;
grant execute on function public.finance_admin_detach_qrpay_from_draft(uuid,text) to service_role;
