import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { collectMetaTags, createBackendPayload, createPageSnapshot, normaliseWhitespace } from "./pageSnapshot";

describe("page snapshot helpers", () => {
  it("normalises whitespace", () => {
    expect(normaliseWhitespace("  Wool   jumper\n\nwith   rib trim  ")).toBe("Wool jumper with rib trim");
  });

  it("collects named, property, and itemprop meta tags once", () => {
    const dom = new JSDOM(`
      <meta property="og:title" content="Merino Jumper">
      <meta name="description" content="Soft knitwear">
      <meta itemprop="brand" content="COS">
      <meta property="og:title" content="Duplicate">
    `);

    expect(collectMetaTags(dom.window.document)).toEqual({
      "og:title": "Merino Jumper",
      description: "Soft knitwear",
      brand: "COS"
    });
  });

  it("creates a bounded stage 1 backend payload", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title> Test Product </title>
        <body>${"Visible text ".repeat(1000)}</body>
      `,
      { url: "https://example.com/products/test" }
    );

    const snapshot = createPageSnapshot(dom.window.document, dom.window.location);
    const payload = createBackendPayload(snapshot);

    expect(snapshot.url).toBe("https://example.com/products/test");
    expect(snapshot.title).toBe("Test Product");
    expect(snapshot.visibleText.length).toBeLessThanOrEqual(5000);
    expect(payload.extension.stage).toBe("stage_1");
    expect(payload.page).toBe(snapshot);
  });
});
