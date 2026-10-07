-- Service-only, token-scoped choice for an already converted Cash at Counter draft.
-- No master activation, historical backfill or notification enqueue.
create or replace function public.icetak_set_cash_draft_whatsapp_choice(
  p_review_token text,
  p_enabled boolean,
  p_actor text default 'admin-link'
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  d public.qrpay_order_drafts%rowtype;
  o public.orders%rowtype;
  changed boolean;
begin
  if p_enabled is null then raise exception 'whatsapp_choice_required'; end if;
  select * into d from public.qrpay_order_drafts where review_token=p_review_token for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.payment_mode not in ('cash_counter','cash_at_counter') then raise exception 'cash_counter_draft_required'; end if;
  if d.status<>'confirmed' or d.order_id is null then raise exception 'confirmed_cash_order_required'; end if;
  select * into o from public.orders where id=d.order_id for update;
  if not found or o.source is distinct from 'draft_engine' or o.external_order_id is distinct from 'draft:'||d.id::text then
    raise exception 'draft_order_mismatch';
  end if;
  if public.icetak_order_is_cancelled(o.id) then raise exception 'order_cancelled'; end if;
  changed := o.whatsapp_opt_in is distinct from p_enabled
    or d.working_draft->>'notify_whatsapp' is distinct from p_enabled::text
    or (d.confirmed_draft is not null and d.confirmed_draft->>'notify_whatsapp' is distinct from p_enabled::text);
  if changed then
    update public.qrpay_order_drafts set
      working_draft=jsonb_set(coalesce(working_draft,'{}'::jsonb),'{notify_whatsapp}',to_jsonb(p_enabled)),
      confirmed_draft=case when confirmed_draft is null then null else jsonb_set(confirmed_draft,'{notify_whatsapp}',to_jsonb(p_enabled)) end,
      version=version+1,updated_at=now()
    where id=d.id;
    update public.orders set whatsapp_opt_in=p_enabled,updated_at=now()
      where id=o.id and whatsapp_opt_in is distinct from p_enabled;
    insert into public.qrpay_order_draft_events(draft_id,event_type,actor,metadata)
    values(d.id,'cash_whatsapp_choice',p_actor,jsonb_build_object(
      'enabled',p_enabled,'previous_order_opt_in',o.whatsapp_opt_in,'order_id',o.id
    ));
  end if;
  if not p_enabled then
    -- Existing opt-out trigger cancels the automatic lifecycle/ready/tracking queue.
    -- This manual pickup-link event must also stop if it was already pending.
    update public.notification_queue set status='skipped',processed_at=now(),locked_at=null,
      decision_mode='skipped',decision_reason='order_whatsapp_opted_out',last_error=null
    where order_id=o.id and event_type='pickup_order_confirmed' and status in ('pending','processing');
  end if;
  return jsonb_build_object('ok',true,'changed',changed,'order_id',o.id,'notify_whatsapp',p_enabled);
end;
$function$;
revoke all on function public.icetak_set_cash_draft_whatsapp_choice(text,boolean,text) from public,anon,authenticated;
grant execute on function public.icetak_set_cash_draft_whatsapp_choice(text,boolean,text) to service_role;
