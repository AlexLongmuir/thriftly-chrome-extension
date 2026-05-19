import type { ExtractedField, PageSnapshot, ProductFieldName, SourceMethod } from "./messages";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type RetailerLocation = Pick<Location, "href" | "hostname" | "pathname">;

type FieldPatch = Partial<Record<ProductFieldName, string | string[] | null>>;

type RetailerRecovery = {
  fields: FieldPatch;
  imageUrls?: string[];
  evidenceLabel: string;
  warning: string;
  confidence?: Partial<Record<ProductFieldName, number>>;
};

const FIELD_CONFIDENCE: Partial<Record<ProductFieldName, number>> = {
  title: 0.86,
  brand: 0.82,
  price: 0.84,
  currency: 0.82,
  colour: 0.78,
  description: 0.8,
  care: 0.72,
  construction: 0.72,
  origin: 0.72,
  sizing: 0.7,
  materials: 0.82,
  categoryBreadcrumbs: 0.7
};

const ACCUMULATING_FIELDS = new Set<ProductFieldName>([
  "materials",
  "care",
  "construction",
  "origin",
  "sizing",
  "categoryBreadcrumbs"
]);

export async function createPageSnapshotWithRetailerFallbacks(
  documentRef: Document,
  locationRef: Location,
  fetcher: Fetcher = fetch
): Promise<PageSnapshot> {
  const { createPageSnapshot } = await import("./pageSnapshot");
  const snapshot = createPageSnapshot(documentRef, locationRef);
  return enrichPageSnapshotWithRetailerFallbacks(snapshot, locationRef, fetcher);
}

export async function enrichPageSnapshotWithRetailerFallbacks(
  snapshot: PageSnapshot,
  locationRef: RetailerLocation,
  fetcher: Fetcher = fetch
): Promise<PageSnapshot> {
  const recovery = await recoverRetailerProductData(locationRef, fetcher);
  if (!recovery) {
    markKnownRetailerBlockedStates(snapshot, locationRef);
    return snapshot;
  }

  applyRecovery(snapshot, recovery);
  return snapshot;
}

function markKnownRetailerBlockedStates(snapshot: PageSnapshot, locationRef: RetailerLocation): void {
  const hostname = locationRef.hostname.toLowerCase();
  if (!hostname.includes("allsaints.com")) return;
  if (snapshot.product.pageState === "product_page") return;

  snapshot.product.pageState = "blocked_or_unavailable";
  snapshot.product.page_state = "blocked_or_unavailable";
  snapshot.product.sourceConfidenceScore = 0;
  snapshot.product.source_confidence_score = 0;
  snapshot.product.warnings = recoveryWarnings(snapshot, "AllSaints product page unavailable to extractor");
}

async function recoverRetailerProductData(locationRef: RetailerLocation, fetcher: Fetcher): Promise<RetailerRecovery | null> {
  const hostname = locationRef.hostname.toLowerCase();

  if (hostname.includes("hm.com")) return recoverHmProduct(locationRef, fetcher);
  if (hostname.includes("uniqlo.com")) return recoverUniqloProduct(locationRef, fetcher);
  if (hostname.includes("zara.com")) return recoverZaraProduct(locationRef, fetcher);
  if (hostname.includes("patagonia.com")) return recoverPatagoniaProduct(locationRef, fetcher);
  if (hostname.includes("arket.com")) return recoverArketProduct(locationRef, fetcher);
  if (hostname.includes("allsaints.com")) return recoverAllSaintsProduct(locationRef, fetcher);
  if (hostname.includes("next.co.uk")) return recoverNextProduct(locationRef, fetcher);
  if (hostname.includes("marksandspencer.com")) return recoverMarksAndSpencerProduct(locationRef, fetcher);

  return null;
}

async function recoverHmProduct(locationRef: RetailerLocation, fetcher: Fetcher): Promise<RetailerRecovery | null> {
  const articleNumber = locationRef.pathname.match(/productpage\.(\d+)\.html/i)?.[1];
  if (!articleNumber) return null;

  const response = await fetchJson<Record<string, unknown>>(
    `https://tags.tiqcdn.com/dle/hm/hdl/${encodeURIComponent(articleNumber)}.json`,
    fetcher
  );
  if (!response || typeof response !== "object" || Object.keys(response).length === 0) return null;

  const title = firstString(response.ProductNameLong, response.ProductNameShort);
  if (!title) return null;

  const descriptors = uniqueStrings([
    normaliseRetailerToken(stringValue(response.ProductFit)),
    normaliseRetailerToken(stringValue(response.ProductStyle)),
    ...splitRetailerTokens(stringValue(response.ProductDescriptiveLength))
  ]);
  const categories = uniqueStrings([
    stringValue(response.ProductCustomerGroup),
    stringValue(response.ProductAssortmentType),
    stringValue(response.ProductPresentationProductType)
  ]);

  return {
    fields: {
      title,
      brand: "H&M",
      colour: titleCase(firstString(response.ArticlePresentationColorGroup, response.ArticleColorMaster)),
      care: mapHmCare(stringValue(response.ProductCareInstructionsWashing)),
      sizing: descriptors.length > 0 ? descriptors : null,
      categoryBreadcrumbs: categories.length > 0 ? categories : null,
      description: uniqueStrings([title, ...descriptors, ...categories.map(titleCase)]).join("; ")
    },
    evidenceLabel: "H&M first-party tag product data",
    warning: "blocked page recovered with H&M first-party tag data; some fields may be unavailable"
  };
}

