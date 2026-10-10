# Marketplace status reconciliation

Backend PRODUCTION; linked-order card rendering VERIFIED in a controlled browser with persisted production snapshots.

Order System (`buivecgahhmrhlmfujgt`) owns canonical marketplace status and its raw webhook/status history. Unified Inbox (`uujcqcsfghqkukaydruc`) consumes the existing private order-summary sync; it does not determine cancellation from logistics or payment labels.

## Same-second cancellation

`reconcile_marketplace_order_status(uuid)` locks the canonical order and selects order-status history by provider occurrence time descending, then CANCELLED priority, then receipt/creation time and ID descending. Final cancellation wins only when provider times tie. A genuinely newer event still takes precedence; other statuses retain their existing ordering.

The reported order 2610109KDDK929 received CANCELLED and IN_CANCEL with the same provider time (2026-10-10 11:17:27 UTC). The pending event arrived about 665 ms later. The old receipt-time tie-break selected IN_CANCEL, which the sync deliberately marks active pending seller action.

Migration `20261010155245_marketplace_cancelled_same_time_priority.sql` changes only reconciliation. It preserves SECURITY INVOKER, fixed search_path, service_role-only EXECUTE, payment mapping and original history. True IN_CANCEL remains active/P1; CANCELLED projects inactive/P4 through the existing worker.

## Verification and bounded repair

- Eight real service_role SQL rollback cases in `scripts/test-marketplace-cancellation-ordering.sql`: both same-second arrival orders, older cancellation, genuine pending cancellation, late older delivery, newer cancellation withdrawal, ordinary delivery and empty history. Each populated case checks persisted status/payment and no mutation on duplicate reconciliation. Deferred production triggers execute before rollback; no fixture remains.
- Live function readback and grants match; migration history records version 20261010155245.
- Only 2610109KDDK929 was reconciled through the existing RPC. Its eleven history records and paid status remain unchanged. Canonical CANCELLED updated at 2026-10-10 16:11:52.999564 UTC; the existing queue/worker projected Inbox CANCELLED / active_order=false at 16:12:01.241 UTC (11 Oct 00:12 MYT).
- Control order 2610109KJJKJ6B remains READY_TO_SHIP / active_order=true with its original timestamps and eight history records.
- Actual OrderWorkspaceTab renders these persisted snapshots at 1280px and 390px in light/dark themes: cancelled card has no Aktif badge; ready-to-ship card retains Aktif. No runtime errors or overflow. This controlled component check does not prove a signed-in hosted staff interaction.

No frontend or Edge Function deployment, provider message, webhook replay, blanket pending-cancellation conversion or broad historical backfill was required. Refresh an already-open panel to consume the updated summary.
