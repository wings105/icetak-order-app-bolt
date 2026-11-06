alter table render_qc.settings add column rules_version int not null default 2;
alter table render_qc.runs add column rules_version int not null default 1;
create or replace function render_qc.enqueue(p_task text,p_selected boolean default false) returns uuid language plpgsql security invoker set search_path='' as $$
declare j render_auto.jobs;r uuid;v int;
begin
 select * into j from render_auto.jobs where task_id=p_task and state='completed' and attachment_id is not null;
 if not found or (not p_selected and j.updated_at<(select rollout_at from render_qc.settings where id)) then return null;end if;
 if j.brief->>'sku' not in ('YS0312','YS0315') then return null;end if;
 select rules_version into v from render_qc.settings where id;
 insert into render_qc.runs(task_id,job_key,rules_version) values(p_task,md5(jsonb_build_array(j.task_id,j.source_hash,j.filename,j.attachment_id)::text)||':'||v,v) on conflict(job_key) do nothing returning id into r;
 return r;
end $$;
DO $$declare s text;begin
 select pg_get_functiondef('public.icetak_ai_qc(text,uuid,uuid,jsonb)'::regprocedure) into s;
 s:=replace(s,'r.job_key is distinct from md5(jsonb_build_array(j.task_id,j.source_hash,j.filename,j.attachment_id)::text)','r.job_key is distinct from (md5(jsonb_build_array(j.task_id,j.source_hash,j.filename,j.attachment_id)::text)||'':''||r.rules_version)');
 execute s;
end $$;
create function public.icetak_ai_qc_audit(p_id uuid,p_lease uuid,p_data jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare r render_qc.runs;s jsonb;
begin
 select * into r from render_qc.runs where id=p_id for update;
 if r.state<>'processing' or r.lease is distinct from p_lease or r.lease_until<now() then return false;end if;
 if p_data->>'state'<>'PASS' or length(p_data->>'output_sha')<>64 or length(p_data->>'source_fingerprint')<>64 then raise exception 'INVALID_QC_APPROVAL';end if;
 s:=public.icetak_ai_qc_source(r.task_id);
 if s->>'valid'<>'true' or s#>>'{job,attachment_id}' is distinct from p_data->>'attachment_id' or s#>>'{template,version}' is distinct from p_data->>'template_version' then return false;end if;
 update render_qc.runs set result=p_data,updated_at=now() where id=p_id;
 insert into render_qc.events(run_id,state,result) values(p_id,'PASS',p_data);
 return true;
end $$;
revoke all on function public.icetak_ai_qc_audit(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_ai_qc_audit(uuid,uuid,jsonb) to service_role;
