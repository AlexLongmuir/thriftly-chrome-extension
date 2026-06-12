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
- [ ] depth.ts + stage.ts + ProductStage.tsx
- [ ] Persistent analysis view + view transitions
- [ ] Loading state rebuild around the stage
- [ ] Loaded hero rebuild around the stage
- [ ] Motion audit + pixel fixes
- [ ] typecheck / tests / build green