async function recoverUniqloProduct(locationRef: RetailerLocation, fetcher: Fetcher): Promise<RetailerRecovery | null> {
  const html = await fetchText(locationRef.href, fetcher);
  if (!html || !html.includes("__PRELOADED_STATE__")) return null;

  const product = extractUniqloProduct(html, locationRef.pathname);
  if (!product) return null;

  const title = firstString(product.name);
  if (!title) return null;

  const priceBase = asRecord(asRecord(product.prices)?.base);
  const currency = asRecord(priceBase?.currency);
  const representative = asRecord(product.representative);
  const representativeColor = asRecord(representative?.color);
  const breadcrumbs = asRecord(product.breadcrumbs);
  const categories = uniqueStrings(
    Object.values(breadcrumbs || {})
      .map(asRecord)
      .map((record) => firstString(record?.locale, record?.name))
  );
  const description = uniqueStrings([
    stripHtml(firstString(product.longDescription)),
    stripHtml(firstString(product.freeInformation)),
    stripHtml(firstString(product.designDetail))
  ]).join(" ");
  const imageUrls = uniqloImageUrls(product.images, firstString(representativeColor?.displayCode));

  return {
    fields: {
      title,
      brand: "UNIQLO",
      price: firstString(priceBase?.value),
      currency: firstString(currency?.code),
      colour: firstString(representativeColor?.name),
      description: description || null,
      materials: withTitleMaterialSignal(firstString(product.composition), title),
      care: stripHtml(firstString(product.washingInformation, product.careInstruction)),
      sizing: stripHtml(firstString(product.sizeInformation)),
      origin: formatUniqloOrigins(product.countriesOfOrigin),
      categoryBreadcrumbs: categories.length > 0 ? categories : null
    },
    imageUrls,
    evidenceLabel: "UNIQLO first-party preloaded product data",
    warning: "product data recovered with UNIQLO first-party preloaded state"
  };
}

async function recoverZaraProduct(locationRef: RetailerLocation, fetcher: Fetcher): Promise<RetailerRecovery | null> {
  const reference = locationRef.pathname.match(/p(\d{8})\.html/i)?.[1] || locationRef.pathname.match(/product\/(\d{8})/i)?.[1];
  if (!reference) return null;

  const storeId = zaraStoreIdForPath(locationRef.pathname);
  const locale = zaraLocaleForPath(locationRef.pathname);
  const url = new URL(`https://www.zara.com/itxrest/1/search/store/${storeId}/reference`);
  url.searchParams.set("reference", reference);
  url.searchParams.set("locale", locale);
  url.searchParams.set("deviceType", "desktop");
  url.searchParams.set("scope", "default");
  url.searchParams.set("origin", "default");

  const response = await fetchJson<Record<string, unknown>>(url.href, fetcher);
  const result = firstRecord((response?.results as unknown[]) || []);
  const content = asRecord(result?.content);
  const detail = asRecord(content?.detail);
  const color = firstRecord((detail?.colors as unknown[]) || []);
  const price = firstNumber(content?.price, color?.price);
  const title = firstString(content?.name, detail?.name);
  if (!title) return null;

  const categories = uniqueStrings([stringValue(content?.sectionName), stringValue(content?.familyName), stringValue(content?.subfamilyName)]);
  const colorName = stringValue(color?.name);
  const imageUrls = zaraImageUrls([...(asArray(content?.xmedia) || []), ...(asArray(color?.xmedia) || [])]);

  return {
    fields: {
      title,
      brand: "Zara",
      price: price == null ? null : String(price / 100),
      currency: zaraCurrencyForPath(locationRef.pathname),
      colour: colorName,
      description: uniqueStrings([title, colorName, ...categories]).join("; "),
      materials: inferMaterialFromTitle(title),
      categoryBreadcrumbs: categories.length > 0 ? categories : null
    },
    imageUrls,
    evidenceLabel: "Zara first-party reference product data",
    warning: "blocked page recovered with Zara first-party reference data; exact composition and care are unavailable from this endpoint"
  };
}

