-- Foreign-key indexes found by the post-deploy Finance performance check.
create index if not exists finance_classification_rules_target_idx
  on finance.classification_rules(target_account_id);
create index if not exists finance_reconciliation_raw_event_idx
  on finance.reconciliation_cases(raw_event_id)
  where raw_event_id is not null;
create index if not exists finance_transactions_classification_idx
  on finance.transactions(classification_account_id)
  where classification_account_id is not null;
create index if not exists finance_transactions_duplicate_idx
  on finance.transactions(duplicate_of_transaction_id)
  where duplicate_of_transaction_id is not null;
