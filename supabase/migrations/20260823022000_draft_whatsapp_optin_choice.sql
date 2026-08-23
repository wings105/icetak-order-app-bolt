-- Carry the admin's Draft Review WhatsApp choice into prepaid orders.
-- The existing finalizer is patched in-place so all callers keep the same contract.
do $patch$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef(p.oid)
    into definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='icetak_finalize_generic_order_draft'
    and pg_get_function_identity_arguments(p.oid)='p_draft_id uuid, p_actor text';

  if definition is null then
    raise exception 'icetak_finalize_generic_order_draft not found';
  end if;

  patched:=replace(
    definition,
    $needle$'notify_whatsapp',false$needle$,
    $replacement$'notify_whatsapp',coalesce((normalized_draft->>'notify_whatsapp')::boolean,false)$replacement$
  );

  if patched=definition then
    raise exception 'finalizer notify_whatsapp guard was not found';
  end if;

  execute patched;
end
$patch$;
