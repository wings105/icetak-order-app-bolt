create table shipping_ops.pod_recovery_checks (
 shipment_id uuid primary key references public.shipments(id), checked_at timestamptz not null default now()
);
alter table shipping_ops.pod_recovery_checks enable row level security;
grant all on shipping_ops.pod_recovery_checks to service_role;
create function public.icetak_claim_customer_pod_recovery(p_shipment_id uuid) returns boolean
language sql security invoker set search_path='' as $$
 with claimed as (
 insert into shipping_ops.pod_recovery_checks(shipment_id)
 select s.id from public.shipments s where s.id=p_shipment_id and s.provider='parceldaily' and s.normalized_status='delivered'
 and not exists(select 1 from public.shipment_pod_files p where p.shipment_id=s.id and p.archive_status in ('archived_db','archived_storage'))
 on conflict(shipment_id) do update set checked_at=now()
 where shipping_ops.pod_recovery_checks.checked_at<now()-interval '1 hour'
 returning 1) select exists(select 1 from claimed);
$$;
revoke all on function public.icetak_claim_customer_pod_recovery(uuid) from public,anon,authenticated;
grant execute on function public.icetak_claim_customer_pod_recovery(uuid) to service_role;
