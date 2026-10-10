# iCetak Architecture Decisions

## 2026-10-10 — Shopee reply resolution follows proven delivery and claim time

Resolve Perlu Balas only after matching successful local-message and send-audit evidence. A private atomic RPC compares incoming activity against the durable outbound claim timestamp, so a customer message during the API request still requires attention. Both Inbox and AI Dashboard use the shared sender; duplicate request repair never invokes the provider again. Keep manual resolution for replies handled outside iCetak. See `SHOPEE_CHAT_DIRECT_SETUP.md`.

## 2026-10-10 — API delivery and Inbox logging have separate retry state

Order whatsapp-send retains delivery authority and a durable outbox. A private, log-only bridge projects successful sends into Unified Inbox; app echo is not assumed for API sends. Delivery remains sent when Inbox logging fails, and existing dispatchers retry only the saved log projection. Provider IDs and unambiguous customer identities deduplicate the Inbox record. Historical mirrors retain original time without reopening sessions or clearing later customer state. Missing pre-send audit blocks delivery. External provider callers must explicitly integrate logging. See `WHATSAPP_API_INBOX_SYNC.md`.

## 2026-10-10 — Token rotation needs only identity and token

The owner requested removing automation timestamps. Minimal pushes contain App ID, Shop ID and Access Token. Record receipt time, keep absent expiry unknown, preserve same-token retries and reject bounded known retired-token replays. Unknown expiry requires an immediate read-only Shopee check before an outbound claim. Do not assume a four-hour lifetime for tokens copied from ClickUp. Optional original timestamps remain backward compatible; untimed unseen updates must come from one serialized refresh producer.

## 2026-10-10 — Shopee sends are direct; existing automation owns token refresh

Keep the existing ClickUp/AP refresh flow as the single token-rotation producer. It may push the new token to a dedicated, hashed-key Inbox endpoint after updating its ClickUp task. iCetak does not run a competing refresh loop. Owner-only Admin V2 Settings configures one App/Shop/environment through the existing private Order→Inbox bridge; browser responses never return stored Partner Key/Access Token. A changed identity clears old credentials, and rotation/check versions fail closed on stale or conflicting input. Manual Inbox and AI Dashboard sends share the existing audited ledger. See `SHOPEE_CHAT_DIRECT_SETUP.md` for contract and unverified provider/UI boundaries.

This file records decisions that future agents should understand before attempting to simplify or redesign the system.

## ADR-001 — `production` is the live code reference

Status: Active.

`main` and `production` are not equivalent. Production work must begin from the latest `production` state unless the owner explicitly chooses another branch strategy.

Why: selecting `main` can omit live features and reintroduce old behavior.

## ADR-002 — Two Supabase projects have separate ownership

Status: Active.

Order System (`buivecgahhmrhlmfujgt`) owns canonical transactional/order state. Unified Inbox (`uujcqcsfghqkukaydruc`) owns conversation/inbox state and chat extraction context.

Why: conversation ingestion and canonical order/accounting lifecycles have different concerns, volumes and integration surfaces. Cross-project bridges are deliberate.

Do not copy the whole order ledger into Unified Inbox or make Unified Inbox the payment authority without an explicit migration plan.

## ADR-003 — Admin V2 is the only supported admin UI source

Status: Active.

Admin features belong under `icetak-admin/`. The customer app should only mount/redirect into Admin V2 where needed.

Why: duplicate admin implementations caused source-of-truth confusion and inconsistent business logic.

Reference: `docs/ADMIN_V2_SOURCE_OF_TRUTH.md`.

## ADR-004 — AI/payment/chat order creation is draft-first

Status: Active.

A payment or chat signal is not sufficient to immediately create a canonical order. The system creates/updates a draft within an active order session, then requires the appropriate confirmation path before conversion.

Why: prevents incorrect customer/order inference and makes corrections auditable.

Reference: `docs/UNIFIED_ORDER_DRAFT_ENGINE_V1.md`.

