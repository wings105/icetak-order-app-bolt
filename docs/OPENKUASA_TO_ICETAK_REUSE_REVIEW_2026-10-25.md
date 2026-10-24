# OpenKuasa → iCetak: Reuse & Roadmap Gap Review (25 Oct 2026)

**Purpose:** map reusable ideas from `wings105/OpenKuasa` onto the existing iCetak roadmap, without replacing the current iCetak applications or creating duplicate systems.

**Status:** architecture and feature discovery only. This review did **not** deploy, migrate schemas, connect OpenKuasa to iCetak, access customer contents, or change iCetak orders/payments/inbox data. New ideas remain at **Idea / 0%** pending owner prioritisation.

## Ground truth reviewed
- **iCetak code:** `wings105/icetak-order-app-bolt` (main); Admin V2 (`icetak-admin/src`), Vite storefront (`src`), inbox (`apps/inbox/src`), Supabase Edge Functions.
- **iCetak database metadata (read-only):** existing roadmap tables; main project has 176 public tables and dedicated `finance` (33 tables) and `stock` (11 tables) schemas. Inbox has 37 public tables. Counts are snapshot observations, *not* indicators of test coverage or completeness.
- **OpenKuasa code:** `wings105/OpenKuasa` (`deploy/openkuasa-preview`). Its standalone demo is not evidence of real-world data-write or AI integrations working.
- **License:** OpenKuasa is AGPL-3.0; verify obligations before copying code into the iCetak app served over a network. Prefer independent implementation of patterns if needed.

## Gap decisions (avoid duplicating existing roadmap)

| OpenKuasa idea | iCetak existing foundation | Roadmap action | Priority |
|---|---|---|---|
| Agent proposals, tool allow-list, runtime validation, human Approve/Reject | AI Action Dashboard, `ai_dashboard_reviews`, `ai_dashboard_events`, `admin-ai-dashboard`, `gpt-order-actions` | **New: AI Proposal & Approval Engine**, linked from AI Action Dashboard | P1 |
| Unified sales deal pipeline + follow-up | `sales_opportunities`, `customer_crm_tasks`, CRM identity, draft follow-ups | **New: CRM Sales Pipeline Kanban & Follow-up**; preserve current CRM identity implementation | P1 |
| Admin-configured trigger-action automation | Many existing Edge Functions, draft follow-up scheduler and outboxes | **New: Visual Automation Rule Builder**; layer on top of approved operations, never bypass them | P1 |
| Quotation → acceptance → invoice/order | `quotation_events`, sales opportunities, QRPay drafts, order & finance flows | **New: Quotation Lifecycle & Invoice/Order Conversion** | P2 |
| AI purchase receipt reader with structured human review | Main `finance.transactions`, `finance.expense_allocations`, QRPay AI | **New: Supplier Receipt AI Reader & Expense Review** (distinct from incoming QRPay payment matching) | P2 |
| Marketing weekly agent, campaign suggestions and spend controls | Shopee Ads Profit Analyzer, Ads Dashboard, SKU/channel profitability | **New: Shopee Weekly Marketing Insights Agent**; reuse existing read-only Shopee KPIs | P2 |
| Employee time/leave/claims approval | Staff / Roles and task assignment, but no complete HR module identified | **New: Staff HR Lite & Approval Queue**; low priority | P3 |
| Cross-module AI copilot and dashboard visualization | Business Command Center, Customer Focus, AI Action Dashboard | **Note on existing items only**, don't build another dashboard | P1 existing |
| CRM contact/draft follow-up | Customer CRM Identity & Address Merge; Draft Follow-Up & Shopee Auto Cancel | **Note only**; don't recreate records | Existing |
| Full inventory + double-entry finance from OpenKuasa | iCetak `stock` and `finance` schemas already contain specialized allocation, movements, journals and reconciliation | **Do not port wholesale**; supplement only UI/workflow gaps | N/A |
| Existing chat/broadcast/inbox | iCetak Unified Inbox, WhatsApp templates, Shopee chat, logging and AI suggestions | **Do not replace** existing provider integrations | N/A |

## New idea acceptance criteria (no implementation authorised by this review)

### 1. AI Proposal & Approval Engine — P1
- Proposals persist `source`, `target`, action type, rationale, input snapshot, expiry, status, reviewed_by/time and idempotency token.
- Allow-list + strict schema validation at proposal time and **again at execution time**; scope to current operator permissions.
- Human approval required for customer communications, order/payment changes and external effects. Read-only recommendations can be auto-generated.
- Every execute/reject/expire/error is auditable; retry-safe; no duplicate WhatsApp, Shopee, ClickUp or QRPay operation.
- Show proposal cards within **existing AI Action Dashboard**, not another app.
- Reference: `OpenKuasa/src/lib/agents/apply-proposal.ts`, `proposals.ts`, `src/lib/ai/agents/orchestrator.ts`.

