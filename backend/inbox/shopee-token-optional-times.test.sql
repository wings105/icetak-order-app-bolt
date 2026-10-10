-- Execute as service_role inside BEGIN / ROLLBACK. No fixture survives.
do $$
declare c jsonb; original_time text; original_version integer; original_events integer; i integer;
begin
 delete from public.private_runtime_settings where setting_key='shopee_chat_direct_config';
 c:=public.icetak_shopee_chat_config('save','{"partner_id":"123","shop_id":"456","partner_key":"fixture-partner","enabled":true,"access_token":"fixture-initial"}');
 if c->>'token_expires_at' is not null or c->>'token_rotated_at' is null then raise exception 'Initial token requires expiry or misses receipt'; end if;
 c:=public.icetak_shopee_chat_config('rotate_webhook',jsonb_build_object('key_hash',repeat('a',64)));
 c:=public.icetak_shopee_chat_config('rotate_token','{"partner_id":"123","shop_id":"456","access_token":"fixture-minimal"}'::jsonb||jsonb_build_object('webhook_key_hash',repeat('a',64)));
 if c->>'access_token'<>'fixture-minimal' or c->>'token_expires_at' is not null or c->>'token_rotated_at' is null or (c->>'check_ok')::boolean then raise exception 'Minimal rotation failed'; end if;
 original_time:=c->>'token_rotated_at'; original_version:=(c->>'credential_version')::integer; original_events:=jsonb_array_length(c->'events');
 c:=public.icetak_shopee_chat_config('rotate_token','{"partner_id":"123","shop_id":"456","access_token":"fixture-minimal","rotated_at":"","expires_at":""}'::jsonb||jsonb_build_object('webhook_key_hash',repeat('a',64)));
 if not (c->>'duplicate')::boolean or c->>'token_rotated_at'<>original_time or (c->>'credential_version')::integer<>original_version or jsonb_array_length(c->'events')<>original_events then raise exception 'Untimed retry changed token state'; end if;
 begin
  perform public.icetak_shopee_chat_config('rotate_token','{"partner_id":"123","shop_id":"456","access_token":"fixture-initial"}'::jsonb||jsonb_build_object('webhook_key_hash',repeat('a',64)));
  raise exception 'Accepted retired token replay';
 exception when others then if sqlerrm not like '%STALE_ROTATION%' then raise; end if; end;
 begin
  perform public.icetak_shopee_chat_config('rotate_token','{"partner_id":"123","shop_id":"999","access_token":"fixture-other"}'::jsonb||jsonb_build_object('webhook_key_hash',repeat('a',64)));
  raise exception 'Minimal request accepted wrong shop';
 exception when others then if sqlerrm not like '%IDENTITY_MISMATCH%' then raise; end if; end;
 begin
  perform public.icetak_shopee_chat_config('rotate_token',jsonb_build_object('partner_id','123','shop_id','456','access_token','fixture-expired','webhook_key_hash',repeat('a',64),'expires_at',clock_timestamp()-interval '1 minute'));
  raise exception 'Accepted explicit expired token';
 exception when others then if sqlerrm not like '%INVALID_TOKEN_UPDATE%' then raise; end if; end;
 for i in 1..70 loop
  c:=public.icetak_shopee_chat_config('rotate_token',jsonb_build_object('partner_id','123','shop_id','456','access_token','fixture-token-'||i,'webhook_key_hash',repeat('a',64)));
 end loop;
 if jsonb_array_length(c->'retired_token_hashes')<>64 then raise exception 'Replay history not bounded'; end if;
 c:=public.icetak_shopee_chat_config('save','{"partner_id":"123","shop_id":"789","enabled":false}');
 if c ? 'retired_token_hashes' or c ? 'access_token' then raise exception 'Changed identity retained token state'; end if;
 if has_function_privilege('anon','public.icetak_shopee_chat_config(text,jsonb)','execute') or has_function_privilege('authenticated','public.icetak_shopee_chat_config(text,jsonb)','execute') then raise exception 'Private boundary lost'; end if;
end $$;
