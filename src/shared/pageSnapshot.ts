import type {
  BackendPayload,
  EvidenceSnippet,
  EvidenceSource,
  ExtractedField,
  PageSnapshot,
  PageState,
  ProductExtraction,
  ProductFieldName,
  SourceMethod
} from "./messages";
import { classifyProductEvidence } from "./classification";
import { createVisualEnrichment } from "./visualEnrichment";

const MAX_VISIBLE_TEXT_LENGTH = 7000;
const MAX_TARGETED_SNIPPETS = 24;
const MAX_HYDRATION_SNIPPETS = 12;
const MAX_FIELD_EVIDENCE = 4;
const MAX_IMAGES = 16;

const FIELD_NAMES: ProductFieldName[] = [
  "title",
  "brand",
  "price",
  "currency",
  "colour",
  "description",
  "materials",
  "care",
  "construction",
  "origin",
  "sizing",
  "categoryBreadcrumbs"
];

const ACCUMULATING_FIELDS = new Set<ProductFieldName>([
  "materials",
  "care",
  "construction",
  "origin",
  "sizing",
  "categoryBreadcrumbs"
]);

const TARGETED_KEYWORDS = [
  "material",
  "materials",
  "composition",
  "fabric",
  "care",
  "colour",
  "color",
  "details",
  "description",
  "editor's notes",
  "editors notes",
  "construction",
  "made in",
  "origin",
  "fit",
  "size",
  "sizing",
  "product information",
  "product details"
];

const POLLUTION_SELECTORS = [
  "header",
  "nav",
  "footer",
  "aside",
  "script",
  "style",
  "noscript",
  "svg",
  "[role='navigation']",
  "[aria-label*='breadcrumb' i]"
];

const BAD_BRAND_VALUES = new Set([
  "women",
  "men",
  "brands",
  "new in",
  "sale",
  "clothing",
  "home",
  "search",
  "account",
  "bag",
  "basket"
]);

const BAD_CURRENCY_VALUES = new Set(["ALL"]);

const FIELD_NOISE_PATTERN =
  /\b(add to cart|add to bag|add to wishlist|delivery|click & collect|free home delivery|in stock|out of stock|reviews?|rating|stars?|returns?|newsletter|sign in|checkout)\b/i;

const MATERIAL_EVIDENCE_PATTERNS = [
  /\b\d{1,3}%\s+(?:organic\s+|recycled\s+|responsible\s+|rws\s+|merino\s+)?(?:wool|cotton|linen|cashmere|silk|leather|polyester|polyamide|nylon|viscose|elastane|acrylic|sheep leather|lamb leather|fibres?)\b/i,
  /\b(?:genuine|real|soft|smooth|tumbled|full[- ]grain|suede)\s+leather\b/i,
  /\b(?:merino wool|wool blend|cotton blend|linen blend|cashmere|organic cotton|recycled polyester|polyester fleece|sheep leather|lamb leather)\b/i
];

const CARE_EVIDENCE_PATTERNS = [
  /\bmachine[- ]wash(?:able)?\b(?:(?!\b(?:Colour|Color|Designer colour|Composition|Materials?|Made in|Origin|Imported|Size|Sizing|Product details|Details)\s*:?).){0,180}/i,
  /\bhand wash\b(?:(?!\b(?:Colour|Color|Designer colour|Composition|Materials?|Made in|Origin|Imported|Size|Sizing|Product details|Details)\s*:?).){0,180}/i,
  /\b(?:specialist leather\s+)?dry clean(?: only)?\b(?:(?!\b(?:Colour|Color|Designer colour|Composition|Materials?|Made in|Origin|Imported|Size|Sizing|Product details|Details)\s*:?).){0,180}/i,
  /\bwash (?:inside out|at \d+\s?c)\b(?:(?!\b(?:Colour|Color|Designer colour|Composition|Materials?|Made in|Origin|Imported|Size|Sizing|Product details|Details)\s*:?).){0,180}/i
];

const CONSTRUCTION_EVIDENCE_PATTERNS = [
  /\b(?:cupsole|lace-up|zip closure|button[- ]down|full collar|ribbed(?: knit| trims?)?|fine[- ]gauge|heavy[- ]knit|plain stitch|perforations|stain guard|freshfeet)[^.]*\.?/i
];

type Candidate = {
  value: string | string[] | null;
  confidence: number;
  source: EvidenceSource;
  evidence: string[];
};

export function normaliseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleaned = value ? normaliseWhitespace(value) : "";
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
  }

  return result;
}

function toAbsoluteUrl(value: string, locationRef: Location): string | null {
  try {
    return new URL(value, locationRef.href).href;
  } catch {
    return null;
  }
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

export function collectJsonLd(documentRef: Document): unknown[] {
  return Array.from(documentRef.querySelectorAll("script[type='application/ld+json']"))
    .flatMap((node) => parseJsonLd(node.textContent || ""))
    .filter(Boolean);
}

function parseJsonLd(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function flattenJsonLdItems(items: unknown[]): Record<string, unknown>[] {
  const flattened: Record<string, unknown>[] = [];

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (!value || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    flattened.push(record);

    const graph = record["@graph"];
    if (Array.isArray(graph)) graph.forEach(visit);
  }

  items.forEach(visit);
  return flattened;
}

function isJsonLdType(record: Record<string, unknown>, type: string): boolean {
  const value = record["@type"];
  if (typeof value === "string") return value.toLowerCase() === type.toLowerCase();
  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === "string" && entry.toLowerCase() === type.toLowerCase());
  }
  return false;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") return normaliseWhitespace(value);
  if (typeof value === "number") return String(value);
  return null;
}

function nestedString(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  for (const key of keys) {
    const current = record[key];
    const direct = stringValue(current);
    if (direct) return direct;

    if (Array.isArray(current)) {
      for (const entry of current) {
        const nested = nestedString(entry, keys);
        if (nested) return nested;
      }
    } else {
      const nested = nestedString(current, keys);
      if (nested) return nested;
    }
  }

  return null;
}

