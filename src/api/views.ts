import { TURNAROUND_ANGLES } from "../shared/turnaround";

const DEFAULT_QUALITY_URL = "https://thriftly-chrome-extension.vercel.app/api/quality-check";

const VIEWS_API_URL =
  (import.meta.env.VITE_PRODUCT_VIEWS_API_URL as string | undefined) ||
  deriveViewsUrl((import.meta.env.VITE_QUALITY_CHECK_API_URL as string | undefined) || DEFAULT_QUALITY_URL);

export type GeneratedView = {
  angle: number;
  /** data: URL, same-origin so the canvas never taints. */
  dataUrl: string;
  source: "generated" | "cache";
};

export { TURNAROUND_ANGLES };

/** Fetches one Gemini-generated turnaround view. Throws on any failure; the
    stage treats a missing angle as non-fatal and keeps rotating without it. */
export async function fetchProductView(
  imageUrl: string,
  angle: number,
  title: string | null
): Promise<GeneratedView> {
  const response = await fetch(VIEWS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, angle, title })
  });
  if (!response.ok) {
    throw new Error(`product-views responded with HTTP ${response.status}`);
  }
  const json = (await response.json()) as { angle: number; mime_type: string; data: string; source?: string };
  if (typeof json.data !== "string" || !json.data) {
    throw new Error("product-views returned no image data");
  }
  return {
    angle,
    dataUrl: `data:${json.mime_type || "image/png"};base64,${json.data}`,
    source: json.source === "cache" ? "cache" : "generated"
  };
}

function deriveViewsUrl(qualityUrl: string): string {
  try {
    const url = new URL(qualityUrl);
    url.pathname = url.pathname.replace(/[^/]*$/, "product-views");
    return url.toString();
  } catch {
    return qualityUrl.replace(/quality-check/, "product-views");
  }
}
