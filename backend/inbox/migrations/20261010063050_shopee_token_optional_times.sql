-- Unified Inbox only. Credentials remain in the existing service-only runtime store.
create or replace function public.icetak_shopee_chat_config(p_action text, p_body jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c jsonb; n jsonb; v_now timestamptz:=clock_timestamp(); v_rotated timestamptz; v_expiry timestamptz; changed boolean; e jsonb;
begin
 if p_action='get' then
  select setting_value::jsonb into c from public.private_runtime_settings where setting_key='shopee_chat_direct_config';
  return coalesce(c,'{}'::jsonb);
 end if;
 insert into public.private_runtime_settings(setting_key,setting_value) values('shopee_chat_direct_config','{}') on conflict(setting_key) do nothing;
 select setting_value::jsonb into c from public.private_runtime_settings where setting_key='shopee_chat_direct_config' for update;
 v_now:=clock_timestamp();
 n:=c;
 if p_action='save' then
  if coalesce(p_body->>'partner_id','') !~ '^[1-9][0-9]{0,14}$' or coalesce(p_body->>'shop_id','') !~ '^[1-9][0-9]{0,14}$' then raise exception 'INVALID_ID'; end if;
  if coalesce(p_body->>'environment','production') not in ('production','sandbox') then raise exception 'INVALID_ENVIRONMENT'; end if;
  -- A different shop/environment cannot inherit the previous shop's credential or rotation key.
  if (c->>'shop_id' is distinct from p_body->>'shop_id') or (c->>'partner_id' is distinct from p_body->>'partner_id') or (coalesce(c->>'environment','production') is distinct from coalesce(p_body->>'environment','production')) then
   n:=n-'access_token'-'partner_key'-'token_expires_at'-'token_rotated_at'-'webhook_key_hash'-'webhook_key_created_at'-'retired_token_hashes';
  end if;
  n:=n||jsonb_build_object('partner_id',p_body->>'partner_id','shop_id',p_body->>'shop_id','environment',coalesce(p_body->>'environment','production'),'enabled',coalesce((p_body->>'enabled')::boolean,false));
  if nullif(btrim(p_body->>'partner_key'),'') is not null then n:=n||jsonb_build_object('partner_key',btrim(p_body->>'partner_key')); end if;
  if nullif(btrim(p_body->>'access_token'),'') is not null then
   v_expiry:=nullif(btrim(p_body->>'token_expires_at'),'')::timestamptz;
   if v_expiry<=v_now then raise exception 'INVALID_EXPIRY'; end if;
   n:=n||jsonb_build_object('access_token',btrim(p_body->>'access_token'),'token_expires_at',v_expiry,'token_rotated_at',v_now);
  end if;
 elsif p_action='rotate_token' then
  -- Revalidate the key under the row lock: regeneration must immediately revoke an in-flight old key.
  if nullif(c->>'webhook_key_hash','') is null or c->>'webhook_key_hash' is distinct from p_body->>'webhook_key_hash' then raise exception 'UNAUTHORIZED_ROTATION'; end if;
  if c->>'shop_id' is distinct from p_body->>'shop_id' or c->>'partner_id' is distinct from p_body->>'partner_id' then raise exception 'IDENTITY_MISMATCH'; end if;
  -- Omitted/blank times are accepted. Receipt time is not a provider issue time.
  v_rotated:=nullif(btrim(p_body->>'rotated_at'),'')::timestamptz;
  v_expiry:=nullif(btrim(p_body->>'expires_at'),'')::timestamptz;
  if v_rotated>v_now+interval '5 minutes' or v_expiry<=v_now or (v_rotated is not null and v_expiry<=v_rotated) or nullif(btrim(p_body->>'access_token'),'') is null then raise exception 'INVALID_TOKEN_UPDATE'; end if;
  -- A retry without timestamps must not change receipt time, expiry, version or audit.
  if v_rotated is null and c->>'access_token'=btrim(p_body->>'access_token') and (v_expiry is null or (c->>'token_expires_at')::timestamptz=v_expiry) then return c||jsonb_build_object('duplicate',true); end if;
  -- Reject recently replaced tokens even when their automation request has no issue time.
  if coalesce(c->'retired_token_hashes','[]'::jsonb) ? md5(btrim(p_body->>'access_token')) then raise exception 'STALE_ROTATION'; end if;
  v_rotated:=coalesce(v_rotated,v_now);
  if v_rotated<coalesce((c->>'token_rotated_at')::timestamptz,'-infinity'::timestamptz) then raise exception 'STALE_ROTATION'; end if;
  if v_rotated=(c->>'token_rotated_at')::timestamptz then
   if c->>'access_token'=btrim(p_body->>'access_token') and (c->>'token_expires_at')::timestamptz is not distinct from v_expiry then return c||jsonb_build_object('duplicate',true); end if;
   raise exception 'ROTATION_CONFLICT';
  end if;
  n:=n||jsonb_build_object('access_token',btrim(p_body->>'access_token'),'token_expires_at',v_expiry,'token_rotated_at',v_rotated);
 elsif p_action='rotate_webhook' then
  if nullif(c->>'shop_id','') is null then raise exception 'SAVE_CONFIG_FIRST'; end if;
  if coalesce(p_body->>'key_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_KEY'; end if;
  n:=n||jsonb_build_object('webhook_key_hash',p_body->>'key_hash','webhook_key_created_at',v_now);
 elsif p_action='record_check' then
  if coalesce((c->>'credential_version')::integer,0)<>coalesce((p_body->>'credential_version')::integer,-1) then return c||jsonb_build_object('check_stale',true); end if;
  n:=n||jsonb_build_object('checked_credential_version',(p_body->>'credential_version')::integer,'check_ok',coalesce((p_body->>'ok')::boolean,false),'last_check_at',v_now,'last_check_code',left(coalesce(p_body->>'code','UNKNOWN'),80));
 else raise exception 'INVALID_ACTION'; end if;
 if n->>'access_token' is distinct from c->>'access_token' and nullif(c->>'access_token','') is not null and n->>'shop_id'=c->>'shop_id' and n->>'partner_id'=c->>'partner_id' and n->>'environment'=c->>'environment' then
  -- Fingerprints are private replay markers, never authentication credentials.
  n:=n||jsonb_build_object('retired_token_hashes',(select jsonb_agg(x) from (select x from jsonb_array_elements(jsonb_build_array(md5(c->>'access_token'))||coalesce(c->'retired_token_hashes','[]'::jsonb)) with ordinality as a(x,i) where i<=64) s));
 end if;
 changed:=n->>'partner_key' is distinct from c->>'partner_key' or n->>'access_token' is distinct from c->>'access_token' or n->>'partner_id' is distinct from c->>'partner_id' or n->>'shop_id' is distinct from c->>'shop_id' or n->>'environment' is distinct from c->>'environment';
 if changed then n:=n||jsonb_build_object('credential_version',coalesce((c->>'credential_version')::integer,0)+1,'check_ok',false); end if;
 e:=jsonb_build_object('action',p_action,'at',v_now,'actor',left(coalesce(p_body->>'actor','token-automation'),80));
 n:=n||jsonb_build_object('updated_at',v_now,'events',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select x from jsonb_array_elements(jsonb_build_array(e)||coalesce(c->'events','[]'::jsonb)) with ordinality as a(x,i) where i<=20) s));
 update public.private_runtime_settings set setting_value=n::text,updated_at=v_now where setting_key='shopee_chat_direct_config';
 return n;
end $$;
revoke all on function public.icetak_shopee_chat_config(text,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_shopee_chat_config(text,jsonb) to service_role;
