import type {
  ExpertVisualInference,
  ProductClassification,
  ProductExtraction,
  VisualCue,
  VisualEnrichment,
  VisualObservation,
  VisualQualityDimension,
  VisualScoreDimension,
  VisualScoreEffect
} from "./messages";

const MAX_VISUAL_IMAGES = 4;
const DEFAULT_VISION_MODEL = "gemini-3.0-flash";
const DEFAULT_FALLBACK_MODEL = "gpt-5.4";

const FORBIDDEN_STRONG_CLAIM_PATTERN =
  /\b(?:made from|made of|is genuine|are genuine|authentic|real leather|full[- ]grain|top[- ]grain|100%\s+|pure\s+(?:wool|cotton|linen|leather|silk)|will last|long[- ]term durable|welted construction|goodyear welted|fabric quality is|construction is (?:excellent|poor|high quality|low quality)|(?:is|are) (?:genuine|authentic|real|pure|durable|high quality|low quality|wool|cotton|linen|leather|silk))\b/i;

const UNQUALIFIED_QUALITY_PATTERN =
  /\b(?:high quality|low quality|poor quality|excellent quality|cheaply made|well made|durable|not durable|stitched|welted|bonded|genuine|authentic|full[- ]grain|top[- ]grain)\b/i;

const WEAK_POSITIVE_CONSTRUCTION_PATTERN =
  /\b(?:clean|crisp|neat|sharp|smooth|absence of|no visible|without visible|standard|functional|typical|consistent with).{0,80}\b(?:lapels?|edges?|pocket flaps?|puckering|buttons?|cuffs?|construction finish|standard of construction|hardware)\b/i;
const STYLING_AS_QUALITY_PATTERN =
  /\b(?:lining|contrast(?:ing)? lining|floral lining|buttons?|trim|design choice).{0,180}\b(?:elevat\w*|perceived value|quality|construction|well made|premium|attention to detail)\b/i;
const MATERIAL_BENEFIT_FROM_APPEARANCE_PATTERN =
  /\b(?:visible fabric texture|matte finish|surface appearance|appearance).{0,120}\b(?:durability|comfort|practical benefits|material choice aligns|blend material)\b/i;

const ALLOWED_EVIDENCE_TYPES = new Set<VisualObservation["evidence_type"]>([
  "colour",
  "silhouette",
  "texture_appearance",
  "fit_proportion",
  "surface_detail",
  "aesthetic_cue"
]);

export function createVisualEnrichment(
  product: ProductExtraction,
  classification: ProductClassification,
  options: { visionModel?: string; fallbackModel?: string } = {}
): VisualEnrichment {
  const model = options.visionModel || DEFAULT_VISION_MODEL;
  const fallbackModel = options.fallbackModel || DEFAULT_FALLBACK_MODEL;
  const imageUrls = product.imageUrls.slice(0, MAX_VISUAL_IMAGES);

  if (product.pageState !== "product_page") {
    return skippedVisualEnrichment(model, fallbackModel, imageUrls, [`visual enrichment skipped for ${product.pageState}`]);
  }

  if (imageUrls.length === 0) {
    return skippedVisualEnrichment(model, fallbackModel, imageUrls, ["visual enrichment skipped: product images not found"]);
  }

  return {
    status: "requested",
    model,
    fallback_model: fallbackModel,
    image_urls: imageUrls,
    observations: [],
    visual_cues: [],
    expert_inferences: [],
    missing_views: [],
    image_quality_limits: [],
    warnings: [
      "vision observations are enrichment only",
      "expert visual inferences must be caveated and low/medium confidence unless directly visible",
      "do not assert fabric authenticity, exact construction method, or durability from images alone"
    ],
    prompt: buildVisualEnrichmentPrompt(classification)
  };
}