## ADR-005 — Closed order sessions are hard context boundaries

Status: Active.

Old chat/order details must not be reused automatically after a session has closed/converted.

Why: the same customer may place multiple orders and historical chat can otherwise contaminate a new order.

## ADR-006 — Payment matching fails closed

Status: Active.

When payment identity/amount/session evidence is ambiguous, the transaction should remain unmatched/attention-required rather than being linked to a convenient draft/order.

Why: false-positive payment matching is more damaging than requiring manual reconciliation.

## ADR-007 — Production work is component-based in ClickUp

Status: Active.

Supabase owns canonical orders/components. ClickUp tasks are external production representations linked by stable webapp order/component identity.

Why: one order may produce multiple production components and retrying integrations must not create duplicates.

## ADR-008 — Integration runners are not sources of truth

Status: Active.

Activepieces and similar automation services may move data or invoke callbacks, but canonical state remains in Supabase/connected systems according to domain ownership.

Why: automations can retry, fail or be replaced; business truth must survive automation-provider changes.

## ADR-009 — WhatsApp sends require guardrails

Status: Active.

Automatic customer messages must use the established safety controls, notification/outbox behavior and per-order opt-out/session rules.

Why: direct send shortcuts can duplicate messages, violate user preference/window rules, or send stale notifications.

## ADR-010 — Shipping readiness is separate from production readiness

Status: Active.

Do not collapse production completion, shipping readiness, courier state and customer tracking into one status field.

Why: these states advance independently and are consumed by different workflows.

## ADR-011 — Migrations are append-only history

Status: Active.

Do not rewrite historical migration files to change production behavior. Add a new targeted migration and preserve rollback/audit reasoning where appropriate.

Why: live database history and repository migration history must remain traceable.

## ADR-012 — Documentation is portable project memory

Status: Active.

Important architectural knowledge must live in the repository rather than only in one AI chat/session. `AGENTS.md` is the common entry point for any coding agent.

Why: the project is intentionally able to move between Codex, Claude, Bolt or other tools without losing system context.

## Adding a new decision

Add a new ADR section when a change alters a system boundary, source of truth, security/payment rule, deployment ownership or long-lived integration contract. Include status, decision and reason. Do not record minor UI implementation choices here.

## 2026-10-02 — Unified Inbox shares Cloudflare hosting under /inbox/

Status: Active, production route verified.

Use the existing shop production Worker to serve the independent frontend in `apps/inbox/` at `/inbox/`. Build it after the storefront into `dist/inbox`, with its own dependency lockfile, styles, PWA scope and cache prefix. Exclude `/inbox` and its descendants from the shop service worker; each worker may delete only its own cache prefix. Keep conversation/auth/media/functions in Inbox Supabase `uujcqcsfghqkukaydruc` and canonical shop data in Order System `buivecgahhmrhlmfujgt`.

Reason: the owner requested the shop subpath while preserving storefront behavior. The `production` branch publishes the custom domain; `main` only produces previews. Future Inbox frontend edits belong in this production app folder. The original Inbox repository remains provenance/backend reference rather than an automatically synchronized frontend source.



## 2026-09-19 — AI action review spans WhatsApp and Shopee

Keep chat evidence in Unified Inbox and canonical identity/order/payment/session state in Order System. Admin v2 combines them through an authenticated server bridge. Dashboard review state is separate from provider needs_reply and order lifecycle. Explicit human confirmation is required for sends and resolution; a new inbound revision reopens the card. Initial response drafting uses conservative SOP templates and existing semantic prototypes; no autonomous messaging or bulk CRM import. See `AI_ACTION_DASHBOARD.md`.


## 2026-09-20 — Conversation feedback is a separate reviewed dataset

Conversation response corrections belong to Order System `ai_dashboard_training`, separate from QRPay draft extraction rules. Admin feedback does not automatically retrain a model or grant send authority. Generic SOP reuse requires owner approval and an explicit admin application to the current draft. Customer-specific evidence/corrected replies remain attached to the originating conversation; cross-customer suggestions expose the authored generic SOP. Confidence describes evidence sufficiency until an evaluated accuracy metric exists. Order completion, courier delivery and payment remain distinct facts. See `AI_ACTION_DASHBOARD.md` for tested boundaries.


