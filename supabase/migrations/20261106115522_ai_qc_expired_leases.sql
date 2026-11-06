update render_qc.settings set rules_version=3 where id;
create or replace function render_qc.dispatch() returns bigint language plpgsql security invoker set search_path='' as $$declare req bigint;t text;begin
 with exhausted as(update render_qc.runs set state='HOLD',lease=null,lease_until=null,result=jsonb_build_object('state','HOLD','reason','QC_ATTEMPTS_EXHAUSTED'),updated_at=now() where attempts>=3 and (state='RETRY' or state='processing' and lease_until<now()) returning id,result)
 insert into render_qc.events(run_id,state,result) select id,'HOLD',result from exhausted;
 if not exists(select 1 from render_qc.settings where id and enabled) then return null;end if;
 if not exists(select 1 from render_qc.runs where (state in ('queued','RETRY') or state='processing' and lease_until<now()) and next_at<=now() and attempts<3) then return null;end if;
 select setting_value into t from public.private_runtime_settings where setting_key='order_brief_worker_token';
 select net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/ai-qc',headers:=jsonb_build_object('Content-Type','application/json','x-order-brief-token',t),body:='{"action":"run"}',timeout_milliseconds:=120000) into req;return req;
end $$;
