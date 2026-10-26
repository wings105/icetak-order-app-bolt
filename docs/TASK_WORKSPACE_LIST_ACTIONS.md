# Task Workspace list actions — 27 October 2026

Status: VERIFIED controlled component; backend read extension active. Hosted signed-in operator acceptance remains pending.

The existing Task Workspace list exposes the provider's original Review Customer dropdown options, exact AWB link and order_link custom-field values, and Complete for each exact task. Links are HTTPS-only, independently openable and copyable; missing values remain blank. The list DTO carries these two additional fields from the existing latest full snapshot query, with the original private invoker grants and task membership preserved. Existing Admin and capability-station handlers already pass through these fields, so no Edge redeployment is needed.

Dropdown options load on explicit open, not once for every displayed row. Mutations reuse authenticated/capability task-clickup, current provider options/revisions, stable request IDs, audit receipts, provider readback and existing projections. Complete changes the actual ClickUp task status. Success refreshes the list; unknown outcomes lock new writes and offer receipt reconciliation. No order/payment/fulfillment mutation is added.

Verification: actual React list action component in Chromium passes provider option selection, exact task/field/revision payload, AWB/order anchors, Complete and refresh callback without page errors. Existing task-clickup and task-workspace regressions, Admin TypeScript/build and full root/Inbox build pass. Live private read confirms populated AWB/order values; anonymous and authenticated direct RPC execution remain denied, with service_role execution retained. No live task is changed for testing. Physical PC/ClickUp embed and hosted operator mutations remain untested.