## 2026-09-20 — AI case facts require an explicit current-order subject

Orders linked to a CRM customer are possible context, not proof that a conversation refers to a specific order. Admin must explicitly confirm the subject order for the current inbound revision and order session before its payment/shipping facts are used in the case brief. A new inbound revision, session change, ambiguous identity or missing canonical membership makes the binding unusable until reviewed again. Shortcuts may open existing order/draft/composer workflows, but the AI dashboard does not create orders, confirm payments, change fulfillment state or send messages implicitly.

## 2026-09-27 — Public AWB references use a minimal ClickUp projection

Owner approved order-ID links without login for internal printing. Group tasks by exact `ORDER ID / customer name`, preserve every image from the latest image comment, and render four task quadrants per A4. Store an indexed private derived cache from raw ClickUp updates; expose only print fields through `awb-preview`. The endpoint has no order/payment/message mutation capability. See `AWB_PREVIEW.md`.


## 2026-09-30 — Business Command Center

- Backend VERIFIED; frontend implementation ATTEMPTED. Five views: Overview, Sales & Chat, Orders & Production, Shipping, Finance & Health; date/source filters and optional 60-second refresh.
- Order System owns operational and audited sales data. Unified Inbox owns chat aggregates. Service-only snapshot RPCs are joined by authenticated admin-command-center (v3) and private token-authenticated command-center-bridge (v1). No browser service/bridge credentials.
- Sales events are idempotent, version checked and audited. Won requires a real noncancelled order plus admin confirmation; quotation requires confirmed dispatch. No messages or order/payment mutations are added.
- Ledger uses existing finance_admin_report posted entries across all finance sources. GMV, cash receipts and Shopee settlement remain separate. Missing settlement is not zero; Shopee COMPLETED is not delivery proof; 1970 ship-by dates are flagged.
- Verified live SQL snapshots, service-only grants, sales lifecycle/retry/version checks in a rolled-back transaction, gateway owner/staff redaction and no-auth rejection, TypeScript and production build/source ownership guard.
- Not verified: desktop/mobile rendered interactions and authenticated hosted frontend. Browser download failed; public site reaches Admin Login. A GitHub commit does not prove frontend hosting publication.
- Existing production webhooks, automations, messaging and customer app preserved; no historical backfill.



## 2026-10-01 — Order work remains independent of chat resolution

Use a private derived ClickUp projection rather than force legacy marketplace tasks into canonical orders. Match explicit Webapp IDs/task links or exact unique Order ID/Order SN; never guess by customer name. Global order priorities read current ledger/shipment/component state before card pagination. Keep production completion, shipping, payment and customer-response resolution separate. Admin case binding still guards case facts. Per-set progress can retire earlier work without closing a complaint/correction. Reconciliation cannot mutate canonical orders/payments/tasks or send messages. Stored replay and real provider pull must be named separately.


## 2026-10-01 — Automation exports use the existing Canvas engine

Use the same native Canvas code in server Chromium rather than reproducing curve/text layout or capturing the editor UI. Authenticate automation with render-only hashed keys or a short signed grant bound to exact fields and template version. Validate before accessing the PNG cache. Combining placeholders in one layer preserves a continuous curve; old full-wording links are supported only through an explicit template compatibility flag. ClickUp task attachment plus a linked comment is the adapter contract; inline comment attachments and live AP installation are not implied by renderer deployment.


## 2026-10-03 — Freeze order material versions and separate contribution from P&L

Status: Active. Use append-only effective material settings, selecting the version at order first_seen_at and capturing per-order item-cost snapshots. Defaults apply to future orders; existing actual costs cannot be silently recalculated. Changed item facts require cost re-review. Existing orders have a reproducible original-version preview without bulk history backfill.

