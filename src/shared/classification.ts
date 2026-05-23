import type {
  BrandTier,
  LabelledInference,
  MaterialFamily,
  ProductCategory,
  ProductClassification,
  ProductExtraction,
  SourceConfidenceLabel
} from "./messages";

const BRAND_TIERS: Record<string, BrandTier> = {
  "h&m": "budget",
  zara: "high-street",
  uniqlo: "high-street",
  next: "high-street",
  "marks & spencer": "high-street",
  "m&s": "high-street",
  autograph: "high-street",
  arket: "mid-premium",
  cos: "mid-premium",
  "mr p.": "mid-premium",
  "mr p": "mid-premium",
  allsaints: "premium",
  patagonia: "premium",
  "kamakura shirts": "mid-premium",
  kamakura: "mid-premium",
  celine: "luxury"
};

type EvidenceBasis = LabelledInference["basis"];

type ClassificationMatch<T extends string> = {
  value: T;
  basis: EvidenceBasis;
  evidence: string;
};

export function classifyProductEvidence(product: ProductExtraction): ProductClassification {
  const brand = stringField(product, "brand");
  const price = formatPrice(stringField(product, "price"), stringField(product, "currency"));
  const category = classifyCategory(product);
  const materialFamily = classifyMaterialFamily(product);
  const primaryColour = normaliseColour(stringField(product, "colour"));
  const sourceConfidenceLabel = confidenceLabel(product.sourceConfidenceScore);
  const labelledInferences: LabelledInference[] = [];

  if (category.basis !== "stated_on_page") {
    labelledInferences.push({ field: "category", value: category.value, basis: category.basis });
  }

  if (materialFamily.basis !== "stated_on_page" && materialFamily.value !== "unknown") {
    labelledInferences.push({ field: "material_family", value: materialFamily.value, basis: materialFamily.basis });
  }

  const brandTier = classifyBrandTier(brand);
  if (brandTier !== "unknown") {
    labelledInferences.push({ field: "brand_tier", value: brandTier, basis: "inferred_from_brand" });
  }

  const styleTags = inferStyleTags(product, category.value, materialFamily.value);
  for (const tag of styleTags) {
    labelledInferences.push({ field: "style_tags", value: tag, basis: "inferred_from_title" });
  }

  const useCase = inferUseCase(category.value, styleTags);
  labelledInferences.push({ field: "use_case", value: useCase, basis: "inferred_from_category" });

  return {
    category: category.value,
    brand,
    brand_tier: brandTier,
    price,
    material_family: materialFamily.value,
    primary_colour: primaryColour,
    style_tags: styleTags,
    use_case: useCase,
    material_description: buildMaterialDescription(product),
    construction_description: buildConstructionDescription(product),
    quality_signals: qualitySignals(product, materialFamily.value),
    quality_concerns: qualityConcerns(product, materialFamily.value),
    source_confidence_score: product.sourceConfidenceScore,
    source_confidence_label: sourceConfidenceLabel,
    labelled_inferences: labelledInferences
  };
}

function classifyCategory(product: ProductExtraction): ClassificationMatch<ProductCategory> {
  if (product.pageState !== "product_page") return { value: "other", basis: "unknown", evidence: "not a product page" };

  const categoryText = textFromValues(product.fields.categoryBreadcrumbs.value);
  const titleText = stringField(product, "title") || "";
  const descriptionText = stringField(product, "description") || "";
  const combined = `${categoryText} ${titleText} ${descriptionText}`.toLowerCase();
  const basis: EvidenceBasis = categoryText ? "stated_on_page" : "inferred_from_title";

  if (/\b(t[-\s]?shirt|tee)\b/.test(combined)) return { value: "t-shirt", basis, evidence: combined };
  if (/\b(shirt|oxford)\b/.test(combined)) return { value: "shirt", basis, evidence: combined };
  if (/\b(jumper|sweater|cardigan|knit|knitwear|crew[-\s]?neck)\b/.test(combined)) return { value: "knitwear", basis, evidence: combined };
  if (/\b(jeans?|denim)\b/.test(combined)) return { value: "denim", basis, evidence: combined };
  if (/\b(trouser|chino|pants)\b/.test(combined)) return { value: "trousers", basis, evidence: combined };
  if (/\b(jacket|coat|fleece|outerwear|leather jackets?|suit jacket|suitjackets|blazer)\b/.test(combined)) {
    return { value: "outerwear", basis, evidence: combined };
  }
  if (/\b(trainer|sneaker|shoe|boot|footwear)\b/.test(combined)) return { value: "footwear", basis, evidence: combined };
  if (/\b(bag|tote|backpack|briefcase)\b/.test(combined)) return { value: "bag", basis, evidence: combined };
  if (/\b(belt|scarf|tie|hat|cap|accessor)\b/.test(combined)) return { value: "accessory", basis, evidence: combined };
  if (/\b(dress)\b/.test(combined)) return { value: "dress", basis, evidence: combined };
  if (/\b(skirt)\b/.test(combined)) return { value: "skirt", basis, evidence: combined };
  if (/\b(active|running|training|gym|performance)\b/.test(combined)) return { value: "activewear", basis, evidence: combined };

  return { value: "other", basis: categoryText ? "stated_on_page" : "unknown", evidence: combined };
}

