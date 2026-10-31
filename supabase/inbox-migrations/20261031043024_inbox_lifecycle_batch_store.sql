create or replace function public.icetak_lifecycle_index_store_batch(p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>40 then raise exception 'Expected at most 40 statuses' using errcode='22023';end if;
 with input as (select * from jsonb_to_recordset(p_rows) as r(id uuid,revision bigint,stage text,checked_at timestamptz)),written as (
  update public.conversation_lifecycle_index i set stage=r.stage,checked_at=r.checked_at,resolved_revision=r.revision,policy_version=1 from input r
  where i.conversation_id=r.id and i.revision=r.revision and r.checked_at between now()-interval '2 minutes' and now()+interval '1 minute' and (i.checked_at is null or i.checked_at<=r.checked_at)
  returning i.conversation_id
 ) select coalesce(jsonb_agg(conversation_id),'[]') into result from written;
 return result;
end $$;
revoke all on function public.icetak_lifecycle_index_store_batch(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_lifecycle_index_store_batch(jsonb) to service_role;
