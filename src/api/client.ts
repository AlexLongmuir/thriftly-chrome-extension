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
    throw new Error(`Backend request failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as BackendVerdict;
}

function createMockVerdict(payload: BackendPayload): BackendVerdict {
  const title = String(payload.page.product.fields.title.value || payload.page.title || "Untitled page");
  const confidence = payload.page.product.sourceConfidenceScore;

  return {
    requestId: `mock-${Date.now()}`,
    summary: `Stage 4 classification succeeded for "${title}" as ${payload.classification.category} / ${payload.classification.material_family} with ${payload.classification.source_confidence_label} source confidence (${confidence}).`,
    receivedUrl: payload.page.url,
    source: "mock",
    capturedTitle: title
  };
}
