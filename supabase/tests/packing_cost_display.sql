
begin;
do $$
declare b jsonb; s jsonb; mismatch integer;
begin
 if finance.packing_estimate('[{"category":"topper","quantity":10,"goods_value":100}]')<>0.21 then raise exception 'Topper quantity duplicated packing';end if;
 if finance.packing_estimate('[{"category":"edible","quantity":5,"goods_value":60}]')<>0.21 then raise exception 'Small edible quantity changed tier';end if;
 if finance.packing_estimate('[{"category":"edible","quantity":3,"goods_value":72}]')<>0.34 then raise exception 'Large edible tier failed';end if;
 if finance.packing_estimate('[{"category":"topper","quantity":10,"goods_value":100},{"category":"acrylic","quantity":3,"goods_value":60}]')<>0.74 then raise exception 'Mixed order must use maximum once';end if;
 b:=finance.margin_breakdown('[{"channel":"shopee","sales":10,"fee":3.02,"nett":6.98,"material":1.27,"packing":0.21,"extras":0.21,"contribution":5.50},{"channel":"deco","sales":12,"customer_paid":16.5,"fee":0,"courier":4.5,"nett":12,"material":5.1,"packing":0.21,"extras":0,"contribution":6.69}]');
 if (b->>'packing')::numeric<>0.42 or (b->>'extras')::numeric<>0 or (b->>'contribution')::numeric<>12.19 then raise exception 'Packing breakdown double counts or drops direct packing';end if;
 if (b->>'nett')::numeric-(b->>'material')::numeric-(b->>'packing')::numeric-(b->>'extras')::numeric<>(b->>'contribution')::numeric then raise exception 'Breakdown arithmetic mismatch';end if;
 s:=public.finance_business_snapshot((now() at time zone 'Asia/Kuala_Lumpur')::date-1);
 if (s#>>'{mtd,packing_total}')::numeric<>(s#>>'{mtd,packing_shopee}')::numeric+(s#>>'{mtd,packing_direct}')::numeric then raise exception 'Snapshot packing channels mismatch';end if;
 if (select sum((o->>'packing')::numeric) from jsonb_array_elements(s->'orders')o)<>(s#>>'{mtd,packing_total}')::numeric then raise exception 'Snapshot rows mismatch';end if;
 if has_table_privilege('anon','finance.packing_cost_settings','select') or has_function_privilege('authenticated','finance.packing_estimate(jsonb)','execute') then raise exception 'Private packing configuration exposed';end if;
end $$;
rollback;
