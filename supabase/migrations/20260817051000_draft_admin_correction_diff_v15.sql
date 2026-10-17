-- Preserve future admin edits as structured correction evidence.
-- This is an audit dataset only: it does not auto-promote or auto-apply rules.

create or replace function public.icetak_jsonb_leaf_diff_v15(
  p_before jsonb,
  p_after jsonb,
  p_path text
)
returns jsonb
language plpgsql
stable
set search_path = 'public', 'pg_temp'
as $$
declare
  result jsonb := '[]'::jsonb;
  key_name text;
  item_index integer;
  max_items integer;
  strategy_key text;
  correction_type text;
begin
  if p_before is not distinct from p_after then
    return result;
  end if;

  if jsonb_typeof(p_before) = 'object' and jsonb_typeof(p_after) = 'object' then
    for key_name in
      select key from (
        select jsonb_object_keys(p_before) as key
        union
        select jsonb_object_keys(p_after) as key
      ) keys
      order by key
    loop
      result := result || public.icetak_jsonb_leaf_diff_v15(
        p_before -> key_name,
        p_after -> key_name,
        p_path || '.' || key_name
      );
    end loop;
    return result;
  end if;

  if jsonb_typeof(p_before) = 'array' and jsonb_typeof(p_after) = 'array' then
    max_items := greatest(jsonb_array_length(p_before), jsonb_array_length(p_after));
    if max_items = 0 then return result; end if;
    for item_index in 0..max_items - 1 loop
      result := result || public.icetak_jsonb_leaf_diff_v15(
        p_before -> item_index,
        p_after -> item_index,
        p_path || '[' || item_index || ']'
      );
    end loop;
    return result;
  end if;

  strategy_key := case
    when p_path ~ '^items\[[0-9]+\]\.(k|kind|product|product_name)$' then 'product_classification'
    when p_path = 'date_need' then 'date_need_extraction'
    when p_path = 'delivery' then 'delivery_classification'
    when p_path like 'customer.%' then 'customer_extraction'
    when p_path ~ '^items\[[0-9]+\]\.(price|qty|quantity|size|style|wording|custom_text)' then 'item_field_extraction'
    else 'manual_correction'
  end;

  correction_type := case
    when p_before is null then 'added'
    when p_after is null then 'removed'
    else 'changed'
  end;

  return jsonb_build_array(jsonb_build_object(
    'field_path', p_path,
    'correction_type', correction_type,
    'ai_value', p_before,
    'human_value', p_after,
    'signature', 'admin_edit:' || p_path || ':' || md5(coalesce(p_after::text, '<removed>')),
    'strategy_key', strategy_key,
    'evidence', jsonb_build_object(
      'source', 'qrpay_order_draft_events',
      'schema_version', 'v15'
    )
  ));
end;
$$;

create or replace function public.icetak_draft_admin_diff_v15(
  p_before jsonb,
  p_after jsonb
)
returns jsonb
language plpgsql
stable
set search_path = 'public', 'pg_temp'
as $$
declare
  result jsonb := '[]'::jsonb;
  root_path text;
begin
  -- Only compare fields an admin can meaningfully correct. Derived totals,
  -- transaction IDs, timestamps and workflow state are deliberately excluded.
  foreach root_path in array array['customer', 'items', 'date_need', 'delivery'] loop
    result := result || public.icetak_jsonb_leaf_diff_v15(
      p_before -> root_path,
      p_after -> root_path,
      root_path
    );
  end loop;
  return result;
end;
$$;

create or replace function public.icetak_fill_draft_event_diff_v15()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $$
declare
  generated_diff jsonb;
begin
  if new.event_type in ('admin_saved', 'admin_approved_for_customer', 'admin_confirmed')
     and (new.diff is null or new.diff in ('[]'::jsonb, '{}'::jsonb))
     and new.before_data is not null
     and new.after_data is not null then
    generated_diff := public.icetak_draft_admin_diff_v15(new.before_data, new.after_data);
    new.diff := generated_diff;
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'diff_generated_by', 'draft-admin-diff-v15',
      'diff_schema_version', 'v15',
      'correction_count', jsonb_array_length(generated_diff)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fill_draft_event_diff_v15 on public.qrpay_order_draft_events;
create trigger trg_fill_draft_event_diff_v15
before insert on public.qrpay_order_draft_events
for each row execute function public.icetak_fill_draft_event_diff_v15();

revoke all on function public.icetak_jsonb_leaf_diff_v15(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.icetak_draft_admin_diff_v15(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.icetak_fill_draft_event_diff_v15() from public, anon, authenticated;
grant execute on function public.icetak_jsonb_leaf_diff_v15(jsonb, jsonb, text) to service_role;
grant execute on function public.icetak_draft_admin_diff_v15(jsonb, jsonb) to service_role;

