-- Unified Inbox only. A delayed status echo from the external-runner period
-- must not become a new native action when an admin enables a rule.
create function wa_automation.set_activation_boundary() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.mode='native' and old.mode<>'native' then
  new.activated_at:=clock_timestamp();
 end if;
 return new;
end $$;
revoke all on function wa_automation.set_activation_boundary() from public,anon,authenticated;
grant execute on function wa_automation.set_activation_boundary() to service_role;
create trigger wa_rule_activation_boundary before update on wa_automation.rules
 for each row execute function wa_automation.set_activation_boundary();

-- Reconcile rules activated before this guard to their actual most recent
-- native transition, preserving every genuine post-cutover message.
with boundaries as (
 select r.id,r.activated_at as previous_boundary,max(e.created_at) as boundary
 from wa_automation.rules r join wa_automation.events e on e.rule_id=r.id
 where r.mode='native' and e.event='rule_saved'
  and e.data#>>'{after,mode}'='native'
  and e.data#>>'{before,mode}'<>'native'
 group by r.id,r.activated_at
), changed as (
 update wa_automation.rules r set activated_at=b.boundary
 from boundaries b where r.id=b.id and b.boundary>r.activated_at
 returning r.id,b.previous_boundary,r.activated_at
)
insert into wa_automation.events(rule_id,event,actor,data)
 select id,'activation_boundary_set','migration',jsonb_build_object(
  'previous_boundary',previous_boundary,'activated_at',activated_at) from changed;
