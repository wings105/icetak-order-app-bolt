# Cake Mockup

Route: `/mockup` and `/mockup/`. Customer-only visual sizing tool. Source: `src/cake-mockup/`; standalone Vite entry: `mockup/index.html`. The root boot handler supports hosts that fall back to the SPA for the bare path.

## Geometry and sizing

- One scene unit is one inch. Switching to cm changes display by exactly 2.54; it does not reinterpret or resize stored dimensions.
- Cakes: round cylinders or rectangular boxes, 1–4 centered tiers, independent width/length/height per tier. Tier 1 is the bottom tier. Customer selects the tier receiving the product.
- Edible on top: true-size textured plane with circular alpha mask or rectangular dimensions. Circle clearance uses radius plus offset. Rectangle clearance includes rotation and corner distances.
- Edible on a cylindrical side: UV mesh wraps around the cylinder. Physical width is arc length, not the front-view chord. Vertical size remains the specified height. More than one circumference is flagged as overlap; excessive height/position is flagged.
- Acrylic remains a flat vertical design. On top, the design base is above the surface with a separately represented stick. Design dimensions exclude the stick. On a round side the plane is tangent to the cylinder; it is not warped to resemble flexible edible material.
- Acrylic presets are maximum bounding dimensions: A7 10×7, A6 14×10, A5 20×14 cm. Uploaded artwork retains its aspect ratio when locked; preset fitting uses both maximum dimensions. Edible printable limits are 7.5×11 inches, rotatable.
- Fit warnings do not silently shrink artwork. Approximation and bakery confirmation notes are visible. Mockup does not establish structural stability or laser-cut connectivity.

## Interaction and privacy

- Orthographic 3D/top/front views; mouse/touch orbit and wheel/pinch/slider zoom. Render on changes, without a permanent animation loop. Geometries/materials/textures are disposed on rebuild.
- When WebGL 2 is unavailable, a Canvas 2D fallback provides dimensionally scaled top/front elevations, cylindrical edible projection, multi-tier occlusion, uploaded artwork, zoom and PNG export. It is labelled Preview 2D and does not offer orbit. Product artwork generation is shared with the 3D renderer.
- Upload PNG/JPG/WEBP up to 10 MB; decode and downsample in browser to a maximum 2048-pixel edge. Acrylic crops transparent outer margins. Uploaded designs stay in page memory; there is no server upload, customer tracking, order write or automatic WhatsApp send.
- Save PNG includes dimensions and approximation notes. Generated download has a native fallback link. WhatsApp opens a prepared enquiry to the existing store number 60179860656; customer sends it explicitly.
- No new backend contract or Supabase schema changes. Three.js is bundled locally; no runtime CDN dependency. The example edible image is a static generated example, not customer content.

## Validation

`node --experimental-strip-types scripts/check-cake-mockup.mjs`

`npx tsc -p tsconfig.mockup.json`

`npm run build`

Rendered interaction and production status must be checked per `VERIFICATION_PROTOCOL.md` before claiming completion.

## Release verification (2026-10-01)

Release `4e0c89d` passed Cloudflare Workers Builds and GitHub guard. Live public browser checks prove top/front preview with sample artwork, inch/cm conversion, edible clearance/side-height warnings, multi-tier acrylic placement and PNG preparation with a native download link. The cloud browser disables WebGL; completed native download events did not arrive through its adapter. Controlled Chromium with software WebGL and with WebGL disabled verifies desktop/mobile interactions, uploads, actual decoded 1600px PNG downloads and stale-export invalidation. Hosted 3D and completed downloads in the cloud browser are not independently claimed. Standalone Chromium could not access the hosted site because its environment proxy certificate was not trusted; certificate validation was preserved.

## Edible catalogue (owner supplied, 2026-10-01)

Edible shape choices are independent of cake shape: Bulat, Square, Rectangular and Love. Love uses equal maximum width/height and a shared normalized heart outline for Canvas/Three texture clipping and top-surface clearance. Square always has equal sides. Uploading artwork preserves these selected footprints; rectangular presets use exact product dimensions rather than shrinking to the uploaded image's aspect ratio.

| Per piece | Bulat (inch) | Square (inch) | Love (inch) | Rectangular (inch) |
| --- | --- | --- | --- | --- |
| RM6 | 3, 3.5, 4 | 3, 3.5 | 3, 3.5, 4 | 5.5 × 3.7 |
| RM12 | 4.5, 5, 5.5 | 4, 4.5, 5, 5.5 | 4.5, 5, 5.5 | 5.5 × 7.5 (half A4) |
| RM24 | 6, 6.5, 7, 7.5 | 6, 6.5, 7, 7.5 | 6, 6.5, 7, 7.5 | 11 × 7.5 (A4) |

Cupcake is a Bulat preset: 1.8 inch, RM1.20/pc, 24/A4. This is a per-piece quote and a reference sheet capacity, not an automatically inferred A4 bundle price or minimum order.

Rectangular landscape/portrait swaps width and height; preset identity and price survive the swap. Display-unit changes preserve inches and prices. Exact catalogue matches display the supplied price; unsupported custom dimensions require a store quote. Acrylic pricing is not added. Presets/prices live in `src/cake-mockup/edible.ts` and do not change backend/storefront catalogue records.

Controlled Chromium validation passes in WebGL 3D and no-WebGL 2D at desktop 1536×1024/mobile 390×844: all 34 presets, all six rectangular orientations, unit/price preservation, square 4-inch price boundary, cupcake/WhatsApp capacity, custom pricing, heart alpha-mask lobes/cleft/tip, top/side placement, upload footprint, decoded 1600px PNG download, stale export invalidation and acrylic regression. No runtime errors/overflow. Catalogue release `f2fda399` passed Cloudflare Workers Builds and GitHub guard. Public browser smoke on `https://shop.decocake.my/mockup/` verifies all four shape controls, round/love 4-inch RM6 versus square 4-inch RM12, all six rectangular dimensions/orientations with RM6/RM12/RM24 retained, cupcake 1.8-inch RM1.20/pc and 24/A4 in the price panel and WhatsApp prefill, and a visibly clipped heart preview. The cloud browser uses the labelled Canvas 2D fallback; hosted 3D and completed cloud-browser downloads are not independently claimed.
