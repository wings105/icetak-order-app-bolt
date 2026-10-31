create function finance.cancelled_zero_lines(p_lines jsonb) returns jsonb language sql immutable set search_path='' as $$
select coalesce(jsonb_agg(l||jsonb_build_object('amount',0,'goods_value',0,'goods',0,'material',0,'unit_cost',0,'rate',0,'mode','estimated','basis','cancelled_zero_policy')),'[]'::jsonb)
from jsonb_array_elements(coalesce(p_lines,'[]')) l
$$;
create function finance.cancelled_zero_extras() returns jsonb language sql immutable set search_path='' as $$
select jsonb_object_agg(k,jsonb_build_object('amount',0,'mode','estimated','basis','cancelled_zero_policy'))
from unnest(array['packaging','wastage','reprint','labor','shipping','ads','affiliate']) k
$$;
create function finance.cancelled_zero_row(p_row jsonb,p_cancelled boolean default null) returns jsonb language plpgsql immutable set search_path='' as $$
declare r jsonb:=p_row;k text;v jsonb;
begin
if not coalesce(p_cancelled,upper(trim(coalesce(r->>'status','')))='CANCELLED' or coalesce(r->>'zero_policy','')='cancelled_zero_v1',false) then return r;end if;
r:=r||jsonb_build_object('zero_policy','cancelled_zero_v1','included',false,'state','excluded','income_state','cancelled','profit_state','excluded','cost_state','estimated','detail_changed',false,'lifecycle_review',false,'reviewed',false,'reasons','[]'::jsonb,'finance_source','cancelled_policy','settlement_status','cancelled','released_at',null);
foreach k in array array['sales','goods_value','product_subtotal','buyer_paid','customer_paid','shipping_charged','shipping_fee','fee','nett','material','material_total','packing','extras','extra_total','cost_total','profit','contribution','margin','escrow_amount','estimated_escrow_amount','released_amount','commission_fee','service_fee','transaction_fee','other_fees','payout_difference','profit_per_hour','work_minutes','material_override','courier_override'] loop r:=r||jsonb_build_object(k,0);end loop;
if jsonb_typeof(r->'courier')='number' or r->>'channel'='deco' then r:=r||jsonb_build_object('courier',0);end if;
r:=r||jsonb_build_object('extra_costs',finance.cancelled_zero_extras(),'courier_state','cancelled','material_actual',false,'courier_actual',false,'extras_actual',false);
if r ? 'material_lines' then r:=jsonb_set(r,'{material_lines}',finance.cancelled_zero_lines(r->'material_lines'));end if;
if r ? 'lines' then r:=jsonb_set(r,'{lines}',finance.cancelled_zero_lines(r->'lines'));end if;
foreach k in array array['finance_metrics','metrics'] loop
select coalesce(jsonb_object_agg(key,case when jsonb_typeof(value)='number' then '0'::jsonb else value end),'{}') into v from jsonb_each(coalesce(r->k,'{}'));
v:=v||jsonb_build_object('shipping_net',0,'return_shipping',0,'fee_total',0,'refund_total',0,'seller_promotion',0,'platform_ads',0,'affiliate',0,'provider_nett',0,'reconstructed_nett',0,'reconciliation_delta',0,'reconciliation','matched','issues','[]'::jsonb,'reasons','[]'::jsonb,'field_count',0);
r:=r||jsonb_build_object(k,v);
end loop;
foreach k in array array['finance_fields','fields'] loop
if jsonb_typeof(r->k)='object' then
select coalesce(jsonb_object_agg(key,value||jsonb_build_object('amount',0,'value',case when value ? 'amount' or jsonb_typeof(value->'value')='number' then '0'::jsonb else value->'value' end)),'{}') into v from jsonb_each(r->k);
r:=r||jsonb_build_object(k,v);
end if;
end loop;
return r;
end $$;
revoke all on function finance.cancelled_zero_lines(jsonb),finance.cancelled_zero_extras(),finance.cancelled_zero_row(jsonb,boolean) from public,anon,authenticated;
grant execute on function finance.cancelled_zero_lines(jsonb),finance.cancelled_zero_extras(),finance.cancelled_zero_row(jsonb,boolean) to service_role;
