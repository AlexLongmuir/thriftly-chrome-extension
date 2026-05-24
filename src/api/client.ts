import type { BackendPayload, BackendVerdict } from "../shared/messages";

const DEFAULT_API_URL = "https://thriftly-chrome-extension.vercel.app/api/quality-check";
const API_URL = (import.meta.env.VITE_QUALITY_CHECK_API_URL as string | undefined) || DEFAULT_API_URL;

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
    summary: `Stage 6 local verdict prepared for "${title}" as ${payload.classification.category} / ${payload.classification.material_family} with ${payload.classification.source_confidence_label} source confidence (${confidence}).`,
    receivedUrl: payload.page.url,
    source: "mock",
    capturedTitle: title,
    analysis: {
      stage: "stage_6",
      status: payload.visual_enrichment.status === "requested" ? "skipped" : "skipped",
      product: {
        title,
        url: payload.page.url,
        page_state: payload.page.product.page_state,
        source_confidence_score: payload.page.product.source_confidence_score,
        source_confidence_label: payload.classification.source_confidence_label
      },
      classification: payload.classification,
      page_evidence: [],
      external_evidence: [],
      benchmark_evidence: [],
      external_coverage: "none",
      external_sources_found: false,
      useful_sources_count: 0,
      external_score_impact: "none",
      rejected_sources: [],
      key_external_insights: [],
      repeated_themes: [],
      conflicting_evidence: [],
      evidence_gaps: [],
      cross_source_themes: [],
      external_search_diagnostics: ["mock_backend_not_configured"],
      external_evidence_pack: {
        external_sources_found: false,
        useful_sources_count: 0,
        external_evidence_quality: "none",
        external_score_impact: "none",
        evidence: [],
        key_external_insights: [],
        repeated_themes: [],
        conflicting_evidence: [],
        evidence_gaps: [],
        cross_source_themes: [],
        rejected_sources: []
      },
      public_evidence: [],
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
      verdict: {
        overall_rating: confidence < 0.45 ? 4.2 : 6.2,
        recommendation: confidence < 0.45 ? "not_enough_info" : "consider",
        recommendation_summary:
          confidence < 0.45 ? "Not enough trustworthy product evidence to make a buying call." : "Local mock verdict; backend is not configured.",
        scores: {
          quality: confidence < 0.45 ? 3.8 : 6.2,
          value: confidence < 0.45 ? 3.8 : 6.0,
          durability: confidence < 0.45 ? 3.8 : 6.0,
          aesthetic: confidence < 0.45 ? 4.5 : 6.2,
          confidence
        },
        confidence_label: payload.classification.source_confidence_label,
        verdicts: {
          quality: {
            verdict: "Mock verdict only; configure the backend for Stage 6 scoring.",
            confidence: payload.classification.source_confidence_label,
            evidence_type: "unknown"
          },
          value: {
            verdict: "Mock verdict only; approved-example anchors run on the backend.",
            confidence: payload.classification.source_confidence_label,
            evidence_type: "unknown"
          },
          durability: {
            verdict: "Mock verdict only; durability is not analysed locally.",
            confidence: payload.classification.source_confidence_label,
            evidence_type: "unknown"
          },
          aesthetic: {
            verdict: "Mock verdict only; visual enrichment runs on the backend.",
            confidence: payload.classification.source_confidence_label,
            evidence_type: "unknown"
          }
        },
        reasoning_flags: ["mock_backend_not_configured"],
        matched_examples: [],
        evidence_score_effects: [],
        summary: "Backend API URL is not configured.",
        model: "gpt-5.4-mini",
        model_status: "model_unavailable"
      },
      approved_examples: [],
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
