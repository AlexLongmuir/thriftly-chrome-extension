import type { BackendPayload, BackendVerdict } from "../shared/messages";

const API_URL = import.meta.env.VITE_QUALITY_CHECK_API_URL as string | undefined;

export async function submitQualityCheck(payload: BackendPayload): Promise<BackendVerdict> {
  if (!API_URL) {
    return createMockVerdict(payload);
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Backend request failed with HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`);
  }

  return (await response.json()) as BackendVerdict;
}

function createMockVerdict(payload: BackendPayload): BackendVerdict {
  const title = String(payload.page.product.fields.title.value || payload.page.title || "Untitled page");
  const confidence = payload.page.product.sourceConfidenceScore;

  return {
    requestId: `mock-${Date.now()}`,
    summary: `Stage 5 payload prepared for "${title}" as ${payload.classification.category} / ${payload.classification.material_family} with ${payload.classification.source_confidence_label} source confidence (${confidence}). Visual enrichment ${payload.visual_enrichment.status} with ${payload.visual_enrichment.image_urls.length} image(s).`,
    receivedUrl: payload.page.url,
    source: "mock",
    capturedTitle: title,
    analysis: {
      stage: "stage_5",
      status: payload.visual_enrichment.status === "requested" ? "skipped" : "skipped",
      product: {
        title,
        url: payload.page.url,
        page_state: payload.page.product.page_state,
        source_confidence_score: payload.page.product.source_confidence_score,
        source_confidence_label: payload.classification.source_confidence_label
      },
      classification: payload.classification,
      visual_enrichment: {
        status: "skipped",
        model: payload.visual_enrichment.model,
        image_count: payload.visual_enrichment.image_urls.length,
        observations: [],
        visual_cues: [],
        expert_inferences: [],
        missing_views: [],
        image_quality_limits: [],
        warnings: ["mock response: backend API URL is not configured"]
      },
      model_config: {
        vision_model: payload.visual_enrichment.model,
        core_model: "gpt-5.4-mini",
        premium_fallback_model: payload.visual_enrichment.fallback_model,
        embedding_model: "text-embedding-3-small",
        openai_configured: false
      }
    }
  };
}
