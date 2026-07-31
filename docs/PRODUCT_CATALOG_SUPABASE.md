# Product catalogue — Supabase runtime

Supabase is the source of truth for the iCetak order system and product catalogue.

## Runtime

- Frontend: Vite application from this GitHub repository.
- Product data: `public.products`, `public.product_categories`, `public.product_images`, and `public.product_variants`.
- Public search: `public.search_product_catalog(...)` through the Supabase client and RLS.
- ClickUp import: Activepieces sends task batches to the `product-catalog-sync` Supabase Edge Function using the existing `x-ap-secret`.
- Order creation, payment, production, shipment, customer login, and admin operations continue using the existing Supabase RPC and Edge Function flows.

AppDeploy is not part of the product catalogue runtime. Files under `backend/` are legacy compatibility code and must not own catalogue data or scheduling.

## Activepieces catalogue sync

Endpoint:

```text
POST https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/product-catalog-sync
Content-Type: application/json
x-ap-secret: <existing Activepieces shared secret>
```

Body:

```json
{
  "list_id": "901604488980",
  "tasks": [
    {
      "id": "86cwqmhpz",
      "name": "[CUSTOM NAME] Happy Birthday Cake Topper J&T Express ...",
      "date_updated": "1772438653993",
      "custom_fields": [],
      "attachments": []
    }
  ]
}
```

The function normalizes ClickUp custom fields, creates missing categories, writes an import-batch audit record, and upserts products by `clickup_task_id`. Send a maximum of 200 tasks per request. Activepieces should page through ClickUp list `901604488980` and send each page to this endpoint.

## Public links

```text
/?q=spiderman
#/product/acrylic-cake-topper
#/product/<catalog-slug>
```

The six basic service slugs open the existing configurable order flow. Other slugs read published catalogue records from Supabase under RLS.
