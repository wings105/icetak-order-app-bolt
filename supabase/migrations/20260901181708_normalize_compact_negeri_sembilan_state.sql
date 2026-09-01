-- Accept common compact spelling from customer-entered Malaysian addresses.
create or replace function public.normalize_malaysia_state(p_value text)
returns text
language sql
immutable
strict
set search_path to ''
as $function$
  select case
    when strpos(lower(p_value), 'putrajaya') > 0 then 'Wilayah Persekutuan Putrajaya'
    when strpos(lower(p_value), 'labuan') > 0 then 'Wilayah Persekutuan Labuan'
    when strpos(lower(p_value), 'kuala lumpur') > 0 or lower(btrim(p_value, ' .,')) in ('kl','w.p. kl','wp kl') then 'Wilayah Persekutuan Kuala Lumpur'
    when strpos(lower(p_value), 'negeri sembilan') > 0
      or strpos(lower(p_value), 'n. sembilan') > 0
      or strpos(lower(p_value), 'n.sembilan') > 0 then 'Negeri Sembilan'
    when strpos(lower(p_value), 'pulau pinang') > 0 or strpos(lower(p_value), 'penang') > 0 then 'Pulau Pinang'
    when strpos(lower(p_value), 'johor') > 0 then 'Johor'
    when strpos(lower(p_value), 'kedah') > 0 then 'Kedah'
    when strpos(lower(p_value), 'kelantan') > 0 then 'Kelantan'
    when strpos(lower(p_value), 'melaka') > 0 or strpos(lower(p_value), 'malacca') > 0 then 'Melaka'
    when strpos(lower(p_value), 'pahang') > 0 then 'Pahang'
    when strpos(lower(p_value), 'perak') > 0 then 'Perak'
    when strpos(lower(p_value), 'perlis') > 0 then 'Perlis'
    when strpos(lower(p_value), 'sabah') > 0 then 'Sabah'
    when strpos(lower(p_value), 'sarawak') > 0 then 'Sarawak'
    when strpos(lower(p_value), 'selangor') > 0 then 'Selangor'
    when strpos(lower(p_value), 'terengganu') > 0 or strpos(lower(p_value), 'trengganu') > 0 then 'Terengganu'
    else null
  end
$function$;
