create or replace function task_detail_private.signal()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='marketplace_orders' then
  insert into task_detail_private.order_signals(kind,order_id,reference) values('shopee',new.id,new.order_sn)
  on conflict(kind,order_id) do update set signalled_at=now(),reference=excluded.reference;
 elsif tg_table_name='orders' then
  insert into task_detail_private.order_signals(kind,order_id,reference) values('icetak',new.id,new.order_no)
  on conflict(kind,order_id) do update set signalled_at=now(),reference=excluded.reference;
 end if;
 perform task_detail_private.dispatch();return new;
exception when others then return new; -- Derived automation cannot block canonical order ingestion.
end;$$;
