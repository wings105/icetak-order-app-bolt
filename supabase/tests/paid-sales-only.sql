begin;
do $test$
declare paid uuid:=gen_random_uuid();unpaid uuid:=gen_random_uuid();cancelled uuid:=gen_random_uuid();partial uuid:=gen_random_uuid();r jsonb;v numeric;
begin
 insert into public.orders(id,source,order_no,total,delivery_fee,delivery_method,payment_status,payment,status,production_approved,customer_confirmed,whatsapp_opt_in,pickup_payment_whatsapp_enabled,created_at)
 values(paid,'paid-sales-qa','QA-PAID-SALES',28.5,4.5,'courier','paid','Paid','Ready to Process',false,false,false,false,'2000-01-15 04:00:00+00'),(unpaid,'paid-sales-qa','QA-UNPAID-SALES',10,0,'pickup','unpaid','Unpaid','Ready to Process',false,false,false,false,'2000-01-15 04:00:00+00'),(cancelled,'paid-sales-qa','QA-CANCELLED-SALES',10,0,'pickup','paid','Paid','Cancelled',false,false,false,false,'2000-01-15 04:00:00+00'),(partial,'paid-sales-qa','QA-PARTIAL-SALES',10,0,'pickup','paid','Paid','Ready to Process',false,false,false,false,'2000-01-15 04:00:00+00');
 insert into public.payment_transactions(order_id,provider,amount,transaction_id)values(paid,'paid-sales-qa',28.5,'QA-'||paid),(partial,'paid-sales-qa',8,'QA-'||partial),(cancelled,'paid-sales-qa',10,'QA-'||cancelled);
 if not finance.order_is_paid(paid) or finance.order_is_paid(unpaid) or finance.order_is_paid(cancelled) or finance.order_is_paid(partial) then raise exception 'Paid/cancel/partial guard';end if;
 r:=public.icetak_command_center_snapshot('2000-01-15','2000-01-15','icetak');
 if (r#>>'{period,gmv}')::numeric<>28.5 or (r#>>'{period,cancelled}')::int<>1 or (r#>>'{period,unpaid_excluded}')::int<>2 or (r#>>'{trend,0,gmv}')::numeric<>28.5 then raise exception 'GMV/trend mismatch: %',r->'period';end if;
 select sum(sales) into v from finance.sales_channel_orders('2000-01-15','2000-01-15') where included;if v<>24 then raise exception 'Channel sales mismatch';end if;
 r:=public.finance_sales_channel_report('{"from":"2000-01-15","to":"2000-01-15","kind":"cancelled"}');
 if not exists(select 1 from jsonb_array_elements(r->'rows')x where x->>'order_id'=cancelled::text and x->>'included'='false' and x->>'sales' is null) then raise exception 'Cancelled follow-up record lost';end if;
 r:=public.finance_sales_channel_report('{"from":"2000-01-15","to":"2000-01-15","kind":"pending"}');
 if not exists(select 1 from jsonb_array_elements(r->'rows')x where x->>'order_id'=unpaid::text and (x->>'pending')::numeric=10) or not exists(select 1 from jsonb_array_elements(r->'rows')x where x->>'order_id'=partial::text and (x->>'pending')::numeric=2) then raise exception 'Unpaid/partial pending lost';end if;
 update public.payment_transactions set amount=28.5 where order_id=partial;
 if not finance.order_is_paid(partial) then raise exception 'Full payment not recognized';end if;
 insert into public.payment_transactions(order_id,provider,amount,transaction_id)values(partial,'paid-sales-qa',-1,'REFUND-'||partial);
 if finance.order_is_paid(partial) then raise exception 'Refund still counted';end if;
 if has_function_privilege('anon','finance.order_is_paid(uuid)','execute') or has_function_privilege('authenticated','finance.order_is_paid(uuid)','execute') then raise exception 'Helper not private';end if;
end $test$;
select 'PASS: paid only GMV/trend, channel sales, partial/refund, cancelled kept and pending kept, private grants' result;
rollback;
