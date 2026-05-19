import type { BackendPayload, PageSnapshot } from "./messages";

const MAX_VISIBLE_TEXT_LENGTH = 5000;

export function normaliseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function collectMetaTags(documentRef: Document): Record<string, string> {
  const meta: Record<string, string> = {};
  const nodes = Array.from(documentRef.querySelectorAll("meta"));

  for (const node of nodes) {
    const key =
      node.getAttribute("property") ||
      node.getAttribute("name") ||
      node.getAttribute("itemprop");
    const content = node.getAttribute("content");

    if (key && content && !meta[key]) {
      meta[key] = normaliseWhitespace(content);
    }
  }

  return meta;
}

export function createPageSnapshot(documentRef: Document, locationRef: Location): PageSnapshot {
  return {
    url: locationRef.href,
    title: normaliseWhitespace(documentRef.title || ""),
    visibleText: normaliseWhitespace(documentRef.body?.innerText || "").slice(0, MAX_VISIBLE_TEXT_LENGTH),
    meta: collectMetaTags(documentRef),
    capturedAt: new Date().toISOString()
  };
}

export function createBackendPayload(page: PageSnapshot): BackendPayload {
  return {
    page,
    extension: {
      stage: "stage_1",
      version: "0.1.0"
    }
  };
}