Use canonical released/escrow income, retain explicit actual versus estimated/allocated costs, and subtract platform deductions only once. Order contribution is before business overhead and does not write journal entries. Reason: dependable order decisions without false settlement/profit confirmation or double-posting costs to the business ledger. Owner-only gateway and cost/version audit preserve accountability. See ORDER_PROFIT.md.


## 2026-10-04 — Compare channels on goods sales and expose evidence gaps

The sales channel follows purchase ownership, not the conversation channel. Shopee mirrors must never inflate direct sales. Compare MYR goods after known seller promotions, before refunds, with shipping/cash/settlement/profit separate. Use known percentages when sales are incomplete and label that denominator. A report-estimated nett is not release proof, and missing direct costs cannot create profit. Read-only gateway reporting must not backfill financial facts or post journal entries. See SALES_CHANNEL.md.


## 2026-10-04 — Customer Focus is an operational list with separate audited observations

Use the existing Order System task/order projection and Inbox bridge for a sortable customer/order/draft list. Store panel notes, explicit detail checks, dates and work hiding in private versioned state/events. Source/message changes reopen earlier work observations. These observations cannot confirm payment, shipment, collection, external reply or ClickUp completion. Exact identity and explicit order references protect multi-order context; unbound inquiries remain visible. Reason: reduce owner admin/design prioritization work without rewriting authoritative lifecycles or enabling autonomous messages. See CUSTOMER_FOCUS.md.

Daily focus must distinguish current action from historical records. A fulfilled order cannot regain an old work/shipping deadline from an unresolved chat; a fresh exactly-owned question is after-sales reply work. Generic inquiry priority belongs to its chat row and cannot multiply across every customer order. Daily chat scope is 24 hours (48 hours urgent / 7 days complaint); current review scope is 7 days. Recent open work or explicit admin urgency/scheduling can restore older records. Keep ordinary collection, future work and unpaid customer-ready drafts in their own filters. Archive classification never changes authoritative order completion.

Manual external-reply observations belong to the exact shared conversation revision. They must not close unfinished order design. Design/production observations follow actual work changes; new inbound creates reply work rather than automatic redesign. Whole-action completion follows stable actual source/message observations, independent of which pending conversation is displayed. Reuse audited panel state for single/bulk/undo actions; bound completed chats remain reviewable. Bulk saves are bounded, individually versioned/idempotent and explicitly partial. No lifecycle/provider-status changes are implied by a panel mark.

## 2026-10-04 — Collect post-order detail on each order without reopening drafts

Use one shared per-item evaluator/session panel in the existing Marketplace and Customer Focus lists. Keep internal-order, ClickUp-task and chat-session links separate. Exact order/SKU/identity evidence and explicit scoped bindings can supply details; customer names or generic multi-item text cannot silently map them. Save checks through private versioned/audited Focus state. Production locks follow actual task stages, while payment, provider readiness, task fields and closed draft sessions remain authoritative elsewhere. Shopee auto-send/default and ClickUp writeback require connected adapters plus proven idempotent scheduling; show the missing capability rather than a false send/confirmation. See ORDER_DETAIL_COLLECTION.md.

## 2026-10-04 — Trusted webhook phone joins WhatsApp and Shopee CRM identity

Owner explicitly authorized merging customer masters from authenticated webhook phone evidence. For an existing exact Shopee order/customer, use normalized phone plus verified inbound WhatsApp phone identifiers; retain that WhatsApp owner to preserve Inbox identity references. Use the existing CRM merge contract and remap legacy staging references atomically in a service-only RPC. Names, generic chat text, CSV and reference-free mappings cannot trigger auto-merge. Conflicting verified phones or competing owners remain review cases. This changes CRM identity ownership, not per-order chat boundaries: bind only the specific order's message interval; final artwork still requires selection.

## 2026-10-04 — Contribution targets

