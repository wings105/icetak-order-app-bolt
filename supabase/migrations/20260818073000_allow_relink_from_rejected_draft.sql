-- Rejected AI drafts retain payment history for audit but must not block relinking the same QRPay to an active draft.
alter table public.qrpay_order_drafts
  drop constraint if exists qrpay_order_drafts_transaction_id_key;

drop index if exists public.qrpay_order_drafts_transaction_id_key;

create unique index qrpay_order_drafts_active_transaction_id_uidx
  on public.qrpay_order_drafts(transaction_id)
  where transaction_id is not null
    and status <> 'rejected';
