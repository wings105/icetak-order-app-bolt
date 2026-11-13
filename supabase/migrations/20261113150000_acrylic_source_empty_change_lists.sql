-- Missing and empty change lists mean the same thing. Preserve all content,
-- confirmation, eligibility, lease and duplicate-generation guards.
DO $migration$
DECLARE d text; changed text; absent text; empty_value text; nonempty text;
BEGIN
  SELECT pg_get_functiondef('acrylic_auto.source(text)'::regprocedure) INTO d;
  IF position('''updates'',j.brief->''message_updates'',''pending'',j.brief->''pending_change_ids''' in d)=0 THEN
    RAISE EXCEPTION 'Unexpected acrylic source definition; inspect before applying';
  END IF;
  changed := replace(d, '''updates'',j.brief->''message_updates'',''pending'',j.brief->''pending_change_ids''', '''updates'',nullif(j.brief->''message_updates'',''[]''::jsonb),''pending'',nullif(j.brief->''pending_change_ids'',''[]''::jsonb)');
  SELECT md5(jsonb_build_object('updates',nullif('{}'::jsonb->'updates','[]'::jsonb),'pending',nullif('{}'::jsonb->'pending','[]'::jsonb))::text) INTO absent;
  SELECT md5(jsonb_build_object('updates',nullif('[]'::jsonb,'[]'::jsonb),'pending',nullif('[]'::jsonb,'[]'::jsonb))::text) INTO empty_value;
  SELECT md5(jsonb_build_object('updates',nullif('[{"wording":"changed"}]'::jsonb,'[]'::jsonb),'pending',nullif('[]'::jsonb,'[]'::jsonb))::text) INTO nonempty;
  IF absent <> empty_value OR absent = nonempty THEN RAISE EXCEPTION 'Fingerprint normalization regression'; END IF;
  EXECUTE changed;
END
$migration$;
