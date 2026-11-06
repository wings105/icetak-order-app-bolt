begin;
DO $$declare t text;r jsonb;lease uuid;rev int;fid uuid;decision text;runid uuid;begin
 if has_schema_privilege('authenticated','render_qc','USAGE') or has_function_privilege('anon','public.icetak_designflow_sync(text,text,uuid,int,uuid,jsonb)','EXECUTE') then raise exception 'FIELD_SYNC_EXPOSED';end if;
 select task_id into t from render_qc.runs where state='PASS' order by created_at desc limit 1;if t is null then raise exception 'Verified pilot fixture required';end if;
 perform render_qc.queue_field(t,'render');
 select revision,field_id into rev,fid from render_qc.field_sync where task_id=t and option_name='Render ai';
 perform render_qc.queue_field(t,'render');if (select revision from render_qc.field_sync where task_id=t and field_id=fid)<>rev then raise exception 'DUPLICATE_REQUEUED';end if;
 update render_qc.field_sync set state='queued',next_at='2000-01-01',updated_at='2000-01-01',attempts=0,lease=null,lease_until=null where task_id=t and field_id=fid;
 r:=public.icetak_designflow_sync('claim');lease=(r->>'lease')::uuid;if r->>'task_id'<>t then raise exception 'WRONG_CLAIM';end if;
 if public.icetak_designflow_sync('check',t,fid,rev,gen_random_uuid())->>'valid'<>'false' then raise exception 'STALE_LEASE_ACCEPTED';end if;
 if public.icetak_designflow_sync('check',t,fid,rev,lease)->>'valid'<>'true' then raise exception 'VALID_SOURCE_REJECTED';end if;
 update render_qc.field_sync set revision=revision+1 where task_id=t and field_id=fid;
 if public.icetak_designflow_sync('ack',t,fid,rev,lease,'{"ok":true}')->>'saved'<>'false' then raise exception 'OLDER_RESULT_ACCEPTED';end if;
 select id into runid from render_qc.runs where task_id=t order by created_at desc limit 1;
 foreach decision in array array['HOLD','FAIL','RETRY','released','PASS'] loop
  update render_qc.runs set state=decision where id=runid;
  if (select option_name from render_qc.field_sync where task_id=t and field_id='4cdb78bd-4fc4-4fd6-a1dd-5b6b01ea4110') is distinct from (case decision when 'released' then 'Ai QC pass' else 'Ai QC '||lower(decision) end) then raise exception 'QC_TRIGGER_MAPPING_FAILED';end if;
 end loop;
end $$;
rollback;