### 2. CRM Sales Pipeline Kanban & Follow-up — P1
- Reuse `sales_opportunities` + customer identity, not a duplicate customers table. Stages: Inquiry → Quoted → Follow-up → Won/Lost; repeat purchase should be linked as a new opportunity.
- Opportunity contains assigned owner, source, estimated value, next action/due date, quotation/order links, and loss reason.
- Support drag-and-drop but server validates stage changes; show history and aging alerts; avoid converting to order twice.
- Reference: `OpenKuasa/src/lib/crm/deal-board.ts`, `deals.ts`, `follow-ups.ts`.

### 3. Visual Automation Rule Builder — P1
- Begin with a narrowly scoped event catalog (draft created, no detail 30 min, shipment ready, deal stage changed, payment pending), actions (flag, assign task, draft message, request approval, update safe status).
- Global and per-rule ON/OFF, dry-run preview, throttling, quiet hours, idempotency, run log and error/retry visibility.
- Critical: not a replacement for existing hard-coded order/stock/payment guards; rules route through existing approved Edge Function operations.
- Reference: `OpenKuasa/src/lib/crm/automations.ts`.

### 4. Quotation Lifecycle & Invoice/Order Conversion — P2
- Versioned quote with item/SKU, price/discount, shipping, expiry and shareable approval link.
- Traceable Sent, Accepted, Declined, Expired; accepted quote creates a draft/order or finance invoice exactly once, using existing iCetak order rules.
- Reuse `quotation_events`, `sales_opportunities`, QRPay payment session; do not rebuild a new finance ledger.
- Reference: `OpenKuasa/src/lib/finance/quotations.ts`, `src/components/finance/quotation-form-card.tsx`.

### 5. Supplier Receipt AI Reader & Expense Review — P2
- Upload purchase receipts, extract merchant/date/amount/currency and suggest category.
- No autonomous postings. Human review confirms fields and maps to the existing finance transaction/category. Duplicate detection and confidence flags.
- Never mix with customer QRPay incoming payment matching.
- Reference: `OpenKuasa/src/lib/finance/receipt-reading.ts`, `receipt-reader.ts`.

### 6. Shopee Weekly Marketing Insights Agent — P2
- Weekly read-only narrative on spend, sales, ROAS, fees, material cost and contribution margin; suggestions for SKU/ad optimisations.
- Propose actions through approval engine; spending limits and logs; no auto-bidding or ad edits by default.
- Source-of-truth: existing Shopee Ads dashboard, Profit Analyzer, finance and catalog data.
- Reference: `OpenKuasa/src/lib/agents/weekly-studio.ts`, `reach-agent.ts`, `costs.ts`.

### 7. Staff HR Lite & Approval Queue — P3
- Future-only proposal: attendance, leave requests, overtime, claim approvals, basic employee directory.
- Separate worker/HR personal data with strict roles. No need to adopt OpenKuasa payroll or recruitment stack now.
- Reference: `OpenKuasa/src/lib/people/approvals.ts`, `attendance.ts`.

## Existing roadmap items to enrich (no status/progress change)
- AI Action Dashboard — add proposal inbox/review cards and audit link; still in testing.
- Business Command Center — add *read-only* cross-module AI questions and drilldowns, reuse KPI sources.
- Draft Follow-Up & Shopee Auto Cancel — candidate for configurable automation trigger; existing rules remain authoritative.
- Shopee Ads Profit Analyzer — becomes data input for weekly AI recommendations, not a replacement.
- Customer CRM Identity & Address Merge — one canonical identity feeding opportunity pipeline.
- Admin V2 Permissions & Production Safety — approval executors must preserve JWT/RLS/role checks and auditability.
- Material Stock Reservation & Deduction — don't replace stock engine with OpenKuasa stock; rules can only request guarded actions.
- Roadmap Documentation Reference Links — connect roadmap entries to this review.

## Validation before any future release
1. Prepare separate sandbox/branch and synthetic data, no iCetak production or customer records.
2. Feature-level unit tests for allowed actions, duplicate prevention, expiry, roles, and RLS. Validate against GitHub/CICD.
3. Review AGPL-3.0 obligations for any direct code reuse and verify dependencies.
4. Obtain explicit owner approval before connecting to iCetak production Edge Functions or enabling an automatic action.
5. Do not mark roadmap items completed merely because OpenKuasa has corresponding source modules.

## Source pointers
- [iCetak repository](https://github.com/wings105/icetak-order-app-bolt)
- [OpenKuasa repository](https://github.com/wings105/OpenKuasa)
- [OpenKuasa source license](https://github.com/wings105/OpenKuasa/blob/deploy/openkuasa-preview/LICENSE)
