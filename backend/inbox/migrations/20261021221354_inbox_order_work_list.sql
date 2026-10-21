-- Apply to Unified Inbox. These functions only derive work eligibility and read pages.
create or replace function public.icetak_inbox_order_active(p jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(
  p->>'source_project'='icetak-order-system'
  and lower(coalesce(p->'metadata'->>'dashboard_excluded','false')) not in ('true','1')
  and nullif(p->>'shipped_at','') is null
  and case lower(coalesce(p->>'source_channel',''))
   when 'shopee' then upper(coalesce(p->>'order_status','')) in ('READY_TO_SHIP','PROCESSED')
    and lower(coalesce(p->>'payment_status',''))='paid'
    and upper(coalesce(p->>'fulfillment_status','')||' '||coalesce(p->>'shipment_status','')) !~ 'PICKUP_DONE|DELIVERY_DONE|IN_TRANSIT|OUT_FOR_DELIVERY|DELIVERED|SHIPPED'
   when 'whatsapp' then lower(coalesce(p->>'payment_status','')) in ('paid','partial','cash_counter')
    and lower(coalesce(p->>'order_status','')) not in ('complete','completed','cancelled','canceled','refunded','shipped','delivered','customer collected')
    and case when p->'metadata' ? 'clickup_open_task_count'
     then coalesce(p->'metadata'->>'clickup_open_task_count','0') ~ '^[1-9][0-9]*$'
     else nullif(btrim(p->'metadata'->>'clickup_status'),'') is not null
       and lower(btrim(p->'metadata'->>'clickup_status')) not in ('complete','completed','closed','cancelled','canceled','archived') end
   else false end,false)
$$;
revoke all on function public.icetak_inbox_order_active(jsonb) from public,anon;
grant execute on function public.icetak_inbox_order_active(jsonb) to authenticated,service_role;

create or replace function public.icetak_inbox_order_bucket(p jsonb)
returns text language sql immutable security invoker set search_path='' as $$
 select case
  when upper(coalesce(p->>'order_status','')||' '||coalesce(p->>'payment_status','')) ~ 'RETURN|REFUND' then 'return'
  when upper(coalesce(p->>'order_status','')) in ('IN_CANCEL','CANCELLED','CANCELED','INVALID') then 'cancelled'
  when lower(coalesce(p->>'order_status','')) in ('complete','completed','customer collected')
    or upper(coalesce(p->>'order_status',''))='TO_CONFIRM_RECEIVE'
    or upper(coalesce(p->>'fulfillment_status','')||' '||coalesce(p->>'shipment_status','')) ~ 'DELIVERY_DONE|DELIVERED' then 'completed'
  when nullif(p->>'shipped_at','') is not null
    or upper(coalesce(p->>'order_status','')||' '||coalesce(p->>'fulfillment_status','')||' '||coalesce(p->>'shipment_status','')) ~ 'SHIPPED|PICKUP_DONE|IN_TRANSIT|TO_RECEIVE|OUT_FOR_DELIVERY' then 'shipping'
  when public.icetak_inbox_order_active(p) then 'to_ship'
  when lower(coalesce(p->>'source_channel',''))='whatsapp'
    and (coalesce(p->'metadata'->>'clickup_open_task_count','')='0' or lower(coalesce(p->'metadata'->>'clickup_status','')) in ('complete','completed','closed')) then 'completed'
  when lower(coalesce(p->>'payment_status','')) in ('unpaid','pending','cash_counter') then 'unpaid'
  else 'other' end
$$;
revoke all on function public.icetak_inbox_order_bucket(jsonb) from public,anon;
grant execute on function public.icetak_inbox_order_bucket(jsonb) to authenticated,service_role;

create or replace function public.icetak_inbox_order_priority(p jsonb,p_now timestamptz default now())
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_day date:=(p_now at time zone 'Asia/Kuala_Lumpur')::date; v_due date; v_ship timestamptz;
begin
 if not public.icetak_inbox_order_active(p) then return jsonb_build_object('priority_level','P9','priority_reason','Bukan kerja aktif');end if;
 if lower(p->>'source_channel')='shopee' then
  v_ship:=nullif(p->>'ship_by_at','')::timestamptz;
  if extract(year from v_ship)<2020 then v_ship:=null;end if;
  if v_ship<p_now then return jsonb_build_object('priority_level','P0','priority_reason','Ship-by overdue');end if;
  if v_ship<=p_now+interval '24 hours' then return jsonb_build_object('priority_level','P1','priority_reason','Ship-by within 24 hours');end if;
  if v_ship<=p_now+interval '48 hours' then return jsonb_build_object('priority_level','P2','priority_reason','Ship-by within 48 hours');end if;
 else
  v_due:=nullif(p->>'date_need','')::date;
  if v_due<v_day then return jsonb_build_object('priority_level','P0','priority_reason','Overdue');end if;
  if v_due=v_day then return jsonb_build_object('priority_level','P1','priority_reason','Due today');end if;
  if v_due=v_day+1 then return jsonb_build_object('priority_level','P2','priority_reason','Due tomorrow');end if;
 end if;
 return jsonb_build_object('priority_level','P4','priority_reason','Task/order belum selesai');
end $$;
revoke all on function public.icetak_inbox_order_priority(jsonb,timestamptz) from public,anon;
grant execute on function public.icetak_inbox_order_priority(jsonb,timestamptz) to authenticated,service_role;

create or replace function public.icetak_inbox_order_page(
 p_mode text default 'active',p_channel text default 'all',p_bucket text default 'all',
 p_query text default '',p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb; v_limit int:=greatest(1,least(coalesce(p_limit,100),100)); v_offset int:=greatest(0,coalesce(p_offset,0));
begin
 if p_mode not in ('active','urgent','all','no_phone') or p_channel not in ('all','shopee','whatsapp')
   or p_bucket not in ('all','to_ship','unpaid','shipping','completed','cancelled','return','other') then
  raise exception 'Invalid order filter' using errcode='22023';end if;
 with source as materialized (
  select e.id,e.ship_by_at,e.order_no,e.last_synced_at,e.customer_phone_normalized,
   jsonb_build_object('source_project',e.source_project,'source_channel',e.source_channel,'order_status',e.order_status,
    'payment_status',e.payment_status,'shipped_at',e.shipped_at,'shipment_status',e.shipment_status,
    'fulfillment_status',e.fulfillment_status,'ship_by_at',e.ship_by_at,'date_need',e.date_need,'metadata',e.metadata) as policy
  from public.external_order_summaries e
  where e.source_project='icetak-order-system' and e.source_channel in ('shopee','whatsapp')
   and lower(coalesce(e.metadata->>'dashboard_excluded','false')) not in ('true','1')
   and (p_channel='all' or e.source_channel=p_channel)
   and (nullif(btrim(p_query),'') is null or position(lower(btrim(p_query)) in lower(concat_ws(' ',e.order_no,e.customer_name,e.customer_phone,e.customer_phone_normalized,e.shopee_username,e.buyer_message,e.items::text)))>0)
 ), work as materialized (
  select s.*,public.icetak_inbox_order_active(policy) as active,
   public.icetak_inbox_order_bucket(policy) as bucket,public.icetak_inbox_order_priority(policy) as priority from source s
 ), eligible as materialized (
  select * from work where (p_mode='all' or active)
   and (p_mode<>'urgent' or priority->>'priority_level' in ('P0','P1','P2'))
   and (p_mode<>'no_phone' or nullif(customer_phone_normalized,'') is null)
   and (p_bucket='all' or bucket=p_bucket)
 ), page as (
  select * from eligible order by priority->>'priority_level',ship_by_at asc nulls last,last_synced_at desc,order_no,id limit v_limit offset v_offset
 )
 select jsonb_build_object(
  'orders',coalesce((select jsonb_agg(to_jsonb(e)||p.priority||jsonb_build_object('active_order',p.active,'work_bucket',p.bucket)
    order by p.priority->>'priority_level',p.ship_by_at asc nulls last,p.last_synced_at desc,p.order_no,p.id)
    from page p join public.external_order_summaries e on e.id=p.id),'[]'::jsonb),
  'total',(select count(*) from eligible),'offset',v_offset,
  'has_more',(select count(*) from eligible)>v_offset+v_limit,
  'active_count',(select count(*) from work where active),
  'urgent_count',(select count(*) from work where active and priority->>'priority_level' in ('P0','P1','P2')),
  'counts',(select jsonb_build_object('all',count(*) filter(where active),'to_ship',count(*) filter(where bucket='to_ship'),
    'unpaid',count(*) filter(where bucket='unpaid'),'shipping',count(*) filter(where bucket='shipping'),
    'completed',count(*) filter(where bucket='completed'),'cancelled',count(*) filter(where bucket='cancelled'),'return',count(*) filter(where bucket='return')) from work)
 ) into v_result;
 return v_result;
end $$;
revoke all on function public.icetak_inbox_order_page(text,text,text,text,integer,integer) from public,anon;
grant execute on function public.icetak_inbox_order_page(text,text,text,text,integer,integer) to authenticated,service_role;

create or replace function public.icetak_normalize_inbox_order_work()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_priority jsonb;
begin
 if new.source_project='icetak-order-system' then
  new.active_order:=public.icetak_inbox_order_active(to_jsonb(new));
  v_priority:=public.icetak_inbox_order_priority(to_jsonb(new));
  new.priority_level:=v_priority->>'priority_level';
  new.priority_reason:=v_priority->>'priority_reason';
 end if;
 return new;
end $$;
revoke all on function public.icetak_normalize_inbox_order_work() from public,anon,authenticated;
create trigger normalize_inbox_order_work before insert or update on public.external_order_summaries
 for each row execute function public.icetak_normalize_inbox_order_work();

-- Repair derived eligibility only, including the four cash-counter orders already in production.
-- No business state, message, reply flag, payment or task is changed.
update public.external_order_summaries e set active_order=public.icetak_inbox_order_active(to_jsonb(e)),
 priority_level=public.icetak_inbox_order_priority(to_jsonb(e))->>'priority_level',
 priority_reason=public.icetak_inbox_order_priority(to_jsonb(e))->>'priority_reason'
where e.source_project='icetak-order-system' and (
 e.active_order is distinct from public.icetak_inbox_order_active(to_jsonb(e))
 or (e.active_order and e.priority_level is distinct from public.icetak_inbox_order_priority(to_jsonb(e))->>'priority_level'));
