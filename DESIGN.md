# Scouted Design System

## Product Context

Scouted is a Chrome extension side-panel for analysing clothing product pages before purchase. It reads the active product page and returns a compact, evidence-led view of quality, value, durability, confidence, positive signs, and watch-outs.

This is a functional buying assistant, not a marketing site, marketplace, wardrobe tool, outfit tracker, upload flow, or general shopping dashboard. The side panel should feel like a sharp product review or buying guide: concise, credible, and useful at the moment of purchase.

The loaded results UI is the visual anchor for the product. Future unloaded, loading, error, and partial-data states must feel like quieter versions of the loaded result, not separate designs.

## Aesthetic Direction

Direction: premium clothing-analysis assistant with editorial restraint.

Mood: warm, calm, compact, trustworthy, and practical. The interface should feel more like an informed product review than an AI dashboard. It should be credible inside a narrow Chrome side panel and should never look like a generic SaaS template.

Use warmth through paper-like backgrounds, distinct row surfaces, precise typography, and careful information hierarchy. Do not add visual noise to make the panel feel more "designed".

Core principles:

- Warm cream or off-white background.
- Deep navy or muted blue primary accent.
- Editorial restraint over decorative UI.
- Compact information density.
- High-quality small-screen typography.
- Muted surfaces, row dividers, and tabular numeric scoring.
- The product result, verdict, and evidence are the primary experience.

Avoid:

- Oversized AI-style headings.
- Random gradients.
- Giant badges.
- Chunky cards.
- Decorative shapes, blobs, confetti, or ornamental noise.
- Generic Tailwind dashboard styling.
- Marketing-page sections or landing-page hero treatment.

## Typography

Use one high-quality sans-serif UI family for the panel. Hanken Grotesk is the approved UI face for the empty and loading states, matching `scouted-final-states.html`; otherwise fall back to Inter and the existing system stack. Fraunces is approved as a restrained editorial serif for the empty-state hook and sample verdict line only. Do not introduce other expressive display fonts into the side panel.

Recommended CSS:

```css
:root {
  --font-sans: "Hanken Grotesk", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-editorial: Fraunces, Georgia, "Times New Roman", serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
```

Type scale for side-panel UI:

| Token | Size | Weight | Line height | Usage |
| --- | ---: | ---: | ---: | --- |
| `text-micro` | 10-11px | 750-850 | 1.3-1.4 | Eyebrows, metadata, confidence labels |
| `text-xs` | 12px | 650-800 | 1.35-1.5 | Row details, secondary labels |
| `text-sm` | 13px | 400-760 | 1.4-1.55 | Body copy, sign detail, descriptions |
| `text-base` | 14-15px | 650-820 | 1.3-1.5 | Row titles, compact section content |
| `text-lg` | 17-19px | 760-850 | 1.15-1.3 | Product title, verdict heading |
| `score-lg` | 24-28px | 850-900 | 1 | Grade tile only |

Rules:

- Keep headings compact. In a 360-420px side panel, 19px is already a large title.
- Do not use all-caps labels. Use Title Case for short UI labels and sentence case for explanatory copy.
- Empty/loading states should follow the approved reference density: 25px editorial hook, 13px support copy, 15px loading heading, 13.6px tracker titles, 12.4px tracker details, and a 4px footer progress bar.
- Use `font-variant-numeric: tabular-nums` for scores, prices where useful, and confidence percentages.
- Do not use viewport-scaled font sizes.
- Do not use negative letter spacing or forced letter-spaced label styling in compact UI.
- Long product names must wrap or truncate intentionally; they must not collide with price, score, or action controls.

## Colour System

Prefer CSS variables in `src/panel/styles.css`. Do not scatter raw Tailwind-style colour names or one-off hex values through components unless a variable is missing and the value is immediately promoted into the system.

Recommended palette:

