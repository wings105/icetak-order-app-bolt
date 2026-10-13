-- Execute within BEGIN/ROLLBACK; no provider request or fixture survives.
set local role service_role;
do $$declare e uuid;o uuid;c jsonb;i int;expected timestamptz;begin
 for i in 1..3 loop
  select event_id into e from public.capture_marketplace_webhook(p_provider=>'shopee',p_event_key=>'qa-cursor-'||i,p_event_code=>3,p_shop_id=>(9988776600+i)::text,p_order_sn=>'QACURSOR00000'||i,p_occurred_at=>now(),p_parsed_payload=>jsonb_build_object('code',3,'data',jsonb_build_object('ordersn','QACURSOR00000'||i,'status','READY_TO_SHIP')));
  select id into o from public.marketplace_orders where order_sn='QACURSOR00000'||i;
  update public.marketplace_orders set created_at=now()-make_interval(days=>case when i=3 then 100 else 30 end),placed_at=case when i=2 then now()-interval '40 days' else null end where id=o;
  c:=public.marketplace_finance_runtime('cursor',jsonb_build_object('shop_id',(9988776600+i)::text));
  expected:=now()-make_interval(days=>case i when 1 then 30 when 2 then 40 else 90 end);
  if abs(extract(epoch from ((c->>'from_at')::timestamptz-expected)))>1 then raise exception 'cursor_lost_order_history_case_%',i;end if;
  if abs(extract(epoch from ((c->>'to_at')::timestamptz-(c->>'from_at')::timestamptz)))<>604800 then raise exception 'cursor_window_unbounded';end if;
 end loop;
 if has_function_privilege('anon','public.marketplace_finance_runtime(text,jsonb)','execute') or has_function_privilege('authenticated','public.marketplace_finance_runtime(text,jsonb)','execute') then raise exception 'cursor_rpc_exposed';end if;
end $$;
reset role;
select 'CURSOR_HISTORY_ROLLBACK_PASS' result;
