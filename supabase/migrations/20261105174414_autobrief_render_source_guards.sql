create or replace function public.icetak_render_auto_record(p_task_id text,p_lease uuid,p_patch jsonb) returns boolean language plpgsql security invoker set search_path=pg_catalog,public,render_auto as $$
declare affected integer; nextstate text:=p_patch->>'state';
begin
 if nextstate is not null and nextstate not in ('retry','review','uncertain','completed','cancelled','skipped') then raise exception 'INVALID_RENDER_STATE';end if;
 update render_auto.jobs set state=coalesce(nextstate,state),
 fields=coalesce(p_patch->'fields',fields),template_version=coalesce((p_patch->>'template_version')::int,template_version),
 filename=coalesce(p_patch->>'filename',filename),attachment_id=coalesce(p_patch->>'attachment_id',attachment_id),attachment_url=coalesce(p_patch->>'attachment_url',attachment_url),
 upload_started_at=case when p_patch->>'upload_started'='true' then coalesce(upload_started_at,now()) else upload_started_at end,
 last_error=left(coalesce(p_patch->>'error',''),200),
 lease_until=case when nextstate is null then lease_until else null end,lease_token=case when nextstate is null then lease_token else null end,
 next_attempt_at=case when nextstate in ('retry','uncertain') then now()+interval '2 minutes' else next_attempt_at end,updated_at=now()
 where task_id=p_task_id and lease_token=p_lease and state='processing' and lease_until>now();
 get diagnostics affected=row_count;
 if affected=1 and nextstate is not null then insert into render_auto.events(task_id,state,reason) values(p_task_id,nextstate,coalesce(p_patch->>'error',''));end if;
 return affected=1;
end $$;
create or replace function public.icetak_render_auto_source(p_task_id text,p_hash text) returns boolean language sql security invoker set search_path=pg_catalog,public,render_auto as $$
 select exists(select 1 from render_auto.jobs q join public.clickup_order_brief_jobs j using(task_id)
 where q.task_id=p_task_id and q.source_hash=p_hash and q.state='processing' and q.lease_until>now()
 and j.state='completed' and j.brief->>'confirmed'='true'
 and coalesce(jsonb_array_length(j.brief->'pending_change_ids'),0)=0 and coalesce((j.brief->>'change_detected')::int,0)=0
 and j.brief->>'wording'=q.brief->>'wording'
 and (
  exists(select 1 from public.marketplace_orders m where m.order_sn=q.order_reference and m.payment_status='paid' and m.current_status in ('READY_TO_SHIP','PROCESSED','RETRY_SHIP'))
  or exists(select 1 from public.orders o where (o.order_no=q.order_reference or o.order_id=q.order_reference) and o.payment_status='paid'
    and lower(coalesce(o.status,'')) not in ('cancelled','canceled','complete','completed','shipped','delivered')
    and lower(coalesce(o.shipment_status_group,'')) not in ('shipped','in_transit','delivered','cancelled'))
  ));
$$;
