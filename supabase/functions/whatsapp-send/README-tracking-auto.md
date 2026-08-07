# Tracking auto-send safety contract

`shipment_auto_tracking` is the only event controlled by the Shipping dashboard Auto Send switch.

- Auto Send remains OFF after deployment.
- Only first courier scan events created after the latest activation timestamp are eligible.
- AWB creation / `Shipment Data Received` never sends tracking.
- Cancelled shipments are rejected again immediately before the Wasapflow API call.
- Idempotency key: `shipment_auto_tracking:<shipment_id>`.
- Manual Send / Mark Sent / Cancel stops a pending automatic job.
- Turning Auto Send OFF cancels pending or processing tracking-only jobs.
- Existing order, payment, checkout-confirmation, and other WhatsApp rules are not enabled by this switch.
- Free-form uses the short tracking message when the 24-hour window is open. Outside the window, the approved `tracking_update` utility template is used.