export function sanitiseVisualObservations(observations: VisualObservation[]): {
  observations: VisualObservation[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const cleanObservations: VisualObservation[] = [];

  for (const observation of observations) {
    const text = observation.observation.trim();
    if (!text) continue;

    if (!ALLOWED_EVIDENCE_TYPES.has(observation.evidence_type)) {
      warnings.push(`visual observation dropped: unsupported evidence type ${observation.evidence_type}`);
      continue;
    }

    const makesForbiddenClaim = FORBIDDEN_STRONG_CLAIM_PATTERN.test(text);
    cleanObservations.push({
      ...observation,
      observation: makesForbiddenClaim
        ? "Image-only claim removed because it asserted fabric quality, construction, authenticity, or durability."
        : text.slice(0, 240),
      confidence: makesForbiddenClaim ? "low" : observation.confidence,
      should_affect_score: makesForbiddenClaim ? false : observation.should_affect_score
    });

    if (makesForbiddenClaim) {
      warnings.push("visual observation downgraded: image-only claim exceeded Stage 5 limits");
    }
  }

  return {
    observations: cleanObservations.slice(0, 8),
    warnings
  };
}

export function sanitiseVisualCues(cues: VisualCue[]): {
  visual_cues: VisualCue[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const cleanCues: VisualCue[] = [];

  for (const cue of cues) {
    const text = cue.cue.trim();
    if (!text) continue;

    if (!ALLOWED_EVIDENCE_TYPES.has(cue.evidence_type)) {
      warnings.push(`visual cue dropped: unsupported evidence type ${cue.evidence_type}`);
      continue;
    }

    const makesForbiddenClaim = FORBIDDEN_STRONG_CLAIM_PATTERN.test(text);
    cleanCues.push({
      cue: makesForbiddenClaim ? "Image-only cue removed because it asserted a non-visual product fact." : text.slice(0, 260),
      evidence_type: cue.evidence_type,
      confidence: makesForbiddenClaim ? "low" : cue.confidence,
      image_limitations: uniqueStrings(cue.image_limitations).slice(0, 4)
    });

    if (makesForbiddenClaim) {
      warnings.push("visual cue downgraded: image-only cue exceeded Stage 5 limits");
    }
  }

  return {
    visual_cues: cleanCues.slice(0, 8),
    warnings
  };
}

export function sanitiseExpertVisualInferences(inferences: ExpertVisualInference[]): {
  expert_inferences: ExpertVisualInference[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const cleanInferences: ExpertVisualInference[] = [];

  for (const inference of inferences) {
    const text = inference.inference.trim();
    const whyItMatters = inference.why_it_matters.trim();
    const caveat = inference.caveat.trim();
    if (!text || !whyItMatters || !caveat) continue;

    const makesForbiddenClaim = FORBIDDEN_STRONG_CLAIM_PATTERN.test(text) && !hasUncertaintyLanguage(text);
    const isUnqualified = UNQUALIFIED_QUALITY_PATTERN.test(text) && !hasUncertaintyLanguage(text);
    const weakPositive = weakPositiveVisualInference(text, inference);
    const shouldDowngrade = makesForbiddenClaim || isUnqualified;
    const neutralisedInference = neutraliseWeakPositiveInference(text, inference);

    cleanInferences.push({
      inference: shouldDowngrade
        ? "Image-only inference removed because it asserted quality, construction, authenticity, or durability without uncertainty."
        : neutralisedInference || text.slice(0, 280),
      quality_dimension: isQualityDimension(inference.quality_dimension) ? inference.quality_dimension : "aesthetic_refinement",
      confidence: shouldDowngrade || weakPositive ? "low" : inference.confidence,
      basis: "inferred_from_image",
      why_it_matters: whyItMatters.slice(0, 220),
      caveat: caveat.slice(0, 180),
      score_dimension: isScoreDimension(inference.score_dimension) ? inference.score_dimension : "confidence",
      score_effect: shouldDowngrade || weakPositive ? "none" : capScoreEffect(inference.score_effect, inference.confidence)
    });

    if (shouldDowngrade) {
      warnings.push("expert visual inference downgraded: image-only claim lacked uncertainty");
    } else if (weakPositive) {
      warnings.push("expert visual inference neutralised: weak positive image cue is not reliable evidence");
    }
  }

  return {
    expert_inferences: cleanInferences.slice(0, 6),
    warnings
  };
}

function skippedVisualEnrichment(model: string, fallbackModel: string, imageUrls: string[], warnings: string[]): VisualEnrichment {
  return {
    status: "skipped",
    model,
    fallback_model: fallbackModel,
    image_urls: imageUrls,
    observations: [],
    visual_cues: [],
    expert_inferences: [],
    missing_views: [],
    image_quality_limits: [],
    warnings,
    prompt: null
  };
}

function buildVisualEnrichmentPrompt(classification: ProductClassification): string {
  return [
    "You are doing Stage 5 visual enrichment for a clothing quality-checking Chrome extension.",
    "Use the supplied product images only for visual enrichment. Return strict JSON.",
    "Do not merely caption the image. Prioritise diagnostic cues an experienced personal shopper, tailor, cobbler, or buyer would notice.",
    "Allowed visual cues: colour, silhouette, texture appearance, fit/proportion, seam or edge neatness, visible hardware/trim, surface finish, drape, fabric density appearance, pilling/fuzz, transparency, puckering, glue marks, loose threads, and aesthetic refinement.",
    "Expert inferences are allowed only when phrased as possible/consistent with/suggests/may indicate, with a caveat. Prefer useful low-confidence inference over bland captioning.",
    "Use a sceptical retail-quality prior: high-street and budget products are usually mass-produced and cost-constrained. Do not reward them for looking acceptable in studio photos.",
    "Absence of visible defects in product images is not positive construction evidence. Clean lapels, crisp pocket flaps, pressed edges, or no visible puckering should be neutral unless there is a close-up showing seams, edge finishing, lining attachment, or stitching.",
    "Styling details such as contrast lining, print lining, buttons, or trim may be aesthetic cues only. They must not imply better construction, durability, or value.",
    "Standard functional buttons/hardware are neutral unless close-up evidence shows unusually good or poor material/attachment.",
    "Do not infer comfort, durability, or practical material benefits from a matte finish or generic visible texture.",
    "Forbidden as hard claims from images alone: true fibre content, fabric authenticity, exact leather grade, exact construction method, long-term durability, or guaranteed build quality.",
    "Do allow visible construction-finish cues such as stitch regularity, seam puckering, edge finishing, glue marks, lining visibility, or hardware appearance.",
    `Category checklist: ${categoryChecklist(classification.category, classification.material_family)}`,
    "Return: visual_cues, expert_inferences, missing_views, image_quality_limits, and legacy visual_observations.",
    "visual_cues items: cue, evidence_type, confidence, image_limitations.",
    "expert_inferences items: inference, quality_dimension, confidence, basis='inferred_from_image', why_it_matters, caveat, score_dimension, score_effect.",
    "Allowed quality_dimension: material_finish, construction_finish, hardware_trim, fit_drape, surface_wear, aesthetic_refinement.",
    "Allowed score_dimension: quality, durability, aesthetic, confidence. Allowed score_effect: none, small_positive, small_negative, medium_positive, medium_negative.",
    "Use medium score effects only for clearly visible cues; low confidence inferences should normally be small or none.",
    `Known non-visual product context: category=${classification.category}; material_family=${classification.material_family}; brand_tier=${classification.brand_tier}; source_confidence=${classification.source_confidence_label}.`,
    "Each legacy visual_observations item must include observation, confidence high|medium|low, evidence_type, and should_affect_score."
  ].join("\n");
}

function categoryChecklist(category: ProductClassification["category"], materialFamily: ProductClassification["material_family"]): string {
  if (category === "knitwear") {
    return "knit evenness, gauge appearance, rib trim recovery, fuzz/pilling, shoulder and neckline shape, density impression, seam bulk";
  }
  if (category === "footwear") {
    return "upper surface finish, leather grain appearance, sole attachment cues, stitch regularity, glue marks, lining visibility, creasing, edge finishing";
  }
  if (category === "shirt") {
    return "collar structure, placket alignment, fabric transparency, seam puckering, pattern matching, drape, button spacing";
  }
  if (category === "outerwear" && materialFamily === "leather") {
    return "grain naturalness, coating/plastic sheen, panel matching, zip/hardware appearance, edge finishing, lining clues, wrinkling, seam neatness";
  }
  if (category === "outerwear") {
    return "fabric body, lining visibility, seam finishing, pocket construction, hardware, quilting or fleece density, hem/cuff structure";
  }
  if (category === "t-shirt") {
    return "fabric transparency, neck rib shape, side seam twisting, print finish, hem neatness, drape and recovery appearance";
  }
  return "surface finish, seam neatness, edge finishing, hardware/trim, drape, transparency, density appearance, visible wear or loose threads";
}

function hasUncertaintyLanguage(value: string): boolean {
  return /\b(?:appears?|looks?|suggests?|may|might|could|can be consistent with|possibly|likely|seems|visible cue|from the image|not enough|cannot verify)\b/i.test(value);
}

function weakPositiveVisualInference(value: string, inference: ExpertVisualInference): boolean {
  if (inference.score_effect !== "small_positive" && inference.score_effect !== "medium_positive") return false;
  return (
    WEAK_POSITIVE_CONSTRUCTION_PATTERN.test(value) ||
    STYLING_AS_QUALITY_PATTERN.test(value) ||
    MATERIAL_BENEFIT_FROM_APPEARANCE_PATTERN.test(value)
  );
}

function neutraliseWeakPositiveInference(value: string, inference: ExpertVisualInference): string | null {
  if (!weakPositiveVisualInference(value, inference)) return null;
  if (STYLING_AS_QUALITY_PATTERN.test(value)) {
    return "Visible lining, trim, buttons, or styling details are aesthetic cues only; they do not establish better construction, durability, or value from images alone.";
  }
  if (MATERIAL_BENEFIT_FROM_APPEARANCE_PATTERN.test(value)) {
    return "Generic fabric texture or matte finish in a product image is not enough evidence to infer comfort, durability, or practical material benefits.";
  }
  return "Clean pressed edges or an absence of visible defects in studio product images are neutral; they do not establish construction quality without close-up seam, lining, or stitching evidence.";
}

function capScoreEffect(effect: VisualScoreEffect, confidence: ExpertVisualInference["confidence"]): VisualScoreEffect {
  if (confidence === "low" && (effect === "medium_positive" || effect === "medium_negative")) {
    return effect === "medium_positive" ? "small_positive" : "small_negative";
  }
  return isScoreEffect(effect) ? effect : "none";
}

function isQualityDimension(value: unknown): value is VisualQualityDimension {
  return (
    value === "material_finish" ||
    value === "construction_finish" ||
    value === "hardware_trim" ||
    value === "fit_drape" ||
    value === "surface_wear" ||
    value === "aesthetic_refinement"
  );
}

function isScoreDimension(value: unknown): value is VisualScoreDimension {
  return value === "quality" || value === "durability" || value === "aesthetic" || value === "confidence";
}

function isScoreEffect(value: unknown): value is VisualScoreEffect {
  return (
    value === "none" ||
    value === "small_positive" ||
    value === "small_negative" ||
    value === "medium_positive" ||
    value === "medium_negative"
  );
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned.slice(0, 120));
  }
  return result;
}
