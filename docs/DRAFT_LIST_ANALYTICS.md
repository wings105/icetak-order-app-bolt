# Draft Orders list and analysis

Backend and frontend delivery PRODUCTION; rendered workflows VERIFIED in controlled desktop/mobile tests. Authenticated hosted owner interaction remains unexercised.

Admin V2 Draft Orders defaults to List view. Card view retains the existing draft actions; Graf view adds sent-outcome bars, cancelled-reason bars, a stacked time trend and source conversion comparison. A reason bar opens the filtered list. Details expands the existing card without changing draft lifecycle contracts. Converted rows link to their canonical order and do not expose draft payment/cancellation mutations.

## Period and cohort contract

Day, Week and Month accept a reference date, previous/next navigation and Semasa. All boundaries use Asia/Kuala_Lumpur. Weeks are Monday–Sunday; ranges include the first day and exclude midnight after the last day. Day trend has 24 hourly buckets; week/month use daily buckets including zero days.

Asas tarikh defaults to Draft dibuat: select drafts by created_at in the period, then show their **current** outcome. Dihantar ke customer instead selects the stored customer_link_sent_at in the period. This is a cohort report, not a count of payments/cancellations occurring during the selected period. A recent cohort can still convert later. Resends use the current stored send timestamp; this report does not reconstruct earlier dispatch history.

Each draft is counted once, including converted drafts previously absent from the active-draft endpoint. Sent means customer_link_sent_at is recorded; missing legacy send timestamps remain Belum dihantar, without inferred/backfilled delivery claims.

| Metric | Definition / percentage denominator |
|---|---|
| Jumlah draft | Every draft matching the period and filters |
| Dihantar | Recorded send timestamp; % of all matched drafts |
| Closed sales | Sent draft linked to an existing noncancelled canonical order whose payment_status is paid; % of sent drafts |
| Cancelled selepas hantar | Sent draft rejected, or linked to a cancelled/voided canonical order; % of sent drafts |
| Belum closed | Sent draft with neither closed nor cancelled outcome; % of sent drafts |
| Cancelled keseluruhan | Cancelled sent and unsent drafts; reason-bar % uses this total |
| Order belum bayar | Converted order without paid status, reported separately and never counted as closed sales |

Closed + cancelled + belum closed partitions the sent cohort. Display percentages round to one decimal, so independently rounded values may differ slightly from 100%. An empty denominator displays —. Cancelled canonical orders use the separate reason Order selepas conversion dibatalkan; missing draft reasons use Sebab tidak direkodkan. Shopee cancellations keep their existing reason and exact Order ID, rather than being counted as a direct paid sale.

Search and source/status/payment-flow/delivery/reason/outcome filters apply to both views and all summary/chart totals. Sort/date controls and server pagination keep list pages bounded to 50 rows; aggregates run over the full filtered cohort before pagination. Filters reset the page, invalidate older requests and show loading immediately. Converted unpaid/paid/cancelled records remain distinguishable. Manual payment, cancellation, reopen and flow actions retain existing permission gates.

## Ownership and security

Order System owns service_role-only SECURITY INVOKER finance_admin_draft_report(jsonb), fixed search_path, no new table or RLS policy. finance-admin action draft_report keeps the existing admin1/owner/view_finance restriction and JWT verification. Legacy draft_orders/follow-up endpoints remain unchanged. Reporting has no order/payment/notification writes or historical backfill.

Installed migration: 20261009080630. finance-admin v34 ACTIVE; source readback matches exactly, verify_jwt=true. No-auth live request returns 401. Security advisor categories/findings remain unchanged from baseline; new RPC denies anon/authenticated execution.

## Verification

