-- Preserve saved CRM address linkage when a draft stores address_id inside customer JSON.
-- This prevents an already-confirmed address from being inserted again during order conversion.

do $patch$
declare
  v_oid oid;
  v_def text;
  v_old text := 'v_address_id uuid:=nullif(payload->>''address_id'','''')::uuid;';
  v_new text := 'v_address_id uuid:=nullif(coalesce(payload->>''address_id'',payload#>>''{customer,address_id}''),'''')::uuid;';
begin
  select p.oid, pg_get_functiondef(p.oid)
    into v_oid, v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='icetak_create_order'
    and pg_get_function_identity_arguments(p.oid)='payload jsonb';

  if v_oid is null then
    raise exception 'icetak_create_order(jsonb) not found';
  end if;

  if position(v_new in v_def)>0 then
    return;
  end if;

  if position(v_old in v_def)=0 then
    raise exception 'Expected address_id declaration not found; migration aborted';
  end if;

  execute replace(v_def,v_old,v_new);
end
$patch$;
