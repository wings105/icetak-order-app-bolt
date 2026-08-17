begin;

do $$
declare
  result jsonb;
begin
  result := public.icetak_draft_admin_diff_v15(
    jsonb_build_object(
      'customer', jsonb_build_object('name', null, 'phone', '60111111111'),
      'items', jsonb_build_array(jsonb_build_object('k', 'acrylic', 'price', 35, 'size', '6 inch')),
      'date_need', null,
      'delivery', 'unknown',
      'draft_total', 35,
      'transaction_id', 'system-before'
    ),
    jsonb_build_object(
      'customer', jsonb_build_object('name', 'Admin Corrected', 'phone', '60111111111'),
      'items', jsonb_build_array(jsonb_build_object('k', 'edible', 'price', 12, 'size', '6 inch')),
      'date_need', '2026-08-20',
      'delivery', 'spx',
      'draft_total', 16.50,
      'transaction_id', 'system-after'
    )
  );

  if jsonb_array_length(result) <> 5 then
    raise exception 'Expected five meaningful admin corrections, got %: %', jsonb_array_length(result), result;
  end if;

  if not result @> '[{"field_path":"items[0].k","strategy_key":"product_classification"}]'::jsonb then
    raise exception 'Missing product correction: %', result;
  end if;

  if not result @> '[{"field_path":"date_need","strategy_key":"date_need_extraction"}]'::jsonb then
    raise exception 'Missing Date Need correction: %', result;
  end if;

  if result @> '[{"field_path":"draft_total"}]'::jsonb
     or result @> '[{"field_path":"transaction_id"}]'::jsonb then
    raise exception 'System-derived fields leaked into learning evidence: %', result;
  end if;
end $$;

rollback;

