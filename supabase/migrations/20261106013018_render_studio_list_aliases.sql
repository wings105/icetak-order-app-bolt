CREATE OR REPLACE FUNCTION public.icetak_render_studio(p_action text, p_sku text DEFAULT ''::text, p_actor text DEFAULT ''::text, p_data jsonb DEFAULT '{}'::jsonb, p_revision integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d render_studio.drafts;t public.render_templates;j render_studio.jobs;v jsonb;rows jsonb;f render_studio.fonts;pid uuid;vid uuid;q text;off int;
begin
 if current_user not in ('postgres','service_role') then raise insufficient_privilege using message='Service access required';end if;
 if jsonb_typeof(p_data)<>'object' then raise exception 'Object payload required';end if;
 if p_action='list' then
  q:=left(coalesce(p_data->>'q',''),100);off:=greatest(0,least(100000,coalesce((p_data->>'offset')::int,0)));
  with items as (
   select coalesce(rd.sku,rt.sku) sku,rd.data,rd.revision,rd.base_version,rd.published_revision,rt.version,
    coalesce(rd.data->>'raw_path',rt.image_path) image_path,coalesce(rd.updated_at,rt.updated_at) updated_at,
    p.display_name,coalesce(p.main_image_url,'') product_image,
    case when exists(select 1 from render_studio.jobs rj where rj.sku=rd.sku and rj.revision=rd.revision and rj.state in ('queued','processing')) then 'analysing'
     when rd.revision>rd.published_revision then case when rd.data ? 'analysis' then 'review' else 'draft' end
     when coalesce((rt.config#>>'{automation,enabled}')::boolean,false) then 'ready'
     when rt.sku is not null then 'paused' else 'draft' end status,
    coalesce(rd.data->'config',rt.config) config
   from render_studio.drafts rd full join public.render_templates rt using(sku) left join public.products p on p.id=rd.product_id
  ),filtered as(select * from items where (q='' or sku ilike '%'||q||'%' or display_name ilike '%'||q||'%') and (coalesce(p_data->>'status','')='' or status=p_data->>'status'))
  select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(x) from (select * from filtered order by updated_at desc,sku limit 50 offset off)x),'[]')) into v;
  return v;
 end if;
 if p_action='fonts' then return coalesce((select jsonb_agg(rf order by rf.name) from render_studio.fonts rf),'[]');end if;
 if p_action='font-save' then
  insert into render_studio.fonts(name,aliases,path,created_by) values(trim(p_data->>'name'),coalesce(p_data->'aliases','[]'),p_data->>'path',p_actor)
  on conflict(path) do update set name=excluded.name,aliases=excluded.aliases returning * into f;return to_jsonb(f);
 end if;
 if p_action='claim' then
  perform pg_advisory_xact_lock(hashtextextended('render-studio-ai',0));
  update render_studio.jobs set state='failed',error='LEASE_EXPIRED_RETRY_MANUALLY',updated_at=now() where state='processing' and lease_until<now();
  if exists(select 1 from render_studio.jobs where state='processing') then return null;end if;
  select * into j from render_studio.jobs where state='queued' order by created_at limit 1 for update skip locked;
  if not found then return null;end if;
  update render_studio.jobs set state='processing',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now() where id=j.id returning * into j;
  return to_jsonb(j);
 end if;
 if p_action='complete' then
  select * into j from render_studio.jobs where id=(p_data->>'id')::uuid;
  if not found then return jsonb_build_object('saved',false);end if;
  perform pg_advisory_xact_lock(hashtextextended('render-template:'||j.sku,0));
  select * into d from render_studio.drafts where sku=j.sku for update;
  select * into j from render_studio.jobs where id=j.id for update;
  if not found or j.state<>'processing' or j.lease is distinct from (p_data->>'lease')::uuid then return jsonb_build_object('saved',false);end if;
  if d.revision<>j.revision then
   update render_studio.jobs set state='superseded',updated_at=now() where id=j.id;return jsonb_build_object('saved',false,'superseded',true);
  end if;
  if coalesce(p_data->>'error','')<>'' then
   update render_studio.jobs set state='failed',error=left(p_data->>'error',200),updated_at=now() where id=j.id;
   insert into render_studio.events(sku,actor,event,data) values(j.sku,'vision-worker','analysis-failed',jsonb_build_object('job_id',j.id,'error',left(p_data->>'error',200)));
   return jsonb_build_object('saved',true);
  end if;
  update render_studio.drafts set data=data||p_data->'result',revision=revision+1,updated_by='vision-worker',updated_at=now() where sku=j.sku returning * into d;
  update render_studio.jobs set state='completed',result=p_data->'result',error=null,updated_at=now() where id=j.id;
  insert into render_studio.events(sku,actor,event,data) values(j.sku,'vision-worker','analysis-completed',jsonb_build_object('job_id',j.id,'revision',d.revision));
  return jsonb_build_object('saved',true,'revision',d.revision);
 end if;
 if p_sku !~ '^[A-Z0-9_-]{1,40}$' then raise exception 'SKU tidak sah';end if;
 if p_action='get' then
  select * into d from render_studio.drafts where sku=p_sku;select * into t from public.render_templates where sku=p_sku;
  return jsonb_build_object('draft',case when d.sku is null then null else to_jsonb(d) end,'template',case when t.sku is null then null else to_jsonb(t) end,
   'jobs',coalesce((select jsonb_agg(x) from (select id,state,revision,error,attempts,created_at,updated_at from render_studio.jobs where sku=p_sku order by created_at desc limit 5)x),'[]'));
 end if;
 if coalesce(p_actor,'')='' then raise exception 'Actor required';end if;
 perform pg_advisory_xact_lock(hashtextextended('render-template:'||p_sku,0));
 select * into d from render_studio.drafts where sku=p_sku for update;
 select * into t from public.render_templates where sku=p_sku;
 if p_action='save' then
  if coalesce(d.revision,0)<>p_revision then
   if d.data=p_data then return to_jsonb(d);end if;
   raise exception 'DRAFT_CHANGED: Reload draft';end if;
  pid:=nullif(p_data->>'product_id','')::uuid;vid:=nullif(p_data->>'variant_id','')::uuid;
  if pid is not null then
   if vid is not null then
    if not exists(select 1 from public.product_variants where id=vid and product_id=pid and upper(trim(sku))=p_sku) then raise exception 'SKU_VARIANT_MISMATCH';end if;
   elsif not exists(select 1 from public.products where id=pid and upper(trim(parent_sku))=p_sku) then raise exception 'SKU_PRODUCT_MISMATCH';end if;
  elsif t.sku is null then raise exception 'Pilih SKU daripada katalog Produk';end if;
  insert into render_studio.drafts(sku,product_id,variant_id,data,base_version,updated_by)
   values(p_sku,pid,vid,p_data,coalesce(t.version,0),p_actor)
   on conflict(sku) do update set product_id=excluded.product_id,variant_id=excluded.variant_id,data=excluded.data,revision=render_studio.drafts.revision+1,updated_by=p_actor,updated_at=now()
   returning * into d;
  insert into render_studio.events(sku,actor,event,data) values(p_sku,p_actor,'draft-saved',jsonb_build_object('revision',d.revision));return to_jsonb(d);
 end if;
 if p_action='pause' then
  if t.sku is null then raise exception 'Template belum confirmed';end if;
  v:=t.config;v:=jsonb_set(v,'{automation}',coalesce(v->'automation','{"inputs":{}}')||'{"enabled":false}');
  v:=public.icetak_render_template_save(p_actor,p_sku,t.image_path,t.font_path,v,t.version);
  update render_studio.drafts set base_version=(v->>'version')::int where sku=p_sku;
  insert into render_studio.events(sku,actor,event) values(p_sku,p_actor,'paused');return v;
 end if;
 if d.sku is null or d.revision<>p_revision then raise exception 'DRAFT_CHANGED: Reload draft';end if;
 if p_action='publish' then
  if d.published_revision=d.revision and t.version=d.base_version and coalesce((t.config#>>'{automation,enabled}')::boolean,false) then return to_jsonb(t);end if;
  if d.base_version<>coalesce(t.version,0) then raise exception 'TEMPLATE_CHANGED: Reload confirmed template';end if;
  if coalesce((p_data->>'confirmed')::boolean,false) is not true then raise exception 'Confirmation required';end if;
  v:=public.icetak_render_template_save(p_actor,p_sku,d.data->>'raw_path',null,d.data->'config',d.base_version);
  update render_studio.drafts set base_version=(v->>'version')::int,published_revision=revision where sku=p_sku;
  insert into render_studio.events(sku,actor,event,data) values(p_sku,p_actor,'confirmed',jsonb_build_object('revision',d.revision,'version',v->'version'));return v;
 end if;
 if p_action='queue' then
  if coalesce(d.data->>'raw_path','')='' or coalesce(d.data->>'reference_path','')='' then raise exception 'Masukkan gambar raw dan contoh siap';end if;
  insert into render_studio.jobs(sku,revision,snapshot) values(p_sku,d.revision,d.data) on conflict(sku,revision) do nothing;
  if coalesce((p_data->>'retry')::boolean,false) then update render_studio.jobs set state='queued',error=null where sku=p_sku and revision=d.revision and state='failed' and attempts<3;end if;
  select * into j from render_studio.jobs where sku=p_sku and revision=d.revision;
  insert into render_studio.events(sku,actor,event,data) values(p_sku,p_actor,'analysis-requested',jsonb_build_object('job_id',j.id));
  perform render_studio.dispatch();return to_jsonb(j);
 end if;
 raise exception 'Unknown studio action';
end $function$
