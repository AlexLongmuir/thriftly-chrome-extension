# Product Stage 3D + motion overhaul — working notes

Brief: make the panel feel top-1% designed. Centrepiece: replace the flat product
image with a real-time rotating 3D presentation of the item, built from the single
product photo, no external API. Plus shader-driven loading, seamless state
transitions, and a frame-by-frame motion audit.

## Architecture

- `src/panel/stage/depth.ts` — silhouette + depth estimation from the product photo.
  Canvas 2D only: estimate background colour from border pixels, soft foreground
  mask via colour distance, then "puff" the mask (iterated separable box blur)
  into a pillow depth field. High-pass luminance adds fabric-fold relief.
  Falls back to a rounded-slab profile when estimation looks unreliable
  (coverage out of range) and to a plain `<img>` when the image is CORS-tainted.
- `src/panel/stage/stage.ts` — zero-dependency WebGL2 renderer. Displaced grid
  mesh, front + back shells meeting at the silhouette (closed soft volume),
  per-fragment normals from the depth texture, key/fill/rim lighting, fabric
  specular, contact-shadow pass, alpha-to-coverage silhouette AA.
  Two modes: `scan` (locked pose, light band sweeping the item during analysis)
  and `orbit` (turntable rotation + drag-to-spin with inertia).
- `src/panel/stage/ProductStage.tsx` — React wrapper: image loading, depth build,
  pointer handling, visibility pausing, reduced-motion static frame, fallbacks.
- App restructure: one persistent analysis view hosts the stage across
  loading → loaded so the object is physically continuous (scan finishes,
  the item lifts into rotation). Lower content swaps via the View Transitions
  API (Chrome-only surface, so it is dependable) with spring-tuned group
  animations; CTA morphs into the loading progress bar.

## Verification loop

```bash
npm run dev
node scripts/preview-shots.mjs            # stills, 320/360/420
node scripts/motion-audit.mjs             # frame strips of transitions
```

Audit checklist per state: alignment to 4px grid, hairline consistency,
type scale, shadow softness, silhouette AA, shadow grounding, scan band
timing, transition continuity frame to frame.

## Status

- [x] Baseline screenshots
- [x] depth.ts + stage.ts + ProductStage.tsx
- [x] Persistent analysis view + view transitions
- [x] Loading state rebuild around the stage (scan beam + tracker)
- [x] Loaded hero rebuild around the stage (orbit + drag hint + verdict block)
- [x] Motion audit + pixel fixes (320/360/420 stills, transition frame strips)
- [x] typecheck / tests / build green

## Findings worth keeping

- Headless screenshot waits must not use `networkidle0`: the WebGL canvas
  keeps the renderer busy and Vite's websocket stays open.
- White-on-white studio photos defeat global colour thresholds; border
  flood-fill with a Sobel gradient barrier segments them reliably.
- The work canvas must be unpadded during segmentation: transparent padding
  poisons the border background sample and blocks the flood at the photo edge.
- A ground-plane contact shadow is invisible at a 10° camera tilt; a
  camera-facing ellipse is what actually reads as the soft "Apple" shadow.
- `prefers-reduced-motion`: stage renders one static lit frame, no loop;
  view transitions are skipped entirely.

## Gemini turnaround views

- `api/product-views.ts` generates one turnaround frame per request
  (angles 60/120/180/240/300; 0° is the original photo) via Gemini image
  output, cached in Supabase `product_view_cache` keyed by
  sha256(image_url + angle + model + prompt version).
- `src/api/views.ts` fetches all angles in parallel as soon as the stage's
  front view is live (during the scan); `ProductStage.addView` uploads each
  frame's colour + depth textures progressively.
- Rendering switches from single-photo relief spin to turnaround once ≥4
  views exist: the nearest view's relief is rotated by the small residual
  angle (≤ ±30°), with a 18°-wide crossfade at view boundaries
  (fresh depth range + premultiplied blend for the incoming view).
- Generated frames are size-normalised against the front view's mask bbox so
  the garment doesn't jump between views.
- The preview harness mocks `product-views` with mirrored/dimmed fixture
  variants, so the whole path is auditable without an API key.

## Debug tooling

- `node scripts/depth-lab.mjs [imageUrl]` — dumps the cutout composite and
  depth field for any product photo, plus coverage stats.
- `node scripts/stage-frames.mjs --view empty|loaded` — cropped rotation
  frame strips of the live stage.
- `?stageDebug=alpha` (+ `&stageFlat=1`) on the preview URL — shader debug
  view of sampled alpha/depth, frozen pose.
