export const MESSAGE_TYPES = {
  EXTRACT_ACTIVE_TAB: "QUALITY_CHECK_EXTRACT_ACTIVE_TAB",
  EXTRACT_PAGE_DATA: "QUALITY_CHECK_EXTRACT_PAGE_DATA"
} as const;

export type ExtractActiveTabMessage = {
  type: typeof MESSAGE_TYPES.EXTRACT_ACTIVE_TAB;
};

export type ExtractPageDataMessage = {
  type: typeof MESSAGE_TYPES.EXTRACT_PAGE_DATA;
};

export type ExtensionMessage = ExtractActiveTabMessage | ExtractPageDataMessage;

export type PageSnapshot = {
  url: string;
  title: string;
  visibleText: string;
  meta: Record<string, string>;
  jsonLd: unknown[];
  hydration: EvidenceSnippet[];
  targetedText: EvidenceSnippet[];
  product: ProductExtraction;
  capturedAt: string;
};

export type PageState =
  | "product_page"
  | "not_product_page"
  | "blocked_or_unavailable"
  | "error_page"
  | "site_failover"
  | "thin_page"
  | "unsupported_page";

export type SourceMethod =
  | "json_ld"
  | "meta_tags"
  | "hydration_blob"
  | "dom_targeted"
  | "visible_text_fallback"
  | "mixed";

export type ProductFieldName =
  | "title"
  | "brand"
  | "price"
  | "currency"
  | "colour"
  | "description"
  | "materials"
  | "care"
  | "construction"
  | "origin"
  | "sizing"
  | "categoryBreadcrumbs";

export type EvidenceSource =
  | "json_ld"
  | "meta_tags"
  | "hydration_blob"
  | "dom_targeted"
  | "visible_text_fallback"
  | "image_extraction";

export type EvidenceSnippet = {
  source: EvidenceSource;
  label: string;
  text: string;
};

export type ExtractedField = {
  value: string | string[] | null;
  confidence: number;
  source: EvidenceSource | null;
  evidence: string[];
};

export type ProductExtraction = {
  pageState: PageState;
  page_state: PageState;
  sourceMethod: SourceMethod;
  source_method: SourceMethod;
  sourceConfidenceScore: number;
  source_confidence_score: number;
  fields: Record<ProductFieldName, ExtractedField>;
  imageUrls: string[];
  image_urls: string[];
  warnings: string[];
};

export type ActiveTabExtraction = {
  tabId: number;
  tabUrl?: string;
  snapshot: PageSnapshot;
};

export type BackendVerdict = {
  requestId: string;
  summary: string;
  receivedUrl: string;
  source: "backend" | "mock";
  capturedTitle: string;
};

export type BackendPayload = {
  page: PageSnapshot;
  extension: {
    stage: "stage_2";
    version: string;
  };
};

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeMessage = value as { type?: unknown };
  return (
    maybeMessage.type === MESSAGE_TYPES.EXTRACT_ACTIVE_TAB ||
    maybeMessage.type === MESSAGE_TYPES.EXTRACT_PAGE_DATA
  );
}
