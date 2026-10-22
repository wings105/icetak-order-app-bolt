-- Read-only design focus and native counts/pages. Fixtures are rolled back.
begin;
do $$declare r jsonb; old_result jsonb; first_page uuid[]; second_page uuid[];begin
 insert into public.external_order_summaries(source_project,source_channel,order_no,order_status,payment_status,items,metadata)
 select 'icetak-order-system','whatsapp','QA-INBOX-DESIGN-'||lpad(n::text,4,'0'),'Ready to Process','cash_counter',
  '[{"product_type":"edible"}]'::jsonb || case when n=351 then '[{"product_type":"acrylic"}]'::jsonb else '[]'::jsonb end,
  '{"clickup_open_task_count":1,"design_work":{"version":1,"stage":"needs_design","tasks":[{"id":"a","status":"design edible image"}]}}'::jsonb
 from generate_series(1,351) n;
 insert into public.external_order_summaries(source_project,source_channel,order_no,order_status,payment_status,items,metadata)
 select 'icetak-order-system','shopee','QA-INBOX-DESIGN-'||stage,'READY_TO_SHIP','paid','[{"product_type":"edible"}]'::jsonb,
  case when stage='unknown' then '{}'::jsonb else jsonb_build_object('design_work',jsonb_build_object('version',1,'stage',stage,'tasks',jsonb_build_array(jsonb_build_object('id','b','status',case stage when 'done' then 'complete' else 'review' end)))) end
 from unnest(array['done','review','unknown']) stage;
 r:=public.icetak_inbox_order_page(p_design=>'needs_design',p_category=>'all',p_query=>'QA-INBOX-DESIGN-');
 if (r->>'total')::int<>351 or jsonb_array_length(r->'orders')<>100 or (r->'design_counts'->>'all')::int<>354 then raise exception 'Focus counts before page limit';end if;
 if (r->'design_counts'->>'done')::int<>1 or (r->'design_counts'->>'review')::int<>1 or (r->'design_counts'->>'unknown')::int<>1 then raise exception 'Independent stage counts';end if;
 if (r->'counts'->>'to_ship')::int<>351 or (r->'category_counts'->>'edible')::int<>351 then raise exception 'Status/category counts must respect design filter';end if;
 select array_agg((x->>'id')::uuid) into first_page from jsonb_array_elements(r->'orders') x;
 r:=public.icetak_inbox_order_page(p_design=>'needs_design',p_category=>'all',p_query=>'QA-INBOX-DESIGN-',p_offset=>100);
 select array_agg((x->>'id')::uuid) into second_page from jsonb_array_elements(r->'orders') x;
 if first_page && second_page then raise exception 'Duplicate focus pages';end if;
 r:=public.icetak_inbox_order_page(p_design=>'needs_design',p_category=>'all',p_query=>'QA-INBOX-DESIGN-',p_offset=>300);
 if jsonb_array_length(r->'orders')<>51 or (r->>'has_more')::boolean then raise exception 'Focus tail beyond 300';end if;
 r:=public.icetak_inbox_order_page(p_design=>'needs_design',p_category=>'acrylic',p_query=>'QA-INBOX-DESIGN-');
 if (r->>'total')::int<>1 then raise exception 'Mixed category conjunction';end if;
 r:=public.icetak_inbox_order_page(p_design=>'needs_design',p_category=>'all',p_channel=>'shopee',p_query=>'QA-INBOX-DESIGN-');
 if (r->>'total')::int<>0 then raise exception 'Printing/complete/review/unknown leaked into designer focus';end if;
 r:=public.icetak_inbox_order_page(p_design=>'done',p_category=>'all',p_query=>'QA-INBOX-DESIGN-');
 if (r->>'total')::int<>1 or not (r->'orders'->0->>'active_order')::boolean then raise exception 'Completed ClickUp task must remain retrievable before shipping';end if;
 r:=public.icetak_inbox_order_page(p_design=>'all',p_category=>'all',p_query=>'QA-INBOX-DESIGN-');
 old_result:=public.icetak_inbox_order_page(p_category=>'all',p_query=>'QA-INBOX-DESIGN-');
 if (r->>'total')::int<>354 or r->>'total'<>old_result->>'total' or r->'counts'<>old_result->'counts' then raise exception 'Old category client compatibility';end if;
 if public.icetak_inbox_order_design_stage('{"metadata":{"design_work":{"version":1,"stage":"future"}}}')<>'unknown' then raise exception 'Unknown stage must not be inferred as design';end if;
 begin
  perform public.icetak_inbox_order_page(p_design=>'invalid',p_category=>'all');
  raise exception 'Invalid focus accepted';
 exception when invalid_parameter_value then null;end;
 if has_function_privilege('anon','public.icetak_inbox_order_page(text,text,text,text,text,text,integer,integer)','EXECUTE') then raise exception 'Anonymous access';end if;
end $$;
rollback;
