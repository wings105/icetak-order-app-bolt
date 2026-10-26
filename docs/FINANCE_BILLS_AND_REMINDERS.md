# Finance Bills & Reminders

Status: backend ACTIVE / controlled full Admin UI VERIFIED; production frontend publication is awaiting owner approval. Source based on `production@75aafb5`.

## Operator flow

Admin V2 → Finance → **Bills & Reminders**. Finance remains restricted to the existing owner and `view_finance` / `manage_finance` permissions.

- **Bills**: create a supplier invoice or an amount-free internal check. New records start as drafts. Approve an invoice to recognize its expense/payable; approve a check to activate it. Edit drafts; use a reasoned void for approved corrections.
- **Recurring**: monthly, quarterly or yearly rules prepare occurrences up to 31 days ahead. Bills remain drafts for review; checks activate automatically. Short months clamp the requested cycle day without losing its original anchor. Pause/resume affects future notices for linked bills. Existing occurrences retain their original details when a rule changes.
- **Suppliers**: reusable names, email, phone and notes. Invoice numbers are unique per supplier except voided records. Names are matched case-insensitively; existing supplier names are not silently renamed.
- **Payments**: record actual external payments against an approved invoice. Amount/date/method/reference and a cash/bank/wallet account are required. Partial/full settlement, replay-safe payment request keys and reasoned reversal are supported. The UI does not move bank funds.
- **Bank feed**: choose an existing Finance transaction ID if its cash movement is already imported. Only a posted outgoing expense-classified MYR transaction without order/duplicate conflicts can be allocated. This avoids a second bank movement and reverses only the allocated portion of its original expense into payables. Active allocations block changing that transaction's amount, classification, account or status elsewhere.
- **Controls**: outstanding, overdue and next-seven-day totals, five ageing bands, server filtering/paging, page-labelled CSV export, exact-bill payment history, and actor/action audit.

## Accounting contract

This release supports MYR supplier payables. Drafts and amount-free checks create no accounting entry. Approval posts debit expense (subtotal plus tax) / credit supplier payable. No recoverable tax is assumed. Manual payment posts debit payable / credit bank; existing bank-feed allocation posts debit payable / credit the previously recognized expense. Every operation checks available bill/transaction balance and closed accounting periods. Reversals preserve journal/payment records and audit state. No historical bank data is backfilled and no existing bill is assumed paid.

Private tables: `finance.bill_suppliers`, `bill_schedules`, `bills`, `bill_payments`, `bill_reminder_runs`, `billing_settings`. They have RLS and no browser grants. Public RPC facades are SECURITY INVOKER and service-only; `finance-admin` first validates the actual user and existing owner permissions, then derives the audit actor server-side. No service credential is exposed in the frontend.

## Native reminder contract

`icetak-finance-billing-hourly` runs `finance.billing_tick()` through Supabase Cron. Calendar dates and send-hour checks use Asia/Kuala_Lumpur. The default is 09:00. The requested provider billing check has been configured privately for the 24th, with Wise as its payment method and no invented invoice amount. Owner-specific billing portal identifiers and recipient settings are not distributed in source. The previous ChatGPT automation is paused.

The scheduler generates occurrences, then sends one advance notice and one due-date notice (or only the due notice when days-before is zero), each with a stable unique key. It uses the existing admin recipient setting and existing transactional notification queue/sender/Inbox mirror. No alternate direct provider sender is introduced. Reminder history distinguishes **API accepted** from final delivery; inspect the matching provider message in Unified Inbox for delivered/read/failed evidence.

Billing pause, rule pause, paid/void/checked state and the WhatsApp master/session controls are enforced. A closed admin chat window creates a visible blocked run, with hourly recovery while eligible (through seven days after the due date). A queue cancelled before provider dispatch solely because its window expired is recovered as the same unsent job. There is no approved billing-specific closed-window template in this release; the scheduler does not repurpose order/OTP templates or bypass the window. Missing sender/recipient settings remain blocked. Provider failures are not blindly resent as old notices.

## Verification

- `supabase/tests/finance_billing.test.sql`: native rolled-back tests for draft/approval, balanced journals, replay, partial/full payment, overpayment rejection, undo/void, bank-feed reclassification, allocation mutation guards, amount-free checks, master guard, recurrence/anchor handling, reminder deduplication/recovery, exact payment history, RLS and service-only RPCs. No QA financial/queue rows retained.
- `node scripts/test-finance-billing.mjs`: ten actual-gateway/sender cases for owner/read-only/no-auth boundaries, trusted actor, master/closed-bill/window guards and no-send preview.
- Existing 28 pickup payment regressions, WhatsApp opt-out and Inbox log-only mirroring checks pass.
- Storefront + Inbox and standalone Admin TypeScript/build checks pass (existing bundle-size warnings remain).
- Actual production Admin bundle with isolated transport passes 1440×1000 and 390×844 creation, partial payment, history, recurring edit/pause, supplier, blocked-log, settings and search interactions; read-only controls are absent. No page errors or document overflow. Browser plugin unavailable; regular Playwright uses official Chrome headless shell. No real customer messages or payments are generated by UI fixtures.
- Deployed `finance-admin` v39, `whatsapp-send` v31 and `whatsapp-dispatch` v20 match reviewed source and preserve their existing in-code authentication. Unauthenticated hosted Finance returns 403.
- Security advisors add only six informational private-table RLS/no-policy findings, matching the service-only private-schema design. No new error/warning findings.

Pending: owner approval to publish the prepared frontend to the existing public repository; signed-in hosted operator acceptance and the first scheduled monthly provider delivery. A successful backend deployment/build is not reported as hosted UI completion.
