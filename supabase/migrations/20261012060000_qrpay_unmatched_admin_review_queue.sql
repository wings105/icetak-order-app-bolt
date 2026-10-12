-- Queue unmatched QRPay notifications for human-reviewed recommendations.
create trigger trg_queue_qrpay_admin_review after insert on public.unmatched_payment_transactions for each row execute function public.queue_qrpay_ai_job();
