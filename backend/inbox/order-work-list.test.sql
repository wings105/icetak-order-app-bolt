-- Controlled regression; every fixture/projection change is rolled back. No provider sends.
begin;
do $$declare r jsonb; first_page uuid[];second_page uuid[];begin
 insert into public.external_order_summaries(source_project,source_channel,order_no,order_status,payment_status,metadata)
 select 'icetak-order-system','whatsapp','QA-INBOX-WORK-'||lpad(n::text,4,'0'),'Ready to Process','cash_counter','{"clickup_open_task_count":1}'::jsonb from generate_series(1,351) n;
 r:=public.icetak_inbox_order_page(p_query=>'QA-INBOX-WORK-',p_limit=>100);
 if (r->>'total')::int<>351 or jsonb_array_length(r->'orders')<>100 or not (r->>'has_more')::boolean then raise exception '351-row pagination regression';end if;
 select array_agg((x->>'id')::uuid) into first_page from jsonb_array_elements(r->'orders') x;
 r:=public.icetak_inbox_order_page(p_query=>'QA-INBOX-WORK-',p_limit=>100,p_offset=>100);
 select array_agg((x->>'id')::uuid) into second_page from jsonb_array_elements(r->'orders') x;
 if first_page && second_page then raise exception 'Duplicate page rows';end if;
 r:=public.icetak_inbox_order_page(p_query=>'QA-INBOX-WORK-',p_limit=>100,p_offset=>300);
 if jsonb_array_length(r->'orders')<>51 or (r->>'has_more')::boolean then raise exception 'Unreachable tail beyond 300';end if;
 update public.external_order_summaries set order_status='Completed',active_order=true where order_no='QA-INBOX-WORK-0001';
 if exists(select 1 from public.external_order_summaries where order_no='QA-INBOX-WORK-0001' and active_order) then raise exception 'Upsert guard failed';end if;
 r:=public.icetak_inbox_order_page(p_query=>'QA-INBOX-WORK-');
 if (r->>'total')::int<>350 then raise exception 'Stale count after completion';end if;
end $$;
rollback;