async function recoverPatagoniaProduct(locationRef: RetailerLocation, fetcher: Fetcher): Promise<RetailerRecovery | null> {
  const html = await fetchText(locationRef.href, fetcher);
  if (!html || !/application\/ld\+json|ProductGroup|schema\.org/i.test(html)) return null;

  const records = extractJsonLdRecords(html);
  const group = records.find((record) => hasSchemaType(record, "ProductGroup"));
  const product = records.find((record) => hasSchemaType(record, "Product"));
  const primary = group || product;
  if (!primary) return null;

  const title = firstString(primary.name, product?.name);
  if (!title) return null;

  const description = decodeHtmlEntities(firstString(primary.description, product?.description));
  const offer = firstRecord(asArray(product?.offers) || asArray(primary.offers) || [product?.offers, primary.offers]);
  const price = firstString(offer?.price, product?.price, primary.price);
  const currency = firstString(offer?.priceCurrency, product?.priceCurrency, primary.priceCurrency);
  const brand = firstString(asRecord(primary.brand)?.name, asRecord(product?.brand)?.name, "Patagonia");
  const accordion = parsePatagoniaProductAccordions(html);
  const materials = accordion.materials || extractMaterial(description);
  const images = uniqueStrings([...normaliseImageValue(primary.image), ...normaliseImageValue(product?.image)]);

  return {
    fields: {
      title,
      brand,
      price,
      currency,
      description,
      materials,
      care: accordion.care,
      sizing: accordion.sizing
    },
    imageUrls: images,
    evidenceLabel: "Patagonia first-party product HTML",
    warning: "failover page recovered by fetching Patagonia first-party product HTML"
  };
}

