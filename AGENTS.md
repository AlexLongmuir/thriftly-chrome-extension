# Repository Instructions

## Scope

These instructions apply to the whole repository.

This project is Scouted, a Chrome extension side-panel that analyses clothing product pages for quality, value, durability, evidence, positive signs, and watch-outs. Treat it as a compact buying assistant, not a web app landing page or general ecommerce product.

## UI Work

Before any UI work:

1. Read `DESIGN.md`.
2. Inspect the existing loaded results UI in `src/panel/App.tsx` and `src/panel/styles.css`.
3. Identify the smallest change that satisfies the request.

The loaded state is the visual anchor. Unloaded, loading, error, and partial states must match it in density, typography, colour, border radius, and component vocabulary.

## Design Constraints

Reuse existing components, class names, tokens, and styles where practical. Avoid inventing a new visual language unless the existing one cannot support the requested change.

Keep UI changes focused and minimal:

- Prefer adjusting existing CSS variables and component styles over adding parallel systems.
- Prefer row groups and compact sections over new large cards.
- Preserve side-panel ergonomics for 360-420px width and check the 320px lower bound when relevant.
- Keep debug UI visually secondary.

Do not add:

- Marketing landing-page sections.
- Upload flows.
- Outfit tracking.
- Marketplace search.
- Secondhand-discovery language unless explicitly requested.
- Generic AI-dashboard styling.
- Random gradients, decorative noise, oversized badges, or giant headings.

## Self-Review Checklist

After implementing UI changes, review against `DESIGN.md` and specifically check for:

- Oversized text.
- Generic AI-dashboard styling.
- Too much whitespace for the side-panel width.
- Inconsistent cards, borders, or radii.
- Chunky badges or pills.
- Poor hierarchy.
- Mismatch with the existing loaded UI.
- Text overlap or awkward wrapping at narrow widths.
- Colour values that should be CSS variables.

## Code Style

Follow the existing React, TypeScript, and CSS style. Keep component changes local unless a shared abstraction already exists or removes real duplication.

Do not rewrite unrelated files. The worktree may contain user changes; preserve them.

Use concise, evidence-led product language. Do not overstate confidence when the data is partial or inferred.

## Worktree and Chrome Extension Testing

Use git worktrees for parallel implementation work, but do not ask the user to load each worktree's `dist/` directory into Chrome.

Default Chrome testing workflow:

- Treat `/Users/alex/Documents/scouted-extension-active` as the single Chrome-loaded unpacked extension directory.
- Chrome should be loaded once from `/Users/alex/Documents/scouted-extension-active`.
- From whichever worktree is being tested, build the extension and sync that worktree's `dist/` into the active directory.
- Prefer `npm run extension:activate` for this workflow when available.
- After activation, tell the user to reload the existing unpacked extension in `chrome://extensions`; do not tell them to load a new worktree unless explicitly requested.

For backend/API testing, run the local backend from the worktree under test and build/activate the extension against that endpoint, for example `VITE_QUALITY_CHECK_API_URL=http://127.0.0.1:3000/api/quality-check npm run extension:activate`.

This keeps branch work isolated while preserving one stable Chrome extension path and avoiding duplicate unpacked extensions.

## Verification

Run relevant local checks when available:

- `npm run typecheck` for TypeScript-only changes.
- `npm test` for logic, extraction, API, or shared model changes.
- `npm run build` before shipping extension-affecting changes when practical.

If a check cannot be run, record why in the final response.
