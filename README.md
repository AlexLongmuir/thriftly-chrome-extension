# Quality Check Chrome Extension

Stage 1 foundation for the Quality Check Chrome extension.

## What is included

- Chrome Manifest V3 extension scaffold
- Chrome Side Panel entry point
- React side panel UI
- Background service worker
- Content script
- Side panel to background to active-tab messaging
- Configurable backend API POST with deterministic mock fallback
- Local loading, success, and error states

## Run locally

Install dependencies:

```bash
npm install
```

Build the unpacked extension:

```bash
npm run build
```

Load `dist/` in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select this repository's `dist/` directory.
5. Open any page and click the Quality Check extension icon.

## Backend connection

Set `VITE_QUALITY_CHECK_API_URL` before building to post the Stage 1 payload to a real backend endpoint:

```bash
VITE_QUALITY_CHECK_API_URL=https://example.com/api/quality-check npm run build
```

If the variable is unset, the panel renders a local mock response. That keeps Stage 1 verifiable before the Next.js backend exists.

The endpoint should accept:

```json
{
  "page": {
    "url": "https://retailer.example/product",
    "title": "Product title",
    "visibleText": "Rendered page text",
    "meta": {},
    "capturedAt": "2026-05-19T00:00:00.000Z"
  },
  "extension": {
    "stage": "stage_1",
    "version": "0.1.0"
  }
}
```

And return:

```json
{
  "requestId": "abc123",
  "summary": "Stage 1 connection succeeded.",
  "receivedUrl": "https://retailer.example/product",
  "source": "backend",
  "capturedTitle": "Product title"
}
```

## Verification

```bash
npm run test
npm run build
```