async function recoverMarksAndSpencerProduct(locationRef: RetailerLocation, fetcher: Fetcher): Promise<RetailerRecovery | null> {
  const html = await fetchText(locationRef.href, fetcher);
  if (!html || !/marksandspencer|__NEXT_DATA__|schema\.org/i.test(html)) return null;

  const records = extractJsonLdRecords(html);
  const product = records.find((record) => hasSchemaType(record, "Product"));
  const title = firstString(product?.name, matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i)?.replace(/\s*\|[\s\S]*$/, ""));
  if (!title) return null;

  const description = decodeHtmlEntities(firstString(product?.description, matchFirst(html, /<meta\s+name=["']description["']\s+content=["']([^"']+)/i)));
  const offer = firstRecord(asArray(product?.offers) || [product?.offers]);
  const currency = firstString(offer?.priceCurrency) || matchFirst(html, /"currencyCode"\s*:\s*"([A-Z]{3})"/);
  const colour = extractMsSelectedColour(html);
  const sizing = extractSizingFromDescription(description);

  return {
    fields: {
      title,
      brand: firstString(asRecord(product?.brand)?.name, "M&S"),
      price: firstString(offer?.price),
      currency,
      colour,
      description,
      materials: extractMaterial(description),
      construction: extractConstruction(description),
      sizing
    },
    evidenceLabel: "M&S first-party product page data",
    warning: "product data enriched with M&S first-party page data"
  };
}

async function recoverArketProduct(locationRef: RetailerLocation, fetcher: Fetcher): Promise<RetailerRecovery | null> {
  const html = await fetchText(locationRef.href, fetcher);
  if (!html || !html.includes("__NEXT_DATA__")) return null;

  const product = extractArketProduct(html);
  if (!product) return null;

  const title = firstString(product.defaultName, product.name);
  if (!title) return null;

  const materialComposition = parseMaterialComposition(stringValue(product.var_material_composition_desc));
  const care = Array.isArray(product.var_care_instruction) ? product.var_care_instruction.map(stringValue).filter(Boolean).join(", ") : null;
  const categories = uniqueStrings([
    ...flatStringArray(product.categoryName),
    stringValue(product.pr_assortment_type),
    stringValue(product.pr_product_type_name)
  ]);
  const sizing = uniqueStrings([
    stringValue(product.pr_fit),
    stringValue(product.pr_garment_length),
    stringValue(product.pr_sleeve_length),
    stringValue(product.pr_neckline_style)
  ]);
  const imageUrls = uniqueStrings([
    ...flatStringArray(asRecord(product.media)?.standard),
    ...normaliseMediaObjects(product.mediaObjects)
  ]);

  return {
    fields: {
      title,
      brand: firstString(product.brandName, product.pr_external_brand, "ARKET"),
      price: firstString(product.priceAsNumber, product.price),
      currency: arketCurrencyForPath(locationRef.pathname),
      colour: firstString(product.var_colour_desc_desc, product.var_pdp_color_desc, asRecord(product.var_color)?.name),
      description: firstString(product.description, product.pr_long_description_desc),
      materials: materialComposition,
      care,
      construction: extractConstruction(firstString(product.description, product.pr_long_description_desc)),
      origin: parseProductionCountry(stringValue(product.var_compliance_details_key)),
      sizing: sizing.length > 0 ? sizing : null,
      categoryBreadcrumbs: categories.length > 0 ? categories : null
    },
    imageUrls,
    evidenceLabel: "ARKET first-party Next.js product data",
    warning: "blocked page recovered with ARKET first-party product data"
  };
}

async function recoverAllSaintsProduct(locationRef: RetailerLocation, fetcher: Fetcher): Promise<RetailerRecovery | null> {
  const html = await fetchText(locationRef.href, fetcher);
  if (!html || !/data-pid=|b-pdp_user_content|application\/ld\+json/i.test(html)) return null;

  const analytics = parseHtmlJsonAttribute(matchFirst(html, /data-analytics="([^"]+)"/i));
  const jsonLd = extractJsonLdRecords(html)[0];
  const title = firstString(analytics?.name, jsonLd?.headline, textBetween(html, /<div class="b-header_product-name">([\s\S]*?)<\/div>/i));
  if (!title) return null;

  const materialsBlock = textBetween(html, /FABRIC\s*&amp;\s*CARE:[\s\S]*?<div class="b-pdp_user_content">([\s\S]*?)<\/div>/i);
  const productDetails = textBetween(html, /<span data-ref="disclosureContent"[^>]*>([\s\S]*?)<\/span>/i);
  const madeIn = matchFirst(html, /Made in:\s*<\/div>\s*<div class="b-pdp_user_content">\s*([^<]+)\s*<\/div>/i) || matchFirst(html, /Made in:\s*([^<]+)/i);
  const imageUrl = firstString(analytics?.imageURL, asRecord(jsonLd?.publisher)?.logo);

  return {
    fields: {
      title,
      brand: "AllSaints",
      price: firstString(analytics?.price),
      currency: firstString(analytics?.currency),
      description: firstString(productDetails, jsonLd?.description),
      materials: cleanListText(materialsBlock),
      care: extractCare(cleanListText(materialsBlock)),
      construction: extractConstruction(productDetails),
      origin: madeIn ? `Made in ${madeIn}` : null,
      categoryBreadcrumbs: uniqueStrings(["Men", "Leather Jackets", firstString(analytics?.category)].filter(Boolean) as string[])
    },
    imageUrls: imageUrl ? [imageUrl] : [],
    evidenceLabel: "AllSaints first-party product HTML",
    warning: "blocked page recovered with AllSaints first-party product HTML"
  };
}

async function recoverNextProduct(locationRef: RetailerLocation, fetcher: Fetcher): Promise<RetailerRecovery | null> {
  const pathMatch = locationRef.pathname.match(/\/style\/([^/]+)\/([^/#?]+)/i);
  if (!pathMatch) return null;

  const styleCode = pathMatch[1].toUpperCase();
  const productCode = pathMatch[2].toUpperCase();
  const doc = await fetchNextBloomreachProduct(productCode, styleCode, fetcher);
  if (!doc) return null;

  const categories = flatStringArray(doc.next_category).map((value) => value.replace(/([a-z])([A-Z])/g, "$1 $2"));
  const image = firstString(doc.thumb_image);

  return {
    fields: {
      title: titleCase(firstString(doc.title)),
      brand: titleCase(firstString(doc.brand)),
      price: firstString(doc.sale_price, doc.price),
      currency: "GBP",
      description: decodeHtmlEntities(firstString(doc.description)),
      materials: extractMaterial(firstString(doc.description)),
      colour: inferColourFromText(firstString(doc.title, doc.description)),
      categoryBreadcrumbs: categories.length > 0 ? categories : null
    },
    imageUrls: image ? [image] : [],
    evidenceLabel: "Next Bloomreach first-party catalog data",
    warning: "blocked page recovered with Next first-party Bloomreach catalog data; material and care fields may be unavailable"
  };
}

async function fetchJson<T>(url: string, fetcher: Fetcher): Promise<T | null> {
  try {
    const response = await fetcher(url, { credentials: "omit" });
    if (!response.ok) return null;

    const text = await response.text();
    if (!text.trim() || text.trim() === "//") return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function fetchText(url: string, fetcher: Fetcher): Promise<string | null> {
  try {
    const response = await fetcher(url, { credentials: "same-origin" });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function applyRecovery(snapshot: PageSnapshot, recovery: RetailerRecovery): void {
  let appliedFields = 0;

  for (const [field, value] of Object.entries(recovery.fields) as Array<[ProductFieldName, string | string[] | null | undefined]>) {
    if (!hasValue(value)) continue;

    const existing = snapshot.product.fields[field];
    const recoveryConfidence = recovery.confidence?.[field] || FIELD_CONFIDENCE[field] || 0.7;
    if (hasValue(existing.value) && existing.confidence > recoveryConfidence && !ACCUMULATING_FIELDS.has(field)) continue;

    snapshot.product.fields[field] = {
      value: ACCUMULATING_FIELDS.has(field) ? mergeFieldValue(existing.value, value) : value,
      confidence: Math.max(existing.confidence, recoveryConfidence),
      source: existing.source && existing.confidence > recoveryConfidence ? existing.source : "hydration_blob",
      evidence: uniqueStrings([...existing.evidence, recovery.evidenceLabel]).slice(0, 4)
    };
    appliedFields += 1;
  }

  if (recovery.imageUrls?.length) {
    snapshot.product.imageUrls = uniqueStrings([...snapshot.product.imageUrls, ...recovery.imageUrls]).slice(0, 16);
    snapshot.product.image_urls = snapshot.product.imageUrls;
  }

  if (appliedFields === 0) return;

  snapshot.hydration = [
    ...snapshot.hydration,
    {
      source: "hydration_blob",
      label: recovery.evidenceLabel,
      text: JSON.stringify(recovery.fields).slice(0, 1200)
    }
  ];

  snapshot.product.pageState = "product_page";
  snapshot.product.page_state = "product_page";
  snapshot.product.sourceMethod = inferRecoveredSourceMethod(snapshot.product.fields);
  snapshot.product.source_method = snapshot.product.sourceMethod;
  snapshot.product.sourceConfidenceScore = calculateRecoveredConfidence(snapshot.product.fields);
  snapshot.product.source_confidence_score = snapshot.product.sourceConfidenceScore;
  snapshot.product.warnings = recoveryWarnings(snapshot, recovery.warning);
}

function recoveryWarnings(snapshot: PageSnapshot, recoveryWarning: string): string[] {
  const warnings: string[] = [];
  const fields = snapshot.product.fields;

  if (!fields.materials.value) warnings.push("materials/composition not found");
  if (!fields.care.value) warnings.push("care information not found");
  if (!fields.brand.value) warnings.push("brand not found");
  if (!fields.price.value) warnings.push("price not found");
  if (snapshot.product.imageUrls.length === 0) warnings.push("product images not found");

  if (!warnings.includes(recoveryWarning)) warnings.unshift(recoveryWarning);
  return warnings;
}

function inferRecoveredSourceMethod(fields: Record<ProductFieldName, ExtractedField>): SourceMethod {
  const sources = uniqueStrings(Object.values(fields).map((field) => field.source).filter(Boolean));
  if (sources.length === 0) return "visible_text_fallback";
  if (sources.length === 1) return sources[0] as SourceMethod;
  return "mixed";
}

function calculateRecoveredConfidence(fields: Record<ProductFieldName, ExtractedField>): number {
  const weights: Partial<Record<ProductFieldName, number>> = {
    title: 1.2,
    brand: 0.9,
    price: 0.9,
    colour: 0.4,
    description: 0.8,
    materials: 1.1,
    care: 0.5,
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

function zaraImageUrls(values: unknown[]): string[] {
  return uniqueStrings(
    values
      .map(asRecord)
      .map((item) => stringValue(item?.url))
      .filter(Boolean)
      .map((url) => url!.replace("{width}", "1024"))
  );
}

function extractArketProduct(html: string): Record<string, unknown> | null {
  const nextData = matchFirst(html, /<script id=["']__NEXT_DATA__["'] type=["']application\/json["']>([\s\S]*?)<\/script>/i);
  if (!nextData) return null;

  try {
    const parsed = JSON.parse(nextData) as Record<string, unknown>;
    const pageProps = asRecord(asRecord(parsed.props)?.pageProps);
    const blocks = asArray(pageProps?.blocks) || [];

    for (const block of blocks) {
      const product = asRecord(asRecord(block)?.product);
      if (product && firstString(product.defaultName, product.name)) return product;
    }
  } catch {
    return null;
  }

  return null;
}

function extractUniqloProduct(html: string, pathname: string): Record<string, unknown> | null {
  const scriptStart = html.indexOf("window.__PRELOADED_STATE__");
  if (scriptStart < 0) return null;

  const objectStart = html.indexOf("{", scriptStart);
  const scriptEnd = html.indexOf("</script>", objectStart);
  const objectEnd = html.lastIndexOf("}", scriptEnd);
  if (objectStart < 0 || objectEnd <= objectStart) return null;

  try {
    const parsed = JSON.parse(html.slice(objectStart, objectEnd + 1)) as unknown;
    const productId = pathname.match(/\/products\/([^/]+)/i)?.[1];
    return flattenUniqloRecords(parsed).find((record) => {
      const recordProductId = firstString(record.productId);
      if (productId && recordProductId === productId) return true;
      return Boolean(record.name && record.prices && record.representative && record.composition);
    }) || null;
  } catch {
    return null;
  }
}

function flattenUniqloRecords(value: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];

  function visit(current: unknown): void {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }

    const record = asRecord(current);
    if (!record) return;
    records.push(record);
    Object.values(record).forEach(visit);
  }

  visit(value);
  return records;
}

function uniqloImageUrls(value: unknown, selectedColorCode: string | null): string[] {
  const images = asRecord(value);
  if (!images) return [];

  const candidates = [
    ...Object.entries(asRecord(images.main) || {})
      .filter(([code]) => !selectedColorCode || code === selectedColorCode)
      .map(([, url]) => stringValue(url)),
    ...flatStringArray(Object.values(asRecord(images.sub) || {}))
  ];

  return uniqueStrings(candidates).slice(0, 16);
}

function formatUniqloOrigins(value: unknown): string | null {
  const countries = (asArray(value) || [])
    .map(asRecord)
    .map((record) => firstString(record?.code))
    .filter((code): code is string => Boolean(code));
  const names = uniqueStrings(countries.map((code) => COUNTRY_CODES[code] || code));
  return names.length > 0 ? `Made in ${names.join(", ")}` : null;
}

function withTitleMaterialSignal(composition: string | null, title: string): string | null {
  const titleMaterial = inferMaterialFromTitle(title);
  if (!composition) return titleMaterial;
  if (!titleMaterial || composition.toLowerCase().includes(titleMaterial.toLowerCase())) return composition;
  return `${composition}; title states ${titleMaterial}`;
}

function inferMaterialFromTitle(title: string | null): string | null {
  if (!title) return null;

  const matches = title.match(/\b(?:cotton|linen|cashmere|merino|wool|leather|silk|polyester|nylon|viscose)(?:\s*[-/]\s*(?:cotton|linen|cashmere|merino|wool|leather|silk|polyester|nylon|viscose))*\b/gi);
  if (!matches) return null;

  return uniqueStrings(matches.map((match) => titleCase(match.replace(/\s*[-/]\s*/g, "/")))).join(", ");
}

type PatagoniaAccordions = {
  materials: string | null;
  care: string | null;
  sizing: string | null;
};

function parsePatagoniaProductAccordions(html: string): PatagoniaAccordions {
  const materialBlock = htmlBlockAfter(html, "data-pdp-accordion-materials", "<div class=\"pdp-ser-wrapper\"");
  const fitBlock = htmlBlockAfter(html, "data-pdp-accordion-fit", "<div class=\"accordion-group\"");
  const materialItems = extractHtmlListItems(materialBlock);
  const careItem = materialItems.find((item) => /^Care Instructions:/i.test(item));
  const materialItemsOnly = materialItems.filter((item) => !/^Care Instructions:/i.test(item));
  const fit = extractHtmlListItems(fitBlock).find((item) => /\bfit\b/i.test(item) && !/reviews?|size guide/i.test(item));

  return {
    materials: materialItemsOnly.length > 0 ? uniqueStrings(materialItemsOnly).join("; ") : null,
    care: careItem ? careItem.replace(/^Care Instructions:\s*/i, "") : null,
    sizing: fit || null
  };
}

function htmlBlockAfter(html: string, startNeedle: string, endNeedle: string): string | null {
  const start = html.indexOf(startNeedle);
  if (start < 0) return null;

  const end = html.indexOf(endNeedle, start + startNeedle.length);
  return html.slice(start, end > start ? end : start + 5000);
}

function extractHtmlListItems(html: string | null): string[] {
  if (!html) return [];

  return uniqueStrings(
    Array.from(html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)).map((match) => {
      const raw = match[1];
      const heading = stripHtml(matchFirst(raw, /<h3\b[^>]*>([\s\S]*?)<\/h3>/i));
      const body = stripHtml(matchFirst(raw, /<p\b[^>]*>([\s\S]*?)<\/p>/i) || raw);
      return heading && body ? `${heading}: ${body}` : body;
    })
  );
}

function extractMsSelectedColour(html: string): string | null {
  const selectedInput = matchFirst(html, /aria-label=["']([^"']+)\s+colour option["'][\s\S]{0,500}?name=["']colour["'][^>]*checked/i);
  if (selectedInput) return titleCase(selectedInput);

  const selectedLabel = matchFirst(html, /data-selected=["']true["'][\s\S]{0,300}?aria-label=["']([^"']+)\s+colour option["']/i);
  return titleCase(selectedLabel);
}

function extractSizingFromDescription(description: string | null): string | null {
  if (!description) return null;
  const match = description.match(/\b(?:regular|slim|relaxed|oversized|classic|tailored)\s+fit\b/i);
  return match ? titleCase(match[0]) : null;
}

function inferColourFromText(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/\b(?:black|white|navy|blue|grey|gray|green|olive|brown|beige|cream|ecru|stone|neutral|tan|red|pink|orange|yellow|purple|khaki)\b/i);
  return match ? titleCase(match[0]) : null;
}

function parseMaterialComposition(value: string | null): string | null {
  if (!value) return null;

  try {
    const entries = JSON.parse(value) as unknown[];
    const parts = entries.flatMap((entry) => {
      const record = asRecord(entry);
      const type = stringValue(record?.type);
      return (asArray(record?.materials) || []).map((material) => {
        const materialRecord = asRecord(material);
        const name = stringValue(materialRecord?.material);
        const percentage = firstString(materialRecord?.percentage);
        if (!name || !percentage) return null;
        return type ? `${type}: ${name} ${percentage}%` : `${name} ${percentage}%`;
      });
    });
    return uniqueStrings(parts).join(", ") || null;
  } catch {
    return value;
  }
}

function parseProductionCountry(value: string | null): string | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const traceability = asRecord(asRecord(parsed.frenchAntiWasteLawForaCircularEconomy)?.traceability);
    const countries = asArray(traceability?.articleCountryOfProduction) || [];
    const country = countries.map(asRecord).map((record) => stringValue(record?.value)).find(Boolean);
    return country ? `Made in ${country}` : null;
  } catch {
    return null;
  }
}

async function fetchNextBloomreachProduct(
  productCode: string,
  styleCode: string,
  fetcher: Fetcher
): Promise<Record<string, unknown> | null> {
  const url = new URL("https://brm-core-0.brsrvr.com/api/v1/core/");
  url.searchParams.set("account_id", "6042");
  url.searchParams.set("auth_key", "vyzz50jis1i9dbxj");
  url.searchParams.set("domain_key", "next");
  url.searchParams.set("request_type", "search");
  url.searchParams.set("search_type", "keyword");
  url.searchParams.set("q", productCode);
  url.searchParams.set("url", "https://www.next.co.uk/");
  url.searchParams.set("ref_url", "https://www.next.co.uk/");
  url.searchParams.set("rows", "5");
  url.searchParams.set("start", "0");
  url.searchParams.set("fl", "pid,title,brand,price,sale_price,url,thumb_image,description,next_category,variants");

  const response = await fetchJson<Record<string, unknown>>(url.href, fetcher);
  const docs = asArray(asRecord(response?.response)?.docs) || [];
  return (
    docs
      .map(asRecord)
      .find((doc) => stringValue(doc?.pid)?.toUpperCase() === productCode && stringValue(doc?.url)?.toUpperCase().includes(`/STYLE/${styleCode}/`)) ||
    null
  );
}

function extractJsonLdRecords(html: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

  for (const script of scripts) {
    try {
      const decoded = decodeHtmlEntities(script[1]);
      if (!decoded) continue;
      flattenJson(JSON.parse(decoded)).forEach((record) => records.push(record));
    } catch {
      continue;
    }
  }

  return records;
}

function flattenJson(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJson);
  const record = asRecord(value);
  if (!record) return [];

  return [record, ...flattenJson(record["@graph"])];
}

function hasSchemaType(record: Record<string, unknown>, type: string): boolean {
  const value = record["@type"];
  if (typeof value === "string") return value.toLowerCase() === type.toLowerCase();
  if (Array.isArray(value)) return value.some((entry) => typeof entry === "string" && entry.toLowerCase() === type.toLowerCase());
  return false;
}

function normaliseImageValue(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(normaliseImageValue);
  const record = asRecord(value);
  if (record) return uniqueStrings([stringValue(record.url), stringValue(record.contentUrl)]);
  return [];
}

function extractMaterial(value: string | null): string | null {
  if (!value) return null;
  return (
    uniqueStrings(Array.from(value.matchAll(/\b\d{1,3}(?:\.\d+)?%?\s+(?:recycled\s+|organic\s+|responsible\s+)?(?:polyester|cotton|linen|wool|nylon|polyamide|elastane|spandex|down|leather|tricot|fleece|cashmere)\b/gi)).map((match) => match[0])).join(", ") ||
    value.match(/\b\d{1,3}%\s+(?:recycled\s+)?fibres?\b/i)?.[0] ||
    value.match(/\b(?:genuine|soft|smooth|tumbled|suede)\s+leather\b/i)?.[0] ||
    value.match(/\b(?:recycled wool|recycled polyester|recycled nylon|organic cotton|polyester fleece|microdenier fleece|cotton\/linen|linen\/cotton)\b/i)?.[0] ||
    null
  );
}

function extractCare(value: string | null): string | null {
  if (!value) return null;
  const care = value.match(/(?:specialist leather dry clean only|machine washable|hand wash only|dry clean only|dry clean|wash cold)[^.]*\.?/i)?.[0];
  return care ? care.replace(/[;\s]+$/g, "").trim() : null;
}

function extractConstruction(value: string | null): string | null {
  if (!value) return null;
  const matches = value.match(/\b(?:plain stitch|fine[- ]gauge|heavy[- ]knit|zip closure|full collar|long sleeves|recycled lining|ribbed trims|button-down front|underwired cups)[^.]*\.?/gi);
  return matches ? uniqueStrings(matches).join(", ") : null;
}

function decodeHtmlEntities(value: string | null | undefined): string | null {
  if (!value) return null;

  return value
    .replace(/&reg;/gi, "®")
    .replace(/&trade;/gi, "™")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanListText(value: string | null): string | null {
  if (!value) return null;
  return decodeHtmlEntities(
    value
      .replace(/<li[^>]*>/gi, "")
      .replace(/<\/li>/gi, "; ")
      .replace(/<[^>]+>/g, " ")
  );
}

function stripHtml(value: string | null): string | null {
  if (!value) return null;
  return decodeHtmlEntities(value.replace(/<br\s*\/?>/gi, ". ").replace(/<[^>]+>/g, " "));
}

function textBetween(html: string, pattern: RegExp): string | null {
  return cleanListText(matchFirst(html, pattern));
}

function matchFirst(value: string, pattern: RegExp): string | null {
  const match = value.match(pattern);
  return match?.[1] ? match[1] : null;
}

function parseHtmlJsonAttribute(value: string | null): Record<string, unknown> | null {
  const decoded = decodeHtmlEntities(value);
  if (!decoded) return null;

  try {
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normaliseMediaObjects(value: unknown): string[] {
  return (asArray(value) || [])
    .map(asRecord)
    .flatMap((record) => [stringValue(record?.url), stringValue(record?.standard), stringValue(record?.large)])
    .filter(Boolean) as string[];
}

function flatStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (Array.isArray(entry) ? flatStringArray(entry) : [stringValue(entry)])).filter(Boolean) as string[];
}

function titleCase(value: string | null): string | null {
  if (!value) return null;
  return value
    .split(/\s+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(" ");
}

function normaliseRetailerToken(value: string | null): string | null {
  if (!value) return null;

  return titleCase(
    value
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([a-z])(?=fit|neck|length|sleeve|colour|color)/gi, "$1 ")
      .replace(/fit$/i, " fit")
      .replace(/neck$/i, " neck")
      .replace(/length$/i, " length")
      .replace(/sleeve$/i, " sleeve")
  );
}

function splitRetailerTokens(value: string | null): string[] {
  if (!value) return [];
  return uniqueStrings(value.split(/[;,]/).map(normaliseRetailerToken));
}

const COUNTRY_CODES: Record<string, string> = {
  BD: "Bangladesh",
  BG: "Bulgaria",
  CN: "China",
  KH: "Cambodia",
  MM: "Myanmar",
  PT: "Portugal",
  TR: "Turkey",
  VN: "Vietnam"
};

function arketCurrencyForPath(pathname: string): string {
  if (pathname.includes("_gbp") || pathname.includes("/en-gb/")) return "GBP";
  return "GBP";
}

function zaraStoreIdForPath(pathname: string): string {
  if (pathname.startsWith("/uk/")) return "10706";
  return "10706";
}

function zaraLocaleForPath(pathname: string): string {
  if (pathname.startsWith("/uk/")) return "en_GB";
  return "en_GB";
}

function zaraCurrencyForPath(pathname: string): string {
  if (pathname.startsWith("/uk/")) return "GBP";
  return "GBP";
}

function mapHmCare(value: string | null): string | null {
  if (!value) return null;

  const normalized = value.toLowerCase();
  const machineWash = normalized.match(/machinewash(\d+)/);
  if (machineWash?.[1]) return `Machine wash at ${machineWash[1]}C`;

  return value;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const converted = stringValue(value);
    if (converted) return converted;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  }
  return null;
}

function firstRecord(values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    const record = asRecord(value);
    if (record) return record;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const cleaned = value.replace(/\s+/g, " ").trim();
    return cleaned || null;
  }
  if (typeof value === "number") return String(value);
  return null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleaned = value?.trim();
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
  }

  return result;
}

function mergeFieldValue(existing: string | string[] | null, incoming: string | string[] | null | undefined): string | string[] | null {
  if (!hasValue(existing)) return incoming || null;
  if (!hasValue(incoming)) return existing;

  const values = uniqueStrings([...fieldValueParts(existing), ...fieldValueParts(incoming)]);
  if (Array.isArray(existing) || Array.isArray(incoming)) return values;
  return values.join("; ");
}

function fieldValueParts(value: string | string[]): string[] {
  if (Array.isArray(value)) return value;
  return value
    .split(/\s*;\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 320);
}

function hasValue(value: string | string[] | null | undefined): value is string | string[] {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}
