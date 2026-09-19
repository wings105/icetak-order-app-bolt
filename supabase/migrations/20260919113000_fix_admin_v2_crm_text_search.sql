-- Fix Admin V2 Customer CRM search returning every customer for text-only queries.
-- Root cause: regexp_replace('sitiazlan','[^0-9]','','g') = '' and LIKE '%%' matched every phone.
-- Keep phone matching only when the search actually contains digits.

create or replace function public.icetak_admin_crm_customers(
  p_search text default '',
  p_status text default 'active',
  p_stage text default '',
  p_tag text default '',
  p_limit integer default 50,
  p_offset integer default 0,
  p_sort text default 'recent'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_limit int:=greatest(1,least(coalesce(p_limit,50),100));
  v_offset int:=greatest(0,coalesce(p_offset,0));
  v_q text:=lower(trim(coalesce(p_search,'')));
  v_digits text:=regexp_replace(lower(trim(coalesce(p_search,''))),'[^0-9]','','g');
  v_total bigint;
  v_rows jsonb;
begin
  if not public.icetak_admin_crm_can_view() then raise exception 'Forbidden'; end if;

  with filtered as (
    select cm.id
    from public.customer_master cm
    left join public.customer_crm_profiles cp on cp.customer_master_id=cm.id
    where (coalesce(p_status,'active')='all' or cm.status=coalesce(nullif(p_status,''),'active'))
      and (coalesce(p_stage,'')='' or coalesce(cp.stage,'customer')=p_stage)
      and (coalesce(p_tag,'')='' or exists(
        select 1 from public.customer_crm_tag_links ctl join public.customer_crm_tags ct on ct.id=ctl.tag_id
        where ctl.customer_master_id=cm.id and lower(ct.name)=lower(p_tag)
      ))
      and (
        v_q=''
        or lower(coalesce(cm.admin_name_override,cm.display_name,'')) like '%'||v_q||'%'
        or (
          v_digits <> ''
          and lower(coalesce(cm.primary_phone_normalized,'')) like '%'||v_digits||'%'
        )
        or lower(coalesce(cm.email,'')) like '%'||v_q||'%'
        or exists(
          select 1
          from public.customer_identifiers_master ci
          where ci.customer_master_id=cm.id
            and lower(coalesce(ci.identifier_value,'')) like '%'||v_q||'%'
        )
      )
  ) select count(*) into v_total from filtered;

  with filtered as (
    select cm.*, coalesce(cp.stage,'customer') crm_stage, coalesce(cp.priority,'normal') crm_priority,
      cp.owner_username, coalesce(cp.do_not_contact,false) do_not_contact
    from public.customer_master cm
    left join public.customer_crm_profiles cp on cp.customer_master_id=cm.id
    where (coalesce(p_status,'active')='all' or cm.status=coalesce(nullif(p_status,''),'active'))
      and (coalesce(p_stage,'')='' or coalesce(cp.stage,'customer')=p_stage)
      and (coalesce(p_tag,'')='' or exists(
        select 1 from public.customer_crm_tag_links ctl join public.customer_crm_tags ct on ct.id=ctl.tag_id
        where ctl.customer_master_id=cm.id and lower(ct.name)=lower(p_tag)
      ))
      and (
        v_q=''
        or lower(coalesce(cm.admin_name_override,cm.display_name,'')) like '%'||v_q||'%'
        or (
          v_digits <> ''
          and lower(coalesce(cm.primary_phone_normalized,'')) like '%'||v_digits||'%'
        )
        or lower(coalesce(cm.email,'')) like '%'||v_q||'%'
        or exists(
          select 1
          from public.customer_identifiers_master ci
          where ci.customer_master_id=cm.id
            and lower(coalesce(ci.identifier_value,'')) like '%'||v_q||'%'
        )
      )
  ), enriched as (
    select f.*,
      coalesce(io.order_count,0)+coalesce(mo.order_count,0) order_count,
      coalesce(io.spend,0)+coalesce(mo.spend,0) lifetime_spend,
      greatest(io.last_order_at,mo.last_order_at) last_order_at,
      coalesce(addr.address_count,0) address_count,
      coalesce(task.open_tasks,0) open_tasks,
      coalesce(tags.tags,'[]'::jsonb) tags,
      coalesce(ch.channels,'[]'::jsonb) channels
    from filtered f
    left join lateral (
      select count(*) order_count,
        coalesce(sum(case when lower(coalesce(o.status,'')) not like '%cancel%' then coalesce(o.total,0) else 0 end),0) spend,
        max(o.created_at) last_order_at
      from public.customers c join public.orders o on o.customer_id=c.id
      where c.customer_master_id=f.id
    ) io on true
    left join lateral (
      select count(*) order_count,
        coalesce(sum(case when lower(coalesce(m.current_status,'')) not like '%cancel%' then coalesce(mf.buyer_paid,mf.product_subtotal,0) else 0 end),0) spend,
        max(m.placed_at) last_order_at
      from public.marketplace_customers mc
      join public.marketplace_orders m on m.buyer_customer_id=mc.id and m.internal_order_id is null
      left join public.marketplace_order_financials mf on mf.order_id=m.id
      where mc.customer_master_id=f.id
    ) mo on true
    left join lateral (select count(*) address_count from public.customer_addresses a where a.customer_master_id=f.id and a.archived_at is null) addr on true
    left join lateral (select count(*) open_tasks from public.customer_crm_tasks t where t.customer_master_id=f.id and t.status='open') task on true
    left join lateral (
      select coalesce(jsonb_agg(ct.name order by ct.name),'[]'::jsonb) tags
      from public.customer_crm_tag_links ctl join public.customer_crm_tags ct on ct.id=ctl.tag_id where ctl.customer_master_id=f.id
    ) tags on true
    left join lateral (
      select coalesce(jsonb_agg(distinct x.source_system) filter(where x.source_system is not null),'[]'::jsonb) channels
      from public.customer_source_records x where x.customer_master_id=f.id
    ) ch on true
  ), paged as (
    select * from enriched
    order by
      case when p_sort='spend' then lifetime_spend end desc nulls last,
      case when p_sort='orders' then order_count end desc nulls last,
      case when p_sort='name' then lower(coalesce(admin_name_override,display_name,'')) end asc nulls last,
      case when p_sort not in ('spend','orders','name') then coalesce(last_order_at,last_seen_at,updated_at,created_at) end desc nulls last,
      id
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,
    'name',coalesce(nullif(admin_name_override,''),nullif(display_name,''),'Unnamed Customer'),
    'sourceName',coalesce(display_name,''),
    'phone',coalesce(primary_phone_normalized,''),
    'email',coalesce(email,''),
    'status',status,
    'stage',crm_stage,
    'priority',crm_priority,
    'owner',coalesce(owner_username,''),
    'doNotContact',do_not_contact,
    'orderCount',order_count,
    'lifetimeSpend',lifetime_spend,
    'lastOrderAt',last_order_at,
    'lastSeenAt',last_seen_at,
    'addressCount',address_count,
    'openTasks',open_tasks,
    'tags',tags,
    'channels',channels
  )),'[]'::jsonb) into v_rows from paged;

  return jsonb_build_object(
    'ok',true,
    'total',v_total,
    'limit',v_limit,
    'offset',v_offset,
    'rows',v_rows,
    'summary',jsonb_build_object(
      'active',(select count(*) from public.customer_master where status='active'),
      'merged',(select count(*) from public.customer_master where status='merged'),
      'withPhone',(select count(*) from public.customer_master where status='active' and nullif(primary_phone_normalized,'') is not null),
      'withEmail',(select count(*) from public.customer_master where status='active' and nullif(email,'') is not null),
      'openTasks',(select count(*) from public.customer_crm_tasks where status='open')
    )
  );
end
$function$;
