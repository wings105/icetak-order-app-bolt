# Task Workspace list actions — 27 October 2026

Status: VERIFIED controlled component; backend read extension active. Hosted signed-in operator acceptance remains pending.

The existing Task Workspace list exposes the provider's original Review Customer dropdown options, exact AWB link and order_link custom-field values, and Complete for each exact task. Links are HTTPS-only, independently openable and copyable; missing values remain blank. The list DTO carries these two additional fields from the existing latest full snapshot query, with the original private invoker grants and task membership preserved. Existing Admin and capability-station handlers already pass through these fields, so no Edge redeployment is needed.

Dropdown options load on explicit open, not once for every displayed row. Mutations reuse authenticated/capability task-clickup, current provider options/revisions, stable request IDs, audit receipts, provider readback and existing projections. Complete changes the actual ClickUp task status. Success refreshes the list; unknown outcomes lock new writes and offer receipt reconciliation. No order/payment/fulfillment mutation is added.

Verification: actual React list action component in Chromium passes provider option selection, exact task/field/revision payload, AWB/order anchors, Complete and refresh callback without page errors. Existing task-clickup and task-workspace regressions, Admin TypeScript/build and full root/Inbox build pass. Live private read confirms populated AWB/order values; anonymous and authenticated direct RPC execution remain denied, with service_role execution retained. No live task is changed for testing. Physical PC/ClickUp embed and hosted operator mutations remain untested.

## Column order and original colours — 27 October 2026

The list keeps Task / item first, then Order ID, SKU, Set and Customize Name before the remaining fields. Hidden optional columns retain their saved visibility. Review chips and dropdown choices use the provider's original option colour with contrasting text. The private read additionally resolves the actual selected Review Customer name and colour from the full snapshot by option UUID or numeric order index, instead of displaying normalized internal workflow labels. Existing permissions and provider write guards are unchanged.

Due dates compare calendar days in Asia/Kuala_Lumpur: earlier days are red, the current day yellow (including earlier times today), later days retain the original text colour. Missing/invalid dates have no urgency colour. A local minute timer updates these colours across midnight even while a task panel is open, without additional API calls.

Verified: actual full Task Workspace controlled Chromium checks confirm the column order, yesterday/today/future classes, original selected and menu-chip colours and dropdown opening without page errors. Date boundary checks cover Malaysia midnight, earlier time today, tomorrow and invalid input. Live selected Review name/colour resolution and unchanged service-only grants pass. Admin TypeScript/build and root/Inbox build pass; hosted owner acceptance remains separate.
