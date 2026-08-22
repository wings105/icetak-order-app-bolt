-- Counter-first pickup workflow: show actionable ready/unpaid customers,
-- reuse QR sessions between staff and customers, and add an explicitly
-- triggered WhatsApp summary rule without touching lifecycle automations.

create or replace function public.icetak_admin_pickup_ready_queue(
  p_limit integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_rows jsonb;
  v_order_count integer;
  v_total numeric;
begin
  if not (
    coalesce(auth.jwt()->>'role','')='service_role'
    or public.icetak_admin_has_permission('view_customers')
    or public.icetak_admin_has_permission('manage_customers')
    or public.icetak_admin_has_permission('verify_payments')
    or public.icetak_admin_has_permission('approve_production')
  ) then raise exception 'Forbidden'; end if;

  with ready_orders as (
    select
      coalesce(m.merged_into_id,m.id) as master_id,
      o.id,
      coalesce(o.order_no,o.order_id) as order_no,
      round(coalesce(o.total,0),2) as amount,
      o.date_need,
      coalesce(o.pickup_ready_at,o.updated_at,o.created_at) as ready_at,
      preview.preview_url,
      preview.item_title
    from public.orders o
    join public.customers c on c.id=o.customer_id
    join public.customer_master m on m.id=c.customer_master_id
    left join lateral (
      select
        coalesce(
          nullif(i.design_preview_url,''),
          (
            select nullif(pc.preview_url,'')
            from public.production_components pc
            where pc.order_id=o.id and nullif(pc.preview_url,'') is not null
            order by pc.updated_at desc nulls last
            limit 1
          )
        ) as preview_url,
        coalesce(nullif(i.title,''),nullif(i.product_type,''),'Item') as item_title
      from public.order_items i
      where i.order_id=o.id
      order by
        case when nullif(i.design_preview_url,'') is not null then 0 else 1 end,
        coalesce(i.sort_index,0),i.updated_at desc nulls last
      limit 1
    ) preview on true
    where public.icetak_pickup_is_ready(o.id)
      and lower(coalesce(o.payment_status,'')) not in ('paid','matched','payment_received')
      and lower(coalesce(o.payment,''))<>'paid'
  ), grouped as (
    select
      r.master_id,
      count(*)::integer as ready_unpaid,
      round(sum(r.amount),2) as ready_amount,
      min(r.date_need) as next_due,
      max(r.ready_at) as latest_ready,
      jsonb_agg(
        jsonb_build_object(
          'id',r.id,'orderNo',r.order_no,'amount',r.amount,
          'previewUrl',r.preview_url,'itemTitle',r.item_title,
          'dateNeed',r.date_need
        )
        order by r.date_need nulls last,r.ready_at desc,r.order_no
      ) as ready_orders
    from ready_orders r
    group by r.master_id
  ), limited as (
    select
      g.*,
      coalesce(nullif(m.admin_name_override,''),nullif(m.display_name,''),'Customer') as customer_name,
      coalesce(nullif(m.primary_phone_normalized,''),contact.phone) as customer_phone,
      contact.bsuid
    from grouped g
    join public.customer_master m on m.id=g.master_id
    left join lateral (
      select
        coalesce(nullif(w.normalized_phone,''),nullif(w.phone,''),nullif(c.phone,'')) as phone,
        nullif(w.bsuid,'') as bsuid
      from public.customers c
      left join public.whatsapp_contacts w on w.customer_id=c.id
      join public.customer_master cm on cm.id=c.customer_master_id
      where coalesce(cm.merged_into_id,cm.id)=g.master_id
      order by
        case when nullif(w.bsuid,'') is not null then 0 else 1 end,
        case when nullif(coalesce(w.normalized_phone,w.phone,c.phone,''),'') is not null then 0 else 1 end,
        w.last_message_at desc nulls last,c.created_at desc
      limit 1
    ) contact on true
    order by g.ready_unpaid desc,g.next_due nulls last,g.latest_ready desc,lower(m.display_name)
    limit greatest(1,least(coalesce(p_limit,60),150))
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id',master_id,'name',customer_name,'phone',customer_phone,'bsuid',bsuid,
        'readyUnpaid',ready_unpaid,'readyAmount',ready_amount,
        'nextDue',next_due,'latestReadyAt',latest_ready,'readyOrders',ready_orders
      ) order by ready_unpaid desc,next_due nulls last,latest_ready desc,lower(customer_name)
    ),'[]'::jsonb),
    coalesce(sum(ready_unpaid),0)::integer,
    round(coalesce(sum(ready_amount),0),2)
  into v_rows,v_order_count,v_total
  from limited;

  return jsonb_build_object(
    'ok',true,'rows',v_rows,'orderCount',v_order_count,
    'totalAmount',v_total,'generatedAt',now()
  );
