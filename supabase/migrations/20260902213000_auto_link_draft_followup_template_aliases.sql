-- Keep Meta template names unchanged while linking follow-up rules by a
-- normalized key (draft_followup_2 = draft_followup2).
create or replace function public.icetak_link_draft_followup_template_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_name text;
begin
  event_name := case
    when lower(regexp_replace(new.name, '[^a-z0-9]', '', 'g')) in ('draftfollowup1','draftfollowup01') then 'draft_followup_1'
    when lower(regexp_replace(new.name, '[^a-z0-9]', '', 'g')) in ('draftfollowup2','draftfollowup02') then 'draft_followup_2'
    when lower(regexp_replace(new.name, '[^a-z0-9]', '', 'g')) in ('draftfollowup3','draftfollowup03') then 'draft_followup_3'
    else null
  end;

  if event_name is not null then
    update public.whatsapp_notification_rules
    set template_name = new.name,
        template_language = coalesce(nullif(new.language, ''), 'ms'),
        updated_at = now()
    where event_type = event_name;
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_templates_auto_link_draft_followup on public.whatsapp_templates;
create trigger whatsapp_templates_auto_link_draft_followup
after insert or update of name, language on public.whatsapp_templates
for each row execute function public.icetak_link_draft_followup_template_alias();

-- Also repair any templates already synced before this migration.
update public.whatsapp_notification_rules r
set template_name = t.name,
    template_language = coalesce(nullif(t.language, ''), 'ms'),
    updated_at = now()
from public.whatsapp_templates t
where r.event_type in ('draft_followup_1','draft_followup_2','draft_followup_3')
  and lower(regexp_replace(t.name, '[^a-z0-9]', '', 'g')) =
      lower(regexp_replace(r.event_type, '[^a-z0-9]', '', 'g'));

revoke all on function public.icetak_link_draft_followup_template_alias() from public, anon, authenticated;
grant execute on function public.icetak_link_draft_followup_template_alias() to service_role;
