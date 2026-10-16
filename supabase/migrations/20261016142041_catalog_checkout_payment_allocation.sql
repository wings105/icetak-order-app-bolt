-- Only the new idempotent customer checkout uses the existing serialized QR allocator at order insert.
-- Other order sources retain their current initial-session behavior.
do $patch$
declare d text:=pg_get_functiondef('public.icetak_create_initial_payment_session()'::regprocedure);
begin
 d:=replace(d,E'begin\n',E'begin\n  if coalesce(current_setting(''icetak.customer_checkout'',true),'''')<>'''' and coalesce(new.total,0)>0 and lower(coalesce(new.payment_status,'''')) in (''pending'',''unpaid'',''waiting_payment'') then\n    perform public.icetak_prepare_payment(new.public_token,false);\n    return new;\n  end if;\n');execute d;
 d:=pg_get_functiondef('public.icetak_create_order(jsonb)'::regprocedure);
 if position('  insert into public.orders(' in d)=0 or position('returning id into v_order_db_id;' in d)=0 then raise exception 'CHECKOUT_INSERT_DRIFT';end if;
 d:=replace(d,'  insert into public.orders(', '  if v_checkout_request is not null then perform set_config(''icetak.customer_checkout'',v_checkout_request::text,true);end if;
  insert into public.orders(');
 d:=replace(d,'returning id into v_order_db_id;','returning id into v_order_db_id;
  perform set_config(''icetak.customer_checkout'','''',true);');execute d;
end $patch$;