end;
$$;

create or replace function public.icetak_admin_pickup_customer_search(
  p_query text,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_q text:=lower(btrim(coalesce(p_query,'')));
  v_phone text:=public.icetak_norm_msisdn(p_query);
  v_result jsonb;
begin
  if not (
    coalesce(auth.jwt()->>'role','')='service_role'
    or public.icetak_admin_has_permission('view_customers')
    or public.icetak_admin_has_permission('manage_customers')
    or public.icetak_admin_has_permission('verify_payments')
    or public.icetak_admin_has_permission('approve_production')
  ) then raise exception 'Forbidden'; end if;

  if v_q='' then
    return public.icetak_admin_pickup_ready_queue(p_limit);
  end if;

  with candidates as (
    select distinct on (coalesce(m.merged_into_id,m.id))
      coalesce(m.merged_into_id,m.id) as master_id,
      coalesce(
        nullif(canonical.admin_name_override,''),nullif(canonical.display_name,''),
        nullif(c.admin_name_override,''),nullif(c.name,''),'Customer'
      ) as customer_name,
      coalesce(
        nullif(canonical.primary_phone_normalized,''),
        nullif(c.phone,''),nullif(w.normalized_phone,''),nullif(w.phone,'')
      ) as customer_phone,
      nullif(w.bsuid,'') as bsuid
    from public.customer_master m
    join public.customer_master canonical on canonical.id=coalesce(m.merged_into_id,m.id)
    left join public.customers c on c.customer_master_id=m.id
    left join public.whatsapp_contacts w on w.customer_id=c.id
    where lower(coalesce(m.display_name,'')) like '%'||v_q||'%'
      or lower(coalesce(m.admin_name_override,'')) like '%'||v_q||'%'
      or lower(coalesce(canonical.display_name,'')) like '%'||v_q||'%'
      or lower(coalesce(canonical.admin_name_override,'')) like '%'||v_q||'%'
      or lower(coalesce(c.name,'')) like '%'||v_q||'%'
      or lower(coalesce(c.admin_name_override,'')) like '%'||v_q||'%'
      or lower(coalesce(w.username,'')) like '%'||v_q||'%'
      or lower(coalesce(w.bsuid,''))=v_q
      or (v_phone is not null and (
        public.icetak_norm_msisdn(canonical.primary_phone_normalized)=v_phone
        or public.icetak_norm_msisdn(c.phone)=v_phone
        or public.icetak_norm_msisdn(w.normalized_phone)=v_phone
        or public.icetak_norm_msisdn(w.phone)=v_phone
      ))
      or exists (
        select 1 from public.orders so
        where so.customer_id=c.id
          and lower(coalesce(so.order_no,so.order_id,''))=v_q
      )
    order by
      coalesce(m.merged_into_id,m.id),
      case when nullif(coalesce(canonical.primary_phone_normalized,c.phone,w.normalized_phone,w.phone,''),'') is not null then 0 else 1 end,
      case when nullif(w.bsuid,'') is not null then 0 else 1 end,
      w.last_message_at desc nulls last,c.created_at desc
  ), ranked as (
    select
      candidate.*,
      coalesce(ready.ready_unpaid,0)::integer as ready_unpaid,
      round(coalesce(ready.ready_amount,0),2) as ready_amount,
      coalesce(ready.ready_orders,'[]'::jsonb) as ready_orders
    from candidates candidate
    left join lateral (
      select
        count(*) as ready_unpaid,
        sum(coalesce(o.total,0)) as ready_amount,
        jsonb_agg(
          jsonb_build_object(
            'id',o.id,'orderNo',coalesce(o.order_no,o.order_id),
            'amount',round(coalesce(o.total,0),2),
            'previewUrl',preview.preview_url,'itemTitle',preview.item_title,
            'dateNeed',o.date_need
          ) order by o.date_need nulls last,o.created_at desc
        ) as ready_orders
      from public.orders o
      join public.customers oc on oc.id=o.customer_id
      join public.customer_master om on om.id=oc.customer_master_id
      left join lateral (
        select
          coalesce(
            nullif(i.design_preview_url,''),
            (
              select nullif(pc.preview_url,'')
              from public.production_components pc
              where pc.order_id=o.id and nullif(pc.preview_url,'') is not null
              order by pc.updated_at desc nulls last limit 1
            )
          ) as preview_url,
          coalesce(nullif(i.title,''),nullif(i.product_type,''),'Item') as item_title
        from public.order_items i
        where i.order_id=o.id
        order by
          case when nullif(i.design_preview_url,'') is not null then 0 else 1 end,
          coalesce(i.sort_index,0),i.updated_at desc nulls last
        limit 1
      ) preview on true
      where coalesce(om.merged_into_id,om.id)=candidate.master_id
        and public.icetak_pickup_is_ready(o.id)
        and lower(coalesce(o.payment_status,'')) not in ('paid','matched','payment_received')
        and lower(coalesce(o.payment,''))<>'paid'
    ) ready on true
    order by
      coalesce(ready.ready_unpaid,0) desc,
      coalesce(ready.ready_amount,0) desc,
      lower(candidate.customer_name)
    limit greatest(1,least(coalesce(p_limit,20),50))
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',master_id,'name',customer_name,'phone',customer_phone,'bsuid',bsuid,
      'readyUnpaid',ready_unpaid,'readyAmount',ready_amount,'readyOrders',ready_orders
    ) order by ready_unpaid desc,ready_amount desc,lower(customer_name)
  ),'[]'::jsonb)
  into v_result
  from ranked;

  return jsonb_build_object('ok',true,'rows',v_result);