```css
:root {
  --background: #f5f2ea;
  --foreground: #1f262f;
  --card: #fbfaf6;
  --surface: #fbfaf6;
  --surface-strong: #fffefa;
  --surface-muted: #ece7dd;
  --popover: #fcfbf7;
  --primary: #233347;
  --primary-foreground: #f8f5ef;
  --secondary: #ece7dd;
  --secondary-foreground: #2f3843;
  --muted: #efebe3;
  --muted-foreground: #5d6673;
  --accent: #e2d8c9;
  --border: #d8d2c7;
  --input: #d8d2c7;
  --ring: #7d8997;
  --success: #2d6a4f;
  --success-muted: #d8f3dc;
  --neutral-score: #2f6f9f;
  --neutral-muted: #e5f2fb;
  --warning: #92400e;
  --warning-muted: #fef3c7;
  --destructive: #a8412e;
  --destructive-muted: #fff0ed;
}
```

Usage:

- `--background`: side-panel page background.
- `--card` / `--surface`: result rows, row groups, skeleton surfaces, debug shell.
- `--surface-strong`: emphasized row groups that need to stand apart from the panel background without borders.
- `--surface-muted`: quiet controls, chips, secondary buttons, and compact supporting rows.
- `--primary`: main action, brand accent, focusable primary indicators.
- `--success`, `--neutral-score`, `--warning`, `--destructive`: score tones and recommendation states.
- `--muted-foreground`: metadata, confidence labels, secondary descriptions.
- `--border`: internal dividers between items only.

Rules:

- Use colour to communicate hierarchy, tone, and state, not decoration.
- Use background contrast to separate grouped rows and emphasized states. Do not outline containers just because they are containers.
- Dark filled surfaces should be rare. The primary dark surface is the grade tile or primary button, not entire sections.
- Avoid bright blue, violet, neon green, and generic SaaS gradient palettes.
- Avoid colour-only communication. Pair tone with text, label, position, or shape.

## Spacing

Base unit: 4px.

Side-panel spacing should be compact:

- Shell padding: 12-16px.
- Main vertical gap: 12-16px.
- Section gap: 8-12px.
- Card/row padding: 10-16px depending on density.
- Row gap: 8-12px.
- Tight metadata gap: 4-6px.

Use whitespace as a separator, not as a decorative luxury. The side panel has limited width; excessive gaps make the tool feel sparse and less useful.

## Borders And Radius

Scouted should not use borders around outer containers, cards, row groups, chips, image placeholders, or buttons. Only use borders as dividers between adjacent items inside a row group, such as `border-top` or a `::after` hairline between rows.

Use background colour differences to make specific grouped rows distinct from the page background. If a section needs separation, choose a stronger or more muted surface first, then adjust spacing; do not add a box border.

Buttons generally use `border-radius: 1000px` and no border. The empty/loading sticky CTA follows the approved reference HTML instead: a full-width dark button with a restrained 13px radius.

Non-button radii should stay restrained:

- 7-8px: thumbnails, small score marks, compact icons.
- 9-10px: rows, skeleton rows, row groups, compact controls.
- 10-12px: soft section surfaces when a grouped background is genuinely needed.
- 999px or 1000px: pills and buttons.

Avoid:

- Large rounded marketing-card radii.
- Nested rounded cards inside rounded cards unless the inner element is a true repeated row group with a distinct background.
- Inconsistent radii between unloaded, loading, and loaded states.
- Borders around buttons or outer containers.

## Layout Rules For Chrome Side Panel

Target width: 360-420px, with a lower bound around 320px.

Rules:

- Design mobile-first and side-panel-first. Do not assume desktop web width.
- The loaded summary should remain the visual anchor: compact product image, brand/title/price, grade tile, score, and recommendation pill.
- Use single-column vertical flow. Two-column layout is acceptable only inside a compact row, such as image plus product copy or score tile plus score metadata.
- Keep product image dimensions stable so loading and loaded states do not jump.
- Prefer row groups with subtle item dividers and distinct backgrounds over separate chunky cards for every item.
- Section headings should be small labels, not page headings.
- Debug UI must remain visually secondary and must not compete with the main verdict.
- Alternatives and score explanation should be compact supporting sections, not the main event.

