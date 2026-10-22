-- Category membership, counts and paging are tested in a rollback-only transaction.
begin;
do $$declare r jsonb; old_result jsonb; rec record; first_page uuid[]; second_page uuid[];begin
 for rec in select * from (values
  ('{"product_type":"edible","title":"Custom Topper"}'::jsonb,array['edible']),
  ('{"product_type":"printed"}',array['topper']),
  ('{"product_type":"mirror"}',array['artpaper_gold']),
  ('{"product_type":"burnaway"}',array['edible','wafer']),
  ('{"title":"Acrylic Cake Topper Gold"}',array['acrylic']),
  ('{"title":"Mirror Gold Artpaper Cake Topper"}',array['artpaper_gold']),
  ('{"title":"Printing Wafer Paper for Burn Away Cake NOT Icing Paper"}',array['wafer']),
  ('{"title":"Edible Image Cake Topper Icing Sheet"}',array['edible']),
  ('{"item_sku":"Ei-no-review"}',array['edible']),
  ('{"title":"Custom Name Birthday Cake Topper"}',array['topper']),
  ('{"title":"Birthday Banner"}',array[]::text[]),
  ('{}',array[]::text[])
 ) t(item,expected) loop
  if public.icetak_inbox_item_categories(rec.item)<>rec.expected then raise exception 'Incorrect category: %',rec.item;end if;
 end loop;
 if public.icetak_inbox_order_categories('[{"product_type":"edible"},{"product_type":"acrylic"},{"product_type":"edible"}]')<>array['acrylic','edible'] then raise exception 'Mixed order membership';end if;
 if public.icetak_inbox_order_categories('null')<>array[]::text[] then raise exception 'Invalid items guard';end if;

 insert into public.external_order_summaries(source_project,source_channel,order_no,order_status,payment_status,items,metadata)
 select 'icetak-order-system','whatsapp','QA-INBOX-CATEGORY-'||lpad(n::text,4,'0'),'Ready to Process','cash_counter',
  '[{"product_type":"edible"}]'::jsonb || case when n%2=0 then '[{"product_type":"acrylic"},{"product_type":"acrylic"}]'::jsonb else '[]'::jsonb end,
  '{"clickup_open_task_count":1}'::jsonb from generate_series(1,351) n;
 r:=public.icetak_inbox_order_page(p_category=>'edible',p_query=>'QA-INBOX-CATEGORY-');
 if (r->>'total')::int<>351 or jsonb_array_length(r->'orders')<>100 or (r->'category_counts'->>'acrylic')::int<>175 then raise exception 'Category count before limit or duplicate-item counting';end if;
 select array_agg((x->>'id')::uuid) into first_page from jsonb_array_elements(r->'orders') x;
 r:=public.icetak_inbox_order_page(p_category=>'edible',p_query=>'QA-INBOX-CATEGORY-',p_offset=>100);
 select array_agg((x->>'id')::uuid) into second_page from jsonb_array_elements(r->'orders') x;
 if first_page && second_page then raise exception 'Duplicate category pages';end if;
 r:=public.icetak_inbox_order_page(p_category=>'edible',p_query=>'QA-INBOX-CATEGORY-',p_offset=>300);
 if jsonb_array_length(r->'orders')<>51 or (r->>'has_more')::boolean then raise exception 'Category tail beyond 300';end if;
 r:=public.icetak_inbox_order_page(p_category=>'acrylic',p_query=>'QA-INBOX-CATEGORY-');
 if (r->>'total')::int<>175 or (r->'counts'->>'to_ship')::int<>175 or (r->'category_counts'->>'edible')::int<>351 then raise exception 'Mixed order counts';end if;
 r:=public.icetak_inbox_order_page(p_category=>'acrylic',p_channel=>'shopee',p_query=>'QA-INBOX-CATEGORY-');
 if (r->>'total')::int<>0 then raise exception 'Channel isolation';end if;
 r:=public.icetak_inbox_order_page(p_category=>'artpaper_gold',p_query=>'QA-INBOX-CATEGORY-');
 if (r->>'total')::int<>0 then raise exception 'Empty category';end if;
 r:=public.icetak_inbox_order_page(p_category=>'all',p_query=>'QA-INBOX-CATEGORY-');
 old_result:=public.icetak_inbox_order_page(p_query=>'QA-INBOX-CATEGORY-');
 if r->>'total'<>old_result->>'total' or r->'counts'<>old_result->'counts' then raise exception 'Legacy RPC compatibility';end if;
 begin
  perform public.icetak_inbox_order_page(p_category=>'invalid');
  raise exception 'Invalid category accepted';
 exception when invalid_parameter_value then null;end;
 if has_function_privilege('anon','public.icetak_inbox_order_page(text,text,text,text,text,integer,integer)','EXECUTE') then raise exception 'Anonymous execution permitted';end if;
end $$;
rollback;
