-- Only whitelisted style features enter a profile. The Edge Function validates equivalence
-- before supplying reusable wording; no prices, policy or customer identity are learned here.
create function public.reply_style_learn(p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s reply_style; k text; v text; n integer; best text; snap reply_suggestion_latest; inserted integer;
begin
 select * into s from reply_style where channel=p_data->>'channel' for update;
 if not found then raise exception 'Invalid channel'; end if;
 insert into reply_style_receipts(message_id,channel,learned) values((p_data->>'message_id')::uuid,s.channel,false) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=0 then return jsonb_build_object('duplicate',true); end if;
 select * into snap from reply_suggestion_latest where conversation_id=(p_data->>'conversation_id')::uuid and created_at>now()-interval '24 hours';
 if not s.enabled or (snap.text is not null and btrim(snap.text)=btrim(p_data->>'actual')) then return jsonb_build_object('learned',false); end if;
 for k,v in select key,value from jsonb_each_text(coalesce(p_data->'features','{}')) loop
  if (k='pronoun' and v in ('saya','kami')) or (k='request' and v in ('hantar','berikan')) or (k='greeting' and v in ('none','Baik,','Salam.','Assalamualaikum.')) or (k='closing' and v in ('none','Terima kasih.')) then
   n=coalesce((s.counts#>>array[k,v])::integer,0)+1;
   s.counts=jsonb_set(s.counts,array[k],coalesce(s.counts->k,'{}')||jsonb_build_object(v,n));
   select key into best from jsonb_each_text(s.counts->k) order by value::integer desc,key limit 1;
   if (s.counts#>>array[k,best])::integer>=3 then s.preferences=s.preferences||jsonb_build_object(k,best); end if;
  end if;
 end loop;
 update reply_style set samples=s.samples+1,counts=s.counts,preferences=s.preferences,version=version+1,updated_at=now() where channel=s.channel;
 update reply_style_receipts set learned=true where message_id=(p_data->>'message_id')::uuid;
 if nullif(p_data->>'wording','') is not null and snap.article_id=(p_data->>'article_id')::uuid and snap.article_version=(p_data->>'article_version')::integer and exists(select 1 from reply_knowledge where id=snap.article_id and published_version=snap.article_version) then
  insert into reply_wording(article_id,article_version,channel,text) values(snap.article_id,snap.article_version,s.channel,p_data->>'wording')
  on conflict(article_id,article_version,channel) do update set uses=case when reply_wording.text=excluded.text then reply_wording.uses+1 else 1 end,text=excluded.text,updated_at=now();
 end if;
 return jsonb_build_object('learned',true);
end; $$;
revoke all on function public.reply_style_learn(jsonb) from public,anon,authenticated;
grant execute on function public.reply_style_learn(jsonb) to service_role;
