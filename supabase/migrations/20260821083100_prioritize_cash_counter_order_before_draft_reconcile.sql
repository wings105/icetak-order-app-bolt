create or replace function public.icetak_auto_reconcile_unmatched_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  pphone text:=public.icetak_norm_msisdn(coalesce(new.raw_payload->>'matched_phone',new.raw_payload->>'phone',new.raw_payload->>'customer_phone'));
  did uuid;
  oid uuid;
  cnt int:=0;
  pcnt int:=0;
  r jsonb;
begin
  if new.transaction_id is null or new.amount is null or new.amount<=0 then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('late-qr-reconcile:'||new.transaction_id,0));

  -- First priority: an existing Pickup + Cash-at-Counter real order.
  -- Exact phone + exact amount wins over creating/linking a new draft.
  oid:=null; pcnt:=0; cnt:=0;
  if pphone is not null then
    select count(*),(array_agg(o.id order by coalesce(o.pickup_ready_at,o.updated_at,o.created_at) desc))[1]
      into pcnt,oid
    from public.orders o
    where lower(coalesce(o.delivery_method,o.delivery,'')) like '%pickup%'
      and lower(coalesce(o.payment_status,''))='cash_counter'
      and abs(coalesce(o.total,0)-new.amount)<0.01
      and o.created_at>now()-interval '30 days'
      and lower(coalesce(o.status,'')) not like '%cancel%'
      and public.icetak_norm_msisdn(o.delivery_phone)=pphone;
  end if;

  -- Amount-only fallback is intentionally strict: one Ready-for-Pickup cash order only.
  if pcnt<>1 then
    select count(*),(array_agg(o.id order by coalesce(o.pickup_ready_at,o.updated_at,o.created_at) desc))[1]
      into cnt,oid
    from public.orders o
    where lower(coalesce(o.delivery_method,o.delivery,'')) like '%pickup%'
      and lower(coalesce(o.payment_status,''))='cash_counter'
      and abs(coalesce(o.total,0)-new.amount)<0.01
      and o.created_at>now()-interval '7 days'
      and o.pickup_ready_at is not null
      and lower(coalesce(o.status,'')) not like '%cancel%';
    if cnt<>1 then oid:=null; end if;
  end if;

  if oid is not null then
    begin
      select public.finance_admin_manual_match_qrpay(
        new.transaction_id,
        coalesce(o.order_no,o.order_id),
        'payment-auto-reconcile',
        true
      ) into r
      from public.orders o where o.id=oid;

      if coalesce((r->>'success')::boolean,false) then
        update public.orders
        set payment_method='QR Pay at Counter',updated_at=now()
        where id=oid;
        return new;
      end if;
    exception when others then
      null;
    end;
  end if;

  -- Second priority: late/saved QR for an existing prepaid draft.
  -- Prefer exact phone; otherwise only a single active amount candidate.
  did:=null; pcnt:=0; cnt:=0;
  if pphone is not null then
    select count(*),(array_agg(d.id order by d.updated_at desc))[1]
      into pcnt,did
    from public.qrpay_order_drafts d
    where d.order_id is null
      and d.payment_required=true
      and d.payment_mode not in ('cash_counter','cash_at_counter')
      and d.status not in ('confirmed','rejected')
      and abs(d.draft_total-new.amount)<0.01
      and d.created_at>now()-interval '30 days'
      and public.icetak_norm_msisdn(d.customer_phone)=pphone;
  end if;

  if pcnt<>1 then
    select count(*),(array_agg(d.id order by d.updated_at desc))[1]
      into cnt,did
    from public.qrpay_order_drafts d
    where d.order_id is null
      and d.payment_required=true
      and d.payment_mode not in ('cash_counter','cash_at_counter')
      and d.status not in ('confirmed','rejected')
      and abs(d.draft_total-new.amount)<0.01
      and d.created_at>now()-interval '30 days';
    if cnt<>1 then did:=null; end if;
  end if;

  if did is not null then
    begin
      r:=public.icetak_admin_link_payment_to_draft(
        new.transaction_id,did,'payment-auto-reconcile',coalesce(pphone is null,true)
      );
      if coalesce((r->>'success')::boolean,false) then return new; end if;
    exception when others then
      null;
    end;
  end if;

  return new;
end
$function$;