function classifyMaterialFamily(product: ProductExtraction): ClassificationMatch<MaterialFamily> {
  const materialText = stringField(product, "materials") || stringField(product, "description") || "";
  const lowered = materialText.toLowerCase();
  if (!lowered) return { value: "unknown", basis: "unknown", evidence: "" };

  const labelledPrimary = primaryLabelledMaterialFamily(lowered);
  if (labelledPrimary) return { value: labelledPrimary, basis: "stated_on_page", evidence: materialText };

  const families = new Set<Exclude<MaterialFamily, "blend" | "unknown">>();
  if (/\b(wool|merino|cashmere)\b/.test(lowered)) families.add("wool");
  if (/\bcotton\b/.test(lowered)) families.add("cotton");
  if (/\blinen\b/.test(lowered)) families.add("linen");
  if (/\bleather|suede\b/.test(lowered)) families.add("leather");
  if (/\bsilk\b/.test(lowered)) families.add("silk");
  if (/\bviscose|lyocell|modal\b/.test(lowered)) families.add("viscose");
  if (/\b(polyester|polyamide|nylon|elastane|acrylic|tricot|fleece)\b/.test(lowered)) families.add("synthetic");

  if (families.size === 0) return { value: "unknown", basis: "unknown", evidence: materialText };
  if (families.size > 1 || /\bblend\b/.test(lowered)) return { value: "blend", basis: "stated_on_page", evidence: materialText };
  return { value: [...families][0], basis: "stated_on_page", evidence: materialText };
}

function primaryLabelledMaterialFamily(value: string): Exclude<MaterialFamily, "blend" | "unknown"> | null {
  const primaryMatch = value.match(/\b(?:shell|upper|body|main fabric)\s*:\s*[^.;]+/i)?.[0] || null;
  if (!primaryMatch) return null;
  if (/\b(wool|merino|cashmere)\b/.test(primaryMatch)) return "wool";
  if (/\bcotton\b/.test(primaryMatch)) return "cotton";
  if (/\blinen\b/.test(primaryMatch)) return "linen";
  if (/\bleather|suede\b/.test(primaryMatch)) return "leather";
  if (/\bsilk\b/.test(primaryMatch)) return "silk";
  if (/\bviscose|lyocell|modal\b/.test(primaryMatch)) return "viscose";
  if (/\b(polyester|polyamide|nylon|elastane|acrylic|tricot|fleece)\b/.test(primaryMatch)) return "synthetic";
  return null;
}

function classifyBrandTier(brand: string | null): BrandTier {
  if (!brand) return "unknown";
  return BRAND_TIERS[brand.toLowerCase()] || "unknown";
}

