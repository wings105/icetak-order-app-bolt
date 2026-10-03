-- Missing goods price prevents percentage costing/margin, but not profit with explicitly known costs.
create or replace function finance.order_profit_row(p_order_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare o public.marketplace_orders%rowtype; f public.marketplace_order_financials%rowtype; c finance.marketplace_order_costs%rowtype;
  est jsonb; lines jsonb; extras jsonb; basis jsonb; item jsonb; material numeric:=0; extra numeric:=0; goods numeric:=0;
  income numeric; profit numeric; income_state text:='missing'; cost_state text:='estimated'; missing boolean:=false; all_actual boolean:=true;
  changed boolean:=false; lifecycle boolean:=false; goods_missing boolean:=false; categories jsonb; skus jsonb; rate_version bigint;
begin
  select * into o from public.marketplace_orders where id=p_order_id;
  if not found then raise exception 'Order tidak dijumpai'; end if;
  select * into f from public.marketplace_order_financials where order_id=p_order_id;
  select * into c from finance.marketplace_order_costs where order_id=p_order_id;
  basis:=finance.order_material_basis(p_order_id);
  if c.order_id is not null then lines:=c.material_lines; extras:=c.extra_costs; rate_version:=c.settings_version; changed:=c.source_signature<>basis->>'signature';
  else est:=finance.order_material_estimate(p_order_id); lines:=est->'lines'; extras:=finance.empty_order_extras(); rate_version:=(est->>'settings_version')::bigint; end if;
  if changed then lines:=finance.order_material_estimate(p_order_id,c.settings_version)->'lines'; end if;
  missing:=jsonb_array_length(lines)=0;
  for item in select value from jsonb_array_elements(lines) loop
    if item->>'amount' is null then missing:=true; else material:=material+(item->>'amount')::numeric; end if;
    if item->>'goods_value' is null then goods_missing:=true; else goods:=goods+(item->>'goods_value')::numeric; end if;
    all_actual:=all_actual and item->>'mode'='actual';
  end loop;
  for item in select value from jsonb_each(extras) loop extra:=extra+(item->>'amount')::numeric; all_actual:=all_actual and item->>'mode'='actual'; end loop;
  if changed then cost_state:='detail_changed'; elsif missing then cost_state:='missing';
  elsif coalesce(c.reviewed,false) and all_actual then cost_state:='actual'; end if;
  -- Shopee completion alone never means money was released. Explicit release evidence is required.
  if f.released_amount is not null and (f.settlement_status='released' or f.released_at is not null) then income:=f.released_amount; income_state:='released';
  elsif f.escrow_amount is not null then income:=f.escrow_amount; income_state:='escrow'; end if;
  if coalesce(nullif(f.currency,''),o.currency,'MYR')<>coalesce(nullif(o.currency,''),'MYR') then income:=null; income_state:='currency_mismatch'; end if;
  lifecycle:=upper(o.current_status) ~ '(CANCEL|RETURN|REFUND)' or upper(o.payment_status) ~ '(REFUND|VOID)';
  if income is not null and not missing and not changed and not lifecycle then profit:=round(income-material-extra,2); end if;
  select coalesce(jsonb_agg(distinct value->>'category') filter(where value->>'category' is not null),'[]'::jsonb),
    coalesce(jsonb_agg(distinct value->>'sku'),'[]'::jsonb) into categories,skus from jsonb_array_elements(lines);
  return jsonb_build_object('order_id',o.id,'order_sn',o.order_sn,'provider',o.provider,'buyer',o.buyer_username,'status',o.current_status,
    'placed_at',coalesce(o.placed_at,o.created_at),'currency',coalesce(nullif(o.currency,''),'MYR'),'buyer_paid',f.buyer_paid,'goods_value',case when goods_missing then null else goods end,
    'nett',income,'income_state',income_state,'released_at',f.released_at,'enriched_at',f.last_enriched_at,
    'escrow_amount',f.escrow_amount,'released_amount',f.released_amount,'commission_fee',f.commission_fee,'service_fee',f.service_fee,
    'transaction_fee',f.transaction_fee,'other_fees',f.other_fees,'shipping_fee',f.shipping_fee,'settlement_status',f.settlement_status,
    'material_total',case when missing then null else material end,'extra_total',extra,'cost_total',case when missing then null else material+extra end,
    'profit',profit,'margin',case when not goods_missing and goods>0 then round(profit/goods*100,2) end,
    'profit_state',case when lifecycle then 'lifecycle_review' when profit is null then 'incomplete' when cost_state='actual' and income_state='released' then 'actual' else 'estimated' end,
    'cost_state',cost_state,'detail_changed',changed,'categories',categories,'skus',skus,
    'cost_version',coalesce(c.version,0),'settings_version',rate_version,'material_lines',lines,'extra_costs',extras,
    'reviewed',coalesce(c.reviewed,false),'work_minutes',c.work_minutes,'profit_per_hour',case when c.work_minutes>0 then round(profit/c.work_minutes*60,2) end,
    'note',coalesce(c.note,''),'cost_updated_at',c.updated_at);
end $$;

