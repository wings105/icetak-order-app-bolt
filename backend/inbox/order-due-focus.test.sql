-- Safe native RPC verification. Isolated fixtures and all writes are rolled back.
begin;
do $$declare r jsonb; prior jsonb; d jsonb; n int; a uuid[]; b uuid[];
 day date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
 for d in select * from jsonb_array_elements('[
 {"channel":"whatsapp","raw":"2026-10-21","bucket":"overdue"},
 {"channel":"whatsapp","raw":"2026-10-22","bucket":"today"},
 {"channel":"whatsapp","raw":"2026-10-23","bucket":"tomorrow"},
 {"channel":"whatsapp","raw":"2026-10-24","bucket":"upcoming"},
 {"channel":"shopee","raw":"2026-10-22T15:58:59Z","bucket":"overdue"},
 {"channel":"shopee","raw":"2026-10-22T15:59:00Z","bucket":"today"},
 {"channel":"shopee","raw":"2026-10-22T16:00:00Z","bucket":"tomorrow"},
 {"channel":"shopee","raw":"2026-10-23T16:00:00Z","bucket":"upcoming"},
 {"channel":"shopee","raw":"2026-10-23T23:59:00+08:00","bucket":"tomorrow"},
 {"channel":"shopee","raw":"1970-01-01T00:00:00Z","bucket":"undated"},
 {"channel":"shopee","raw":"2026-02-31T00:00:00Z","bucket":"undated"},
 {"channel":"shopee","raw":"2026-10-23T00:00:00","bucket":"undated"},
 {"channel":"whatsapp","raw":"2026-02-31","bucket":"undated"},
 {"channel":"whatsapp","raw":"2026-99-99","bucket":"undated"},
 {"channel":"whatsapp","raw":"1970-01-01","bucket":"undated"},
 {"channel":"whatsapp","raw":"bad","bucket":"undated"},
 {"channel":"whatsapp","raw":null,"bucket":"undated"}]') loop
 r:=public.icetak_inbox_order_deadline(jsonb_build_object('source_channel',d->>'channel','date_need',d->>'raw','ship_by_at',d->>'raw'),'2026-10-22T15:59:00Z');
 if r->>'bucket'<>d->>'bucket' then raise exception 'Deadline boundary mismatch: % -> %',d,r;end if;
 end loop;
 if public.icetak_inbox_order_deadline('{"source_channel":"whatsapp","date_need":"2026-10-24"}','2026-10-22T16:00:00Z')->>'bucket'<>'tomorrow' then raise exception 'Read-time rollover';end if;
 insert into public.external_order_summaries(source_project,source_channel,order_no,order_status,payment_status,date_need,items,metadata)
 select 'icetak-order-system','whatsapp','QA-INBOX-DUE-'||lpad(i::text,4,'0'),'Ready to Process','cash_counter',day+1,
  '[{"product_type":"edible"}]'::jsonb || case when i=351 then '[{"product_type":"acrylic"}]'::jsonb else '[]'::jsonb end,
  '{"clickup_open_task_count":1,"design_work":{"version":1,"stage":"needs_design"}}'::jsonb from generate_series(1,351)i;
 insert into public.external_order_summaries(source_project,source_channel,order_no,order_status,payment_status,date_need,items,metadata)
 select 'icetak-order-system','whatsapp','QA-INBOX-DUE-'||k,'Ready to Process','cash_counter',
  case k when 'overdue' then day-1 when 'today' then day when 'future' then day+8 when 'done' then day when 'review' then day when 'unknown' then day end,
  '[{"product_type":"edible"}]'::jsonb,jsonb_build_object('clickup_open_task_count',1,'design_work',jsonb_build_object('version',1,'stage',case when k in ('done','review','unknown') then k else 'needs_design' end))
 from unnest(array['overdue','today','future','undated','done','review','unknown'])k;
 insert into public.external_order_summaries(source_project,source_channel,order_no,order_status,payment_status,ship_by_at,items,metadata)
 values('icetak-order-system','shopee','QA-INBOX-DUE-shopee','READY_TO_SHIP','paid',now()+interval '10 seconds','[{"product_type":"acrylic"}]','{"design_work":{"version":1,"stage":"needs_design"}}');
 r:=public.icetak_inbox_order_page(p_due=>'urgent',p_design=>'needs_design',p_category=>'all',p_query=>'QA-INBOX-DUE-');
 if (r->>'total')::int<>354 or jsonb_array_length(r->'orders')<>100 or (r->'due_counts'->>'all')::int<>356 or (r->'due_counts'->>'upcoming')::int<>1 or (r->'due_counts'->>'undated')::int<>1 then raise exception 'Urgent/independent due counts before page: %',r-'orders';end if;
 if (r->'category_counts'->>'acrylic')::int<>2 or (r->'design_counts'->>'done')::int<>1 or (r->'design_counts'->>'review')::int<>1 or (r->'design_counts'->>'unknown')::int<>1 then raise exception 'Category/design conjunction';end if;
 if (r->'counts'->>'to_ship')::int<>354 or r#>>'{orders,0,order_no}'<>'QA-INBOX-DUE-overdue' then raise exception 'Status counts or earliest deadline sorting';end if;
 select array_agg((x->>'id')::uuid) into a from jsonb_array_elements(r->'orders')x;
 r:=public.icetak_inbox_order_page(p_due=>'urgent',p_design=>'needs_design',p_category=>'all',p_query=>'QA-INBOX-DUE-',p_offset=>100);
 select array_agg((x->>'id')::uuid) into b from jsonb_array_elements(r->'orders')x;
 if a && b then raise exception 'Duplicate deadline pages';end if;
 r:=public.icetak_inbox_order_page(p_due=>'urgent',p_design=>'needs_design',p_category=>'all',p_query=>'QA-INBOX-DUE-',p_offset=>300);
 if jsonb_array_length(r->'orders')<>54 or (r->>'has_more')::boolean then raise exception 'Deadline tail beyond 300';end if;
 r:=public.icetak_inbox_order_page(p_due=>'upcoming',p_design=>'needs_design',p_category=>'all',p_query=>'QA-INBOX-DUE-');
 if (r->>'total')::int<>1 or r#>>'{orders,0,work_deadline,source}'<>'date_need' or (r->'category_counts'->>'edible')::int<>1 or (r->'design_counts'->>'all')::int<>1 then raise exception 'Future preorder isolation';end if;
 r:=public.icetak_inbox_order_page(p_due=>'undated',p_design=>'needs_design',p_category=>'all',p_query=>'QA-INBOX-DUE-');
 if (r->>'total')::int<>1 then raise exception 'Missing deadlines must stay separately retrievable';end if;
 r:=public.icetak_inbox_order_page(p_due=>'urgent',p_design=>'needs_design',p_category=>'acrylic',p_channel=>'shopee',p_query=>'QA-INBOX-DUE-');
 if (r->>'total')::int<>1 or r#>>'{orders,0,work_deadline,source}'<>'ship_by' or (r->'due_counts'->>'all')::int<>1 then raise exception 'Channel/category combination';end if;
 r:=public.icetak_inbox_order_page(p_due=>'all',p_design=>'all',p_category=>'all',p_query=>'QA-INBOX-DUE-');
 prior:=public.icetak_inbox_order_page(p_design=>'all',p_category=>'all',p_query=>'QA-INBOX-DUE-');
 if r->>'total'<>prior->>'total' or r->'counts'<>prior->'counts' then raise exception 'Legacy eight-argument client compatibility';end if;
 begin perform public.icetak_inbox_order_page(p_due=>'bad',p_design=>'all',p_category=>'all');raise exception 'Invalid deadline accepted';exception when invalid_parameter_value then null;end;
 if has_function_privilege('anon','public.icetak_inbox_order_page(text,text,text,text,text,text,text,integer,integer)','execute') then raise exception 'Anonymous RPC access';end if;
end $$;
rollback;