function confidenceLabel(score: number): SourceConfidenceLabel {
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function inferStyleTags(product: ProductExtraction, category: ProductCategory, materialFamily: MaterialFamily): string[] {
  const text = `${stringField(product, "title") || ""} ${stringField(product, "description") || ""} ${textFromValues(
    product.fields.categoryBreadcrumbs.value
  )} ${textFromValues(product.fields.sizing.value)} ${stringField(product, "construction") || ""}`.toLowerCase();
  const tags = new Set<string>();

  if (hasSmartSignal(text)) tags.add("smart");
  if (hasSmartCasualSignal(text, category)) tags.add("smart casual");
  if (hasCasualSignal(text, category)) tags.add("casual");
  if (hasActiveSignal(text, category)) tags.add("active");
  if (/\b(minimal|plain|clean|classic)\b/.test(text)) tags.add("minimal");
  if (materialFamily === "leather") tags.add("leather");
  if (category === "knitwear") tags.add("knit");
  if (category === "outerwear") tags.add("layering");

  return [...tags].slice(0, 5);
}

function hasSmartSignal(text: string): boolean {
  return (
    /\b(suit|suiting|blazer|waistcoat|tuxedo|dinner jacket|formal|occasionwear|dress shirt)\b/.test(text) ||
    /\b(tailored|pleat front|centre-leg crease|center-leg crease)\b/.test(text) ||
    /\b(derby|brogue|monk strap|court shoe)\b/.test(text)
  );
}

function hasSmartCasualSignal(text: string, category: ProductCategory): boolean {
  if (/\b(smart casual)\b/.test(text)) return true;
  if (/\b(oxford|button-down|button down|polo|chino|loafer)\b/.test(text)) return true;
  if (/\b(linen shirt|cotton shirt|collared|collar)\b/.test(text) && category === "shirt") return true;
  return /\b(cardigan|fine[- ]gauge|merino|cashmere)\b/.test(text) && category === "knitwear";
}

function hasCasualSignal(text: string, category: ProductCategory): boolean {
  if (/\b(relaxed|oversized|fleece|sweat|hoodie|jersey|cargo|utility|washed|graphic)\b/.test(text)) return true;
  return category === "t-shirt" || category === "denim";
}

function hasActiveSignal(text: string, category: ProductCategory): boolean {
  return (
    category === "activewear" ||
    /\b(performance|running|training|gym|workout|technical|waterproof|breathable|freshfeet)\b/.test(text)
  );
}

function inferUseCase(category: ProductCategory, styleTags: string[]): string {
  if (styleTags.includes("active")) return "active";
  if (styleTags.includes("smart")) return "formal / office";
  if (styleTags.includes("smart casual")) return "office casual";
  if (category === "outerwear") return "outer layer";
  if (category === "footwear") return "everyday wear";
  if (category === "bag") return "daily carry";
  return "casual";
}

function buildMaterialDescription(product: ProductExtraction): string {
  const value = stringField(product, "materials");
  return value ? `${value}.` : "Material composition not clearly stated.";
}

function buildConstructionDescription(product: ProductExtraction): string {
  const value = stringField(product, "construction");
  return value ? `${value}.` : "Construction method not clearly stated.";
}

function qualitySignals(product: ProductExtraction, materialFamily: MaterialFamily): string[] {
  const materialText = (stringField(product, "materials") || "").toLowerCase();
  const constructionText = textFromValues(product.fields.construction.value).toLowerCase();
  const originText = textFromValues(product.fields.origin.value).toLowerCase();
  const rating = stringField(product, "onSiteRating");
  const reviewCount = stringField(product, "onSiteReviewCount");
  const signals: string[] = [];

  if (/\b(?:100%\s+(?:wool|merino|cashmere|cotton|linen|leather|silk)|(?:wool|merino|cashmere|cotton|linen|leather|silk)\s+100%)(?!\w)/.test(materialText)) {
    signals.push("stated on page: single-fibre natural material composition");
  }
  if (/\b(merino|cashmere|full[-\s]?grain|sheep leather|lamb leather)\b/.test(materialText)) {
    signals.push("stated on page: premium material term present");
  }
  if (materialFamily === "leather") signals.push("inferred from material: leather can be a positive durability signal when genuine and well constructed");
  if (product.fields.care.value) signals.push("stated on page: care information is available");
  if (/\bmade in japan\b/.test(originText)) signals.push("stated on page: Made in Japan");
  if (/\bshell buttons?\b/.test(constructionText)) signals.push("stated on page: shell buttons");
  if (/\bbox pleat\b/.test(constructionText)) signals.push("stated on page: box pleat");
  if (/\blocker loop\b/.test(constructionText)) signals.push("stated on page: locker loop");
  if (/\bback collar button\b/.test(constructionText)) signals.push("stated on page: back collar button");
  if (/\bpleated cuffs?\b/.test(constructionText)) signals.push("stated on page: pleated cuffs");
  if (/\bfront placket\b/.test(constructionText)) signals.push("stated on page: front placket");
  if (rating && reviewCount) signals.push(`stated on page: ${rating}/5 from ${reviewCount} reviews`);

  return signals.slice(0, 10);
}

function qualityConcerns(product: ProductExtraction, materialFamily: MaterialFamily): string[] {
  const materialText = (stringField(product, "materials") || "").toLowerCase();
  const concerns: string[] = [];

  if (/\b(polyester|polyamide|nylon|acrylic|elastane)\b/.test(materialText) && materialFamily === "blend") {
    concerns.push("inferred from material: synthetic content may affect handle or breathability");
  }
  if (!product.fields.materials.value) concerns.push("unknown: material composition not found");
  if (!product.fields.construction.value) concerns.push("unknown: construction method not verified");
  if (product.sourceConfidenceScore < 0.45) concerns.push("unknown: weak source data limits classification confidence");

  return concerns.slice(0, 5);
}

function formatPrice(price: string | null, currency: string | null): string | null {
  if (!price) return null;
  if (currency === "GBP" && !price.startsWith("£")) return `£${price}`;
  if (currency === "USD" && !price.startsWith("$")) return `$${price}`;
  if (currency === "EUR" && !price.startsWith("€")) return `€${price}`;
  return price;
}

function normaliseColour(value: string | null): string | null {
  return value ? normaliseWhitespace(value).toLowerCase() : null;
}

function stringField(product: ProductExtraction, field: keyof ProductExtraction["fields"]): string | null {
  const value = product.fields[field].value;
  return typeof value === "string" ? normaliseWhitespace(value) : null;
}

function textFromValues(value: string | string[] | null): string {
  if (Array.isArray(value)) return value.join(" ");
  return value || "";
}

function normaliseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