function collectJsonLdProductCandidates(jsonLd: unknown[]): Partial<Record<ProductFieldName, Candidate[]>> {
  const products = flattenJsonLdItems(jsonLd).filter((item) => isJsonLdType(item, "Product"));
  const candidates: Partial<Record<ProductFieldName, Candidate[]>> = {};

  function add(field: ProductFieldName, value: string | string[] | null, confidence: number, label: string): void {
    if (!value || (Array.isArray(value) && value.length === 0)) return;
    candidates[field] = candidates[field] || [];
    candidates[field]!.push({
      value,
      confidence,
      source: "json_ld",
      evidence: [`JSON-LD Product ${label}`]
    });
  }

  for (const product of products) {
    add("title", stringValue(product.name), 0.96, "name");
    add("brand", extractBrandFromJsonLd(product.brand), 0.93, "brand");
    add("description", stringValue(product.description), 0.9, "description");
    add("colour", firstString(product.color, product.colour), 0.88, "color");
    add("colour", extractColourFromDescription(stringValue(product.description) || ""), 0.72, "description colour evidence");
    add("materials", firstString(product.material, product.fabric, product.composition), 0.9, "material/composition");
    add("materials", extractPatternEvidence(stringValue(product.description), MATERIAL_EVIDENCE_PATTERNS), 0.68, "description material evidence");
    add("care", extractPatternEvidence(stringValue(product.description), CARE_EVIDENCE_PATTERNS), 0.66, "description care evidence");
    add("construction", extractPatternEvidence(stringValue(product.description), CONSTRUCTION_EVIDENCE_PATTERNS), 0.58, "description construction evidence");
    add("categoryBreadcrumbs", collectCategoryValues(product), 0.82, "category");

    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    if (offer && typeof offer === "object") {
      const offerRecord = offer as Record<string, unknown>;
      add("price", stringValue(offerRecord.price) || stringValue(offerRecord.lowPrice), 0.94, "offers.price");
      add("currency", stringValue(offerRecord.priceCurrency), 0.94, "offers.priceCurrency");
    }
  }

  return candidates;
}

function extractBrandFromJsonLd(value: unknown): string | null {
  if (typeof value === "string") return normaliseWhitespace(value);
  if (Array.isArray(value)) return extractBrandFromJsonLd(value[0]);
  return nestedString(value, ["name"]);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const direct = stringValue(value);
    if (direct) return direct;

    if (Array.isArray(value)) {
      const joined = uniqueStrings(value.map(stringValue)).join(", ");
      if (joined) return joined;
    }
  }

  return null;
}

function collectCategoryValues(product: Record<string, unknown>): string[] {
  const values = [
    stringValue(product.category),
    stringValue(product.audience),
    stringValue(product.department)
  ];

  return uniqueStrings(values);
}

function collectMetaCandidates(meta: Record<string, string>): Partial<Record<ProductFieldName, Candidate[]>> {
  const candidates: Partial<Record<ProductFieldName, Candidate[]>> = {};

  function add(field: ProductFieldName, value: string | string[] | null, confidence: number, label: string): void {
    if (!value || (Array.isArray(value) && value.length === 0)) return;
    candidates[field] = candidates[field] || [];
    candidates[field]!.push({
      value,
      confidence,
      source: "meta_tags",
      evidence: [`meta ${label}`]
    });
  }

  add("title", pickMeta(meta, ["og:title", "twitter:title"]), 0.74, "title");
  add("description", pickMeta(meta, ["og:description", "description", "twitter:description"]), 0.7, "description");
  add("materials", extractPatternEvidence(pickMeta(meta, ["og:description", "description", "twitter:description"]), MATERIAL_EVIDENCE_PATTERNS), 0.54, "description material evidence");
  add("care", extractPatternEvidence(pickMeta(meta, ["og:description", "description", "twitter:description"]), CARE_EVIDENCE_PATTERNS), 0.52, "description care evidence");
  add("brand", pickMeta(meta, ["product:brand", "brand"]), 0.76, "brand");
  add(
    "price",
    pickMeta(meta, ["product:sale_price:amount", "og:sale_price:amount", "sale_price", "product:price:amount", "og:price:amount", "price", "twitter:data1"]),
    0.76,
    "price"
  );
  add("currency", pickMeta(meta, ["product:price:currency", "og:price:currency", "currency"]), 0.76, "currency");
  add("colour", pickMeta(meta, ["product:color", "product:colour", "color", "colour"]), 0.72, "colour");

  return candidates;
}

function extractPatternEvidence(value: string | null, patterns: RegExp[]): string | null {
  if (!value) return null;

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[0]) return normaliseWhitespace(match[0]);
  }

  return null;
}

function pickMeta(meta: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    if (meta[key]) return meta[key];
  }
  return null;
}

function collectBreadcrumbCandidates(documentRef: Document): Partial<Record<ProductFieldName, Candidate[]>> {
  const values = uniqueStrings([
    ...Array.from(documentRef.querySelectorAll("[aria-label*='breadcrumb' i] a, nav.breadcrumb a, .breadcrumb a, [class*='breadcrumb' i] a")).map(
      (node) => node.textContent
    ),
    ...Array.from(documentRef.querySelectorAll("[itemtype*='BreadcrumbList' i] [itemprop='name']")).map((node) => node.textContent)
  ]).filter((value) => !BAD_BRAND_VALUES.has(value.toLowerCase()));

  if (values.length === 0) return {};

  return {
    categoryBreadcrumbs: [
      {
        value: values,
        confidence: 0.72,
        source: "dom_targeted",
        evidence: ["breadcrumb DOM"]
      }
    ]
  };
}

export function collectHydrationSnippets(documentRef: Document): EvidenceSnippet[] {
  const scripts = Array.from(documentRef.querySelectorAll("script"));
  const snippets: EvidenceSnippet[] = [];
  const keywordPattern = /(product|material|composition|care|price|brand|sku|colour|color|size|fit)/i;

  for (const script of scripts) {
    const text = script.textContent || "";
    if (!keywordPattern.test(text)) continue;

    const compact = normaliseWhitespace(text);
    if (compact.length < 80) continue;

    snippets.push({
      source: "hydration_blob",
      label: script.id || script.getAttribute("type") || "script",
      text: compact.slice(0, 1200)
    });

    if (snippets.length >= MAX_HYDRATION_SNIPPETS) break;
  }

  return snippets;
}

export function collectTargetedText(documentRef: Document): EvidenceSnippet[] {
  const body = documentRef.body;
  if (!body) return [];

  const nodes = Array.from(
    body.querySelectorAll("main, article, section, div, dl, table, details, [class], [id]")
  ) as HTMLElement[];
  const snippets: EvidenceSnippet[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    if (isPollutionNode(node)) continue;

    const descriptor = `${node.id} ${node.className || ""} ${node.getAttribute("aria-label") || ""}`;
    const text = normaliseWhitespace(node.innerText || node.textContent || "");
    if (text.length < 20 || text.length > 1800) continue;
    if (!matchesTargetedKeyword(`${descriptor} ${text}`)) continue;

    const key = text.toLowerCase().slice(0, 160);
    if (seen.has(key)) continue;
    seen.add(key);

    snippets.push({
      source: "dom_targeted",
      label: normaliseWhitespace(descriptor) || node.tagName.toLowerCase(),
      text
    });

    if (snippets.length >= MAX_TARGETED_SNIPPETS) break;
  }

  return snippets;
}

function isPollutionNode(node: Element): boolean {
  return POLLUTION_SELECTORS.some((selector) => node.closest(selector));
}

function matchesTargetedKeyword(value: string): boolean {
  const lowered = value.toLowerCase();
  return TARGETED_KEYWORDS.some((keyword) => lowered.includes(keyword));
}

