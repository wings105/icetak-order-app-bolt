alter table public.product_sync_jobs drop constraint product_sync_jobs_status_check;
alter table public.product_sync_jobs add constraint product_sync_jobs_status_check check(status in ('pending','running','verified','failed','unknown','conflict','cancelled'));
create or replace function public.icetak_product_job(p_id uuid,p_action text,p_result jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare j product_sync_jobs%rowtype; l product_channel_listings%rowtype; state jsonb; patch jsonb; models jsonb;
begin
 select * into j from product_sync_jobs where id=p_id for update;
 if not found then raise exception 'JOB_NOT_FOUND'; end if;
 select * into l from product_channel_listings where id=j.listing_id for update;
 if p_action='claim' then
  if j.status='running' and j.updated_at<now()-interval '2 minutes' then update product_sync_jobs set status='unknown',updated_at=now(),result='{"code":"WORKER_INTERRUPTED"}' where id=p_id; j.status:='unknown'; end if;
  if j.status not in ('pending','unknown') then raise exception 'JOB_NOT_PROCESSABLE'; end if;
  if j.status='pending' and l.revision<>j.expected_revision then update product_sync_jobs set status='conflict',updated_at=now() where id=p_id;return jsonb_build_object('status','conflict'); end if;
  update product_sync_jobs set status='running',updated_at=now() where id=p_id;
  return jsonb_build_object('job',to_jsonb(j),'listing',to_jsonb(l),'verify_only',j.status='unknown');
 elsif p_action='close' then
  if j.status<>'unknown' or nullif(p_result->>'actor','') is null then raise exception 'ONLY_UNKNOWN_CAN_BE_CLOSED'; end if;
  update product_sync_jobs set status='cancelled',result=result||jsonb_build_object('closed_by',p_result->>'actor','closed_at',now(),'code','OWNER_CLOSED_UNCONFIRMED'),updated_at=now() where id=p_id;
  return jsonb_build_object('status','cancelled','provider_outcome','unconfirmed');
 elsif p_action='finish' then
  if j.status<>'running' or p_result->>'status' not in ('verified','failed','unknown','conflict') then raise exception 'INVALID_JOB_RESULT'; end if;
  update product_sync_jobs set status=p_result->>'status',result=p_result,updated_at=now() where id=p_id;
  if p_result->>'status'='verified' then
   state:=coalesce(p_result->'state',j.desired->'patch'); patch:='{}';
   if j.action='status' then update product_channel_listings set provider_status=case when (state->>'unlist')::boolean then 'UNLIST' else 'NORMAL' end where id=l.id;
   elsif j.action='item' then
    if state?'item_name' then patch:=patch||jsonb_build_object('name',state->>'item_name'); end if;
    if state?'description' then patch:=patch||jsonb_build_object('description',state->>'description'); end if;
    if state?'item_sku' then patch:=patch||jsonb_build_object('sku',state->>'item_sku'); end if;
    if state?'image' then patch:=patch||jsonb_build_object('images',(select jsonb_agg('https://cf.shopee.com.my/file/'||x) from jsonb_array_elements_text(state#>'{image,image_id_list}') x),'image_url','https://cf.shopee.com.my/file/'||(state#>>'{image,image_id_list,0}')); end if;
   else
    patch:=case j.action when 'price' then jsonb_build_object('price',(state->>'original_price')::numeric) when 'stock' then jsonb_build_object('stock',(state->>'stock')::int) else jsonb_build_object('sku',state->>'model_sku') end;
    select jsonb_agg(case when x->>'model_id'=state->>'model_id' then x||patch else x end) into models from jsonb_array_elements(l.snapshot->'models') x;
    update product_variants set metadata=metadata||jsonb_build_object('provider_snapshot',coalesce(metadata->'provider_snapshot','{}')||patch) where product_id=l.product_id and metadata->>'shop_id'=l.shop_id and metadata->>'shopee_model_id'=state->>'model_id';
    patch:=jsonb_build_object('models',models);
    if j.action='price' then patch:=patch||jsonb_build_object('price',(select min((x->>'price')::numeric) from jsonb_array_elements(models) x)); end if;
   end if;
   update product_channel_listings set snapshot=snapshot||patch||jsonb_build_object('last_verified_change',state),revision=revision+1,updated_at=now(),last_verified_at=now() where id=l.id;
  end if;
  return p_result;
 end if;
 raise exception 'INVALID_JOB_ACTION';
end $$;
revoke all on function public.icetak_product_job(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_product_job(uuid,text,jsonb) to service_role;
