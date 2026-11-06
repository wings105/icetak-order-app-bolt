DO $$declare s text;begin
 select pg_get_functiondef('public.icetak_ai_qc(text,uuid,uuid,jsonb)'::regprocedure) into s;
 s:=replace(s,'select * into r from render_qc.runs where id=p_id for update;','select * into r from render_qc.runs where id=p_id for update; if not found then return jsonb_build_object(''saved'',false);end if;');
 execute s;
 select pg_get_functiondef('public.icetak_ai_qc_audit(uuid,uuid,jsonb)'::regprocedure) into s;
 s:=replace(s,'select * into r from render_qc.runs where id=p_id for update;','select * into r from render_qc.runs where id=p_id for update; if not found then return false;end if;');
 s:=replace(s,'p_data->>''state''<>''PASS'' or length(p_data->>''output_sha'')<>64 or length(p_data->>''source_fingerprint'')<>64','(p_data->>''state'') is distinct from ''PASS'' or coalesce(p_data->>''output_sha'','''')!~''^[a-f0-9]{64}$'' or coalesce(p_data->>''source_fingerprint'','''')!~''^[a-f0-9]{64}$''');
 execute s;
end $$;
