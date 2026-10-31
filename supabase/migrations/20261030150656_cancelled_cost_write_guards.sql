create function finance.guard_cancelled_costs() returns trigger language plpgsql set search_path='' as $$
begin
if tg_table_name='marketplace_order_costs' then
if exists(select 1 from public.marketplace_orders o where o.id=new.order_id and upper(trim(o.current_status))='CANCELLED') then
new.material_lines:=finance.cancelled_zero_lines(new.material_lines);new.extra_costs:=finance.cancelled_zero_extras();new.work_minutes:=0;new.reviewed:=false;new.actor:='cancelled_zero_policy';
end if;
else
if exists(select 1 from public.orders o where o.id=new.order_id and 'CANCELLED'=any(array[upper(trim(o.status)),upper(trim(o.admin_status)),upper(trim(o.fulfillment_stage))])) then
new.material:=0;new.courier:=0;new.extras:=0;new.material_actual:=false;new.courier_actual:=false;new.extras_actual:=false;new.actor:='cancelled_zero_policy';
end if;
end if;
return new;
end $$;
create trigger zz_cancelled_zero_cost_guard before insert or update on finance.marketplace_order_costs for each row execute function finance.guard_cancelled_costs();
create trigger zz_cancelled_zero_cost_guard before insert or update on finance.direct_order_costs for each row execute function finance.guard_cancelled_costs();
revoke all on function finance.guard_cancelled_costs() from public,anon,authenticated;
grant execute on function finance.guard_cancelled_costs() to service_role;
