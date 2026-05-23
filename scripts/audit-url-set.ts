import { JSDOM } from "jsdom";
import { createBackendPayload } from "../src/shared/pageSnapshot";
import { createPageSnapshotWithRetailerFallbacks } from "../src/shared/retailerFallbacks";
import { handleQualityCheckPayload } from "../api/quality-check";

const URLS = [
  "https://www.uniqlo.com/uk/en/products/E450535-000/00",
  "https://www.arket.com/en-gb/product/relaxed-linen-shirt-beige-1283004006/",
  "https://www.arket.com/en_gbp/men/knitwear/product.heavy-knit-wool-blend-jumper-black.0787330025.html",
  "https://www.mrporter.com/en-gb/mens/product/mr-p/clothing/crew-necks/brushed-cashmere-sweater/46376663162905192",
  "https://www.mrporter.com/en-gb/mens/product/celine/clothing/crew-necks/cashmere-sweater/1647597323606986",
  "https://www2.hm.com/en_gb/productpage.0570002002.html",
  "https://www2.hm.com/en_gb/productpage.1101074001.html",
  "https://www2.hm.com/en_gb/productpage.0945531001.html",
  "https://www.zara.com/uk/en/cotton---linen-shirt-p01063412.html",
  "https://www.zara.com/uk/en/linen-cotton-polo-shirt-p01063304.html",
  "https://www.next.co.uk/style/su730732/139892",
  "https://www.next.co.uk/style/st117534/402122",
  "https://www.next.co.uk/style/st038974/u16233",
  "https://www.marksandspencer.com/leather-lace-up-trainers/p/clp60642209",
  "https://www.marksandspencer.com/leather-trainers/p/clp60720372",
  "https://www.allsaints.com/eu/men/leathers/leather-jackets/alkan-zip-up-two-tone-leather-jacket/M018LB-839.html",
  "https://www.allsaints.com/eu/men/leathers/leather-jackets/miller-leather-jacket/M009LA-5.html",
  "https://www.patagonia.com/product/mens-micro-d-fleece-jacket/26171.html",
  "https://www.patagonia.com/product/mens-better-sweater-fleece-jacket/25528.html",
  "https://www.patagonia.com/product/mens-reclaimed-fleece-jacket/22921.html"
];

const fieldNames = ["title", "brand", "price", "currency", "colour", "materials", "care", "construction", "origin", "sizing"] as const;
const failures: string[] = [];

for (const url of URLS) {
  try {
    const response = await fetch(url, { redirect: "follow" });
    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const snapshot = await createPageSnapshotWithRetailerFallbacks(dom.window.document, dom.window.location, fetch);
    const payload = createBackendPayload(snapshot);
    const result = await handleQualityCheckPayload(payload, {
      env: {
        GEMINI_API_KEY: "",
        OPENAI_API_KEY: "",
        QUALITY_CHECK_VISION_MODEL: "gemini-3.0-flash",
        QUALITY_CHECK_CORE_MODEL: "gpt-5.4-mini",
        QUALITY_CHECK_PREMIUM_FALLBACK_MODEL: "gpt-5.4",
        QUALITY_CHECK_EMBEDDING_MODEL: "text-embedding-3-small"
      }
    });
    const product = snapshot.product;
    const verdict = result.analysis?.verdict;
    const fields = Object.fromEntries(
      fieldNames.map((field) => [
        field,
        {
          value: product.fields[field].value,
          confidence: product.fields[field].confidence,
          source: product.fields[field].source
        }
      ])
    );
    const urlFailures = validateStage6Url(url, payload, result);
    failures.push(...urlFailures);

    console.log(
      JSON.stringify({
        url,
        httpStatus: response.status,
        pageState: product.pageState,
        sourceMethod: product.sourceMethod,
        sourceConfidenceScore: product.sourceConfidenceScore,
        fields,
        imageCount: product.imageUrls.length,
        visualStatus: payload.visual_enrichment.status,
        visualImageCount: payload.visual_enrichment.image_urls.length,
        stage: result.analysis?.stage,
        overall: verdict?.overall_rating,
        recommendation: verdict?.recommendation,
        scores: verdict?.scores,
        confidenceLabel: verdict?.confidence_label,
        matchedExamples: verdict?.matched_examples,
        reasoningFlags: verdict?.reasoning_flags,
        validation: urlFailures.length ? "failed" : "passed",
        warnings: product.warnings
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${url}: audit crashed: ${message}`);
    console.log(JSON.stringify({ url, validation: "failed", error: message }));
  }
}

if (failures.length) {
  console.error(JSON.stringify({ validation: "failed", failures }, null, 2));
  process.exitCode = 1;
} else {
  console.error(JSON.stringify({ validation: "passed", urls: URLS.length }, null, 2));
}

function validateStage6Url(url: string, payload: ReturnType<typeof createBackendPayload>, result: Awaited<ReturnType<typeof handleQualityCheckPayload>>): string[] {
  const failuresForUrl: string[] = [];
  const verdict = result.analysis?.verdict;
  const product = payload.page.product;

  if (result.analysis?.stage !== "stage_6") failuresForUrl.push(`${url}: backend did not return stage_6`);
  if (!verdict) return [`${url}: missing Stage 6 verdict`];
  if (!Number.isFinite(verdict.overall_rating) || verdict.overall_rating < 0 || verdict.overall_rating > 10) {
    failuresForUrl.push(`${url}: invalid overall rating`);
  }
  for (const [dimension, value] of Object.entries(verdict.scores)) {
    if (!Number.isFinite(value) || value < 0 || value > 10) failuresForUrl.push(`${url}: invalid ${dimension} score`);
  }
  if (verdict.scores.confidence > Math.min(0.92, product.source_confidence_score) + 0.001) {
    failuresForUrl.push(`${url}: verdict confidence exceeds source confidence cap`);
  }
  if (product.page_state === "product_page" && product.source_confidence_score >= 0.45 && payload.classification.material_family !== "unknown") {
    if (verdict.recommendation === "not_enough_info") failuresForUrl.push(`${url}: enough evidence but returned not_enough_info`);
    if (verdict.matched_examples.length < 3) failuresForUrl.push(`${url}: fewer than 3 approved anchors returned`);
  }
  if (product.source_confidence_score < 0.45 && verdict.recommendation !== "not_enough_info") {
    failuresForUrl.push(`${url}: weak source data did not return not_enough_info`);
  }
  if (hasStrongImageOnlyClaim(verdict.verdicts.aesthetic.verdict) && verdict.verdicts.aesthetic.evidence_type === "inferred_from_image") {
    failuresForUrl.push(`${url}: image-only aesthetic verdict contains a strong claim`);
  }
  return failuresForUrl;
}

function hasStrongImageOnlyClaim(value: string): boolean {
  return /\b(?:is genuine|authentic|full[- ]grain|top[- ]grain|will last|guaranteed|exact construction|high quality|durable)\b/i.test(value);
}
