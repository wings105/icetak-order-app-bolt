-- Order System only. Private read model and auditable panel decisions.
create table public.customer_focus_state (
 row_key text primary key check (row_key ~ '^(icetak|shopee|chat):[0-9a-f-]{36}$'),
 version integer not null default 1, data jsonb not null default '{}',
 updated_by text not null, updated_at timestamptz not null default now()
);
create table public.customer_focus_events (
 request_id uuid primary key, row_key text not null, actor text not null,
 expected_version integer not null, input jsonb not null, result jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.customer_focus_state enable row level security;
alter table public.customer_focus_events enable row level security;
revoke all on public.customer_focus_state,public.customer_focus_events from public,anon,authenticated;
grant all on public.customer_focus_state,public.customer_focus_events to service_role;

create function public.icetak_customer_focus_save(p_key text,p_actor text,p_version integer,p_request uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare old public.customer_focus_state%rowtype; e public.customer_focus_events%rowtype; r jsonb;
begin
 if p_key !~ '^(icetak|shopee|chat):[0-9a-f-]{36}$' or length(p_actor)<1 or p_version<0 or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid focus update'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key,0));
 select * into e from customer_focus_events where request_id=p_request;
 if found then
  if e.row_key<>p_key or e.actor<>p_actor or e.expected_version<>p_version or e.input<>p_data then raise exception 'REQUEST_CONFLICT'; end if;
  return e.result;
 end if;
 select * into old from customer_focus_state where row_key=p_key for update;
 if coalesce(old.version,0)<>p_version then raise exception 'FOCUS_CHANGED: Muat semula, admin lain sudah mengemas kini.'; end if;
 insert into customer_focus_state(row_key,version,data,updated_by)
 values(p_key,p_version+1,p_data,p_actor)
 on conflict(row_key) do update set version=excluded.version,data=excluded.data,updated_by=excluded.updated_by,updated_at=now()
 returning to_jsonb(customer_focus_state) into r;
 insert into customer_focus_events(request_id,row_key,actor,expected_version,input,result) values(p_request,p_key,p_actor,p_version,p_data,r);
 return r;
end $$;
revoke all on function public.icetak_customer_focus_save(text,text,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_customer_focus_save(text,text,integer,uuid,jsonb) to service_role;

create function public.icetak_customer_focus_snapshot() returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
with eligible as (
 select s.*, coalesce(o.created_at,m.placed_at,m.created_at) created_at,
 case when s.kind='icetak' then o.total else f.buyer_paid end amount,
 case when s.kind='icetak' then o.date_need end customer_needed,
 case when s.kind='shopee' then s.deadline end platform_deadline,
 coalesce(m.buyer_message,o.admin_remark) order_note,
 case when s.kind='icetak' then
  coalesce((select jsonb_agg(jsonb_build_object('title',i.title,'quantity',i.qty,'size',i.size,'wording',i.wording,'sku',i.catalog_slug)) from order_items i where i.order_id=s.id),'[]')
 else coalesce((select jsonb_agg(jsonb_build_object('title',i.title,'quantity',i.quantity,'size',i.variation_name,'sku',coalesce(i.variation_sku,i.item_sku))) from marketplace_order_items i where i.order_id=s.id and i.is_current),'[]') end items
 from ai_order_work_source s
 left join orders o on s.kind='icetak' and o.id=s.id
 left join marketplace_orders m on s.kind='shopee' and m.id=s.id
 left join lateral(select buyer_paid from marketplace_order_financials where order_id=m.id limit 1) f on true
 where not(s.kind='icetak' and exists(select 1 from marketplace_orders mirror where mirror.internal_order_id=s.id and coalesce(mirror.metadata->>'dashboard_excluded','false')<>'true'))
), bounded as (select * from eligible order by source_updated_at desc nulls last,id limit 10000)
select jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(bounded)) from bounded),'[]'),
 'order_total',(select count(*) from eligible),'orders_truncated',(select count(*)>10000 from eligible),
 'states',coalesce((select jsonb_object_agg(row_key,to_jsonb(s)) from customer_focus_state s),'{}'),
 'reviews',coalesce((select jsonb_object_agg(conversation_id::text,to_jsonb(r)) from ai_dashboard_reviews r),'{}'),
 'checked_at',now(),'clickup',jsonb_build_object('latest_event_at',(select max(received_at) from clickup_webhook_events),
 'latest_projection_at',(select max(projected_at) from ai_clickup_work_snapshots),
 'unlinked',(select count(*) from ai_clickup_work_snapshots where mapping_status in ('unlinked','conflict') and lower(coalesce(clickup_status,'')) not in ('prospect','lain2'))));
$$;
revoke all on function public.icetak_customer_focus_snapshot() from public,anon,authenticated;
grant execute on function public.icetak_customer_focus_snapshot() to service_role;

-- Resolve identities in bulk using the same exact canonical identifiers as AI context.
create function public.icetak_customer_focus_identities(p_identities jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
with supplied as (select x->>'id' id,nullif(x->>'master_id','')::uuid master_id,
 case when left(x->>'phone',1)='0' then '6'||(x->>'phone') else x->>'phone' end phone,
 x->>'shopee_user_id' shopee_user_id from jsonb_array_elements(p_identities) x),
 matches as (
 select s.id,cm.id master_id from supplied s join customer_master cm on cm.status='active' and (cm.id=s.master_id or (nullif(s.phone,'') is not null and cm.primary_phone_normalized=s.phone))
 union select s.id,cm.id from supplied s join marketplace_customers mc on mc.provider='shopee' and mc.provider_user_id=s.shopee_user_id join customer_master cm on cm.id=mc.customer_master_id and cm.status='active'
), counted as (select s.id,count(distinct m.master_id) n, min(m.master_id::text)::uuid master_id from supplied s left join matches m on m.id=s.id group by s.id)
select coalesce(jsonb_object_agg(c.id,jsonb_build_object('identity_status',case when n>1 then 'ambiguous' when n=1 then 'matched' else 'unmatched' end,
 'master_id',case when n=1 then c.master_id end,'name',case when n=1 then coalesce(cm.admin_name_override,cm.display_name) end,
 'phone',case when n=1 then cm.primary_phone_normalized end)),'{}') from counted c left join customer_master cm on cm.id=c.master_id;
$$;
revoke all on function public.icetak_customer_focus_identities(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_customer_focus_identities(jsonb) to service_role;
