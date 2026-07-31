create or replace function public.icetak_recalculate_catalog_order_total()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_order_id uuid; v_source text;
begin
  v_order_id:=case when tg_op='DELETE' then old.order_id else new.order_id end;
  select source into v_source from public.orders where id=v_order_id;
  if v_source='catalog_customer' then
    update public.orders set total=coalesce((select sum(coalesce(price,0)*greatest(coalesce(qty,1),1)) from public.order_items where order_id=v_order_id),0),updated_at=now() where id=v_order_id;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function public.icetak_catalog_notification_total()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_total numeric;
begin
  if new.source='catalog_customer' then
    select total into v_total from public.orders where order_id=new.order_id or order_no=new.order_id order by created_at desc limit 1;
    if v_total is not null then new.total:=v_total; end if;
  end if;
  return new;
end $$;

drop trigger if exists notification_outbox_catalog_total on public.notification_outbox;
create trigger notification_outbox_catalog_total before insert or update of total on public.notification_outbox
for each row execute function public.icetak_catalog_notification_total();