Admin V2 now has a VERIFIED contribution-target read model and direct-order cost review. The Order System privately owns goal/workday settings and direct cost overrides; existing Shopee nett/cost and sales-channel identity/date rules remain authoritative. Dashboard and Finance distinguish known actual/estimated totals, missing orders and overhead goals. finance-admin v32 deployed with unchanged owner/JWT gates; no accounting journal, payment/provider or historical cost backfill. Hosted owner UI interaction remains pending. See [CONTRIBUTION_TARGETS.md](CONTRIBUTION_TARGETS.md) for formulas, cohort limits and evidence.

## 2026-10-05 — Exact order mentions are cross-channel evidence bindings

Owner authorizes a single explicit known Shopee Order ID in inbound WhatsApp as a per-order evidence link even when canonical CRM identities are not merged. Persist the reference and message time, stop at the next distinct order/cutoff and retain manual scope precedence. Never merge customer masters by an order mention. Explicit artwork captions may fill one image-required item, but screenshots/receipts/examples do not; conflicting artwork and generic multi-item evidence remain review. This changes detail readiness only, not payment, production or send authorization.

## 2026-10-07 — Owner-approved AWB preview task actions

Extend the existing public exact-order internal print page with explicit one-click webhook actions. The owner approves header fan-out for Address/Complete and individual Finished actions beneath each task. This qualifies the 2026-09-27 read-only endpoint statement: GET remains a projection read; POST performs only validated external webhook dispatch and private delivery receipt writes, never direct business-record or ClickUp mutations. Admin V2 owns the private destination setting with existing owner/manage_admins authorization. Signed, short-lived page grants, current membership/config rechecks and stable request receipts restrict dispatch. Keep the exact user JSON field spelling `buton` and one task per POST; receiver automation owns downstream status mapping and must honor Idempotency-Key for exactly-once effects. See AWB_PREVIEW.md.

## 2026-10-08 — SKU is a minimal AWB print reference field

Owner approved exposing the task's text SKU in the exact-order reference preview and a copy control beneath Finished. Read SKU and AWB URL together via a new service-only bounded snapshot RPC; retain the previous AWB-link RPC's signature for compatibility. Preserve original SKU text for clipboard, omit empty values and keep controls/values hidden from print/PDF. No raw custom-field exposure, ingestion changes, history backfill or webhook dispatch on copy. See AWB_PREVIEW.md.


## 2026-10-09 — Paid Shopee purchase supersedes one recent unpaid quotation

The owner authorizes exact-phone cancellation of a single customer-linked prepaid quotation within the prior 14 days. Use the existing cancellation reason/audit and pause follow-ups for ambiguous multi-draft/CRM matches. Defer matching to transaction end and retry when canonical phone mapping arrives; exclude historical captures, paid/receipt-linked/converted quotes and invalid Shopee orders. Customer links cannot resurrect rejected drafts; explicit admin Reopen owns recovery. No outgoing cancellation message is added. See SHOPEE_DRAFT_AUTOCANCEL.md.
# 2026-10-09 — Draft reporting uses explicit cohorts and paid canonical conversion

Draft list/graph analytics include converted rows and use either draft-created or stored customer-send dates, with MYT day/ISO week/month boundaries. Outcomes are current, not event-date counts. Sent conversion percentages use recorded sent drafts; missing legacy dispatch evidence is not inferred. Closed requires a noncancelled canonical paid order; unpaid pickup conversion remains separate. Reason percentages use all cancelled drafts. Service-only read aggregation runs before bounded pagination through existing finance-admin owner auth. No historical updates or provider sends. See DRAFT_LIST_ANALYTICS.md.


## 2026-10-09 — Review cancellation history without rewriting audit facts

Use existing draft events for cancellation/Reopen history through a sanitized private read RPC. Both system and admin cancellation retain their recorded source, actor, reason and time; Reopen clears current draft cancellation fields but never deletes earlier events. A source filter applies to current cancelled cohort outcomes, while history remains available on active/converted drafts. Missing legacy source remains unknown; no historical audit reconstruction or provider sends. See DRAFT_LIST_ANALYTICS.md.
