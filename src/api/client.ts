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
  const title = payload.page.title || "Untitled page";

  return {
    requestId: `mock-${Date.now()}`,
    summary: `Stage 1 connection succeeded for "${title}". Real analysis starts in later stages.`,
    receivedUrl: payload.page.url,
    source: "mock",
    capturedTitle: title
  };
}
