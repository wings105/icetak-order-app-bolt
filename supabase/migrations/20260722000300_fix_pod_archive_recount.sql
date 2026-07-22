create or replace function public.archive_shipment_pod_from_payload()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_payload jsonb;
  v_pod jsonb;
  v_url text;
  v_position integer;
  v_response extensions.http_response;
  v_binary bytea;
  v_event public.shipping_webhook_events%rowtype;
  v_expires_at timestamptz;
  v_success integer := 0;
  v_failed integer := 0;
begin
  if pg_trigger_depth() > 1 then return new; end if;

  v_payload := coalesce(
    new.provider_payload->'last_webhook',
    new.provider_payload->'first_webhook',
    '{}'::jsonb
  );
  v_pod := coalesce(v_payload->'pod', v_payload#>'{data,pod}');
  if jsonb_typeof(v_pod) <> 'array' or jsonb_array_length(v_pod) = 0 then return new; end if;

  select * into v_event
  from public.shipping_webhook_events
  where provider='parceldaily'
    and coalesce(payload->>'consign_no',payload#>>'{data,consign_no}')=new.tracking_no
    and jsonb_typeof(coalesce(payload->'pod',payload#>'{data,pod}'))='array'
  order by received_at desc
  limit 1;

  for v_url,v_position in
    select value, ordinality::int
    from jsonb_array_elements_text(v_pod) with ordinality
  loop
    if exists(
      select 1 from public.shipment_pod_files
      where provider='parceldaily' and source_url=v_url
    ) then
      v_success := v_success + 1;
      continue;
    end if;

    begin
      v_expires_at := case
        when substring(v_url from '[?&]Expires=([0-9]+)') is not null
        then to_timestamp(substring(v_url from '[?&]Expires=([0-9]+)')::bigint)
        else null
      end;

      v_response := extensions.http_get(v_url);
      if v_response.status <> 200 then raise exception 'HTTP %',v_response.status; end if;
      v_binary := textsend(v_response.content);
      if octet_length(v_binary) < 100 then raise exception 'POD response too small'; end if;

      insert into public.shipment_pod_files(
        shipment_id,webhook_event_id,provider,provider_event_id,tracking_no,position,
        source_url,source_expires_at,content_type,size_bytes,sha256,archive_status,
        archived_at,binary_data,updated_at
      ) values (
        new.id,v_event.id,'parceldaily',v_event.provider_event_id,new.tracking_no,v_position,
        v_url,v_expires_at,coalesce(v_response.content_type,'application/octet-stream'),
        octet_length(v_binary),encode(extensions.digest(v_binary,'sha256'),'hex'),'archived_db',
        now(),v_binary,now()
      ) on conflict(provider,source_url) do nothing;
      v_success := v_success + 1;
    exception when others then
      insert into public.shipment_pod_files(
        shipment_id,webhook_event_id,provider,provider_event_id,tracking_no,position,
        source_url,source_expires_at,archive_status,archive_error,updated_at
      ) values (
        new.id,v_event.id,'parceldaily',v_event.provider_event_id,new.tracking_no,v_position,
        v_url,v_expires_at,'failed',sqlerrm,now()
      ) on conflict(provider,source_url) do update
        set archive_status='failed',archive_error=excluded.archive_error,updated_at=now();
      v_failed := v_failed + 1;
    end;
  end loop;

  update public.shipments s
  set pod_count=x.good,
      pod_status=case
        when x.total=0 then 'none'
        when x.failed=0 then 'archived'
        when x.good>0 then 'partial'
        else 'failed'
      end,
      pod_archived_at=case when x.good>0 then now() else s.pod_archived_at end,
      pod_error=case when x.failed>0 then x.failed::text||' POD file(s) failed' else null end
  from (
    select count(*) total,
           count(*) filter(where archive_status in ('archived_db','archived_storage')) good,
           count(*) filter(where archive_status='failed') failed
    from public.shipment_pod_files
    where shipment_id=new.id
  ) x
  where s.id=new.id;

  return new;
end;
$$;