end;
$$;

create or replace function public.icetak_admin_pickup_customer_overview(
  p_customer_master_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_overview jsonb;
  v_phone text;
  v_bsuid text;
begin
  if not (
    coalesce(auth.jwt()->>'role','')='service_role'
    or public.icetak_admin_has_permission('view_customers')
    or public.icetak_admin_has_permission('manage_customers')
    or public.icetak_admin_has_permission('verify_payments')
    or public.icetak_admin_has_permission('approve_production')
  ) then raise exception 'Forbidden'; end if;

  v_overview:=public.icetak_pickup_overview_for_master(p_customer_master_id);

  select
    coalesce(nullif(m.primary_phone_normalized,''),nullif(w.normalized_phone,''),nullif(w.phone,''),nullif(c.phone,'')),
    nullif(w.bsuid,'')
  into v_phone,v_bsuid
  from public.customer_master m
  left join public.customers c on c.customer_master_id=m.id
  left join public.whatsapp_contacts w on w.customer_id=c.id
  where m.id=(v_overview#>>'{customer,id}')::uuid
  order by
    case when nullif(w.bsuid,'') is not null then 0 else 1 end,
    w.last_message_at desc nulls last,c.created_at desc
  limit 1;

  if nullif(v_phone,'') is not null then
    v_overview:=jsonb_set(v_overview,'{customer,phone}',to_jsonb(v_phone),true);
  end if;
  if nullif(v_bsuid,'') is not null then
    v_overview:=jsonb_set(v_overview,'{customer,bsuid}',to_jsonb(v_bsuid),true);
  end if;
  return v_overview;
end;
$$;

create or replace function public.icetak_admin_create_pickup_access(
  p_customer_master_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor text;
  v_token text:=encode(extensions.gen_random_bytes(24),'hex');
  v_master uuid;
  v_expires timestamptz:=now()+interval '7 days';
begin
  if not (
    coalesce(auth.jwt()->>'role','')='service_role'
    or public.icetak_admin_has_permission('view_customers')
    or public.icetak_admin_has_permission('manage_customers')
    or public.icetak_admin_has_permission('verify_payments')
  ) then raise exception 'Forbidden'; end if;
  select coalesce(m.merged_into_id,m.id) into v_master
  from public.customer_master m where m.id=p_customer_master_id;
  if v_master is null then raise exception 'customer_not_found'; end if;
  select u.username into v_actor from public.admin_users u
  where u.auth_user_id=auth.uid() and u.is_active limit 1;
  insert into public.pickup_access_tokens(customer_master_id,token_hash,expires_at,created_by)
  values(
    v_master,public.icetak_customer_session_hash(v_token),v_expires,
    coalesce(v_actor,case when auth.jwt()->>'role'='service_role' then 'service_role' else 'admin' end)
  );
  return jsonb_build_object(
    'ok',true,'token',v_token,'path','/?pickup='||v_token,
    'expiresAt',v_expires,'customerMasterId',v_master
  );
end;
$$;

create or replace function public.icetak_create_pickup_checkout_internal(
  p_customer_master_id uuid,
  p_order_ids uuid[],
  p_method text,
  p_source text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_master uuid;
  v_checkout_id uuid:=gen_random_uuid();
  v_checkout_no text:='PC'||to_char(now() at time zone 'Asia/Kuala_Lumpur','YYMMDD')
    ||'-'||upper(substr(replace(v_checkout_id::text,'-',''),1,6));
  v_session_id uuid:=gen_random_uuid();
  v_session_token text:='pb_'||encode(extensions.gen_random_bytes(16),'hex');
  v_order_ids uuid[];
  v_total numeric;
  v_count integer;
  v_expires timestamptz:=now()+interval '30 minutes';
  v_existing public.pickup_checkouts%rowtype;
  v_result jsonb;
begin
  if p_method not in ('cash','qrpay') then raise exception 'invalid_payment_method'; end if;
  if coalesce(cardinality(p_order_ids),0)=0 then raise exception 'select_at_least_one_order'; end if;
  if cardinality(p_order_ids)<>cardinality(array(select distinct unnest(p_order_ids))) then
    raise exception 'duplicate_order_selection';
  end if;
  select array_agg(order_id order by order_id)
  into v_order_ids
  from unnest(p_order_ids) as selected(order_id);

  select coalesce(m.merged_into_id,m.id) into v_master
  from public.customer_master m where m.id=p_customer_master_id;
  if v_master is null then raise exception 'customer_not_found'; end if;

  update public.pickup_checkouts pc
  set status='expired',updated_at=now()
  where pc.status='awaiting_payment'
    and (
      pc.expires_at<=now()
      or exists (
        select 1 from public.payment_sessions ps
        where ps.id=pc.payment_session_id
          and (
            ps.expires_at<=now()
            or lower(coalesce(ps.status,'')) in ('expired','cancelled','canceled','superseded')
          )
      )
    );

  update public.pickup_checkout_orders po
  set status='released',active_reservation=false
  where po.active_reservation
    and exists (
      select 1 from public.pickup_checkouts pc
      where pc.id=po.checkout_id and pc.status in ('expired','cancelled')
    );

  perform 1
  from public.orders o
  where o.id=any(v_order_ids)
  order by o.id for update;

  select count(*),round(sum(coalesce(o.total,0)),2)
  into v_count,v_total
  from public.orders o
  join public.customers c on c.id=o.customer_id
  join public.customer_master m on m.id=c.customer_master_id
  where o.id=any(v_order_ids)
    and coalesce(m.merged_into_id,m.id)=v_master
    and (
      lower(coalesce(o.delivery_method,'')) like '%pickup%'
      or lower(coalesce(o.delivery,'')) like '%pickup%'
      or o.pickup_ready_at is not null
    )
    and o.pickup_collected_at is null
    and lower(coalesce(o.status,'')) not in ('cancelled','canceled')
    and lower(coalesce(o.payment_status,'')) not in ('paid','matched','payment_received')
    and lower(coalesce(o.payment,''))<>'paid';
  if v_count<>cardinality(v_order_ids) then
    raise exception 'invalid_paid_or_foreign_order_selection';
  end if;
  if coalesce(v_total,0)<=0 then raise exception 'invalid_checkout_total'; end if;

  if p_method='qrpay' then
    select pc.* into v_existing
    from public.pickup_checkouts pc
    join public.payment_sessions ps on ps.id=pc.payment_session_id
    where pc.customer_master_id=v_master
      and pc.status='awaiting_payment'
      and pc.payment_method='qrpay'
      and pc.expires_at>now()
      and ps.expires_at>now()
      and lower(coalesce(ps.status,'')) in ('pending','submitted','receipt_submitted','pending_review')
      and (
        select array_agg(po.order_id order by po.order_id)
        from public.pickup_checkout_orders po
        where po.checkout_id=pc.id and po.active_reservation
      )=v_order_ids
    order by pc.created_at desc
    limit 1
    for update of pc;

    if found then
      return jsonb_build_object(
        'ok',true,'paid',false,'reused',true,
        'checkoutId',v_existing.id,'checkoutNo',v_existing.checkout_no,
        'amount',v_existing.total_amount,'paymentSessionId',v_existing.payment_session_id,
        'expiresAt',v_existing.expires_at
      );
    end if;
  end if;

  with cancelled as (
    update public.pickup_checkouts pc
    set status='cancelled',updated_at=now()
    where pc.customer_master_id=v_master
      and pc.status='awaiting_payment'
      and exists (
        select 1 from public.pickup_checkout_orders po
        where po.checkout_id=pc.id
          and po.active_reservation
          and po.order_id=any(v_order_ids)
      )
    returning pc.payment_session_id
  )
  update public.payment_sessions ps
  set status='cancelled'
  where ps.id in (select payment_session_id from cancelled)
    and lower(coalesce(ps.status,'')) in ('pending','submitted','receipt_submitted','pending_review');

  update public.pickup_checkout_orders po
  set status='released',active_reservation=false
  where po.active_reservation
    and exists (
      select 1 from public.pickup_checkouts pc
      where pc.id=po.checkout_id and pc.status in ('expired','cancelled')
    );

  insert into public.payment_sessions(
    id,order_id,expected_amount,status,base_amount,discount,expires_at,
    order_token,purpose,pricing_snapshot,reservation_grace_seconds
  ) values(
    v_session_id,null,v_total,
    case when p_method='cash' then 'matched' else 'pending' end,
    v_total,0,v_expires,v_session_token,'pickup_bundle',
    jsonb_build_object(
      'pickup_checkout_id',v_checkout_id,'pickup_checkout_no',v_checkout_no,
      'customer_master_id',v_master,'order_ids',to_jsonb(v_order_ids),
      'source',p_source,'payment_method',p_method
    ),120
  );

  insert into public.pickup_checkouts(
    id,checkout_no,customer_master_id,customer_id,source,status,payment_method,
    total_amount,payment_session_id,expires_at,created_by
  )
  select
    v_checkout_id,v_checkout_no,v_master,
    (
      select c.id
      from public.customers c
      join public.customer_master m on m.id=c.customer_master_id
      where coalesce(m.merged_into_id,m.id)=v_master
      order by c.created_at desc limit 1
    ),
    case when p_source in ('counter','customer_portal','whatsapp','admin_crm')
      then p_source else 'counter' end,
    'awaiting_payment',p_method,v_total,v_session_id,v_expires,
    coalesce(nullif(p_actor,''),'pickup_checkout');

  insert into public.pickup_checkout_orders(
    checkout_id,order_id,amount,ready_at_creation,item_snapshot
  )
  select
    v_checkout_id,o.id,round(coalesce(o.total,0),2),
    public.icetak_pickup_is_ready(o.id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'title',coalesce(i.title,i.product_type,'Item'),
        'qty',coalesce(i.qty,1),'price',coalesce(i.price,0),
        'size',i.size,'wording',coalesce(i.custom_text,i.wording),
        'previewUrl',i.design_preview_url
      ) order by coalesce(i.sort_index,0),i.id)
      from public.order_items i where i.order_id=o.id
    ),'[]'::jsonb)
  from public.orders o where o.id=any(v_order_ids);

  if p_method='cash' then
    v_result:=public.icetak_finalize_pickup_checkout(
      v_checkout_id,'CASH-'||v_checkout_no,v_total,'cash_counter','',
      coalesce(nullif(p_actor,''),'pickup_counter'),
      jsonb_build_object('source','pickup_counter','paid_at',now())
    );
  else
    v_result:=jsonb_build_object(
      'ok',true,'paid',false,'reused',false,
      'checkoutId',v_checkout_id,'checkoutNo',v_checkout_no,
      'amount',v_total,'paymentSessionId',v_session_id,'expiresAt',v_expires
    );
  end if;
  return v_result;
end;
$$;

create or replace function public.icetak_admin_pickup_total_by_identity(
  p_identity text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_search jsonb;
  v_row jsonb;
  v_overview jsonb;
  v_access jsonb;
  v_ready jsonb;
  v_total numeric;
begin
  if not (
    coalesce(auth.jwt()->>'role','')='service_role'
    or public.icetak_admin_has_permission('view_customers')
    or public.icetak_admin_has_permission('verify_payments')
  ) then raise exception 'Forbidden'; end if;

  v_search:=public.icetak_admin_pickup_customer_search(p_identity,2);
  if jsonb_array_length(v_search->'rows')<>1 then
    return jsonb_build_object(
      'ok',false,'reason','identity_not_unique',
      'matches',jsonb_array_length(v_search->'rows')
    );
  end if;
  v_row:=(v_search->'rows')->0;
  v_overview:=public.icetak_pickup_overview_for_master((v_row->>'id')::uuid);
  select
    coalesce(jsonb_agg(order_row),'[]'::jsonb),
    coalesce(sum((order_row->>'balance')::numeric),0)
  into v_ready,v_total
  from jsonb_array_elements(v_overview->'orders') order_row
  where order_row->>'group'='ready_unpaid';
  v_access:=public.icetak_admin_create_pickup_access((v_row->>'id')::uuid);

  return jsonb_build_object(
    'ok',true,'customer',v_overview->'customer','orders',v_ready,
    'total',round(v_total,2),'path',v_access->>'path',
    'message','Hi '||(v_overview#>>'{customer,name}')||E',\n\n'
      ||jsonb_array_length(v_ready)||' order siap untuk pickup. '
      ||'Jumlah belum dibayar: RM'||to_char(v_total,'FM999999990.00')||E'\n'
      ||'Pilih order dan buat bayaran melalui link: '||(v_access->>'path')
  );
end;
$$;

insert into public.whatsapp_notification_rules(
  event_type,label,enabled,prefer_template_when_closed,
  freeform_enabled,template_enabled,freeform_text,
  template_name,template_language,template_params,
  sort_order,trigger_status,notes,available_fields
)
values(
  'pickup_payment_summary',
  'Pickup Counter · Ready Orders & Payment Link',
  true,true,true,true,
  E'Hi {customer_name},\n\n{pickup_order_count} order anda sudah siap untuk pickup:\n{items_summary}\n\nJumlah perlu dibayar: *{order_total}*\n\nSemak item dan bayar melalui link:\n{payment_link}',
  'payment_pending','ms',
  '["customer_name","order_id","order_total","payment_link"]'::jsonb,
  12,
  'Staff manually clicks Send WhatsApp in Pickup Counter',
  'Manual counter send only. Free-form in open 24H window; approved payment_pending template otherwise.',
  array[
    'customer_name','phone','order_id','order_total','payment_link',
    'order_link','items_summary','pickup_order_count','pickup_location','support_phone'
  ]::text[]
)
on conflict(event_type) do nothing;

-- Fix stale bundles already left behind by expired payment sessions.
update public.pickup_checkouts pc
set status='expired',updated_at=now()
where pc.status='awaiting_payment'
  and (
    pc.expires_at<=now()
    or exists (
      select 1 from public.payment_sessions ps
      where ps.id=pc.payment_session_id
        and (
          ps.expires_at<=now()
          or lower(coalesce(ps.status,'')) in ('expired','cancelled','canceled','superseded')
        )
    )
  );

update public.pickup_checkout_orders po
set status='released',active_reservation=false
where po.active_reservation
  and exists (
    select 1 from public.pickup_checkouts pc
    where pc.id=po.checkout_id and pc.status in ('expired','cancelled')
  );

revoke execute on function public.icetak_admin_pickup_ready_queue(integer)
  from public,anon;
grant execute on function public.icetak_admin_pickup_ready_queue(integer)
  to authenticated,service_role;

revoke execute on function public.icetak_create_pickup_checkout_internal(uuid,uuid[],text,text,text)
  from public,anon,authenticated;
grant execute on function public.icetak_create_pickup_checkout_internal(uuid,uuid[],text,text,text)
  to service_role;
