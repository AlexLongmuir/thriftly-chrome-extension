# Scouted by Thriftly Chrome Extension

Scouted by Thriftly helps you make smarter clothing purchases by analysing product quality, value, durability, and style signals directly on the product page. Get a clear verdict before you buy, so you can avoid overpriced pieces, spot better value, and build a wardrobe that lasts.

## What is included

- Chrome Manifest V3 extension scaffold
- Chrome Side Panel entry point
- React side panel UI
- Background service worker
- Content script
- Side panel to background to active-tab messaging
- Configurable backend API POST with deterministic mock fallback
- Local loading, success, and error states
- Product evidence extraction from the active browser tab
- JSON-LD Product, meta tag, hydration blob, targeted DOM, visible text, and image URL extraction
- Page-state classification and per-field confidence metadata
- Deterministic Stage 4 normalisation for controlled category, material-family, brand-tier, colour, style tags, use case, quality signals, quality concerns, and source-confidence labels
- Stage 5 visual-enrichment request metadata for product images, with guardrails preventing image-only claims about fabric quality, construction, authenticity, or durability
- Vercel serverless Stage 5 endpoint at `api/quality-check.ts`
- Guarded Gemini visual enrichment with server-side API keys only

## Run locally

Install dependencies:

```bash
npm install
```

Build the unpacked extension:

```bash
npm run build
```

## Local backend setup

Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

Set the server-side keys in `.env.local`:

```bash
GEMINI_API_KEY=your_gemini_key
OPENAI_API_KEY=your_openai_key
QUALITY_CHECK_VISION_MODEL=gemini-3.0-flash
QUALITY_CHECK_CORE_MODEL=gpt-5.4-mini
QUALITY_CHECK_PREMIUM_FALLBACK_MODEL=gpt-5.4
QUALITY_CHECK_EMBEDDING_MODEL=text-embedding-3-small
```

Do not add model keys to `VITE_*` variables or Chrome extension files. `VITE_QUALITY_CHECK_API_URL` is safe because it is only the backend URL compiled into the extension.

Run the Vercel serverless endpoint locally:

```bash
npx vercel dev
```

The local endpoint is normally:

```plain text
http://127.0.0.1:3000/api/quality-check
```

Load `dist/` in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select this repository's `dist/` directory.
5. Open any page and click the Scouted by Thriftly extension icon.

## Backend connection

Set `VITE_QUALITY_CHECK_API_URL` before building to post the Stage 5 payload to a real backend endpoint:

```bash
VITE_QUALITY_CHECK_API_URL=https://example.com/api/quality-check npm run build
```

If the variable is unset, the panel renders a local mock response. That keeps extraction, Stage 4 classification, and Stage 5 visual-enrichment request generation verifiable without a backend.

Build the extension against the local backend:

```bash
VITE_QUALITY_CHECK_API_URL=http://127.0.0.1:3000/api/quality-check npm run build
```

Build the extension against the production Vercel backend:

```bash
VITE_QUALITY_CHECK_API_URL=https://your-project.vercel.app/api/quality-check npm run build
```

After either build, reload the unpacked `dist/` extension in `chrome://extensions`.

Do not put model API keys in the Chrome extension. Add them only to the backend environment, for example Vercel project environment variables:

```bash
GEMINI_API_KEY=...
OPENAI_API_KEY=...
QUALITY_CHECK_VISION_MODEL=gemini-3.0-flash
QUALITY_CHECK_CORE_MODEL=gpt-5.4-mini
QUALITY_CHECK_PREMIUM_FALLBACK_MODEL=gpt-5.4
QUALITY_CHECK_EMBEDDING_MODEL=text-embedding-3-small
```

## Vercel deployment

Install or use the Vercel CLI:

```bash
npx vercel login
npx vercel link
```

Add production environment variables:

```bash
npx vercel env add GEMINI_API_KEY production
npx vercel env add OPENAI_API_KEY production
npx vercel env add QUALITY_CHECK_VISION_MODEL production
npx vercel env add QUALITY_CHECK_CORE_MODEL production
npx vercel env add QUALITY_CHECK_PREMIUM_FALLBACK_MODEL production
npx vercel env add QUALITY_CHECK_EMBEDDING_MODEL production
```

Use these values for the model variables:

