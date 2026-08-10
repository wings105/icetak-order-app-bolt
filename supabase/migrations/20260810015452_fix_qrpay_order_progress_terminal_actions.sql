do $$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef('public.finance_admin_qrpay_order_progress(uuid)'::regprocedure)
  into definition;

  updated_definition:=replace(
    definition,
    E'    ) is_cancelled\n  from public.orders o',
    E'    ) is_cancelled,\n    (\n      o.pickup_collected_at is not null\n      or o.delivered_at is not null\n      or lower(coalesce(o.fulfillment_stage,\'\')) in (\'collected\',\'delivered\',\'completed\')\n      or lower(coalesce(o.status,\'\')) in (\'completed\',\'delivered\')\n      or lower(coalesce(o.shipment_status_group,s.status_group,\'\'))=\'delivered\'\n    ) is_terminal\n  from public.orders o'
  );
  updated_definition:=replace(
    updated_definition,
    E'case when not is_cancelled\n      and',
    E'case when not is_cancelled and not is_terminal\n      and'
  );
  updated_definition:=replace(
    updated_definition,
    E'and not coalesce(production_approved,false)',
    E'and (components_total=0 or components_complete<components_total)\n      and not coalesce(production_approved,false)'
  );

  if updated_definition=definition then
    raise exception 'finance_admin_qrpay_order_progress definition pattern not found';
  end if;

  execute updated_definition;
end;
$$;

comment on function public.finance_admin_qrpay_order_progress(uuid) is 'Canonical order, production component and courier progress payload for the owner QRPay review; terminal orders expose no lifecycle actions.';
