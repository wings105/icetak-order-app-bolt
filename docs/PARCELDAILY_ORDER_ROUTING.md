# ParcelDaily order routing

## Source of truth

- `orders`: one customer order and one shipment timeline.
- `production_components`: one production item/component.
- `clickup_tasks`: maps a production component task to its order.
- `orders.clickup_order_task_id`: optional mapping for the one order-level ClickUp record.
- `shipments`: one order-level ParcelDaily shipment.
- `shipment_events`: ParcelDaily tracking history.
- `shipment_pod_files`: archived proof-of-delivery files.

Production tasks never own `In Transit`, `Out for Delivery`, `Delivered`, or POD state. Those states belong to `shipments.order_id`.

## Make.com AWB contract

The existing Make.com flow may continue using the selected production task as ParcelDaily `reference`:

- single-component order: the only production task;
- multi-component order: only the task selected by the existing `set1` rule.

No additional Make callback is required for the base shipment route. ParcelDaily `CHECKOUT` is the AWB-created event and contains `reference`, `orderId`, `consign_no`, courier, and connote URLs.

## ClickUp task callback contract

After Activepieces creates a production task, it must save the mapping in Supabase:

```text
clickup_tasks.order_id          = orders.id
clickup_tasks.order_item_id     = order_items.id
clickup_tasks.component_id      = production_components.id
clickup_tasks.clickup_task_id   = ClickUp task ID
clickup_tasks.clickup_list_id   = 18375902
production_components.clickup_task_id = ClickUp task ID
```

The reference resolver accepts, in order:

1. `orders.id`
2. `orders.order_no`
3. `orders.order_id`
4. `orders.external_order_id`
5. `orders.clickup_order_task_id`
6. `clickup_tasks.clickup_task_id`
7. `production_components.clickup_task_id`

If ParcelDaily sends `CHECKOUT` before Activepieces saves the ClickUp mapping, the shipment remains safely stored as `shipment_only`. Saving the mapping later automatically runs `reconcile_shipments_for_reference()` and links the existing shipment to the order.

## Order-level ClickUp record

The existing ClickUp **Order database** list may hold one record per order. Store its task ID in:

```text
orders.clickup_order_task_id
orders.clickup_order_list_id
orders.clickup_order_url
```

Production status remains on component tasks. Payment, overall order stage, tracking, delivered state and POD belong to the order-level record and Supabase order.

## ParcelDaily status mapping

```text
Shipment Data Received -> awb_created
Picked Up               -> picked_up
In Transit / hub scans  -> in_transit
On Delivery             -> out_for_delivery
Parcel has been received-> delivered
```

`complete` in ClickUp means production complete. It does not mean the customer order is delivered.

## Customer portal

`customer-shipment` accepts either:

```text
?order_token=<orders.public_token>
?customer_token=<customer portal token>
```

It returns the latest shipment, timeline events, AWB link and secure POD links. The customer portal displays this once at order level.