Current loaded-state anchors to preserve:

- Top action bar with a small Title Case product name and compact refresh action.
- Product hero with fixed image area, concise product copy, grade tile, score, and recommendation pill.
- Short verdict section with one strong summary line and one explanatory paragraph.
- Positive signs and watch-outs as dense row lists.
- Evidence and score explanations as expandable or row-based support.

## Motion And Loading

Motion is choreographed but restrained: the 3D stage and the view transitions
are the two sanctioned theatrical moments; everything else stays functional.

- Button active state may use `scale(0.98)`.
- Hover/focus colour transitions: 100-200ms.
- State swaps morph via the View Transitions API (see State Transitions).
- The loading state is the live product stage in scan mode plus the step
  tracker — no generic skeletons.
- Progress indicator: the 4px footer sweep.
- Score count-up, grade-tile sheen sweep, staggered section entrances and
  drawn tracker checkmarks are part of the loaded-state choreography.
- Everything nonessential respects `prefers-reduced-motion`.
- Loading state copy should be calm and specific: reading page, checking material signals, assessing value, building verdict.

## Component Vocabulary

### Product Stage (3D)

The product image is presented as a real-time 3D object on a WebGL2 stage
(`src/panel/stage/`): depth is estimated client-side from the single product
photo, and the item renders as a soft closed volume with studio lighting and a
camera-facing contact shadow, directly on the cream paper — no card box, no
border.

Rules:

- One stage per state, full width: ~212px in the analysis view, ~158px in the
  empty-state sample. The same component instance persists from loading to
  loaded so the object is physically continuous.
- Loading uses `scan` mode: locked three-quarter pose, an analytic blue band
  sweeps the item, material below the line is slightly dimmed.
- Loaded uses `orbit` mode: slow turntable, drag-to-spin with inertia, rim
  light eased to the verdict tone with a brief pulse as the verdict lands.
- Fallbacks are mandatory: flat photo with drop shadow when the image is
  CORS-tainted or WebGL is unavailable; shirt placeholder when there is no
  image; one static lit frame under reduced motion.
- The stage must never get a background, border, or card treatment.

### State Transitions

Status changes (empty → loading → loaded → error) go through
`withViewTransition` (View Transitions API). Named groups: `stage`,
`product-copy`, `wordmark`, `dock`. Sub-page navigation keeps the lighter
`pageIn` slide. Reduced motion skips view transitions entirely.

### Header

Small, quiet, and persistent. Use the header for "Scouted" and compact actions such as "Check Again". Do not turn it into app navigation.

### Product Summary

Use image, brand, title, price, and compact metadata. The title is important but must stay within side-panel scale. Product images should be cropped cleanly and never become a marketing hero.

### Verdict Area

The verdict should be direct and readable at a glance:

- One concise recommendation summary.
- One short explanatory paragraph.
- Confidence should be visible where it helps interpretation.
- Do not bury the verdict below secondary evidence.

### Score / Grade

Use a compact grade tile or score mark. The grade should feel like editorial shorthand, not a gamified badge.

Rules:

- Use tabular numbers for `74/100`, `7.4/10`, or confidence values.
- Keep grade tiles fixed size.
- Tone grades with semantic variables.
- Do not create oversized circular meters or decorative progress charts.

### Recommendation Pill

Use a small rounded pill for recommendation labels such as excellent pick, worth buying, consider, poor value, skip, avoid, or can’t assess.

Rules:

- 11-12px text.
- Muted semantic background.
- No border.
- No forced capitalization; render the label in Title Case from data.
- No giant badge treatment.
- No decorative icons unless the icon adds clarity.

### Positive Signs / Watch-Outs

Use compact rows with:

- Small metric initial or icon.
- Strong label.
- One short evidence-grounded detail.
- Confidence/severity indicator when available.

