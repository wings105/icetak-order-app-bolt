do $repair$
declare definition text;
begin
 select pg_get_functiondef('public.icetak_clean_draft_address_v14(jsonb)'::regprocedure) into definition;
 if strpos(definition,'-- Repair unambiguous reversed city/state fields.')=0 then
 definition:=replace(definition,E'begin\n  state:=',E'begin\n  -- Repair unambiguous reversed city/state fields.\n  if lower(btrim(state)) not in (\'johor\',\'kedah\',\'kelantan\',\'melaka\',\'malacca\',\'negeri sembilan\',\'pahang\',\'perak\',\'perlis\',\'pulau pinang\',\'penang\',\'sabah\',\'sarawak\',\'selangor\',\'terengganu\',\'kuala lumpur\',\'labuan\',\'putrajaya\')\n     and lower(btrim(city)) in (\'johor\',\'kedah\',\'kelantan\',\'melaka\',\'malacca\',\'negeri sembilan\',\'pahang\',\'perak\',\'perlis\',\'pulau pinang\',\'penang\',\'sabah\',\'sarawak\',\'selangor\',\'terengganu\',\'kuala lumpur\',\'labuan\',\'putrajaya\')\n     and public.normalize_malaysia_state(state) is null\n     and length(btrim(state)) >= 2 then\n    state_key:=city; city:=state; state:=state_key;\n  end if;\n  state:=');
 if strpos(definition,'-- Repair unambiguous reversed city/state fields.')=0 then raise exception 'Address normalizer patch target missing'; end if;
 execute definition;
 end if;
end;
$repair$;