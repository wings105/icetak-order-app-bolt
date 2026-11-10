alter table acrylic_auto.settings add column if not exists ready boolean not null default false;
do $$ declare f text; begin
 f:=pg_get_functiondef('public.icetak_acrylic_auto_settings(boolean)'::regprocedure);
 f:=replace(f,'if p_enabled is not null then','if p_enabled is not null then
  if p_enabled and not (select ready from acrylic_auto.settings where singleton) then raise exception ''INSTALLATION_NOT_READY'';end if;');
 f:=replace(f,'''enabled'',s.enabled,','''enabled'',s.enabled,''ready'',s.ready,');execute f;
 f:=pg_get_functiondef('public.icetak_acrylic_auto_worker(text,jsonb)'::regprocedure);
 f:=replace(f,'select * into j from acrylic_auto.jobs where task_id=p_data->>''task_id''','if p_action=''reserve'' then select * into s from acrylic_auto.settings where singleton for update;end if;
 select * into j from acrylic_auto.jobs where task_id=p_data->>''task_id''');
 f:=replace(f,'next_attempt_at=case when patch->>''retry''=''true'' then now()+interval ''10 minutes'' else now() end','next_attempt_at=case when patch->>''defer''=''true'' then (date_trunc(''day'',now() at time zone ''Asia/Kuala_Lumpur'')+interval ''1 day'') at time zone ''Asia/Kuala_Lumpur'' when patch->>''retry''=''true'' then now()+interval ''10 minutes'' else now() end');
 execute f;
end $$;