Rows should be scannable. Avoid prose blocks that make the panel feel like a report pasted into a tiny viewport.

### Evidence Rows

Evidence should be factual, compact, and labelled. Prefer row groups, expandable details, or small metric cells. Distinguish first-party page facts from external evidence and inferred signals.

Rules:

- Do not overstate claims when source confidence is low.
- Do not let debug payloads replace user-facing evidence.
- Evidence gaps are useful and should be presented calmly, not as errors.

### Buttons

Primary buttons:

- `border: 0`.
- `border-radius: 1000px`.
- `background: var(--primary)`.
- `color: var(--primary-foreground)`.
- Compact height, usually 38-44px.
- Full width only when it is the single primary action in the unloaded state.

Secondary/refresh buttons:

- Small, muted background.
- `border: 0`.
- `border-radius: 1000px`.
- No oversized CTA styling.

### Skeleton States

Skeleton states should preview the loaded UI:

- Product-image placeholder.
- Product title and metadata lines.
- Grade/score placeholder.
- Verdict copy lines.
- Two to four row placeholders for signs/watch-outs/evidence.

Use `--muted` and subtle shimmer/pulse. Match border radius to the element being replaced.

## State Guidance

### Unloaded State

Purpose: invite the user to analyse the current clothing product page.

Rules:

- Keep it compact and practical.
- Show what the user will get, but do not create a marketing pitch.
- The primary action can be full width.
- If a product title or brand was detected, show it as a quiet readiness line.
- Match the loaded result's row, typography, surface, and spacing vocabulary.
- Avoid hero copy, illustrations, feature grids, or landing-page language.

### Loading State

Purpose: reassure the user that the extension is reading and analysing the page.

Rules:

- Match loaded result structure closely enough to prevent layout surprise.
- Use calm progress labels.
- Keep skeleton density close to final content density.
- Do not use novelty AI animations, chat bubbles, or spinner-only layouts.

### Loaded State

Purpose: deliver the answer fast.

Rules:

- Show product context, grade/score, and recommendation immediately.
- Keep the verdict above secondary evidence.
- Positive signs and watch-outs should be visible without excessive scrolling.
- Evidence, alternatives, debug data, and score methodology are supporting information.
- Do not add marketing copy around the result.

### Error / Partial State

Purpose: explain what failed and what can still be done.

Rules:

- Use clear plain language.
- Preserve the same visual system.
- Show captured product evidence when available.
- Do not use alarming colours except for true failure states.

## Do / Do Not

Do:

- Read the loaded UI before designing related states.
- Keep UI small, sharp, and evidence-led.
- Use CSS variables for colours.
- Keep row groups and surfaces subtle.
- Maintain compact information density.
- Use product-review language.
- Make confidence and evidence visible.
- Preserve stable image, grade, and row dimensions.

Do not:

- Make a landing page.
- Add upload flows, outfit tracking, secondhand discovery language, marketplace search, or marketing sections.
- Add large hero headlines.
- Add random gradients or decorative backgrounds.
- Use chunky badges or oversized pills.
- Use generic Tailwind dashboard cards.
- Put borders around containers or buttons.
- Force labels into all caps.
- Spread one-off raw colours through the UI.
- Add whitespace that makes the panel feel empty.
- Create a new visual language for unloaded or loading states.
- Hide the verdict below debug or methodology content.

## Accessibility Basics

- Interactive controls should have at least a 44px touch target when practical; compact secondary controls may be visually smaller if their clickable area remains comfortable.
- Use semantic buttons and links.
- Provide visible focus states using `--ring`.
- Maintain WCAG AA contrast for body text and essential UI.
- Do not rely on colour alone for score or recommendation meaning.
- Product images should have empty alt text when decorative and a labelled container when conveying availability.
- Loading states should have an accessible label.
- Avoid text overlap at 320px width.
- Respect reduced-motion preferences for nonessential animation.
