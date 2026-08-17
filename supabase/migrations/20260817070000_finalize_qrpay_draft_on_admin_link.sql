create or replace function public.icetak_admin_link_payment_to_draft_and_finalize(
  p_transaction_id text,
  p_draft_id uuid,
  p_actor text default 'admin1',
  p_confirm_mismatch boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  d public.qrpay_order_drafts%rowtype;
  v_link jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_order_no text;
  v_delivery text;
  v_customer jsonb;
  v_address_pending boolean;
begin
  v_link := public.icetak_admin_link_payment_to_draft(
    p_transaction_id,
    p_draft_id,
    p_actor,
    p_confirm_mismatch
  );

  select * into d
  from public.qrpay_order_drafts
  where id = p_draft_id
  for update;

  if not found then raise exception 'Draft not found'; end if;

  if d.order_id is not null then
    return coalesce(v_link,'{}'::jsonb) || jsonb_build_object(
      'success',true,'finalized',true,'duplicate',true,
      'order_db_id',d.order_id,'order_no',d.order_no,'order_id',d.order_no
    );
  end if;

  if d.transaction_id is distinct from nullif(btrim(coalesce(p_transaction_id,'')),'')
     or d.payment_status <> 'paid' then
    raise exception 'Linked paid transaction is required before finalizing';
  end if;

  v_delivery := lower(coalesce(d.working_draft->>'delivery',''));
  v_customer := coalesce(d.working_draft->'customer','{}'::jsonb);
  v_address_pending := v_delivery <> 'pickup' and (
    length(regexp_replace(coalesce(v_customer->>'address_line1',''),'[^[:alnum:]]','','g')) < 3
    or coalesce(v_customer->>'postcode','') !~ '^\d{5}$'
    or length(regexp_replace(coalesce(v_customer->>'city',''),'[^[:alnum:]]','','g')) < 2
    or length(regexp_replace(coalesce(v_customer->>'state',''),'[^[:alnum:]]','','g')) < 2
  );

  update public.qrpay_order_drafts
  set customer_confirmed_at = coalesce(customer_confirmed_at,now()),
      customer_status = 'admin_confirmed',
      working_draft = coalesce(working_draft,'{}'::jsonb) || jsonb_build_object(
        'admin_confirmed_order',true,
        'address_pending',v_address_pending
      ),
      updated_at = now(),
      version = version + 1
  where id = d.id;

  insert into public.qrpay_order_draft_events(
    draft_id,event_type,actor,before_data,after_data,metadata
  )
  select d.id,'admin_confirmed_linked_payment',coalesce(nullif(p_actor,''),'admin1'),
         d.working_draft,q.working_draft,
         jsonb_build_object(
           'transaction_id',p_transaction_id,
           'address_pending',v_address_pending,
           'payment_session_id',q.payment_session_id
         )
  from public.qrpay_order_drafts q
  where q.id=d.id;

  v_result := public.icetak_finalize_generic_order_draft(
    d.id,
    'admin-payment-link:' || coalesce(nullif(p_actor,''),'admin1')
  );

  v_order_id := nullif(v_result->>'order_db_id','')::uuid;
  if v_order_id is null then
    select order_id into v_order_id
    from public.qrpay_order_drafts
    where id=d.id;
  end if;
  if v_order_id is null then raise exception 'Order creation failed after admin confirmation'; end if;

  select coalesce(order_no,order_id)
  into v_order_no
  from public.orders
  where id=v_order_id;

  update public.orders
  set admin_remark = concat_ws(
        E'\n',
        nullif(admin_remark,''),
        case when v_address_pending then 'Alamat penghantaran belum lengkap — kemas kini sebelum booking courier.' end
      ),
      updated_at=now()
  where id=v_order_id;

  return coalesce(v_link,'{}'::jsonb) || coalesce(v_result,'{}'::jsonb) || jsonb_build_object(
    'success',true,'linked',true,'finalized',true,
    'draft_id',d.id,'transaction_id',p_transaction_id,
    'order_db_id',v_order_id,'order_no',v_order_no,'order_id',v_order_no,
    'payment_status','paid','clickup_queued',true,
    'address_pending',v_address_pending,'waiting_for','[]'::jsonb
  );
end
$function$;

revoke all on function public.icetak_admin_link_payment_to_draft_and_finalize(text,uuid,text,boolean)
from public,anon,authenticated;
grant execute on function public.icetak_admin_link_payment_to_draft_and_finalize(text,uuid,text,boolean)
to service_role;
