-- Safe read-only regression against live data. No retained QA records.
begin;
set local role service_role;
do $test$
declare r jsonb;c jsonb;f date;dates date[]:=array['2026-10-03','2026-09-27','2026-09-04','2026-07-04','2026-04-04','2025-10-04',null]::date[];n numeric;cnt int;
begin
 foreach f in array dates loop
  r:=public.finance_sales_channel_report(jsonb_build_object('from',f,'to','2026-10-03','limit',1));
  select sum((x->>'known_sales')::numeric) into n from jsonb_array_elements(r->'channels')x;
  if n<>(r#>>'{summary,known_sales}')::numeric then raise exception 'channel sum does not equal total';end if;
  select sum((x->>'orders')::int) into cnt from jsonb_array_elements(r->'trend')x;
  if cnt<>(r#>>'{summary,orders}')::int then raise exception 'trend order count mismatch';end if;
  if n>0 then
   select sum((x->>'known_sales_share')::numeric) into n from jsonb_array_elements(r->'channels')x;
   if abs(n-100)>0.01 then raise exception 'percentage does not sum to 100';end if;
  end if;
 end loop;
 r:=public.finance_sales_channel_report('{"from":"2000-01-01","to":"2000-01-02"}');
 if (r#>>'{summary,orders}')::int<>0 or (r#>>'{summary,sales}')::numeric<>0 then raise exception 'empty period is not zero';end if;
 r:=public.finance_sales_channel_report('{"from":"2026-09-01","to":"2026-09-30","channel":"deco","kind":"pending","limit":5000}');
 if exists(select 1 from jsonb_array_elements(r->'rows')x where x->>'channel'<>'deco' or not (x->>'included')::boolean or (x->>'pending')::numeric<=0) then raise exception 'pending/channel filter mismatch';end if;
 if exists(select 1 from finance.sales_channel_orders('2026-09-01','2026-09-30') x join public.marketplace_orders m on m.internal_order_id=x.order_id or m.order_sn=x.reference where x.channel='deco') then raise exception 'marketplace mirror double-counted';end if;
 if exists(select 1 from finance.sales_channel_orders('2026-09-01','2026-09-30') where included and status ilike '%cancel%') then raise exception 'cancelled order entered sales';end if;
 if exists(select 1 from finance.sales_channel_orders('2026-09-01','2026-09-30') where channel='deco' and profit is not null) then raise exception 'unrecorded direct costs produce false profit';end if;
 r:=public.finance_sales_channel_report('{"from":"2026-09-01","to":"2026-09-30"}');
 if (r#>>'{summary,missing_sales}')::int>0 and r#>>'{summary,sales}' is not null then raise exception 'missing sales treated as zero';end if;
 if exists(select 1 from jsonb_array_elements(r->'channels')x where (x->>'missing_profit')::int>0 and x->>'profit' is not null) then raise exception 'partial profit presented as full profit';end if;
end $test$;
reset role;
do $security$
begin
 if has_function_privilege('anon','public.finance_sales_channel_report(jsonb)','execute') or has_function_privilege('authenticated','public.finance_sales_channel_report(jsonb)','execute') then raise exception 'direct client access enabled';end if;
end $security$;
select 'PASS: seven periods, totals, percentages, trend counts, filters, empty state, cancellations, duplicate exclusion, missing money/costs, private grants' result;
rollback;
