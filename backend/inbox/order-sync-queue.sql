-- Apply to icetak-order-system only. This queue is private and never exposes its token.
create schema if not exists inbox_sync;
revoke all on schema inbox_sync from public,anon,authenticated;
create table inbox_sync.jobs (
 source text not null check(source in ('marketplace','direct')),order_id uuid not null,
 requested_at timestamptz not null default now(),status text not null default 'pending',
 attempts integer not null default 0,request_id bigint,dispatched_at timestamptz,
 available_at timestamptz not null default now(),synced_at timestamptz,last_error text,
 primary key(source,order_id),check(status in ('pending','in_flight','synced','failed'))
);
alter table inbox_sync.jobs enable row level security;
revoke all on inbox_sync.jobs from public,anon,authenticated;
create index inbox_sync_pending on inbox_sync.jobs(available_at,requested_at) where status='pending';
create function inbox_sync.enqueue_order() returns trigger language plpgsql security definer set search_path='' as $$
declare v_source text; v_id uuid;
begin
 v_source:=case when TG_TABLE_NAME in ('marketplace_orders','marketplace_order_items','marketplace_shipments') then 'marketplace' else 'direct' end;
 if TG_TABLE_NAME in ('orders','marketplace_orders') then v_id:=new.id;else v_id:=new.order_id::uuid;end if;
 insert into inbox_sync.jobs(source,order_id) values(v_source,v_id)
 on conflict(source,order_id) do update set requested_at=clock_timestamp(),
 status=case when inbox_sync.jobs.status='in_flight' then 'in_flight' else 'pending' end,
 attempts=case when inbox_sync.jobs.status='in_flight' then inbox_sync.jobs.attempts else 0 end,available_at=now();
 return new;
end $$;
revoke all on function inbox_sync.enqueue_order() from public,anon,authenticated;
create trigger order_inbox_sync after insert or update on public.orders for each row execute function inbox_sync.enqueue_order();
create trigger marketplace_inbox_sync after insert or update on public.marketplace_orders for each row execute function inbox_sync.enqueue_order();
create trigger item_inbox_sync after insert or update on public.order_items for each row execute function inbox_sync.enqueue_order();
create trigger marketplace_item_inbox_sync after insert or update on public.marketplace_order_items for each row execute function inbox_sync.enqueue_order();
create trigger marketplace_shipment_inbox_sync after insert or update on public.marketplace_shipments for each row execute function inbox_sync.enqueue_order();
create function inbox_sync.run() returns jsonb language plpgsql security invoker set search_path='' as $$
declare r record; v_ids uuid[];v_request bigint;v_token text;v_source text;v_sent int:=0;v_batch int;
begin
 if not pg_try_advisory_xact_lock(hashtext('icetak_inbox_sync')) then return jsonb_build_object('busy',true);end if;
 for r in select distinct j.request_id,h.status_code,h.content,h.error_msg,min(j.dispatched_at) as dispatched_at from inbox_sync.jobs j left join net._http_response h on h.id=j.request_id where j.status='in_flight' group by j.request_id,h.status_code,h.content,h.error_msg loop
  if r.status_code between 200 and 299 and r.content::jsonb->>'ok'='true' then
   update inbox_sync.jobs set status=case when requested_at>dispatched_at then 'pending' else 'synced' end,synced_at=now(),last_error=null,attempts=case when requested_at>dispatched_at then 0 else attempts end,request_id=null,available_at=now() where request_id=r.request_id;
  elsif r.status_code is not null or r.error_msg is not null or r.dispatched_at < now()-interval '3 minutes' then
   update inbox_sync.jobs set status=case when attempts>=8 then 'failed' else 'pending' end,last_error=coalesce('HTTP '||r.status_code::text||': '||left(r.content,500),r.error_msg,'response_missing'),request_id=null,available_at=now()+make_interval(mins=>least(60,power(2,least(attempts-1,6))::int)) where request_id=r.request_id;
  end if;
 end loop;
 select setting_value into v_token from public.private_runtime_settings where setting_key='admin_window_bridge_token';
 if nullif(v_token,'') is null then return jsonb_build_object('error','sync_token_missing');end if;
 foreach v_source in array array['marketplace','direct'] loop
  for v_batch in 1..2 loop
   select array_agg(order_id) into v_ids from (select order_id from inbox_sync.jobs where source=v_source and status='pending' and available_at<=now() order by requested_at desc limit 100 for update skip locked) x;
   if v_ids is null then exit; end if;
   v_request:=net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/order-inbox-sync-worker',body:=jsonb_build_object('source',v_source,'order_ids',v_ids),headers:=jsonb_build_object('Content-Type','application/json','x-order-sync-token',v_token),timeout_milliseconds:=60000);
   update inbox_sync.jobs set status='in_flight',attempts=attempts+1,request_id=v_request,dispatched_at=clock_timestamp() where source=v_source and order_id=any(v_ids);
   v_sent:=v_sent+cardinality(v_ids);
  end loop;
 end loop;
 return jsonb_build_object('queued_orders',v_sent);
end $$;
revoke all on function inbox_sync.run() from public,anon,authenticated;
insert into inbox_sync.jobs(source,order_id,requested_at) select 'marketplace',id,updated_at from public.marketplace_orders where provider='shopee';
insert into inbox_sync.jobs(source,order_id,requested_at) select 'direct',id,updated_at from public.orders;
select cron.schedule('icetak-order-inbox-sync','* * * * *','select inbox_sync.run()');
