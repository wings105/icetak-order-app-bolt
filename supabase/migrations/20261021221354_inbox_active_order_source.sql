-- Canonical direct work: paid/partial/cash-counter with a current unfinished ORDER LIST task.
-- Only derived read/sync state changes; orders, payments and provider tasks are untouched.
create or replace view public.active_order_summary with (security_invoker=true) as
WITH task_candidates AS (
 SELECT ct.order_id, ct.clickup_task_id AS task_id, ct.status, ct.clickup_list_id AS list_id,
        coalesce(ct.updated_at,ct.last_synced_at,ct.created_at) AS work_updated_at
 FROM public.clickup_tasks ct WHERE ct.order_id IS NOT NULL
 UNION ALL
 SELECT s.order_id,s.task_id,s.clickup_status,s.list_id,
        coalesce(s.source_updated_at,s.observed_at)
 FROM public.ai_clickup_work_snapshots s WHERE s.order_id IS NOT NULL
), current_tasks AS (
 SELECT DISTINCT ON (task_id) * FROM task_candidates
 ORDER BY task_id,work_updated_at DESC NULLS LAST
), open_work AS (
 SELECT order_id,
        count(*) FILTER (WHERE list_id='18375902' AND nullif(btrim(status),'') IS NOT NULL
          AND lower(btrim(status)) NOT IN ('complete','completed','closed','cancelled','canceled','archived')) AS open_task_count,
        jsonb_agg(task_id ORDER BY task_id) FILTER (WHERE list_id='18375902' AND nullif(btrim(status),'') IS NOT NULL
          AND lower(btrim(status)) NOT IN ('complete','completed','closed','cancelled','canceled','archived')) AS open_task_ids,
        max(work_updated_at) AS work_updated_at
 FROM current_tasks GROUP BY order_id
), latest_shipment AS (
         SELECT DISTINCT ON (s.order_id) s.order_id,
            s.status AS shipment_status,
            s.status_group AS shipment_status_group,
            s.tracking_no,
            s.tracking_link,
            s.shipped_at,
            s.delivered_at
           FROM shipments s
          ORDER BY s.order_id, (COALESCE(s.updated_at, s.created_at)) DESC NULLS LAST
        ), clickup AS (
         SELECT DISTINCT ON (ct.order_id) ct.order_id,
            ct.clickup_task_id,
            ct.url AS clickup_url,
            ct.status AS clickup_status
           FROM clickup_tasks ct
          WHERE ct.order_id IS NOT NULL
          ORDER BY ct.order_id, (COALESCE(ct.updated_at, ct.created_at)) DESC NULLS LAST
        ), base AS (
         SELECT o.id AS order_id,
            o.order_no,
            o.customer_id,
            c.name AS customer_name,
            COALESCE(o.delivery_phone, c.phone) AS customer_phone,
            regexp_replace(COALESCE(o.delivery_phone, c.phone, ''::text), '\D'::text, ''::text, 'g'::text) AS customer_phone_digits,
            COALESCE(o.tab, c.source, 'manual_qr'::text) AS source_channel,
            o.status AS order_status,
            o.payment_status,
            o.admin_status,
            o.delivery_method,
            o.total,
            o.date_need,
            o.created_at,
            o.updated_at,
            o.public_token,
            o.delivery_name,
            o.delivery_city,
            o.delivery_state,
            o.production_approved,
            o.customer_confirmed,
            ls.shipment_status,
            ls.shipment_status_group,
            ls.tracking_no,
            ls.tracking_link,
            ls.shipped_at,
            ls.delivered_at,
            cu.clickup_task_id,
            cu.clickup_url,
            cu.clickup_status,
            ow.open_task_count,
            ow.open_task_ids,
            ow.work_updated_at
           FROM orders o
             LEFT JOIN customers c ON c.id = o.customer_id
             LEFT JOIN latest_shipment ls ON ls.order_id = o.id
             LEFT JOIN clickup cu ON cu.order_id = o.id
             LEFT JOIN open_work ow ON ow.order_id = o.id
        )
 SELECT 'icetak-order-system'::text AS source_project,
    source_channel,
    order_no AS external_order_id,
    order_id AS order_system_order_id,
    customer_id AS order_system_customer_id,
    order_no,
    COALESCE(customer_name, delivery_name) AS customer_name,
    customer_phone,
        CASE
            WHEN customer_phone_digits = ''::text THEN NULL::text
            WHEN "left"(customer_phone_digits, 1) = '0'::text THEN '60'::text || substr(customer_phone_digits, 2)
            WHEN "left"(customer_phone_digits, 2) = '60'::text THEN customer_phone_digits
            WHEN length(customer_phone_digits) >= 9 AND length(customer_phone_digits) <= 10 THEN '60'::text || customer_phone_digits
            ELSE customer_phone_digits
        END AS customer_phone_normalized,
    NULL::text AS shopee_username,
    NULL::text AS shopee_buyer_id,
    payment_status,
    order_status,
    admin_status,
    delivery_method,
    date_need,
    NULL::timestamp with time zone AS ship_by_at,
    shipped_at,
    (payment_status = ANY (ARRAY['paid'::text, 'partial'::text, 'cash_counter'::text])) AND (lower(COALESCE(order_status, ''::text)) <> ALL (ARRAY['shipped'::text, 'delivered'::text, 'completed'::text, 'cancelled'::text, 'refunded'::text, 'customer collected'::text])) AND shipped_at IS NULL AND delivered_at IS NULL AND coalesce(open_task_count,0)>0 AS active_order,
        CASE
            WHEN coalesce(open_task_count,0)=0 THEN 'P9'::text
            WHEN payment_status <> ALL (ARRAY['paid'::text, 'partial'::text, 'cash_counter'::text]) THEN 'P9'::text
            WHEN (lower(COALESCE(order_status, ''::text)) = ANY (ARRAY['shipped'::text, 'delivered'::text, 'completed'::text, 'cancelled'::text, 'refunded'::text, 'customer collected'::text])) OR shipped_at IS NOT NULL OR delivered_at IS NOT NULL THEN 'P9'::text
            WHEN date_need IS NOT NULL AND date_need < (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date THEN 'P0'::text
            WHEN date_need = (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date THEN 'P1'::text
            WHEN date_need = ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + 1) THEN 'P2'::text
            WHEN COALESCE(admin_status, order_status, ''::text) = ANY (ARRAY['New Order'::text, 'confirmed'::text, 'paid_new'::text, 'waiting_design'::text, 'design_pending'::text]) THEN 'P3'::text
            ELSE 'P4'::text
        END AS priority_level,
        CASE
            WHEN coalesce(open_task_count,0)=0 THEN 'Tiada task ClickUp terbuka'::text
            WHEN payment_status <> ALL (ARRAY['paid'::text, 'partial'::text, 'cash_counter'::text]) THEN 'Belum paid'::text
            WHEN (lower(COALESCE(order_status, ''::text)) = ANY (ARRAY['shipped'::text, 'delivered'::text, 'completed'::text, 'cancelled'::text, 'refunded'::text, 'customer collected'::text])) OR shipped_at IS NOT NULL OR delivered_at IS NOT NULL THEN 'Sudah ship/selesai'::text
            WHEN date_need IS NOT NULL AND date_need < (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date THEN 'Overdue'::text
            WHEN date_need = (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date THEN 'Due today'::text
            WHEN date_need = ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + 1) THEN 'Due tomorrow'::text
            WHEN COALESCE(admin_status, order_status, ''::text) = ANY (ARRAY['New Order'::text, 'confirmed'::text, 'paid_new'::text, 'waiting_design'::text, 'design_pending'::text]) THEN 'Paid baru / belum proceed'::text
            ELSE 'Active due later'::text
        END AS priority_reason,
        CASE
            WHEN public_token IS NOT NULL THEN '/order/'::text || public_token
            ELSE NULL::text
        END AS public_order_url,
    clickup_url,
    jsonb_build_object('total', total, 'public_token', public_token, 'delivery_name', delivery_name, 'delivery_city', delivery_city, 'delivery_state', delivery_state, 'shipment_status', shipment_status, 'shipment_status_group', shipment_status_group, 'tracking_no', tracking_no, 'tracking_link', tracking_link, 'production_approved', production_approved, 'customer_confirmed', customer_confirmed, 'clickup_task_id', clickup_task_id, 'clickup_status', clickup_status, 'clickup_open_task_count', coalesce(open_task_count,0), 'clickup_open_task_ids',coalesce(open_task_ids,'[]'::jsonb), 'work_updated_at', greatest(updated_at,work_updated_at)) AS metadata,
    now() AS last_synced_at
   FROM base;
revoke all on public.active_order_summary from public,anon,authenticated;
grant select on public.active_order_summary to service_role;

create or replace function inbox_sync.task_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_old uuid; v_new uuid;
begin
 if TG_OP <> 'INSERT' then v_old:=old.order_id; end if;
 if TG_OP <> 'DELETE' then v_new:=new.order_id; end if;
 if TG_OP='UPDATE' and
    (to_jsonb(old)->>'order_id') is not distinct from (to_jsonb(new)->>'order_id') and
    coalesce(to_jsonb(old)->>'status',to_jsonb(old)->>'clickup_status') is not distinct from coalesce(to_jsonb(new)->>'status',to_jsonb(new)->>'clickup_status') and
    coalesce(to_jsonb(old)->>'clickup_list_id',to_jsonb(old)->>'list_id') is not distinct from coalesce(to_jsonb(new)->>'clickup_list_id',to_jsonb(new)->>'list_id')
 then return new; end if;
 insert into inbox_sync.jobs(source,order_id,requested_at)
 select 'direct',x,clock_timestamp() from (select distinct unnest(array[v_old,v_new]) x) ids where x is not null
 on conflict(source,order_id) do update set requested_at=excluded.requested_at,
 status=case when inbox_sync.jobs.status='in_flight' then 'in_flight' else 'pending' end,
 attempts=case when inbox_sync.jobs.status='in_flight' then inbox_sync.jobs.attempts else 0 end,available_at=now();
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function inbox_sync.task_changed() from public,anon,authenticated;
create trigger clickup_work_inbox_sync after insert or update or delete on public.clickup_tasks
 for each row execute function inbox_sync.task_changed();
create trigger clickup_snapshot_inbox_sync after insert or update or delete on public.ai_clickup_work_snapshots
 for each row execute function inbox_sync.task_changed();

