create function inbox_sync.response_ok(p_content text) returns boolean language plpgsql immutable set search_path='' as $$
begin return coalesce(p_content::jsonb->>'ok'='true',false);exception when others then return false;end $$;
revoke all on function inbox_sync.response_ok(text) from public,anon,authenticated;
create function inbox_sync.customer_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into inbox_sync.jobs(source,order_id,requested_at)
 select 'direct',id,clock_timestamp() from public.orders where customer_id=new.id
 union all select 'marketplace',id,clock_timestamp() from public.marketplace_orders where buyer_customer_id=new.id
 on conflict(source,order_id) do update set requested_at=excluded.requested_at,status=case when inbox_sync.jobs.status='in_flight' then 'in_flight' else 'pending' end,attempts=case when inbox_sync.jobs.status='in_flight' then inbox_sync.jobs.attempts else 0 end,available_at=now();
 return new;
end $$;
revoke all on function inbox_sync.customer_changed() from public,anon,authenticated;
create trigger customer_phone_inbox_sync after update of phone on public.customers for each row when (old.phone is distinct from new.phone) execute function inbox_sync.customer_changed();
create or replace function inbox_sync.enqueue_order() returns trigger language plpgsql security definer set search_path='' as $$
declare v_source text;v_id uuid;
begin
 v_source:=case when TG_TABLE_NAME in ('marketplace_orders','marketplace_order_items','marketplace_shipments') then 'marketplace' else 'direct' end;
 if TG_OP='DELETE' then v_id:=old.order_id;else if TG_TABLE_NAME in ('orders','marketplace_orders') then v_id:=new.id;else v_id:=new.order_id::uuid;end if;end if;
 insert into inbox_sync.jobs(source,order_id) values(v_source,v_id)
 on conflict(source,order_id) do update set requested_at=clock_timestamp(),status=case when inbox_sync.jobs.status='in_flight' then 'in_flight' else 'pending' end,attempts=case when inbox_sync.jobs.status='in_flight' then inbox_sync.jobs.attempts else 0 end,available_at=now();
 if TG_OP='DELETE' then return old;else return new;end if;
end $$;
create trigger item_delete_inbox_sync after delete on public.order_items for each row execute function inbox_sync.enqueue_order();
create trigger marketplace_item_delete_inbox_sync after delete on public.marketplace_order_items for each row execute function inbox_sync.enqueue_order();
create trigger marketplace_shipment_delete_inbox_sync after delete on public.marketplace_shipments for each row execute function inbox_sync.enqueue_order();
create or replace function inbox_sync.run() returns jsonb language plpgsql security invoker set search_path='' as $$
declare r record; v_ids uuid[];v_request bigint;v_token text;v_source text;v_sent int:=0;v_batch int;
begin
 if not pg_try_advisory_xact_lock(hashtext('icetak_inbox_sync')) then return jsonb_build_object('busy',true);end if;
 for r in select distinct j.request_id,h.status_code,h.content,h.error_msg,min(j.dispatched_at) as dispatched_at from inbox_sync.jobs j left join net._http_response h on h.id=j.request_id where j.status='in_flight' group by j.request_id,h.status_code,h.content,h.error_msg loop
  if r.status_code between 200 and 299 and inbox_sync.response_ok(r.content) then
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
