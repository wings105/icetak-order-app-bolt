alter table finance.qrpay_payment_controls
  add column if not exists identity_name text,
  add column if not exists identity_phone text,
  add column if not exists identity_confirmed_at timestamptz,
  add column if not exists identity_confirmed_by text;

create or replace function public.finance_admin_qrpay_identity_update(
  p_transaction_id text,
  p_name text,
  p_phone text,
  p_update_order boolean default false,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_transaction_id text:=nullif(btrim(p_transaction_id),'');
  v_name text:=nullif(btrim(p_name),'');
  v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v_order_id uuid;
  v_order_no text;
  v_old jsonb;
begin
  if v_transaction_id is null or v_name is null then
    raise exception 'Transaction, customer name and phone are required';
  end if;
  if length(v_name)>200 then raise exception 'Customer name cannot exceed 200 characters'; end if;

  if left(v_phone,1)='0' then v_phone:='6'||v_phone;
  elsif left(v_phone,1)='1' then v_phone:='60'||v_phone;
  end if;
  if v_phone !~ '^60[1-9][0-9]{7,10}$' then
    raise exception 'Enter a valid Malaysia phone number';
  end if;

  if not exists(
    select 1 from public.admin_users a
    where a.username=p_actor and coalesce(a.is_active,false) and a.role='owner'
  ) then raise exception 'Active owner access is required'; end if;

  if not exists(
    select 1 from public.payment_transactions p
    where p.transaction_id=v_transaction_id and p.provider in ('qrpay','qrpay_ai','duitnow')
    union all
    select 1 from public.unmatched_payment_transactions u
    where u.transaction_id=v_transaction_id and u.provider in ('qrpay','qrpay_ai','duitnow')
  ) then raise exception 'QRPay transaction was not found'; end if;

  select p.order_id into v_order_id
  from public.payment_transactions p
  where p.transaction_id=v_transaction_id and p.provider in ('qrpay','qrpay_ai','duitnow')
  order by p.created_at desc limit 1;

  if v_order_id is null then
    select j.order_id into v_order_id
    from public.unmatched_payment_transactions u
    left join public.qrpay_ai_jobs j
      on j.unmatched_payment_id=u.id or (j.unmatched_payment_id is null and j.transaction_id=u.transaction_id)
    where u.transaction_id=v_transaction_id and u.provider in ('qrpay','qrpay_ai','duitnow')
      and j.order_id is not null
    order by j.updated_at desc nulls last,j.created_at desc nulls last
    limit 1;
  end if;

  select to_jsonb(q) into v_old
  from finance.qrpay_payment_controls q where q.transaction_id=v_transaction_id;

  insert into finance.qrpay_payment_controls(
    transaction_id,workflow_state,created_by,updated_by,
    identity_name,identity_phone,identity_confirmed_at,identity_confirmed_by
  ) values (
    v_transaction_id,'active',p_actor,p_actor,
    v_name,v_phone,now(),p_actor
  )
  on conflict(transaction_id) do update set
    identity_name=excluded.identity_name,
    identity_phone=excluded.identity_phone,
    identity_confirmed_at=excluded.identity_confirmed_at,
    identity_confirmed_by=excluded.identity_confirmed_by,
    updated_at=now(),updated_by=excluded.updated_by,
    version=finance.qrpay_payment_controls.version+1;

  if coalesce(p_update_order,false) then
    if v_order_id is null then raise exception 'Payment is not linked to an order'; end if;
    update public.orders set
      delivery_name=v_name,
      delivery_phone=v_phone,
      updated_at=now()
    where id=v_order_id;
  end if;

  select o.order_no into v_order_no from public.orders o where o.id=v_order_id;

  insert into public.admin_audit(order_db_id,order_id,action,actor,payload,meta)
  values (
    v_order_id::text,v_order_no,'qrpay_identity_confirm',p_actor,
    jsonb_build_object(
      'transaction_id',v_transaction_id,
      'previous_override',coalesce(v_old,'{}'::jsonb),
      'confirmed_name',v_name,
      'confirmed_phone',v_phone,
      'updated_linked_order',coalesce(p_update_order,false)
    ),
    jsonb_build_object('source','qrpay_daily','immutable_source_preserved',true)
  );

  return jsonb_build_object(
    'success',true,'transaction_id',v_transaction_id,
    'name',v_name,'phone',v_phone,'order_id',v_order_id,'order_no',v_order_no,
    'updated_order',coalesce(p_update_order,false),'confirmed_at',now(),'confirmed_by',p_actor
  );
end;
$$;

create or replace function public.finance_admin_qrpay_range_with_progress(p_from date default null,p_to date default null)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
with base as (
  select public.finance_admin_qrpay_range(p_from,p_to) value
), enriched_rows as (
  select coalesce(jsonb_agg(
    r.value || jsonb_build_object(
      'sender_name',coalesce(nullif(qc.identity_name,''),r.value->>'sender_name'),
      'phone',coalesce(nullif(qc.identity_phone,''),r.value->>'phone'),
      'whatsapp_link',case
        when nullif(coalesce(qc.identity_phone,r.value->>'phone'),'') is null then null
        else 'https://wa.me/'||regexp_replace(coalesce(qc.identity_phone,r.value->>'phone'),'[^0-9]','','g')
      end,
      'identity_confirmed',qc.identity_confirmed_at is not null,
      'identity_confirmed_at',qc.identity_confirmed_at,
      'identity_confirmed_by',qc.identity_confirmed_by,
      'identity_original_name',r.value->>'sender_name',
      'identity_original_phone',r.value->>'phone',
      'order_progress',case
        when nullif(r.value->>'order_id','') is null then null
        else public.finance_admin_qrpay_order_progress((r.value->>'order_id')::uuid)
      end
    ) order by r.ordinality
  ),'[]'::jsonb) value
  from base b
  cross join lateral jsonb_array_elements(coalesce(b.value->'rows','[]'::jsonb)) with ordinality r(value,ordinality)
  left join finance.qrpay_payment_controls qc on qc.transaction_id=r.value->>'transaction_id'
)
select b.value || jsonb_build_object('rows',e.value)
from base b cross join enriched_rows e;
$$;

create or replace function public.finance_admin_qrpay_daily(p_date date default null)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select public.finance_admin_qrpay_range_with_progress(
    coalesce(p_date,(now() at time zone 'Asia/Kuala_Lumpur')::date),
    coalesce(p_date,(now() at time zone 'Asia/Kuala_Lumpur')::date)
  );
$$;

revoke all on function public.finance_admin_qrpay_identity_update(text,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.finance_admin_qrpay_identity_update(text,text,text,boolean,text) to service_role;

revoke all on function public.finance_admin_qrpay_range_with_progress(date,date) from public,anon,authenticated;
grant execute on function public.finance_admin_qrpay_range_with_progress(date,date) to service_role;

revoke all on function public.finance_admin_qrpay_daily(date) from public,anon,authenticated;
grant execute on function public.finance_admin_qrpay_daily(date) to service_role;

comment on column finance.qrpay_payment_controls.identity_phone is 'Transaction-specific admin-confirmed phone; immutable bank/AI payload remains unchanged.';
comment on function public.finance_admin_qrpay_identity_update(text,text,text,boolean,text) is 'Audited owner-only QRPay identity override; optionally updates delivery contact on the linked order without changing customer master data.';
