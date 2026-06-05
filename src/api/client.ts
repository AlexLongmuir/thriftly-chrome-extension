import type { BackendPayload, BackendVerdict } from "../shared/messages";

const DEFAULT_API_URL = "https://thriftly-chrome-extension.vercel.app/api/quality-check";
const API_URL = (import.meta.env.VITE_QUALITY_CHECK_API_URL as string | undefined) || DEFAULT_API_URL;

export async function submitQualityCheck(payload: BackendPayload, options: { forceRefresh?: boolean } = {}): Promise<BackendVerdict> {
  const body: BackendPayload = options.forceRefresh ? { ...payload, refresh: "force" } : payload;
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Backend request failed with HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`);
  }

  return (await response.json()) as BackendVerdict;
}
