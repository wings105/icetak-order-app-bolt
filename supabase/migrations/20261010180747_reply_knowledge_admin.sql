create function public.reply_knowledge_save(p_action text,p_actor text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.reply_knowledge; s public.reply_style; doc jsonb:=p_data->'draft';
begin
 if p_action in ('style','reset_style') then
  if p_data->>'channel' not in ('whatsapp','shopee') then raise exception 'Invalid channel'; end if;
  if p_action='reset_style' then
   update reply_style set counts='{}',preferences='{}',samples=0,version=version+1,updated_at=now() where channel=p_data->>'channel' returning * into s;
   update reply_wording set uses=0 where channel=s.channel;
  else
   update reply_style set enabled=(p_data->>'enabled')::boolean,version=version+1,updated_at=now() where channel=p_data->>'channel' returning * into s;
  end if;
  insert into reply_knowledge_events(article_id,action,actor,version,snapshot) values(null,p_action,p_actor,s.version,to_jsonb(s));
  return to_jsonb(s);
 end if;
 if p_action not in ('save','publish','unpublish') then raise exception 'Invalid action'; end if;
 if p_data->>'id' is null then
  if p_action<>'save' then raise exception 'Save draft first'; end if;
  insert into reply_knowledge(draft,updated_by) values(doc,p_actor) returning * into r;
 else
  select * into r from reply_knowledge where id=(p_data->>'id')::uuid for update;
  if not found then raise exception 'Not found'; end if;
  if r.version<>(p_data->>'version')::integer then raise exception 'VERSION_CONFLICT: Muat semula artikel'; end if;
  if p_action='publish' then
   if (select count(*) from reply_knowledge where published is not null and id<>r.id)>=200 then raise exception 'Had 200 artikel aktif; tarik artikel yang tidak diperlukan dahulu';end if;
   if r.draft->>'answer' ~ '\{\{' then raise exception 'Gantikan placeholder dengan maklumat yang disahkan';end if;
   if coalesce(r.draft->>'review_note','')<>'' then raise exception 'Selesaikan nota semakan sebelum terbit'; end if;
   if nullif(r.draft->>'title','') is null or nullif(r.draft->>'answer','') is null or nullif(r.draft->>'source','') is null then raise exception 'Lengkapkan artikel dan sumber'; end if;
  end if;
  update reply_knowledge set draft=case when p_action='save' then doc else draft end,
   published=case when p_action='publish' then draft when p_action='unpublish' then null else published end,
   published_version=case when p_action='publish' then version+1 when p_action='unpublish' then null else published_version end,
   version=version+1,updated_by=p_actor,updated_at=now() where id=r.id returning * into r;
 end if;
 insert into reply_knowledge_events(article_id,action,actor,version,snapshot) values(r.id,p_action,p_actor,r.version,to_jsonb(r));
 return to_jsonb(r);
end; $$;
revoke all on function public.reply_knowledge_save(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reply_knowledge_save(text,text,jsonb) to service_role;

