-- Run in a transaction with the migration loaded first; always ROLLBACK.
do $$
declare c jsonb; v_time timestamptz:=clock_timestamp()-interval '1 minute'; v_expiry timestamptz:=clock_timestamp()+interval '3 hours'; v_count integer;
begin
 if not has_function_privilege('service_role','public.icetak_shopee_chat_config(text,jsonb)','execute') or has_function_privilege('anon','public.icetak_shopee_chat_config(text,jsonb)','execute') or has_function_privilege('authenticated','public.icetak_shopee_chat_config(text,jsonb)','execute') then raise exception 'Private RPC grants failed'; end if;
 delete from public.private_runtime_settings where setting_key='shopee_chat_direct_config';
 c:=public.icetak_shopee_chat_config('save','{"partner_id":"123","shop_id":"456","partner_key":"fixture-partner-only","enabled":true}');
 if c->>'shop_id'<>'456' or c->>'access_token' is not null then raise exception 'Initial save failed'; end if;
 c:=public.icetak_shopee_chat_config('rotate_webhook',jsonb_build_object('key_hash',repeat('a',64)));
 c:=public.icetak_shopee_chat_config('rotate_token',jsonb_build_object('shop_id','456','partner_id','123','access_token','fixture-token-only','webhook_key_hash',repeat('a',64),'rotated_at',v_time,'expires_at',v_expiry));
 if c->>'access_token'<>'fixture-token-only' or (c->>'check_ok')::boolean then raise exception 'Rotation failed'; end if;
 v_count:=jsonb_array_length(c->'events');
 c:=public.icetak_shopee_chat_config('rotate_token',jsonb_build_object('shop_id','456','partner_id','123','access_token','fixture-token-only','webhook_key_hash',repeat('a',64),'rotated_at',v_time,'expires_at',v_expiry));
 if not (c->>'duplicate')::boolean or jsonb_array_length(c->'events')<>v_count then raise exception 'Duplicate rotated twice'; end if;
 begin
  perform public.icetak_shopee_chat_config('rotate_token',jsonb_build_object('shop_id','456','partner_id','123','access_token','older','webhook_key_hash',repeat('a',64),'rotated_at',v_time-interval '1 second','expires_at',v_expiry));
  raise exception 'Accepted stale rotation';
 exception when others then if sqlerrm not like '%STALE_ROTATION%' then raise; end if; end;
 begin
  perform public.icetak_shopee_chat_config('rotate_token',jsonb_build_object('shop_id','456','partner_id','123','access_token','different','webhook_key_hash',repeat('a',64),'rotated_at',v_time,'expires_at',v_expiry));
  raise exception 'Accepted conflicting retry';
 exception when others then if sqlerrm not like '%ROTATION_CONFLICT%' then raise; end if; end;
 begin
  perform public.icetak_shopee_chat_config('rotate_token',jsonb_build_object('shop_id','999','partner_id','123','access_token','wrong-shop','webhook_key_hash',repeat('a',64),'rotated_at',v_time,'expires_at',v_expiry));
  raise exception 'Accepted wrong shop';
 exception when others then if sqlerrm not like '%IDENTITY_MISMATCH%' then raise; end if; end;
 c:=public.icetak_shopee_chat_config('record_check',jsonb_build_object('credential_version',(c->>'credential_version')::integer,'ok',true,'code','CHAT_READ_VERIFIED'));
 if not (c->>'check_ok')::boolean then raise exception 'Check not recorded'; end if;
 c:=public.icetak_shopee_chat_config('rotate_token',jsonb_build_object('shop_id','456','partner_id','123','access_token','fixture-new-token','webhook_key_hash',repeat('a',64),'rotated_at',v_time+interval '1 second','expires_at',v_expiry));
 if (c->>'check_ok')::boolean then raise exception 'New token inherited check'; end if;
 c:=public.icetak_shopee_chat_config('record_check',jsonb_build_object('credential_version',(c->>'credential_version')::integer-1,'ok',true,'code','CHAT_READ_VERIFIED'));
 if (c->>'check_ok')::boolean or not (c->>'check_stale')::boolean then raise exception 'Stale check changed state'; end if;
 c:=public.icetak_shopee_chat_config('rotate_webhook',jsonb_build_object('key_hash',repeat('b',64)));
 begin
  perform public.icetak_shopee_chat_config('rotate_token',jsonb_build_object('shop_id','456','partner_id','123','access_token','old-key','webhook_key_hash',repeat('a',64),'rotated_at',v_time+interval '2 seconds','expires_at',v_expiry));
  raise exception 'Accepted revoked key';
 exception when others then if sqlerrm not like '%UNAUTHORIZED_ROTATION%' then raise; end if; end;
 c:=public.icetak_shopee_chat_config('save','{"partner_id":"123","shop_id":"456","enabled":false}');
 if (c->>'enabled')::boolean or c->>'access_token'<>'fixture-new-token' or c->>'partner_key'<>'fixture-partner-only' then raise exception 'Blank fields lost credentials'; end if;
 c:=public.icetak_shopee_chat_config('save','{"partner_id":"123","shop_id":"789","enabled":false}');
 if c->>'access_token' is not null or c->>'partner_key' is not null or c->>'webhook_key_hash' is not null then raise exception 'Different shop inherited credentials'; end if;
 if c::text like '%fixture-partner%' or c::text like '%fixture-new-token%' then raise exception 'Audit contains credentials'; end if;
end $$;
