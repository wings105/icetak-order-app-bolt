# SKU template renderer v2

## Scope and routes

- Admin V2: `/?admin=v2&view=render-templates`, Settings → Render Templates.
- Public test: `/render-test/?sku=YS0184&name=Jayna+turns+4`.
- One raster template and one text region per SKU. Upload original blank PNG/JPG/WebP, up to 6 MB, maximum 8000 px per side and 24 megapixels.
- Font selection or custom TTF/OTF upload; fill, outline, maximum font size, weight, alignment, letter case, auto-fit, text-region dimensions and position. Position/region use percentages of original image. Font/outline sizes are original-image pixels.
- Click preview to reposition the text region. Preview guides never appear in exported PNG.
- The test form has SKU plus one wording field, Render, Copy URL and Download PNG. PNG preserves original pixel dimensions and transparency.

## Ownership and security

Order System owns `render_templates`, append-only `render_template_events`, public `render-templates` Storage bucket and `render-template` Edge Function.
Admin UI belongs solely in `icetak-admin/src/pages/RenderTemplates.tsx`. Shared canvas engine is `public/render-test/renderer.js`.

- Anonymous GET by exact SKU exposes only SKU, asset paths, configuration and version. No customer/order/payment data is involved.
- POST list/upload/save requires a valid Supabase Auth user matched to an active admin, and owner role or existing Manage Admins permission. The UI uses the existing shared Supabase session.
- Gateway JWT verification is disabled deliberately because GET is public. All POST actions authenticate in the function body; no service credential is shipped to browsers.
- Tables have RLS enabled, no client grants/policies. The save RPC is SECURITY INVOKER, service-role-only. Save atomically checks expected version and records before/after template history.
- Uploaded assets use UUID paths rather than overwriting cached assets. Storage uploads are service-only through the authenticated endpoint. MIME is detected from file signatures.
- Image and font decoding must complete before drawing; stale asynchronous results do not replace newer previews. Download is disabled until the current render succeeds. Missing templates show an explicit upload instruction.

## Verification and remaining limits

Backend deployed; SQL grants/RLS/bucket state queried, public missing-template GET returns 404, unauthenticated POST returns 401. Rolled-back SQL test proves create/update/version conflict and two audit records without leaving QA templates.

Controlled tests prove PNG/TTF upload handling, role rejection, signature validation, config bounds, save/read configuration and stale-version conflict using mocked Auth/Storage/REST boundaries. Canvas tests with a synthetic 1200×1600 raster prove full image pixels, auto-fit, uppercase, uploaded font, guide exclusion, corrupted-image rejection, dimension mismatch and overflow rejection. New page TypeScript check, Admin V2 source boundary check and complete admin bundle with external existing Supabase dependency pass.

Authenticated hosted admin upload/save and mobile browser interactions have not been verified. The browser session currently reaches Admin Login. System fonts vary by device; upload a custom font for the same typeface across devices. The owner will upload the real blank YS0184 template after release. No legacy gray/thumbnail asset is automatically imported.

Deleting uploaded assets/template records is deliberately outside the first test UI. Unreferenced assets from an interrupted setup may remain until a later cleanup feature.
