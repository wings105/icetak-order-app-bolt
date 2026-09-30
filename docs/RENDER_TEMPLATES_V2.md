# SKU template renderer v3

## Routes and ownership

- Admin V2: `/?admin=v2&view=render-templates`, Settings → Render Templates.
- Public test: `/render-test/?sku=YS0184&name=Jayna+turns+4`.
- Admin implementation: `icetak-admin/src/pages/RenderTemplates.tsx`.
- Shared Canvas engine: `public/render-test/renderer.js`.
- Order System owns template records, audit events, Storage and the `render-template` Edge Function. Existing save RPC and RLS/grants remain unchanged.

## Configuration contract

New saves use `config: {width, height, layers: [{id, field, label, font_path, text}]}`. Old `config.text` plus top-level `font_path` records normalize to one layer bound to `name` without rewriting stored records. The endpoint also accepts old editor save payloads and preserves their text shape.

Each layer has independent font/system fallback, fill, stroke, maximum font size, alignment, letter case, auto-fit and region position/dimensions. New controls:
- `curve`: signed circular arc in degrees, -140..140; positive arch ∩, negative smile ∪, zero straight.
- `rotation`: -180..180 degrees.
- `tracking`: -20..100 original-image pixels.
- `scaleX` / `scaleY`: 10..300 percent; 100 is unchanged.
- Up to 12 layers and 8 unique input fields. Duplicating a layer preserves its field binding, so one input can appear in several places. Layer order is paint order.
- Custom font is stored per layer. Asset checks include every unique font path and require the same SKU prefix.
- Region centers/dimensions remain percentages; font/stroke/tracking use original-image pixels.
- Click preview relocates the active layer, drag moves it relative to its previous position, arrow buttons move 1 original-image pixel.
- Public form generates labels and inputs from unique field bindings. URL parameters use the field keys; old name URLs still work.

Auto-fit measures glyph ink and stroke after curve, nonuniform scale and rotation. The text is centered vertically by its transformed bounds; left/center/right align those bounds inside the region. All glyph strokes precede all fills. Guides are a preview overlay and never enter exported PNG.

This phase implements text along a curve. It does not implement Photoshop glyph Warp distortion or all Blending Options (shadow/glow/gradient/double stroke remain future work). System fonts can vary by device; upload TTF/OTF for consistent font appearance.

## Security and save behavior

Anonymous exact-SKU GET exposes only template assets/configuration. POST list/upload/save still validates Supabase Auth and an active owner or Manage Admins admin. Service keys remain server-only. Save uses the existing service-only SECURITY INVOKER RPC with expected-version conflict detection and atomic before/after audit. No schema migration or historical backfill is required.

## Verification (2026-10-01 MYT)

Controlled canvas tests: up/down curves, rotation and scale fit inside the region for 25 combinations; duplicate bindings use one input; multiple input values render distinct layers; long text auto-fits; legacy records remain readable; PNG original dimensions and bottom image pixels remain intact; guides differ only in preview; invalid dimensions, images, overflow and long input reject.

Controlled Edge handler tests: authenticated v3 save/read preserves curve/scale and shared layers; every custom font is checked; no-auth/staff requests reject; malformed transforms, reserved fields, duplicate IDs and other-SKU font paths reject; stale versions return conflict; legacy saves still succeed. Auth/Storage/REST providers are mocked in these handler tests.

TypeScript page check, full admin bundle and Admin V2 source boundary check pass. Hosted v2 was directly observed on 2026-10-01; prior v1 hosting blocker is resolved. User-uploaded YS0184 PNG exists and was opened at 2480×3508, but its template record was not yet saved when work began.

Status at source commit: engine VERIFIED in controlled Canvas environment; frontend UI ATTEMPTED pending hosted v3 smoke check. Authenticated admin editing is currently blocked by the normal Admin Login in the agent browser. Do not claim hosted editor interactions were exercised until that evidence exists.


## Production smoke (2026-10-01 MYT)

Source commits: 210377b5a3549e1b381dd1ef4c7c5417a6553271 (v3), c70473c471c7e549ca1b06a17a93fef7673e501d (font fallback), d77fb2aadfcd72346956592f6a207c9850459084 (native PNG link). GitHub full production builds and Cloudflare Workers Builds checks succeeded.

Public v3 was opened on shop.decocake.my, with the real uploaded YS0184 image. Wording Haziq turns 6 and Ros turns 4 rendered with the down curve, yellow fill, blue outline and 55% height; full template including bottom artwork/YS0184 label remained visible. Editing wording hides old preview and removes its download until Render succeeds. Generated form has the single name field for this SKU. No app/framework errors were observed; logged browser-extension metadata errors were unrelated to the app. Final screenshot captured at 1165×936.

Initial YS0184 setup was saved through the existing audited RPC, with expected version 0, actor codex:owner-request-setup, the user's existing uploaded image, and one name layer. No prior template record existed or was overwritten. Live readback proves version 1 and exactly one audit event. Initial settings: x55.2%, y41.4%, region60×12%, Trebuchet MS Bold149px, tracking4px, curve-35°, scale100×55%, stroke12px. These are editable starter settings, not a claim of exact Photoshop parity. System fonts use sans-serif fallback when unavailable.

Public PNG is now encoded before its native download link is enabled. Editing invalidates/revokes the old link. Download was obtained using the browser media-download API; the synchronized 5,374,080-byte PNG was decoded and visually inspected at 2480×3508, with the full template and no guide lines. The browser's download-event waiter timed out, so its event return alone is not evidence; the real synchronized decoded file is the outcome proof.

Controlled public-form tests also prove two inputs bind three layers, URL values survive reload and edits, and stale async renders cannot restore an outdated preview/download. Controlled Canvas tests cover both curve directions and 25 rotation/scale combinations; legacy/config guards and Edge-handler tests pass.

Status: public single-field render/export and YS0184 setup PRODUCTION. Multiple-field/curve/transform engine behavior VERIFIED in controlled tests. Authenticated admin UI (adding fields, font upload, dragging, saving through the hosted form) remains ATTEMPTED because the agent browser shows Admin Login. Mobile device testing remains unverified. The editor source is deployed in the same successful Workers build, but build success is not authenticated interaction proof.
