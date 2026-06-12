# Side-panel design overhaul — working notes

Goal: remove the "AI slop" signals (generic gradients, visual glitches, awkward layout) and
bring every state of the panel to a finished, premium, editorial standard with fluid motion.

## Root causes found in the audit

1. `src/panel/styles.css` contained a full duplicated "Locked loaded-result layout" block
   (~440 lines repeated at the top and bottom of the file) with conflicting values for the
   same selectors. Several components rendered with whichever rule happened to win.
2. The design fonts (Hanken Grotesk, Fraunces) were loaded from Google Fonts via `panel.html`.
   Inside the extension this is slow/unreliable; the panel mostly rendered in fallback fonts.
3. The loaded-state header (`.analysis-action-bar`) was a 96px bar with a 31px wordmark and a
   68px outlined button — the "awkward layout structure" complaint.
4. One-off hex values everywhere instead of tokens; radii and divider colours inconsistent
   between states.
5. Motion was minimal-to-broken: `max-height` accordion hack, no entrance choreography,
   no reduced-motion handling for some animations.

## Plan

- [x] Preview harness (`preview.html` + mocked chrome runtime + backend fixture) so every
      state renders in a normal browser and can be screenshot-audited with headless Chrome.
- [x] Baseline screenshots of every state at 320/360/420 px.
- [x] Bundle fonts via `@fontsource-variable` (Hanken Grotesk wght, Fraunces opsz + italic);
      drop the Google Fonts `<link>`.
- [x] Rewrite `styles.css` from scratch: single token system, zero duplicated blocks,
      consistent radius/divider/surface scales.
- [x] Rework loaded-state header into a compact wordmark + pill action.
- [x] Motion system: spring `linear()` easings, staggered section entrances, score count-up,
      drawn checkmarks in the loading tracker, grid-rows accordions, meter fills,
      press/hover micro-interactions, full `prefers-reduced-motion` support.
- [x] Screenshot audit loop until every state is clean at all three widths.
- [x] `npm run typecheck && npm test && npm run build` green.

## Verification loop

```bash
npm run dev               # serves /preview.html
node scripts/preview-shots.mjs   # writes shots/<state>-<width>.png
```

States covered: empty, loading (extract + research phases), loaded, alternatives,
how-it-works, error.
