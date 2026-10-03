alter table public.customer_focus_state drop constraint customer_focus_state_row_key_check;
alter table public.customer_focus_state add constraint customer_focus_state_row_key_check check (row_key ~ '^(icetak|shopee|draft|chat):[0-9a-f-]{36}$');
create function public.icetak_customer_focus_drafts() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
with active as (
 select d.id,'draft'::text kind,coalesce(d.order_no,'Draft') reference,d.customer_name,d.customer_phone phone,d.conversation_id,
 d.status,d.payment_status,d.draft_total amount,d.payment_amount,d.payment_received_at,d.created_at,d.updated_at source_updated_at,d.version,
 d.next_followup_at,d.followup_enabled,
 case when coalesce(d.working_draft->>'date_need','') ~ '^\d{4}-\d{2}-\d{2}$' then d.working_draft->>'date_need' end customer_needed,
 coalesce(d.working_draft->>'delivery_method',d.working_draft->>'delivery') delivery_method,
 case when jsonb_typeof(d.working_draft->'items')='array' then (select jsonb_agg(jsonb_build_object('title',i->>'title','quantity',coalesce(i->'qty',i->'quantity'),'size',i->>'size','wording',i->>'wording')) from jsonb_array_elements(d.working_draft->'items') i) else '[]'::jsonb end items
 from qrpay_order_drafts d where d.order_id is null and d.converted_at is null and lower(d.status) not in ('confirmed','rejected','cancelled','canceled','expired','auto_cancelled','closed')
), bounded as (select * from active order by created_at desc,id limit 1000)
select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(bounded)) from bounded),'[]'),'total',(select count(*) from active),'truncated',(select count(*)>1000 from active));
$$;
revoke all on function public.icetak_customer_focus_drafts() from public,anon,authenticated;
grant execute on function public.icetak_customer_focus_drafts() to service_role;
-- Extend save key validation without changing audit/idempotency behavior.
do $$ declare d text; begin select pg_get_functiondef('public.icetak_customer_focus_save(text,text,integer,uuid,jsonb)'::regprocedure) into d;
 execute replace(d,'(icetak|shopee|chat)','(icetak|shopee|draft|chat)'); end $$;
