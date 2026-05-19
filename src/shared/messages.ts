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
  capturedAt: string;
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
    stage: "stage_1";
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