function collectDomCandidates(snippets: EvidenceSnippet[]): Partial<Record<ProductFieldName, Candidate[]>> {
  const candidates: Partial<Record<ProductFieldName, Candidate[]>> = {};

  function add(field: ProductFieldName, value: string | string[] | null, confidence: number, evidence: string[]): void {
    if (!value || (Array.isArray(value) && value.length === 0)) return;
    candidates[field] = candidates[field] || [];
    candidates[field]!.push({
      value,
      confidence,
      source: "dom_targeted",
      evidence
    });
  }

  for (const snippet of snippets) {
    const text = snippet.text;
    const label = snippet.label || "targeted DOM";

    add("materials", extractLineAfterLabel(text, ["materials", "material", "composition", "fabric"]), 0.75, [label]);
    add("materials", extractMaterialBlock(text), 0.76, [label]);
    add("care", extractPatternEvidence(text, CARE_EVIDENCE_PATTERNS), 0.78, [label]);
    add("care", extractLineAfterLabel(text, ["care", "care guide", "washing", "wash"]), 0.58, [label]);
    add("colour", extractColourFromText(text), 0.7, [label]);
    add("construction", extractConstructionSection(text), 0.66, [label]);
    add("origin", extractLineAfterLabel(text, ["made in", "origin", "imported"]), 0.66, [label]);
    add("sizing", extractSizingSection(text), 0.66, [label]);
    add("description", extractDescriptionFromSnippet(text), 0.58, [label]);
    add("materials", extractPatternEvidence(text, MATERIAL_EVIDENCE_PATTERNS), 0.56, [label]);
    add("construction", extractPatternEvidence(text, CONSTRUCTION_EVIDENCE_PATTERNS), 0.5, [label]);
  }

  return candidates;
}

function collectInteractiveDisclosureCandidates(snippets: EvidenceSnippet[]): Partial<Record<ProductFieldName, Candidate[]>> {
  const candidates = collectDomCandidates(snippets);

  function add(field: ProductFieldName, value: string | string[] | null, confidence: number, evidence: string[]): void {
    if (!value || (Array.isArray(value) && value.length === 0)) return;
    candidates[field] = candidates[field] || [];
    candidates[field]!.push({
      value,
      confidence,
      source: "dom_targeted",
      evidence
    });
  }

  for (const snippet of snippets) {
    const text = snippet.text;
    const label = snippet.label || "interactive disclosure";
    const labelAndText = `${label} ${text}`;

    add("description", extractInteractiveDescription(labelAndText), 0.94, [label]);
    add("materials", extractMaterialBlock(labelAndText), 0.86, [label]);
    add("care", extractCareBlock(labelAndText), 0.84, [label]);
    add("origin", extractOriginBlock(labelAndText), 0.8, [label]);
    add("sizing", extractSizingSection(labelAndText), 0.78, [label]);
    add("construction", extractConstructionSection(labelAndText), 0.78, [label]);
    add("colour", extractColourFromDescription(labelAndText), 0.74, [label]);
  }

  return candidates;
}

