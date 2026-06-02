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

Before any non-read-only implementation, commit, PR, or merge task:

1. Run `git status --short --branch` and `npm run chat:list`.
2. If the current directory is `/Users/alex/Documents/thriftly-chrome-extension`, treat it as the primary control folder. Do not edit or commit there.
3. Create a task worktree with `npm run chat:new -- <task-slug>`, then do all subsequent implementation, verification, commit, PR, and merge work from `/Users/alex/Documents/scouted-worktrees/<task-slug>`.
4. If a matching clean worktree already exists for the task, use that existing worktree instead of creating another one.
5. If the primary folder has dirty files, assume they belong to another task. Do not stage, commit, reset, restore, or overwrite them unless explicitly asked.

For read-only investigation, planning, status checks, and answering questions, it is acceptable to stay in the primary folder.

After a PR is merged, return to the primary folder, run `git pull --ff-only`, then run `npm run chat:done -- <task-slug>` or `npm run chat:cleanup -- --apply` to remove the clean merged worktree.

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