- 26 read-only production cohorts reconcile against independent canonical SQL: day/week/month, created/sent dates, active/closed/cancelled/unpaid/pending/sent/unsent states, source/flow/delivery/status/reason/search filters, missing data and empty periods.
- Every filtered ID is recovered exactly once across 17-row test pages, including cohorts beyond the old 200-row list limit. Full chart/source/reason counts and conversion percentages reconcile; MYT midnight, ISO week and leap-month/zero buckets are checked.
- Actual Edge handler controlled replay verifies owner reads/filter forwarding, 50-row gateway bound and unauthenticated/staff/other-owner/missing-permission rejection without external requests.
- Actual React component and full Admin App/Draft Workspace shell with synthetic 240-draft API responses: 50-row list, pagination, canonical order navigation, all-cohort graph totals, Day/Week/Month, reason drilldown, payment/sort/date-basis/search filters, empty state, stale response isolation, existing cancel modal and reader mutation hiding pass. Desktop 1440×1000 and mobile 390×844 have no page overflow, runtime errors or framework overlay. Screenshots visually inspected.
- Browser plugin not available; regular Playwright uses tool-only npm Chromium outside the repository. No signed-in hosted owner interaction or real draft/customer mutation is exercised.
- Full storefront/Inbox build, Admin V2 type/build, admin source boundary and git diff checks pass.

## Hosted release

PR #81 merged to production as `861f222000f4579a944c978cb0da2028a62cb632`. Workers Builds and Public Domain Guard pass; Worker version `4a1c2589-41b6-40f7-a9e5-2d55e899592d`. Public `https://shop.decocake.my/?admin=v2&view=draft-orders` asset chain serves `main-B92AteEa.js` → `admin-v2-route-4XGaWPQ5.js` → `App-CO3ojcGF.js` and the new list/metrics/trend CSS. Hosted JS contains the new list/graph labels, reason/trend/paid-outcome controls, cohort API call and corrected workspace header. Controlled UI verification and private production SQL/API verification do not by themselves prove authenticated hosted owner interaction.


## Cancellation audit review — 2026-10-09

Backend PRODUCTION; rendered desktop/mobile workflows VERIFIED; frontend publication pending.

List/card actions include **Sejarah pembatalan** on every draft, so earlier cancellations remain reviewable after Reopen or conversion. Cancelled draft rows show current source, actor and MYT timestamp. Filter tambahan → Jenis pembatalan supports Auto system (`automation`), Manual admin (`admin`) and Tidak direkodkan (`unknown`); it selects current cancelled outcomes and applies before all aggregates/pagination. Clearing the source retains the selected outcome filter; Reset filters clears both. Existing cohort date rules still apply, rather than filtering by cancellation event date.

Reuse the existing append-only `qrpay_order_draft_events`: `admin_rejected` is the historical event name for both automated and manual cancellation; metadata.source distinguishes them. The existing cancellation RPC already stores reason code, label, detail, actor and timestamp. Shopee detail retains its exact order reference. `draft_reopened` supplies actor/time and previous reason, while the earlier cancellation event retains full details. No cancellation/reopen mutation contract, trigger or historical row is changed. A missing legacy source stays unknown even when an actor exists; no source/reason is fabricated or backfilled. Canonical order cancellation has unknown draft-cancellation source and may have no draft cancellation event.

New service-only invoker RPC `finance_admin_draft_cancellation_history(uuid,integer)` returns only sanitized cancellation/Reopen fields, newest first, 50 events per page with stable timestamp/ID ordering and total. It excludes raw metadata, snapshots, tokens and payment payloads. `finance-admin` v35 action `draft_cancellation_history` retains JWT and existing admin1/owner/view_finance checks; UUID validated and nonnegative offset forwarded. Read permission suffices for history; manual cancellation continues to require manage_finance and server-owned admin actor/source. Installed migration: `20261009100538_draft_cancellation_audit_view.sql`. Deployed Edge source readback matches exactly.

Verification: production rollback tests exercise the real cancel RPC (automation), Reopen and manual re-cancel, preserving all three audit events; unknown legacy source, 54-event pagination, privacy/grants and nine independent month/source cohorts pass. Zero synthetic drafts remain and no provider requests/customer messages are sent. All 26 existing read-only cohort/pagination/chart tests pass after migration. Actual Edge handler controlled replay passes owner/read permission, unauthorized identities, invalid UUID, pagination, filter bounds and unspoofable manual cancellation actor/source. Live unauthenticated endpoint denies access. Actual React component passes source filters, reopened history, reason/actor/Shopee reference, history paging, error state, keyboard close and desktop/mobile overflow checks. Browser plugin unavailable; regular Playwright with external tool-only Chromium used. Authenticated hosted owner interaction remains unexercised.
