-- Run inside BEGIN/ROLLBACK. No retained OAuth grant or external delivery.
do $$ declare o uuid;n int;begin
 select auth_user_id into o from public.admin_users where role='owner' and is_active limit 1;
 if o is null then raise exception 'owner fixture missing';end if;
 insert into public.icetak_mcp_clients(client_id,redirect_uris) values('mcp-code-retry-regression','["https://chatgpt.com/connector/oauth/regression"]');
 insert into public.icetak_mcp_codes(code_hash,client_id,owner_id,redirect_uri,challenge,scope,expires_at)
 values('mcp-code-retry-hash','mcp-code-retry-regression',o,'https://chatgpt.com/connector/oauth/regression','original-challenge','briefs:read',now()+interval '1 minute') on conflict(code_hash) do nothing;
 insert into public.icetak_mcp_codes(code_hash,client_id,owner_id,redirect_uri,challenge,scope,expires_at)
 values('mcp-code-retry-hash','mcp-code-retry-regression',o,'https://chatgpt.com/connector/oauth/regression','must-not-replace','comments:write',now()+interval '1 hour') on conflict(code_hash) do nothing;
 select count(*) into n from public.icetak_mcp_codes where code_hash='mcp-code-retry-hash' and challenge='original-challenge' and scope='briefs:read';
 if n<>1 then raise exception 'retry replaced or duplicated grant';end if;
 select count(*) into n from public.icetak_mcp_consume_code('mcp-code-retry-hash','mcp-code-retry-regression','https://chatgpt.com/connector/oauth/regression','wrong');
 if n<>0 then raise exception 'bad PKCE accepted';end if;
 select count(*) into n from public.icetak_mcp_consume_code('mcp-code-retry-hash','mcp-code-retry-regression','https://chatgpt.com/connector/oauth/regression','original-challenge');
 if n<>1 then raise exception 'valid code rejected';end if;
 select count(*) into n from public.icetak_mcp_consume_code('mcp-code-retry-hash','mcp-code-retry-regression','https://chatgpt.com/connector/oauth/regression','original-challenge');
 if n<>0 then raise exception 'code replay accepted';end if;
end $$;
