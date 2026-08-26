-- QRPay safety hotfix: an unmatched bank notification is never proof of which
-- order/draft it belongs to. Only an active, exact payment_session created by
-- checkout may complete payment automatically. Everything else stays queued
-- for review and may be proposed by the AI worker, but cannot change money,
-- fulfilment, or customer notification state.

create or replace function public.icetak_auto_reconcile_unmatched_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Keep the unmatched row intact for the QRPay AI/review queue trigger.
  -- In particular: no amount-only fallback, no phone+amount auto-link, and no
  -- invocation of any manual-match function from this trigger.
  return new;
end;
$function$;

create or replace function public.icetak_try_attach_qrpay_job_to_existing_draft(
  p_job_id uuid,
  p_internal_token text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_expected text;
begin
  select setting_value into v_expected
  from public.private_runtime_settings
  where setting_key = 'qrpay_ai_worker_token';

  if v_expected is null or p_internal_token is distinct from v_expected then
    raise exception 'Unauthorized qrpay AI worker';
  end if;

  if not exists (select 1 from public.qrpay_ai_jobs where id = p_job_id) then
    raise exception 'qrpay_ai_job_not_found';
  end if;

  -- A conversation/phone/amount result is only a candidate. The worker must
  -- create an admin-review proposal; it must not mark an existing draft paid,
  -- attach a payment transaction, reject another draft, or notify a customer.
  return jsonb_build_object(
    'success', true,
    'attached', false,
    'reason', 'automatic_existing_draft_attach_disabled',
    'job_id', p_job_id
  );
end;
$function$;

comment on function public.icetak_auto_reconcile_unmatched_payment() is
  'Fail-closed QRPay trigger. Unmatched payments are review-only; only payment-session webhook matching may settle payment.';

comment on function public.icetak_try_attach_qrpay_job_to_existing_draft(uuid, text) is
  'Fail-closed QRPay AI candidate guard. Existing draft attachment requires explicit admin confirmation.';