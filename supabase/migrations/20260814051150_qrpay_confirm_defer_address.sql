do $do$
declare
  fn oid;
  def text;
  old_guard text := $$if lower(coalesce(p_payload->>'delivery','')) <> 'pickup' and nullif(btrim(coalesce(p_payload#>>'{customer,address_line1}','')),'') is null then raise exception 'Delivery address is required for courier'; end if;$$;
  insert_before text := $$v_totals:=public.icetak_qrpay_draft_totals(p_payload);$$;
  replacement text := $$if lower(coalesce(p_payload->>'delivery','')) <> 'pickup' and nullif(btrim(coalesce(p_payload#>>'{customer,address_line1}','')),'') is null then
    p_payload:=coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('admin_remark',concat_ws(E'\n',nullif(p_payload->>'admin_remark',''),'[ADDRESS PENDING - lengkapkan sebelum shipping]'));
  end if;
  v_totals:=public.icetak_qrpay_draft_totals(p_payload);$$;
begin
  select p.oid into fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='icetak_confirm_qrpay_order_draft' limit 1;
  if fn is null then raise exception 'icetak_confirm_qrpay_order_draft not found'; end if;
  def:=pg_get_functiondef(fn);
  if position(old_guard in def)=0 then raise exception 'address guard pattern not found'; end if;
  def:=replace(def,old_guard,'-- courier address may remain pending at draft confirmation');
  if position(insert_before in def)=0 then raise exception 'totals pattern not found'; end if;
  def:=replace(def,insert_before,replacement);
  execute def;
end
$do$;