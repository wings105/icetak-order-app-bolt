-- Feature-specific FK indexes reported by Supabase performance advisor.
create index if not exists admin_order_reviews_draft_id_idx
  on public.admin_order_reviews(draft_id) where draft_id is not null;
create index if not exists qrpay_ai_corrections_learning_rule_id_idx
  on public.qrpay_ai_corrections(learning_rule_id) where learning_rule_id is not null;
create index if not exists qrpay_order_drafts_unmatched_payment_id_idx
  on public.qrpay_order_drafts(unmatched_payment_id) where unmatched_payment_id is not null;
create index if not exists qrpay_order_drafts_order_id_idx
  on public.qrpay_order_drafts(order_id) where order_id is not null;