```plain text
QUALITY_CHECK_VISION_MODEL=gemini-3.0-flash
QUALITY_CHECK_CORE_MODEL=gpt-5.4-mini
QUALITY_CHECK_PREMIUM_FALLBACK_MODEL=gpt-5.4
QUALITY_CHECK_EMBEDDING_MODEL=text-embedding-3-small
```

Deploy:

```bash
npx vercel --prod
```

Then rebuild the extension with:

```bash
VITE_QUALITY_CHECK_API_URL=https://your-project.vercel.app/api/quality-check npm run build
```

CORS is handled by `api/quality-check.ts` for `chrome-extension://...`, local dev origins, and command-line requests.

Model routing for the backend:

- Image / visual enrichment: `gemini-3.0-flash` by default, overridable with `QUALITY_CHECK_VISION_MODEL`.
- Core structured analysis: `gpt-5.4-mini` via `QUALITY_CHECK_CORE_MODEL`.
- Premium fallback / eval mode: `gpt-5.4` via `QUALITY_CHECK_PREMIUM_FALLBACK_MODEL`.
- Embeddings: `text-embedding-3-small` via `QUALITY_CHECK_EMBEDDING_MODEL`, unless you choose Gemini embeddings in the backend.

The endpoint should accept:

```json
{
  "page": {
    "url": "https://retailer.example/product",
    "title": "Product title",
    "visibleText": "Rendered page text",
    "meta": {},
    "jsonLd": [],
    "hydration": [],
    "targetedText": [],
    "product": {
      "pageState": "product_page",
      "page_state": "product_page",
      "sourceMethod": "json_ld",
      "source_method": "json_ld",
      "sourceConfidenceScore": 0.82,
      "source_confidence_score": 0.82,
      "fields": {
        "title": {
          "value": "Product title",
          "confidence": 0.96,
          "source": "json_ld",
          "evidence": ["JSON-LD Product name"]
        }
      },
      "imageUrls": [],
      "image_urls": [],
      "warnings": []
    },
    "capturedAt": "2026-05-19T00:00:00.000Z"
  },
  "classification": {
    "category": "knitwear",
    "brand": "COS",
    "brand_tier": "mid-premium",
    "price": "£120",
    "material_family": "wool",
    "primary_colour": "navy",
    "style_tags": ["minimal", "smart casual"],
    "use_case": "office casual",
    "material_description": "85% merino wool, 15% nylon.",
    "construction_description": "Construction method not clearly stated.",
    "quality_signals": ["stated on page: premium material term present"],
    "quality_concerns": ["inferred from material: synthetic content may affect handle or breathability"],
    "source_confidence_score": 0.85,
    "source_confidence_label": "high",
    "labelled_inferences": [
      {"field": "brand_tier", "value": "mid-premium", "basis": "inferred_from_brand"}
    ]
  },
  "visual_enrichment": {
    "status": "requested",
    "model": "gemini-3.0-flash",
    "fallback_model": "gpt-5.4",
    "image_urls": ["https://retailer.example/product.jpg"],
    "observations": [],
    "warnings": [
      "vision observations are enrichment only",
      "do not infer fabric quality, construction, authenticity, or durability from images alone"
    ],
    "prompt": "Stage 5 visual enrichment prompt..."
  },
  "extension": {
    "stage": "stage_5",
    "version": "0.5.0"
  }
}
```

And return:

```json
{
  "requestId": "abc123",
  "summary": "Stage 5 visual enrichment completed.",
  "receivedUrl": "https://retailer.example/product",
  "source": "backend",
  "capturedTitle": "Product title",
  "analysis": {
    "stage": "stage_5",
    "status": "completed",
    "product": {
      "title": "Product title",
      "url": "https://retailer.example/product",
      "page_state": "product_page",
      "source_confidence_score": 0.82,
      "source_confidence_label": "high"
    },
    "classification": {},
    "visual_enrichment": {
      "status": "completed",
      "model": "gemini-3.0-flash",
      "image_count": 1,
      "observations": [],
      "warnings": []
    },
    "model_config": {
      "vision_model": "gemini-3.0-flash",
      "core_model": "gpt-5.4-mini",
      "premium_fallback_model": "gpt-5.4",
      "embedding_model": "text-embedding-3-small",
      "openai_configured": true
    }
  }
}
```

## Verification

```bash
npm run test
npm run typecheck
npm run build
```
