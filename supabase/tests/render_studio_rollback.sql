begin;
do $$
declare t public.render_templates; d jsonb; payload jsonb; j jsonb; k jsonb; v jsonb; before_events int;
begin
 perform public.icetak_render_studio('list');
 perform public.icetak_render_studio('fonts');
 select * into strict t from public.render_templates where sku='YS0315';
 t.sku:='ZZ_STUDIO_QA';
 insert into public.render_templates(sku,image_path,font_path,config,version,updated_by) values(t.sku,t.image_path,t.font_path,t.config,t.version,'native-rollback-qa');
 if exists(select 1 from render_studio.drafts where sku=t.sku) then raise exception 'QA expects no existing selected draft';end if;
 select count(*) into before_events from public.render_template_events where sku=t.sku;
 payload:=jsonb_build_object('raw_path',t.image_path,'reference_path',t.image_path,'config',t.config,'values',jsonb_build_object('name','Fixture Name','greeting','HAPPY BIRTHDAY'));
 d:=public.icetak_render_studio('save',t.sku,'native-rollback-qa',payload,0);
 if (select version from public.render_templates where sku=t.sku)<>t.version then raise exception 'Draft changed live version';end if;
 begin
  perform public.icetak_render_studio('save',t.sku,'native-rollback-qa',payload||'{"instructions":"stale"}',0);
  raise exception 'Expected stale rejection';
 exception when others then if sqlerrm not like 'DRAFT_CHANGED:%' then raise;end if;end;
 begin
  perform public.icetak_render_studio('publish',t.sku,'native-rollback-qa','{}',1);
  raise exception 'Expected confirmation rejection';
 exception when others then if sqlerrm<>'Confirmation required' then raise;end if;end;
 j:=public.icetak_render_studio('queue',t.sku,'native-rollback-qa','{}',1);
 k:=public.icetak_render_studio('queue',t.sku,'native-rollback-qa','{}',1);
 if j->>'id'<>k->>'id' then raise exception 'Duplicate AI jobs';end if;
 j:=public.icetak_render_studio('claim');
 if j->>'sku'<>t.sku then raise exception 'Other pending job; abort selected QA';end if;
 d:=public.icetak_render_studio('save',t.sku,'native-rollback-qa',payload||'{"instructions":"new revision"}',1);
 v:=public.icetak_render_studio('complete','', '',jsonb_build_object('id',j->'id','lease',j->'lease','result',jsonb_build_object('values',jsonb_build_object('name','Wrong stale name'))),0);
 if coalesce((v->>'superseded')::boolean,false) is not true then raise exception 'Stale AI not rejected';end if;
 if (select rd.data#>>'{values,name}' from render_studio.drafts rd where sku=t.sku)<>'Fixture Name' then raise exception 'Stale result changed draft';end if;
 j:=public.icetak_render_studio('queue',t.sku,'native-rollback-qa','{}',2);
 j:=public.icetak_render_studio('claim');
 v:=public.icetak_render_studio('complete','','',jsonb_build_object('id',j->'id','lease',j->'lease','result',jsonb_build_object('config',t.config,'values',jsonb_build_object('name','Fixture Name','greeting','HAPPY BIRTHDAY'),'analysis',jsonb_build_object('origin','ai'))),0);
 if coalesce((v->>'saved')::boolean,false) is not true then raise exception 'Accepted result not saved';end if;
 if not (select rd.data ?& array['raw_path','reference_path','config','instructions'] from render_studio.drafts rd where sku=t.sku) then raise exception 'Accepted AI result lost source context';end if;
 v:=public.icetak_render_studio('publish',t.sku,'native-rollback-qa','{"confirmed":true}',3);
 if (v->>'version')::int<>t.version+1 then raise exception 'Wrong publication version';end if;
 k:=public.icetak_render_studio('publish',t.sku,'native-rollback-qa','{"confirmed":true}',3);
 if k->>'version'<>v->>'version' then raise exception 'Duplicate publication';end if;
 if (select count(*) from public.render_template_events where sku=t.sku)<>before_events+1 then raise exception 'Duplicate publication event';end if;
 v:=public.icetak_render_studio('pause',t.sku,'native-rollback-qa');
 if (v#>>'{config,automation,enabled}')::boolean then raise exception 'Pause failed';end if;
 if has_function_privilege('anon','public.icetak_render_studio(text,text,text,jsonb,integer)','EXECUTE') or has_function_privilege('authenticated','public.icetak_render_studio(text,text,text,jsonb,integer)','EXECUTE') or has_schema_privilege('authenticated','render_studio','USAGE') then raise exception 'Private schema exposed';end if;
end $$;
rollback;
select 'Native draft isolation / revision / queue / publication / pause / ACL checks passed; all mutations rolled back' as verification;
