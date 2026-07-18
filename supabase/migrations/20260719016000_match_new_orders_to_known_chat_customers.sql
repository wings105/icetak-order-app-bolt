
create or replace function public.match_marketplace_order_to_known_customer_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_customer public.marketplace_customers%rowtype;
begin
  if not coalesce(new.detail_complete,false) or nullif(btrim(new.buyer_username),'') is null then
    return new;
  end if;

  select c.* into v_customer
  from public.marketplace_customers c
  where c.provider=new.provider
    and c.region=upper(coalesce(new.region,'MY'))
    and c.username_normalized=lower(btrim(new.buyer_username))
  order by c.last_seen_at desc,c.updated_at desc
  limit 1;

  if found then
    perform public.sync_marketplace_customer_identity(
      v_customer.username,
      v_customer.provider_user_id,
      v_customer.provider_shop_id,
      v_customer.region,
      new.detail_source_event_id,
      coalesce(new.detail_received_at,new.updated_at,now())
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists match_marketplace_order_to_known_customer_after_detail
  on public.marketplace_orders;
create trigger match_marketplace_order_to_known_customer_after_detail
after insert or update of buyer_username,region,detail_complete
on public.marketplace_orders
for each row
when (new.detail_complete=true and new.buyer_username is not null)
execute function public.match_marketplace_order_to_known_customer_trigger();

revoke all on function public.match_marketplace_order_to_known_customer_trigger()
  from public,anon,authenticated;
