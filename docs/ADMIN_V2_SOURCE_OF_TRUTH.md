# iCetak Admin V2 — Source of Truth

Admin V1 is retired. Do not add new admin UI or admin business logic back into the customer app.

## Where to edit admin features

| Area | Source |
|---|---|
| Admin shell/navigation | `icetak-admin/src/App.tsx`, `icetak-admin/src/components/` |
| Admin login/reset/first setup | `icetak-admin/src/AdminLogin.tsx` |
| Dashboard overview | `icetak-admin/src/pages/Dashboard.tsx` |
| Full order lifecycle | `icetak-admin/src/pages/Orders.tsx` |
| Auto-priced counter order | `icetak-admin/src/pages/QuickOrder.tsx` |
| Custom item/custom price order | `icetak-admin/src/pages/ManualOrder.tsx` |
| Payments ledger | `icetak-admin/src/pages/Payments.tsx` |
| Finance, bank feed, reconciliation, Shopee wallet and reports | `icetak-admin/src/pages/Finance.tsx` |
| ParcelDaily tracking | `icetak-admin/src/pages/Shipping.tsx` |
| WhatsApp controls/rules/health/queue | `icetak-admin/src/pages/WhatsAppControl.tsx` |
| WhatsApp templates | `icetak-admin/src/pages/WhatsAppTemplates.tsx` |
| WhatsApp outbox | `icetak-admin/src/pages/WhatsAppOutbox.tsx` |
| Integrations | `icetak-admin/src/pages/Integrations.tsx` |
| Staff / permissions | `icetak-admin/src/pages/StaffRoles.tsx` |
| Export/system settings | `icetak-admin/src/pages/Settings.tsx` |
| Product/pricing config used by admin order tools | `icetak-admin/src/lib/orderProducts.ts` |
| Admin URL mount + authenticated bridge only | `src/admin-v2-route.tsx` |
| Backend data/actions | Supabase migrations, RPCs and Edge Functions under `supabase/` |

## Customer code

`src/main.ts` and customer-specific scripts are storefront/customer portal code only. They must not contain:

- admin login/dashboard UI
- admin order mutation UI
- admin permission UI
- Quick Order / Manual Order UI
- WhatsApp Control Center UI
- Admin V1 route/state

The customer **Staff / Admin Login** button only redirects to `?admin=v2`.

## Create Order flows

There are three deliberate Admin V2 flows. Do not combine them unless the product behavior is intentionally changed.

1. **Quick Order** — iCetak product variants and automatic V1-compatible pricing. Includes counter/WhatsApp sources and ClickUp sync monitoring.
2. **Manual Order** — arbitrary item name and unit price. Replacement for V1 `Create Customer Order`.
3. **Paid QR / WhatsApp** — inside Quick Order; creates an order together with verified Manual QR payment data.

## Order actions

All order mutation controls live in `Orders.tsx` and use Supabase RPCs. Dashboard and Payments are navigation/overview surfaces, not duplicate order action implementations.

## Shipping / tracking

All ParcelDaily admin tracking functionality lives in `Shipping.tsx`. Do not create a second tracking admin page.

## WhatsApp

All admin WhatsApp connection settings, production health, notification rules, template sync, tests, queue processing and retry controls live in `WhatsAppControl.tsx` or its dedicated V2 template/outbox pages.

## CI enforcement

`scripts/check-admin-v2-source.mjs` fails CI if:

- legacy Admin V1 scripts are loaded again,
- new `src/admin-*` modules appear outside the single V2 mount bridge,
- legacy admin symbols return to `src/main.ts`, or
- required V2 source files disappear.

When changing admin behavior, start in `icetak-admin/`. Only touch `src/admin-v2-route.tsx` for authentication/mount/routing concerns and only touch `supabase/` for backend behavior.
