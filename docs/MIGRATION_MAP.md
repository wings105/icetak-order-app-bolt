# AppDeploy to Supabase migration map

AppDeploy currently uses `@appdeploy/sdk` tables. The clean Bolt app should use Supabase.

Recommended migration stages:

1. Mirror every AppDeploy row into `appdeploy_mirror` as JSONB.
2. Normalize mirrored data into clean Supabase tables.
3. Build the frontend against Supabase only.
4. Remove AppDeploy dependency.

## AppDeploy source tables to mirror

- customers
- orders
- order_items
- production_components
- payment_sessions
- shipment_events
- integration_settings
- integration_outbox
- notification_outbox
- admin_sessions
- admin_permissions
- login_tokens
- entity_subscriptions
- unmatched_payment_transactions
- admin_audit

## Known field mismatches

- AppDeploy `orders.order_id` maps to Supabase `orders.order_no`.
- AppDeploy `orders.customer_token` maps to Supabase `customers.public_token` or normalized `orders.customer_id`.
- AppDeploy `orders.payment` maps to Supabase `orders.payment_status`.
- AppDeploy `orders.delivery` maps to Supabase `orders.delivery_method`.
- AppDeploy `order_items.k` maps to Supabase `order_items.product_type`.
- AppDeploy `order_items.custom_text` maps to Supabase `order_items.wording`.
- AppDeploy `production_components.item_id` maps to Supabase `production_components.order_item_id` after lookup.

Do not delete the raw mirror until the normalized tables have been verified.
