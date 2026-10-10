-- One snapshot per conversation; no per-attempt transcript or vector generation.
create function public.reply_suggestion_remember(p_data jsonb) returns void
language sql security definer set search_path=public,pg_temp as $$
 insert into reply_suggestion_latest(conversation_id,inbound_revision,text,article_id,article_version)
 values ((p_data->>'conversation_id')::uuid,coalesce(p_data->>'inbound_revision',''),left(p_data->>'text',4000),nullif(p_data->>'article_id','')::uuid,nullif(p_data->>'article_version','')::integer)
 on conflict(conversation_id) do update set inbound_revision=excluded.inbound_revision,text=excluded.text,article_id=excluded.article_id,article_version=excluded.article_version,created_at=now();
$$;
revoke all on function public.reply_suggestion_remember(jsonb) from public,anon,authenticated;
grant execute on function public.reply_suggestion_remember(jsonb) to service_role;

