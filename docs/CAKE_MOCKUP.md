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
