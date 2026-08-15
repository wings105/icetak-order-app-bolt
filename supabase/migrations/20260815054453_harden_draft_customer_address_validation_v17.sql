create or replace function public.icetak_customer_confirm_draft(p_customer_token text, p_customer jsonb default '{}'::jsonb, p_actor text default 'customer-link'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
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
$$;

revoke all on function public.icetak_customer_confirm_draft(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.icetak_customer_confirm_draft(text,jsonb,text) to service_role;