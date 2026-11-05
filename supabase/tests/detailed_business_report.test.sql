-- Read-only source calculations inside a rolled-back transaction.
begin;
do $test$
declare s jsonb;t jsonb;b jsonb;d date;
begin
 foreach d in array array['2026-11-04'::date,'2026-11-01'::date,'2026-10-01'::date,'2026-09-30'::date] loop
  s:=public.finance_business_snapshot(d);
  foreach t in array array[s->'daily',s->'mtd'] loop
   b:=t->'breakdown';
   assert abs((b->>'sales')::numeric+(b->>'shipping_collected')::numeric+(b->>'shopee_shipping_net')::numeric+(b->>'shopee_adjustments')::numeric-(b->>'fees')::numeric-(b->>'courier_total')::numeric-(b->>'material')::numeric-(b->>'packing_total')::numeric-(b->>'other_extras')::numeric-(b->>'contribution')::numeric)<=0.01,'Cost bridge must reconcile';
   assert (t->>'orders')::int=(t->>'contribution_orders')::int+(t->>'missing_contribution')::int;
   assert (t->>'cash_out')::numeric=(t->>'released_payout')::numeric+(t->>'pending_cash_out')::numeric;
  end loop;
 end loop;
 t:=finance.business_report_totals('[]');assert t->>'sales'='0' and t->>'contribution'='0';
 assert not has_function_privilege('anon','finance.business_report_row(uuid,text,numeric,numeric,numeric)','EXECUTE');
 assert not has_function_privilege('authenticated','public.finance_business_snapshot(date)','EXECUTE');
end $test$;
rollback;