function extractInteractiveDescription(text: string): string | null {
  const cleaned = normaliseWhitespace(text);
  if (!/(product details|editor'?s notes|description|specs\s*&\s*features)/i.test(cleaned)) return null;
  if (FIELD_NOISE_PATTERN.test(cleaned.slice(0, 180))) return null;

  const withoutHeading = cleaned.replace(/^(product details|editor'?s notes|description|specs\s*&\s*features)\s*/i, "").trim();
  return withoutHeading.length >= 40 ? withoutHeading.slice(0, 1000) : null;
}

function extractMaterialBlock(text: string): string | null {
  const labelled = extractSectionByHeading(text, [
    "composition, care & origin",
    "materials & care instructions",
    "fabric & care",
    "materials",
    "composition",
    "fabric"
  ]);
  const source = labelled || text;
  const matches = uniqueStrings([
    ...Array.from(source.matchAll(/\b(?:shell|lining|body|trim|pocket bags|side panels, cuffs and hem|side panels|cuffs|hem)\s*:\s*[^.;]+/gi)).map((match) => match[0]),
    ...Array.from(source.matchAll(/\b\d{1,3}(?:\.\d+)?(?:-oz\s+)?%?\s*(?:postconsumer\s+|recycled\s+|organic\s+|responsible\s+)?(?:cotton|linen|wool|cashmere|sheep leather|leather|polyester|polyamide|nylon|viscose|elastane|tricot|fleece|fiber|fibres?)\b(?:\/\d{1,3}%?\s*(?:recycled\s+|postconsumer\s+)?(?:cotton|polyester|nylon|wool|other fiber))*[^.;]*/gi)).map((match) => match[0])
  ]);

  return matches.length > 0 ? matches.join("; ") : null;
}

function extractCareBlock(text: string): string | null {
  const labelled = extractSectionByHeading(text, ["care instructions", "care", "fabric & care", "composition, care & origin"]);
  const source = labelled || text;
  const explicit = source.match(/\b(?:specialist leather dry clean only|machine wash(?:able)?[^.;]*|hand wash[^.;]*|dry clean(?: only)?[^.;]*|do not bleach[^.;]*|tumble dry[^.;]*|do not iron[^.;]*)/gi);
  return explicit ? uniqueStrings(explicit).join(", ") : null;
}

function extractOriginBlock(text: string): string | null {
  const match = text.match(/\bMade in\s*:?\s*[^.;\n]+/i);
  if (!match) return null;

  return normaliseWhitespace(match[0].replace(/\s*:\s*/, " "));
}

function extractSectionByHeading(text: string, headings: string[]): string | null {
  const escaped = headings.map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const stopper =
    "Product details|Details|Editor'?s Notes|Description|Specs\\s*&\\s*Features|Materials?|Composition|Fabric|Fabric\\s*&\\s*Care|Care Instructions|Care|Made in|Origin|Imported|Size\\s*&\\s*Fit|Size|Fit|Sizing|Designer Colour|Designer Color|Colour|Color|Features|Shipping|Returns";
  const pattern = new RegExp(`(?:^|\\b)(${escaped})\\b\\s*:?\\s*([\\s\\S]{0,1200}?)(?=\\b(?:${stopper})\\b\\s*:?|$)`, "i");
  const match = text.match(pattern);
  return match?.[2] ? normaliseWhitespace(match[2]) : null;
}

function extractColourFromDescription(text: string): string | null {
  const match = text.match(/\bin\s+((?:black|white|navy|blue|grey|gray|green|khaki|olive|brown|beige|cream|ecru|stone|neutral|tan|red|pink|orange|yellow|purple)(?:\s+[a-z]+)?)\s+(?:at|from|colour|color)\b/i);
  return match?.[1] ? normaliseWhitespace(match[1]) : null;
}

function collectDomPriceCandidates(documentRef: Document): Partial<Record<ProductFieldName, Candidate[]>> {
  const candidates: Partial<Record<ProductFieldName, Candidate[]>> = {};
  const selectors = [
    "[itemprop='price']",
    "[class*='price' i]",
    "[data-tau*='price' i]",
    "[data-testid*='price' i]",
    "[aria-label*='price' i]"
  ];
  const nodes = Array.from(documentRef.querySelectorAll(selectors.join(",")));
  const seen = new Set<string>();

  function add(field: ProductFieldName, value: string | null, confidence: number, evidence: string): void {
    if (!value) return;
    candidates[field] = candidates[field] || [];
    candidates[field]!.push({
      value,
      confidence,
      source: "dom_targeted",
      evidence: [evidence]
    });
  }

  for (const node of nodes) {
    if (isPollutionNode(node)) continue;
    const raw = normaliseWhitespace(node.getAttribute("content") || node.textContent || "");
    if (!raw || seen.has(raw.toLowerCase())) continue;
    seen.add(raw.toLowerCase());

    const price = extractPrice(raw);
    if (!price) continue;

    add("price", price.amount, confidenceForDomPrice(node, raw), `price DOM: ${raw.slice(0, 160)}`);
    add("currency", price.currency, 0.68, "price DOM currency");
  }

  return candidates;
}

function extractPrice(value: string): { amount: string; currency: string | null } | null {
  const matches = Array.from(value.matchAll(/(?:£|\$|€|¥)\s*\d{1,5}(?:[,.]\d{2})?|\d{1,5}(?:[,.]\d{2})?\s*(?:GBP|USD|EUR|JPY)/gi));
  const match = choosePriceMatch(value, matches);
  if (!match?.[0]) return null;

  const raw = match[0];
  const amount = raw.replace(/[^\d.,]/g, "");
  if (!amount) return null;

  return {
    amount,
    currency: currencyFromPriceText(raw)
  };
}

function choosePriceMatch(value: string, matches: RegExpMatchArray[]): RegExpMatchArray | undefined {
  if (matches.length <= 1) return matches[0];

  const lowered = value.toLowerCase();
  const labelledSale = matches.find((match) => {
    const prefix = lowered.slice(Math.max(0, match.index! - 48), match.index);
    return /\b(?:discounted|sale|current|now|member|special|offer|deal)\s*(?:price)?\s*:?$/.test(prefix);
  });
  if (labelledSale) return labelledSale;

  const labelledRegular = matches.find((match) => {
    const prefix = lowered.slice(Math.max(0, match.index! - 48), match.index);
    return /\b(?:was|regular|original|previous|rrp)\s*(?:price)?\s*:?$/.test(prefix);
  });
  if (labelledRegular && matches.some((match) => match !== labelledRegular)) {
    return matches.find((match) => match !== labelledRegular);
  }

  if (/\b(?:sale price in effect|final sale|discounted price)\b/.test(lowered) || /-\d{1,2}%/.test(value)) {
    return matches[0];
  }

  return matches.at(-1);
}

function confidenceForDomPrice(node: Element, raw: string): number {
  const descriptor = [
    raw,
    node.getAttribute("class"),
    node.getAttribute("data-testid"),
    node.getAttribute("data-test-id"),
    node.getAttribute("data-tau"),
    node.getAttribute("aria-label")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const priceCount = Array.from(
    raw.matchAll(/(?:£|\$|€|¥)\s*\d{1,5}(?:[,.]\d{2})?|\d{1,5}(?:[,.]\d{2})?\s*(?:GBP|USD|EUR|JPY)/gi)
  ).length;

  if (/\b(?:sale|discount|reduced|current|now|member|special|offer|deal)\b/.test(descriptor) || priceCount > 1) return 0.96;
  if (/\b(?:old|was|previous|regular|original|rrp|strike|strikethrough|compare)\b/.test(descriptor)) return 0.42;
  return 0.7;
}

function currencyFromPriceText(value: string): string | null {
  if (value.includes("£") || /\bGBP\b/i.test(value)) return "GBP";
  if (value.includes("$") || /\bUSD\b/i.test(value)) return "USD";
  if (value.includes("€") || /\bEUR\b/i.test(value)) return "EUR";
  if (value.includes("¥") || /\bJPY\b/i.test(value)) return "JPY";
  return null;
}

function collectHydrationCandidates(snippets: EvidenceSnippet[]): Partial<Record<ProductFieldName, Candidate[]>> {
  const candidates: Partial<Record<ProductFieldName, Candidate[]>> = {};

  function add(field: ProductFieldName, value: string | null, confidence: number, evidence: string[]): void {
    if (!value) return;
    candidates[field] = candidates[field] || [];
    candidates[field]!.push({
      value,
      confidence,
      source: "hydration_blob",
      evidence
    });
  }

  for (const snippet of snippets) {
    const text = snippet.text;
    const label = snippet.label || "hydration blob";

    add("title", extractJsonishString(text, ["name", "title", "productName"]), 0.8, [label]);
    add("brand", extractJsonishString(text, ["brand", "brandName"]), 0.78, [label]);
    add("price", extractJsonishString(text, ["currentPrice", "salePrice", "salesPrice", "price"]), 0.8, [label]);
    add("currency", extractJsonishString(text, ["currency", "priceCurrency"]), 0.78, [label]);
    add("colour", extractJsonishString(text, ["colour", "color", "colorName", "colourName"]), 0.74, [label]);
    add("description", extractJsonishString(text, ["description", "shortDescription"]), 0.72, [label]);
    add("materials", extractJsonishString(text, ["material", "materials", "composition", "fabric"]), 0.76, [label]);
    add("care", extractJsonishString(text, ["care", "careInstructions", "washCare"]), 0.72, [label]);
  }

  return candidates;
}

function collectStructuredScriptCandidates(documentRef: Document): Partial<Record<ProductFieldName, Candidate[]>> {
  const candidates: Partial<Record<ProductFieldName, Candidate[]>> = {};
  const scripts = Array.from(documentRef.querySelectorAll("script"));

  function add(field: ProductFieldName, value: string | string[] | null, confidence: number, evidence: string): void {
    if (!value || (Array.isArray(value) && value.length === 0)) return;
    candidates[field] = candidates[field] || [];
    candidates[field]!.push({
      value,
      confidence,
      source: "hydration_blob",
      evidence: [evidence]
    });
  }

  for (const script of scripts) {
    if ((script.getAttribute("type") || "").toLowerCase() === "application/ld+json") continue;

    const text = script.textContent?.trim();
    if (!text || !/(product|material|composition|care|price|brand|sku|colour|color|fit)/i.test(text)) continue;

    const parsed = parseEmbeddedJson(text);
    if (!parsed) continue;

    const records = flattenObjectRecords(parsed)
      .filter(looksLikeProductRecord)
      .slice(0, 8);

    for (const record of records) {
      const label = script.id || script.getAttribute("type") || "structured script";
      const description = firstString(
        record.description,
        record.shortDescription,
        record.longDescription,
        record.pr_long_description_desc
      );
      const material = firstString(
        parseCompositionValue(record.var_material_composition_desc),
        record.material,
        record.materials,
        record.composition,
        record.fabric,
        record.item_pim_material,
        extractPatternEvidence(description, MATERIAL_EVIDENCE_PATTERNS)
      );
      const care = firstString(
        joinStringArray(record.var_care_instruction),
        record.care,
        record.careInstructions,
        record.washCare,
        extractPatternEvidence(description, CARE_EVIDENCE_PATTERNS)
      );
      const categories = uniqueStrings([
        ...stringArrayValue(record.categoryName),
        ...stringArrayValue(record.categories),
        stringValue(record.category),
        stringValue(record.productCategory),
        stringValue(record.pr_assortment_type),
        stringValue(record.pr_product_type_name)
      ]);
      const colour = firstString(
        record.color,
        record.colour,
        record.colorName,
        record.colourName,
        record.displayColor,
        record.displayColour,
        nestedString(record.representative, ["name"])
      );
      const sizing = uniqueStrings([
        stringValue(record.fit),
        stringValue(record.pr_fit),
        stringValue(record.size),
        stringValue(record.sizing),
        stringValue(record.pr_garment_length),
        stringValue(record.pr_sleeve_length),
        joinStringArray(record.pr_neckline_style)
      ]);

      add("title", firstString(record.name, record.defaultName, record.title, record.productName), 0.84, `${label} product title`);
      add("brand", firstString(record.brandName, record.pr_external_brand, record.brand, nestedString(record.brand, ["name"])), 0.82, `${label} product brand`);
      add("price", firstString(record.currentPrice, record.salePrice, record.salesPrice, record.priceAsNumber, record.price), 0.82, `${label} product price`);
      add("currency", firstString(record.currency, record.priceCurrency), 0.8, `${label} product currency`);
      add("colour", colour, 0.78, `${label} product colour`);
      add("description", description, 0.78, `${label} product description`);
      add("materials", material, 0.82, `${label} product material/composition`);
      add("care", care, 0.78, `${label} product care`);
      add("construction", extractPatternEvidence(description, CONSTRUCTION_EVIDENCE_PATTERNS), 0.62, `${label} construction evidence`);
      add("origin", firstString(record.countryOfOrigin, record.madeIn, record.origin, parseOriginValue(record.var_compliance_details_key)), 0.68, `${label} origin`);
      add("sizing", sizing.length > 0 ? sizing : null, 0.68, `${label} fit/sizing`);
      add("categoryBreadcrumbs", categories.length > 0 ? categories : null, 0.68, `${label} category`);
    }
  }

  return candidates;
}

function extractJsonishString(text: string, keys: string[]): string | null {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const quoted = text.match(new RegExp(`["']${escaped}["']\\s*:\\s*["']([^"']{1,500})["']`, "i"));
    if (quoted?.[1]) return normaliseWhitespace(quoted[1]);

    const numeric = text.match(new RegExp(`["']${escaped}["']\\s*:\\s*([0-9]+(?:[.,][0-9]+)?)`, "i"));
    if (numeric?.[1]) return normaliseWhitespace(numeric[1]);
  }

  return null;
}

function parseEmbeddedJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    const objectStart = text.indexOf("{");
    const objectEnd = text.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      try {
        return JSON.parse(text.slice(objectStart, objectEnd + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

function flattenObjectRecords(value: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];

  function visit(current: unknown): void {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }

    if (!current || typeof current !== "object") return;

    const record = current as Record<string, unknown>;
    records.push(record);
    Object.values(record).forEach((entry) => {
      if (entry && typeof entry === "object") visit(entry);
    });
  }

  visit(value);
  return records;
}

function looksLikeProductRecord(record: Record<string, unknown>): boolean {
  const keys = Object.keys(record).join(" ").toLowerCase();
  const hasName = Boolean(firstString(record.name, record.defaultName, record.title, record.productName));
  const hasProductMarker = /(product|sku|price|material|composition|care|brand|variant|colour|color)/i.test(keys);
  const hasUsefulFact = Boolean(
    firstString(
      record.price,
      record.priceAsNumber,
      record.description,
      record.material,
      record.materials,
      record.composition,
      record.var_material_composition_desc,
      record.care,
      record.careInstructions,
      joinStringArray(record.var_care_instruction)
    )
  );

  return hasName && hasProductMarker && hasUsefulFact;
}

function joinStringArray(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  return uniqueStrings(value.map(stringValue)).join(", ") || null;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (Array.isArray(entry) ? stringArrayValue(entry) : [stringValue(entry)])).filter(Boolean) as string[];
}

function parseCompositionValue(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as unknown;
    const parts = flattenObjectRecords(parsed)
      .filter((record) => record.material || record.name)
      .map((record) => {
        const material = firstString(record.material, record.name);
        const percentage = firstString(record.percentage, record.percent);
        if (!material) return null;
        return percentage ? `${material} ${percentage}%` : material;
      });
    return uniqueStrings(parts).join(", ") || text;
  } catch {
    return text;
  }
}

function parseOriginValue(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as unknown;
    const country = flattenObjectRecords(parsed)
      .map((record) => firstString(record.countryName, record.country, record.value))
      .find(Boolean);
    return country ? `Made in ${country}` : null;
  } catch {
    return null;
  }
}

function extractLineAfterLabel(text: string, labels: string[]): string | null {
  const parts = splitIntoFactParts(text);
  const lowerLabels = labels.map((label) => label.toLowerCase());

  for (const part of parts) {
    const lowered = part.toLowerCase();
    if (lowerLabels.some((label) => hasLabelCue(lowered, label))) {
      return cleanLabelledFact(part);
    }
  }

  return null;
}

function splitIntoFactParts(text: string): string[] {
  return text
    .replace(/\s+(?=(?:Materials?|Composition|Fabric|Care|Washing|Construction|Product details|Details|Editor'?s Notes|Made in|Origin|Imported|Size & Fit|Size|Fit|Sizing|Designer Colour|Designer Color|Colour|Color)\s*:)/gi, "\n")
    .split(/(?<=[.!?])\s+|\n+/)
    .map(normaliseWhitespace)
    .filter(Boolean);
}

function cleanLabelledFact(value: string): string | null {
  const cleaned = normaliseWhitespace(value)
    .replace(/^(materials?|composition|fabric|care|care guide|washing|wash|construction|product details|details|editor'?s notes|made in|origin|imported|size & fit|size|fit|sizing|designer colour|designer color|colour|color)\s*[:\-]\s*/i, "")
    .replace(/\s+(?=(?:Materials?|Composition|Fabric|Care|Washing|Construction|Product details|Details|Editor'?s Notes|Made in|Origin|Imported|Size & Fit|Size|Fit|Sizing|Designer Colour|Designer Color|Colour|Color)\s*:).*$/i, "")
    .trim();

  if (!cleaned || FIELD_NOISE_PATTERN.test(cleaned)) return null;
  return cleaned.slice(0, 500);
}

function extractColourFromText(text: string): string | null {
  const labelled = extractLineAfterLabel(text, ["designer colour", "designer color", "colour", "color"]);
  if (!labelled) return null;

  const cleaned = labelled.replace(/^\d{1,4}\s+/, "").replace(/\s+Size:.*$/i, "").trim();
  if (!cleaned || cleaned.length > 80 || FIELD_NOISE_PATTERN.test(cleaned)) return null;
  return cleaned;
}

function extractConstructionSection(text: string): string | null {
  const patternEvidence = extractPatternEvidence(text, CONSTRUCTION_EVIDENCE_PATTERNS);
  if (patternEvidence) return patternEvidence;

  const labelled = extractLineAfterLabel(text, ["construction"]);
  if (!labelled || labelled.length > 350 || FIELD_NOISE_PATTERN.test(labelled)) return null;
  return labelled;
}

function extractSizingSection(text: string): string | string[] | null {
  const sizeFitMatch = text.match(/\bSize\s*&\s*Fit\b([\s\S]{0,900})/i);
  if (sizeFitMatch?.[1]) {
    const facts = splitIntoFactParts(sizeFitMatch[1])
      .map((part) => cleanLabelledFact(part) || part)
      .filter((part) => /(?:fits?|fit\b|model|measures|wearing|true to size|regular|oversized|slim|relaxed|chest|height|waist|inseam|UK\/US|IT\/FR\/EU)/i.test(part))
      .filter((part) => !FIELD_NOISE_PATTERN.test(part))
      .slice(0, 10);
    if (facts.length > 0) return uniqueStrings(facts);
  }

  const labelled = extractLineAfterLabel(text, ["fit", "sizing"]);
  if (!labelled || labelled.length > 350 || FIELD_NOISE_PATTERN.test(labelled)) return null;
  if (/^(?:men|women|unisex)?\s*(?:xxs|xs|s|m|l|xl|xxl|3xl|\d+\s*){2,}$/i.test(labelled.replace(/\s+/g, " "))) return null;
  return labelled;
}

function hasLabelCue(text: string, label: string): boolean {
  if (label.includes(" ")) return text.includes(label);

  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\b)${escaped}s?\\s*[:\\-]`).test(text);
}

function extractDescriptionFromSnippet(text: string): string | null {
  const lowered = text.toLowerCase();
  if (!lowered.includes("description") && !lowered.includes("product details") && !lowered.includes("editor's notes") && !lowered.includes("editors notes")) return null;
  return text.slice(0, 600);
}

function collectVisibleFallbackCandidates(visibleText: string, pageTitle: string): Partial<Record<ProductFieldName, Candidate[]>> {
  const candidates: Partial<Record<ProductFieldName, Candidate[]>> = {};

  if (pageTitle) {
    candidates.title = [
      {
        value: pageTitle,
        confidence: 0.48,
        source: "visible_text_fallback",
        evidence: ["document title"]
      }
    ];
  }

  const materials = extractLineAfterLabel(visibleText, ["materials", "material", "composition", "fabric"]);
  if (materials) {
    candidates.materials = [
      {
        value: materials,
        confidence: 0.45,
        source: "visible_text_fallback",
        evidence: ["visible page text"]
      }
    ];
  }

  const price = extractPrice(visibleText);
  if (price) {
    candidates.price = [
      {
        value: price.amount,
        confidence: 0.44,
        source: "visible_text_fallback",
        evidence: ["visible page text price"]
      }
    ];

    if (price.currency) {
      candidates.currency = [
        {
          value: price.currency,
          confidence: 0.44,
          source: "visible_text_fallback",
          evidence: ["visible page text currency"]
        }
      ];
    }
  }

  return candidates;
}

function collectUrlCandidates(locationRef: Location): Partial<Record<ProductFieldName, Candidate[]>> {
  const candidates: Partial<Record<ProductFieldName, Candidate[]>> = {};

  if (locationRef.hostname.toLowerCase().includes("mrporter.com")) {
    const brandSlug = locationRef.pathname.match(/\/product\/([^/]+)/i)?.[1];
    const brand = formatMrPorterBrand(brandSlug);
    if (brand) {
      candidates.brand = [
        {
          value: brand,
          confidence: 0.7,
          source: "dom_targeted",
          evidence: ["MR PORTER product URL brand slug"]
        }
      ];
    }
  }

  return candidates;
}

function formatMrPorterBrand(value: string | null | undefined): string | null {
  if (!value) return null;
  const decoded = decodeURIComponent(value).replace(/-/g, " ").trim();
  if (!decoded) return null;
  if (decoded.toLowerCase() === "mr p") return "MR P.";
  return decoded
    .split(/\s+/)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

export function collectImageUrls(documentRef: Document, locationRef: Location, jsonLd: unknown[], meta: Record<string, string>): string[] {
  const jsonLdImages = flattenJsonLdItems(jsonLd)
    .filter((item) => isJsonLdType(item, "Product"))
    .flatMap((item) => normaliseImageValue(item.image));

  const metaImages = [
    meta["og:image"],
    meta["twitter:image"],
    documentRef.querySelector("link[rel='image_src']")?.getAttribute("href")
  ];

  const domImages = Array.from(documentRef.images)
    .filter((image) => looksLikeProductImage(image))
    .map((image) => image.currentSrc || image.src || image.getAttribute("src"));

  return uniqueStrings([...jsonLdImages, ...metaImages, ...domImages].map((url) => (url ? toAbsoluteUrl(url, locationRef) : null))).slice(
    0,
    MAX_IMAGES
  );
}

function normaliseImageValue(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(normaliseImageValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return uniqueStrings([stringValue(record.url), stringValue(record.contentUrl)]);
  }
  return [];
}

function looksLikeProductImage(image: HTMLImageElement): boolean {
  const descriptor = `${image.alt || ""} ${image.id || ""} ${image.className || ""}`.toLowerCase();
  if (/(logo|icon|sprite|avatar|payment|klarna|trustpilot|flag)/.test(descriptor)) return false;

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (width && height && (width < 180 || height < 180)) return false;

  return Boolean(image.currentSrc || image.src || image.getAttribute("src"));
}

function createEmptyFields(): Record<ProductFieldName, ExtractedField> {
  return FIELD_NAMES.reduce(
    (fields, field) => {
      fields[field] = {
        value: null,
        confidence: 0,
        source: null,
        evidence: []
      };
      return fields;
    },
    {} as Record<ProductFieldName, ExtractedField>
  );
}

function mergeCandidates(groups: Array<Partial<Record<ProductFieldName, Candidate[]>>>): Record<ProductFieldName, ExtractedField> {
  const fields = createEmptyFields();

  for (const field of FIELD_NAMES) {
    const candidates = groups.flatMap((group) => group[field] || []).filter((candidate) => hasValue(candidate.value));
    const merged = mergeFieldCandidates(field, candidates);
    if (merged) fields[field] = merged;
  }

  if (fields.brand.value && typeof fields.brand.value === "string" && BAD_BRAND_VALUES.has(fields.brand.value.toLowerCase())) {
    fields.brand = {
      value: null,
      confidence: 0,
      source: null,
      evidence: []
    };
  }

  if (fields.currency.value && typeof fields.currency.value === "string" && BAD_CURRENCY_VALUES.has(fields.currency.value.toUpperCase())) {
    fields.currency = {
      value: null,
      confidence: 0,
      source: null,
      evidence: []
    };
  }

  return fields;
}

function mergeFieldCandidates(field: ProductFieldName, candidates: Candidate[]): ExtractedField | null {
  const sorted = candidates
    .map((candidate) => ({
      ...candidate,
      value: sanitizeFieldValue(field, candidate.value)
    }))
    .filter((candidate): candidate is Candidate & { value: string | string[] } => hasValue(candidate.value))
    .sort((a, b) => b.confidence - a.confidence);

  const best = sorted[0];
  if (!best) return null;

  if (!ACCUMULATING_FIELDS.has(field)) {
    return {
      value: best.value,
      confidence: best.confidence,
      source: best.source,
      evidence: best.evidence.slice(0, MAX_FIELD_EVIDENCE)
    };
  }

  const additionalThreshold = Math.max(field === "materials" || field === "care" ? 0.8 : 0.7, best.confidence - 0.22);
  const merged = sorted
    .filter((candidate, index) => index === 0 || candidate.confidence >= additionalThreshold)
    .reduce<string[]>((facts, candidate) => mergeFactValues(facts, candidate.value), []);

  if (merged.length === 0) return null;

  return {
    value: field === "categoryBreadcrumbs" || field === "sizing" ? merged : merged.join("; "),
    confidence: best.confidence,
    source: best.source,
    evidence: uniqueStrings(sorted.flatMap((candidate) => candidate.evidence)).slice(0, MAX_FIELD_EVIDENCE)
  };
}

function mergeFactValues(existing: string[], value: string | string[] | null): string[] {
  const values = Array.isArray(value) ? value : splitCompositeFieldValue(value);
  let facts = [...existing];

  for (const raw of values) {
    const fact = normaliseWhitespace(raw);
    if (!fact || FIELD_NOISE_PATTERN.test(fact)) continue;

    const factKey = fact.toLowerCase();
    const matchingIndex = facts.findIndex((existingFact) => factsOverlap(existingFact.toLowerCase(), factKey));
    if (matchingIndex < 0) {
      facts.push(fact);
      continue;
    }

    if (fact.length > facts[matchingIndex].length + 12) facts[matchingIndex] = fact;
  }

  facts = uniqueStrings(facts);
  return facts.slice(0, 10);
}

function splitCompositeFieldValue(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/\s*;\s*/)
    .map(normaliseWhitespace)
    .filter(Boolean);
}

function factsOverlap(existing: string, incoming: string): boolean {
  if (existing === incoming) return true;
  if (existing.includes(incoming) || incoming.includes(existing)) return true;
  const existingLabel = existing.match(/^([^:]{1,60}):/)?.[1]?.trim();
  const incomingLabel = incoming.match(/^([^:]{1,60}):/)?.[1]?.trim();
  if (existingLabel && incomingLabel && existingLabel !== incomingLabel) return false;
  if (Boolean(existingLabel) !== Boolean(incomingLabel)) return false;

  const existingMaterial = existing.match(/\b(?:wool|cotton|linen|cashmere|silk|leather|polyester|polyamide|nylon|viscose|elastane|acrylic|fleece|fibres?|fiber)\b/i)?.[0];
  const incomingMaterial = incoming.match(/\b(?:wool|cotton|linen|cashmere|silk|leather|polyester|polyamide|nylon|viscose|elastane|acrylic|fleece|fibres?|fiber)\b/i)?.[0];
  return Boolean(existingMaterial && incomingMaterial && existingMaterial.toLowerCase() === incomingMaterial.toLowerCase());
}

function hasValue(value: string | string[] | null): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function sanitizeFieldValue(field: ProductFieldName, value: string | string[] | null): string | string[] | null {
  if (Array.isArray(value)) return uniqueStrings(value);
  if (!value) return null;

  const cleaned = normaliseWhitespace(value);
  if (field === "price") {
    const price = cleaned.replace(/[^\d.,£$€¥]/g, "").slice(0, 80);
    const numeric = Number(price.replace(/[£$€¥,]/g, ""));
    if (!price || numeric === 0) return null;
    return price;
  }
  if (field === "colour") return cleaned.replace(/^\d{1,4}\s+/, "").slice(0, 120);
  return cleaned.slice(0, 1000);
}

function isSupportedPageLocation(locationRef: Location): boolean {
  if (!["http:", "https:"].includes(locationRef.protocol)) return false;
  if (/\.(?:pdf|docx?|xlsx?|pptx?)(?:$|[?#])/i.test(locationRef.pathname)) return false;
  return true;
}

function classifyPageState(
  visibleText: string,
  fields: Record<ProductFieldName, ExtractedField>,
  jsonLd: unknown[],
  locationRef: Location
): PageState {
  if (!isSupportedPageLocation(locationRef)) return "unsupported_page";

  const lowered = visibleText.toLowerCase();
  if (/(access denied|forbidden|captcha|enable cookies|temporarily unavailable|request blocked|just a moment|checking your browser)/.test(lowered)) {
    return "blocked_or_unavailable";
  }
  if (/(404|page not found|something went wrong|error loading)/.test(lowered)) return "error_page";
  if (/(sorry, we are unable|site maintenance|failover page|hang tight|routing to checkout)/.test(lowered)) return "site_failover";

  const hasProductJsonLd = flattenJsonLdItems(jsonLd).some((item) => isJsonLdType(item, "Product"));
  const hasTargetedProductEvidence = Boolean(
    (fields.price.value && fields.price.source !== "visible_text_fallback") ||
      (fields.description.value && fields.description.source !== "visible_text_fallback") ||
      (fields.materials.value && fields.materials.source !== "visible_text_fallback")
  );
  const hasVisibleFallbackProductEvidence = Boolean(
    fields.title.value &&
      fields.title.source === "visible_text_fallback" &&
      (fields.price.value || fields.materials.value) &&
      /(?:\/products?\/|\/productpage\.|\/style\/|\/p\/|product\.|clp\d+|p\d{8})/i.test(locationRef.pathname)
  );
  const hasProductFacts = Boolean(fields.title.value && (hasTargetedProductEvidence || hasVisibleFallbackProductEvidence));
  if (hasProductJsonLd || hasProductFacts) return "product_page";

  if (visibleText.length < 40) return "thin_page";
  return "not_product_page";
}

function inferSourceMethod(fields: Record<ProductFieldName, ExtractedField>): SourceMethod {
  const sources = uniqueStrings(FIELD_NAMES.map((field) => fields[field].source));
  if (sources.length === 0) return "visible_text_fallback";
  if (sources.length === 1) return sources[0] as SourceMethod;
  return "mixed";
}

function calculateSourceConfidence(fields: Record<ProductFieldName, ExtractedField>, pageState: PageState): number {
  if (pageState !== "product_page") return 0;

  const weights: Partial<Record<ProductFieldName, number>> = {
    title: 1.2,
    brand: 0.9,
    price: 0.9,
    colour: 0.4,
    description: 0.8,
    materials: 1.1,
    care: 0.5,
    construction: 0.5,
    categoryBreadcrumbs: 0.5
  };

  let weightedScore = 0;
  let totalWeight = 0;

  for (const [field, weight] of Object.entries(weights) as Array<[ProductFieldName, number]>) {
    weightedScore += fields[field].confidence * weight;
    totalWeight += weight;
  }

  return Math.round((weightedScore / totalWeight) * 100) / 100;
}

function collectWarnings(fields: Record<ProductFieldName, ExtractedField>, pageState: PageState, imageUrls: string[]): string[] {
  const warnings: string[] = [];

  if (pageState !== "product_page") warnings.push(`page classified as ${pageState}`);
  for (const field of FIELD_NAMES) {
    const value = fields[field].value;
    if (hasValue(value) && fields[field].confidence > 0 && fields[field].confidence < 0.6) {
      warnings.push(`low-confidence ${field} from ${fields[field].source}`);
    }
  }
  if (!fields.materials.value) warnings.push("materials/composition not found");
  if (!fields.care.value) warnings.push("care information not found");
  if (!fields.brand.value) warnings.push("brand not found");
  if (!fields.price.value) warnings.push("price not found");
  if (imageUrls.length === 0) warnings.push("product images not found");

  return warnings;
}

export function enrichProductWithEvidenceSnippets(snapshot: PageSnapshot, snippets: EvidenceSnippet[]): PageSnapshot {
  if (snippets.length === 0) return snapshot;

  const candidates = collectInteractiveDisclosureCandidates(snippets);

  for (const field of FIELD_NAMES) {
    const fieldCandidates = (candidates[field] || []).filter((candidate) => hasValue(candidate.value));
    const existing = snapshot.product.fields[field];
    const merged = mergeFieldCandidates(field, [
      ...(hasValue(existing.value) && existing.source
        ? [
            {
              value: existing.value,
              confidence: existing.confidence,
              source: existing.source,
              evidence: existing.evidence
            }
          ]
        : []),
      ...fieldCandidates
    ]);

    if (merged) snapshot.product.fields[field] = merged;
  }

  snapshot.targetedText = [...snapshot.targetedText, ...snippets].slice(0, MAX_TARGETED_SNIPPETS + snippets.length);
  snapshot.product.sourceMethod = inferSourceMethod(snapshot.product.fields);
  snapshot.product.source_method = snapshot.product.sourceMethod;
  snapshot.product.sourceConfidenceScore = calculateSourceConfidence(snapshot.product.fields, snapshot.product.pageState);
  snapshot.product.source_confidence_score = snapshot.product.sourceConfidenceScore;
  snapshot.product.warnings = collectWarnings(snapshot.product.fields, snapshot.product.pageState, snapshot.product.imageUrls);

  return snapshot;
}

function clearProductFieldsForNonProductPage(
  fields: Record<ProductFieldName, ExtractedField>,
  pageState: PageState
): Record<ProductFieldName, ExtractedField> {
  if (pageState === "product_page") return fields;

  return createEmptyFields();
}

export function extractProductData(documentRef: Document, locationRef: Location): ProductExtraction {
  const meta = collectMetaTags(documentRef);
  const jsonLd = collectJsonLd(documentRef);
  const hydration = collectHydrationSnippets(documentRef);
  const targetedText = collectTargetedText(documentRef);
  const visibleText = normaliseWhitespace(documentRef.body?.innerText || documentRef.body?.textContent || "").slice(0, MAX_VISIBLE_TEXT_LENGTH);
  const pageTitle = normaliseWhitespace(documentRef.title || "");
  const imageUrls = collectImageUrls(documentRef, locationRef, jsonLd, meta);

  const fields = mergeCandidates([
    collectJsonLdProductCandidates(jsonLd),
    collectMetaCandidates(meta),
    collectStructuredScriptCandidates(documentRef),
    collectHydrationCandidates(hydration),
    collectBreadcrumbCandidates(documentRef),
    collectDomPriceCandidates(documentRef),
    collectDomCandidates(targetedText),
    collectUrlCandidates(locationRef),
    collectVisibleFallbackCandidates(visibleText, pageTitle)
  ]);
  const pageState = classifyPageState(`${pageTitle} ${visibleText}`, fields, jsonLd, locationRef);
  const productFields = clearProductFieldsForNonProductPage(fields, pageState);
  const sourceMethod = inferSourceMethod(productFields);
  const sourceConfidenceScore = calculateSourceConfidence(productFields, pageState);

  return {
    pageState,
    page_state: pageState,
    sourceMethod,
    source_method: sourceMethod,
    sourceConfidenceScore,
    source_confidence_score: sourceConfidenceScore,
    fields: productFields,
    imageUrls,
    image_urls: imageUrls,
    warnings: collectWarnings(productFields, pageState, imageUrls)
  };
}

export function createPageSnapshot(documentRef: Document, locationRef: Location): PageSnapshot {
  const meta = collectMetaTags(documentRef);
  const jsonLd = collectJsonLd(documentRef);
  const hydration = collectHydrationSnippets(documentRef);
  const targetedText = collectTargetedText(documentRef);
  const visibleText = normaliseWhitespace(documentRef.body?.innerText || documentRef.body?.textContent || "").slice(0, MAX_VISIBLE_TEXT_LENGTH);
  const product = extractProductData(documentRef, locationRef);

  return {
    url: locationRef.href,
    title: normaliseWhitespace(documentRef.title || ""),
    visibleText,
    meta,
    jsonLd,
    hydration,
    targetedText,
    product,
    capturedAt: new Date().toISOString()
  };
}

export function createBackendPayload(page: PageSnapshot): BackendPayload {
  const classification = classifyProductEvidence(page.product);

  return {
    page,
    classification,
    visual_enrichment: createVisualEnrichment(page.product, classification),
    extension: {
      stage: "stage_5",
      version: "0.5.0"
    }
  };
}
