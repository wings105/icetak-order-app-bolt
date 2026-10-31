CREATE OR REPLACE FUNCTION public.icetak_lifecycle_index_sources(p_ids uuid[], p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb:='[]';r record;fresh boolean;
begin
 if not exists(select 1 from public.workspace_members where auth_user_id=auth.uid() and active and role in ('owner','admin','designer','production','support','viewer')) then raise exception 'Active staff required' using errcode='42501';end if;
 if coalesce(cardinality(p_ids),0) not between 1 and 40 then raise exception 'Expected 1 to 40 IDs' using errcode='22023';end if;
 for r in select c.id,c.last_message_at,i.revision,i.resolved_revision,i.stage,i.checked_at,i.policy_version from public.conversations c left join public.conversation_lifecycle_index i on i.conversation_id=c.id where c.id=any(p_ids) loop
  fresh:=not p_force and r.revision=r.resolved_revision and r.policy_version=1 and r.checked_at>now()-case when r.last_message_at>now()-interval '1 day' then interval '5 minutes' else interval '15 minutes' end;
  result:=result||jsonb_build_array(jsonb_build_object('id',r.id,'revision',r.revision,'cached',case when fresh then jsonb_build_object('stage',r.stage,'checked_at',r.checked_at) end,'source',case when not coalesce(fresh,false) then public.icetak_conversation_lifecycle_source(r.id) end));
 end loop;
 return result;
end $function$
