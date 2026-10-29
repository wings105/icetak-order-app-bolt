-- Existing once-per-minute stock worker owns bounded, read-only detail recovery.
create table stock.item_recovery (
 order_id uuid primary key,
 shop_id text not null check(shop_id in ('188218638','1635364464')),
 reference text not null,
 status text not null default 'pending' check(status in ('pending','reading','done','failed')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 response_id bigint,
 last_error text,
 updated_at timestamptz not null default now()
);
alter table stock.item_recovery enable row level security;
revoke all on stock.item_recovery from public,anon,authenticated;
grant select,insert,update on stock.item_recovery to service_role;

create or replace function stock.recovery_tick()
returns jsonb language plpgsql security invoker set search_path='' as $tick$
declare sample record; response record; wanted jsonb; token text; rid bigint; answer jsonb;
 recovered integer:=0; dispatched integer:=0; failures integer:=0;
begin
 if not (select enabled from stock.settings where singleton) then return jsonb_build_object('disabled',true);end if;
 if not pg_try_advisory_xact_lock(hashtextextended('stock:writer',0)) then return jsonb_build_object('busy',true);end if;
 insert into stock.item_recovery(order_id,shop_id,reference)
 select s.order_id,m.shop_id,m.order_sn from stock.order_state s join public.marketplace_orders m on m.id=s.order_id and s.source='shopee'
 where s.stage in ('to_ship','consume') and s.consumed_at is null and s.excluded_at is null
 and not m.detail_complete and m.shop_id in ('188218638','1635364464')
 and not exists(select 1 from public.marketplace_order_items i where i.order_id=m.id)
 on conflict(order_id) do update set status='pending',attempts=0,available_at=now(),last_error=null,updated_at=now()
 where stock.item_recovery.status='done';

 -- A normal source ingestion may finish first. Never replace its item facts.
 update stock.item_recovery q set status='done',last_error=null,updated_at=now()
 where q.status in ('pending','reading') and (
 exists(select 1 from public.marketplace_orders m where m.id=q.order_id and m.detail_complete)
 or exists(select 1 from public.marketplace_order_items i where i.order_id=q.order_id and i.is_current));
 for sample in select response_id,jsonb_agg(reference order by reference) ids,min(available_at) deadline
 from stock.item_recovery where status='reading' group by response_id order by response_id limit 2 loop
  select status_code,timed_out,error_msg,content into response from net._http_response where id=sample.response_id;
  if not found then
   if sample.deadline>now() then continue;end if;
   update stock.item_recovery set status=case when attempts>=5 then 'failed' else 'pending' end,
    available_at=now()+interval '5 minutes',last_error='SOURCE_READ_TIMEOUT',updated_at=now() where response_id=sample.response_id and status='reading';
   failures:=failures+1;continue;
  end if;
  begin
   if response.status_code<>200 or coalesce(response.timed_out,false) then raise exception 'SOURCE_READ_UNAVAILABLE';end if;
   answer:=stock.recover_items(sample.response_id,sample.ids,'stock-source-worker');
   update stock.item_recovery set status='done',last_error=null,updated_at=now() where response_id=sample.response_id and status='reading';
   recovered:=recovered+coalesce((answer->>'imported')::int,0);
  exception when others then
   update stock.item_recovery set status=case when attempts>=5 then 'failed' else 'pending' end,
    available_at=now()+interval '5 minutes',last_error=case when sqlerrm in ('CANONICAL_ORDER_CURRENCY_MISMATCH','CANONICAL_STATUS_RECONCILIATION_REQUIRED','EXISTING_ITEM_DETAIL_PRESERVED') then sqlerrm else 'SOURCE_DETAIL_RECOVERY_FAILED' end,updated_at=now()
   where response_id=sample.response_id and status='reading';
   failures:=failures+1;
  end;
 end loop;

 select setting_value into token from public.private_runtime_settings where setting_key='admin_window_bridge_token' limit 1;
 for sample in select distinct shop_id from stock.item_recovery where status='pending' and available_at<=now() and attempts<5 order by shop_id limit 2 loop
  select jsonb_agg(reference order by reference) into wanted from (
   select reference from stock.item_recovery where shop_id=sample.shop_id and status='pending' and available_at<=now() and attempts<5 order by available_at,reference limit 10) candidates;
  if token is null or length(token)<1 then
   update stock.item_recovery set attempts=attempts+1,status=case when attempts>=4 then 'failed' else 'pending' end,
    available_at=now()+interval '5 minutes',last_error='BRIDGE_NOT_CONFIGURED',updated_at=now()
   where shop_id=sample.shop_id and wanted ? reference;
   failures:=failures+1;continue;
  end if;
  rid:=net.http_post(url:='https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/shopee-order-audit-source',
   headers:=jsonb_build_object('content-type','application/json','x-admin-window-token',token),
   body:=jsonb_build_object('action','order_detail','shop_id',sample.shop_id,'order_sn_list',wanted),timeout_milliseconds:=30000);
  update stock.item_recovery set status='reading',attempts=attempts+1,response_id=rid,available_at=now()+interval '2 minutes',last_error=null,updated_at=now()
  where shop_id=sample.shop_id and status='pending' and wanted ? reference;
  dispatched:=dispatched+jsonb_array_length(wanted);
 end loop;
 return jsonb_build_object('recovered',recovered,'dispatched',dispatched,'failures',failures);
end $tick$;
revoke all on function stock.recovery_tick() from public,anon,authenticated;
grant execute on function stock.recovery_tick() to service_role;

CREATE OR REPLACE FUNCTION public.icetak_stock_process_queue(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare q record; result text; processed integer:=0;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('stock:writer',0)) then return jsonb_build_object('processed',0,'busy',true);end if;
 perform stock.recovery_tick();
 for q in select * from stock.work_queue where status='pending' and available_at<=now() order by available_at,source,order_id limit least(20,greatest(1,p_limit)) for update skip locked loop
  begin
   result:=stock.process_order(q.source,q.order_id);
   update stock.work_queue set status=result,attempts=attempts+1,last_error=null,updated_at=now() where source=q.source and order_id=q.order_id;
  exception when others then
   update stock.work_queue set status=case when attempts>=2 then 'failed' else 'pending' end,attempts=attempts+1,available_at=now()+interval '5 minutes',last_error=left(sqlerrm,300),updated_at=now() where source=q.source and order_id=q.order_id;
  end;
  processed:=processed+1;
 end loop;
 return jsonb_build_object('processed',processed);
end $function$;
