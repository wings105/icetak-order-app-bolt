-- Stop unmatched QRPay transactions from creating speculative AI drafts.
--
-- The canonical auto-reconcile trigger remains active:
--   zz_auto_reconcile_unmatched_payment
-- It links only a unique exact-amount eligible draft/order match and otherwise
-- leaves the payment unmatched for manual review.
--
-- Chat-driven order drafting remains available through its own explicit trigger
-- path; a payment signal alone must never create a new order draft.

begin;

drop trigger if exists unmatched_payment_queue_qrpay_ai
  on public.unmatched_payment_transactions;

comment on function public.queue_qrpay_ai_job() is
  'Legacy QRPay AI job queue function. Automatic invocation from unmatched payments was disabled on 2026-09-06 because ambiguous/unmatched payments must fail closed and must not create speculative drafts.';

commit;
