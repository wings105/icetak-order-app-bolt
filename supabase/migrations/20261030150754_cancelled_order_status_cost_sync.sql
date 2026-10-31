create function finance.sync_cancelled_cost_policy_trigger() returns trigger language plpgsql set search_path='' as $$
begin
if tg_table_name='marketplace_orders' then
 if upper(trim(new.current_status))='CANCELLED' or (tg_op='UPDATE' and upper(trim(old.current_status))='CANCELLED') then perform finance.sync_cancelled_cost_policy(new.id,'marketplace');end if;
else
 if coalesce('CANCELLED'=any(array[upper(trim(new.status)),upper(trim(new.admin_status)),upper(trim(new.fulfillment_stage))]),false)
 or (tg_op='UPDATE' and coalesce('CANCELLED'=any(array[upper(trim(old.status)),upper(trim(old.admin_status)),upper(trim(old.fulfillment_stage))]),false))
 then perform finance.sync_cancelled_cost_policy(new.id,'direct');end if;
end if;
return new;
end $$;
create trigger finance_cancelled_zero_policy after insert or update of current_status on public.marketplace_orders for each row execute function finance.sync_cancelled_cost_policy_trigger();
create trigger finance_cancelled_zero_policy after insert or update of status,admin_status,fulfillment_stage on public.orders for each row execute function finance.sync_cancelled_cost_policy_trigger();
revoke all on function finance.sync_cancelled_cost_policy_trigger() from public,anon,authenticated;
grant execute on function finance.sync_cancelled_cost_policy_trigger() to service_role;
