begin;
DO $$declare lease uuid; r jsonb; key text; runid uuid=gen_random_uuid(); t text; begin
 select task_id into t from render_qc.runs where state='PASS' and rules_version=3 order by created_at desc limit 1;
 if t is null then raise exception 'A verified pilot fixture is required';end if;
 if has_schema_privilege('anon','render_qc','USAGE') or has_schema_privilege('authenticated','render_qc','USAGE') then raise exception 'PRIVATE_SCHEMA_EXPOSED';end if;
 if has_function_privilege('anon','public.icetak_ai_qc(text,uuid,uuid,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.icetak_ai_qc_audit(uuid,uuid,jsonb)','EXECUTE') then raise exception 'RPC_EXPOSED';end if;
 if (select count(*) from render_qc.runs where task_id=t and rules_version=3)<>1 then raise exception 'CANARY_DEDUP';end if;
 if render_qc.enqueue(t,true) is not null then raise exception 'QUEUE_DUPLICATED';end if;
 select md5(jsonb_build_array(task_id,source_hash,filename,attachment_id)::text)||':999' into key from render_auto.jobs where task_id=t;
 insert into render_qc.runs(id,task_id,job_key,rules_version,created_at) values(runid,t,key,999,'2000-01-01');
 r:=public.icetak_ai_qc('claim');if r#>>'{run,id}'<>runid::text then raise exception 'CLAIM_NOT_ISOLATED';end if;lease=(r#>>'{run,lease}')::uuid;
 if public.icetak_ai_qc('record',runid,gen_random_uuid(),'{"state":"PASS"}')->>'saved'<>'false' then raise exception 'STALE_LEASE_ACCEPTED';end if;
 if (select state from render_qc.runs where id=runid)<>'processing' then raise exception 'STALE_WRITE';end if;
 update render_qc.runs set job_key='changed' where id=runid;
 r:=public.icetak_ai_qc('record',runid,lease,'{"state":"PASS"}');if r->>'state'<>'HOLD' then raise exception 'CHANGED_OUTPUT_APPROVED';end if;
 if not exists(select 1 from render_qc.events where run_id=runid and state='HOLD') then raise exception 'AUDIT_MISSING';end if;
 if (select auto_release from render_qc.settings where id) then raise exception 'PILOT_RELEASE_ENABLED';end if;
end $$;
rollback;
