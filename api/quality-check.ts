import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  BackendAnalysis,
  BackendPayload,
  BackendVerdict,
  BrandTier,
  DimensionVerdict,
  ExpertVisualInference,
  MatchedApprovedExample,
  MaterialFamily,
  ProductCategory,
  ProductClassification,
  Recommendation,
  Stage6Verdict,
  VerdictConfidence,
  VerdictEvidenceType,
  VerdictScores,
  VisualCue,
  VisualObservation,
  VisualObservationConfidence,
  VisualObservationEvidenceType,
  VisualQualityDimension,
  VisualScoreDimension,
  VisualScoreEffect
} from "../src/shared/messages";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4_000_000;
const REQUEST_BODY_LIMIT_BYTES = 1_000_000;
const DEFAULT_VISION_MODEL = "gemini-3.0-flash";
const DEFAULT_CORE_MODEL = "gpt-5.4-mini";
const DEFAULT_PREMIUM_FALLBACK_MODEL = "gpt-5.4";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const FORBIDDEN_STRONG_VISUAL_CLAIM_PATTERN =
  /\b(?:made from|made of|is genuine|are genuine|authentic|real leather|full[- ]grain|top[- ]grain|100%\s+|pure\s+(?:wool|cotton|linen|leather|silk)|will last|long[- ]term durable|welted construction|goodyear welted|fabric quality is|construction is (?:excellent|poor|high quality|low quality)|(?:is|are) (?:genuine|authentic|real|pure|durable|high quality|low quality|wool|cotton|linen|leather|silk))\b/i;
const UNQUALIFIED_VISUAL_QUALITY_PATTERN =
  /\b(?:high quality|low quality|poor quality|excellent quality|cheaply made|well made|durable|not durable|stitched|welted|bonded|genuine|authentic|full[- ]grain|top[- ]grain)\b/i;
const WEAK_POSITIVE_VISUAL_CONSTRUCTION_PATTERN =
  /\b(?:clean|crisp|neat|sharp|smooth|absence of|no visible|without visible|standard|functional|typical|consistent with).{0,80}\b(?:lapels?|edges?|pocket flaps?|puckering|buttons?|cuffs?|construction finish|standard of construction|hardware)\b/i;
const STYLING_AS_VISUAL_QUALITY_PATTERN =
  /\b(?:lining|contrast(?:ing)? lining|floral lining|buttons?|trim|design choice).{0,180}\b(?:elevat\w*|perceived value|quality|construction|well made|premium|attention to detail)\b/i;
const MATERIAL_BENEFIT_FROM_VISUAL_APPEARANCE_PATTERN =
  /\b(?:visible fabric texture|matte finish|surface appearance|appearance).{0,120}\b(?:durability|comfort|practical benefits|material choice aligns|blend material)\b/i;

type Env = Record<string, string | undefined>;

type QualityCheckEnv = {
  geminiApiKey: string | null;
  openaiApiKey: string | null;
  visionModel: string;
  coreModel: string;
  premiumFallbackModel: string;
  embeddingModel: string;
};

type DownloadedImage = {
  url: string;
  mimeType: string;
  base64: string;
};

type Fetcher = typeof fetch;

type QualityCheckDependencies = {
  env?: Env;
  fetcher?: Fetcher;
  requestId?: () => string;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

type OpenAIResponsesResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

type ParsedVisionResult = {
  observations: VisualObservation[];
  visual_cues: VisualCue[];
  expert_inferences: ExpertVisualInference[];
  missing_views: string[];
  image_quality_limits: string[];
};

type Stage6Context = {
  payload: BackendPayload;
  visual: BackendAnalysis["visual_enrichment"];
  matchedExamples: MatchedApprovedExample[];
  env: QualityCheckEnv;
  fetcher: Fetcher;
};

type ScoreGuardrails = Record<keyof Omit<VerdictScores, "confidence">, { min: number; max: number }>;

const APPROVED_EXAMPLES: MatchedApprovedExample[] = [
  example("approved_merino_knit_mid_premium_001", "knitwear", "wool", "mid-premium", "£80-£150", [7.8, 7.8, 7.0, 7.5, 0.86], "buy"),
  example("approved_cashmere_knit_luxury_001", "knitwear", "wool", "luxury", "£600+", [8.8, 4.8, 6.8, 8.7, 0.84], "overpriced"),
  example("approved_wool_blend_knit_high_street_001", "knitwear", "blend", "high-street", "£40-£90", [6.4, 6.8, 6.0, 6.5, 0.78], "consider"),
  example("approved_acrylic_knit_budget_001", "knitwear", "synthetic", "budget", "under £40", [4.4, 5.4, 4.8, 5.2, 0.74], "reconsider"),
  example("approved_linen_shirt_mid_premium_001", "shirt", "linen", "mid-premium", "£60-£120", [7.2, 7.1, 6.6, 7.4, 0.82], "buy"),
  example("approved_cotton_linen_shirt_high_street_001", "shirt", "blend", "high-street", "£30-£70", [6.4, 7.0, 6.2, 6.6, 0.78], "consider"),
  example("approved_cotton_shirt_budget_001", "shirt", "cotton", "budget", "under £30", [5.4, 6.2, 5.6, 5.4, 0.76], "consider"),
  example("approved_synthetic_shirt_high_street_001", "shirt", "synthetic", "high-street", "£30-£60", [4.8, 4.8, 5.0, 5.8, 0.72], "reconsider"),
  example("approved_leather_trainers_high_street_001", "footwear", "leather", "high-street", "£40-£90", [6.4, 7.0, 6.3, 6.2, 0.78], "consider"),
  example("approved_leather_trainers_premium_001", "footwear", "leather", "premium", "£100-£220", [7.4, 6.3, 7.0, 7.1, 0.8], "consider"),
  example("approved_synthetic_trainers_budget_001", "footwear", "synthetic", "budget", "under £50", [4.8, 5.5, 4.9, 5.5, 0.7], "reconsider"),
  example("approved_leather_jacket_premium_001", "outerwear", "leather", "premium", "£250-£600", [7.5, 6.4, 7.2, 7.8, 0.78], "consider"),
  example("approved_leather_jacket_luxury_001", "outerwear", "leather", "luxury", "£1200+", [8.2, 4.2, 7.4, 8.6, 0.72], "overpriced"),
  example("approved_poly_fleece_premium_001", "outerwear", "synthetic", "premium", "£80-£150", [6.8, 7.0, 7.2, 6.1, 0.82], "consider"),
  example("approved_recycled_fleece_premium_001", "outerwear", "synthetic", "premium", "£120-£220", [7.0, 6.6, 7.3, 6.6, 0.82], "consider"),
  example("approved_blazer_high_street_001", "outerwear", "blend", "high-street", "£50-£120", [5.8, 6.1, 5.7, 6.3, 0.74], "consider"),
  example("approved_denim_high_street_001", "denim", "cotton", "high-street", "£35-£80", [6.2, 6.8, 6.5, 6.1, 0.8], "consider"),
  example("approved_denim_premium_001", "denim", "cotton", "premium", "£120-£250", [7.4, 6.0, 7.2, 7.0, 0.82], "consider"),
  example("approved_tshirt_cotton_budget_001", "t-shirt", "cotton", "budget", "under £20", [5.2, 6.5, 5.0, 5.2, 0.78], "consider"),
  example("approved_tshirt_premium_cotton_001", "t-shirt", "cotton", "premium", "£40-£90", [6.8, 5.4, 6.2, 6.8, 0.8], "consider"),
  example("approved_trousers_wool_mid_premium_001", "trousers", "wool", "mid-premium", "£90-£180", [7.4, 6.8, 7.0, 7.2, 0.8], "buy"),
  example("approved_trousers_synthetic_high_street_001", "trousers", "synthetic", "high-street", "£30-£80", [5.4, 6.0, 5.7, 5.9, 0.76], "consider"),
  example("approved_bag_leather_premium_001", "bag", "leather", "premium", "£180-£450", [7.6, 6.4, 7.6, 7.5, 0.78], "consider"),
  example("approved_bag_synthetic_budget_001", "bag", "synthetic", "budget", "under £50", [4.8, 5.8, 5.0, 5.2, 0.72], "reconsider"),
  example("approved_dress_viscose_high_street_001", "dress", "viscose", "high-street", "£40-£100", [5.8, 6.4, 5.4, 6.8, 0.76], "consider"),
  example("approved_dress_silk_premium_001", "dress", "silk", "premium", "£180-£450", [7.8, 6.3, 6.2, 8.0, 0.78], "consider"),
  example("approved_skirt_wool_mid_premium_001", "skirt", "wool", "mid-premium", "£80-£180", [7.2, 6.7, 6.8, 7.2, 0.78], "consider"),
  example("approved_activewear_synthetic_premium_001", "activewear", "synthetic", "premium", "£60-£150", [6.8, 6.7, 7.4, 6.2, 0.8], "consider"),
  example("approved_accessory_leather_high_street_001", "accessory", "leather", "high-street", "£20-£80", [6.0, 6.8, 6.1, 6.0, 0.76], "consider"),
  example("approved_unknown_thin_page_001", "other", "unknown", "unknown", "unknown", [2.8, 2.8, 2.8, 2.8, 0.2], "not_enough_info")
];

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const result = await handleQualityCheckPayload(body);
    sendJson(res, 200, result);
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected quality-check backend error.";
    console.error("quality-check backend error", error);
    sendJson(res, status, { error: message });
  }
}

export async function handleQualityCheckPayload(
  body: unknown,
  dependencies: QualityCheckDependencies = {}
): Promise<BackendVerdict> {
  const payload = validateStage5Payload(body);
  const env = readQualityCheckEnv(dependencies.env || process.env);
  const warnings = [...payload.visual_enrichment.warnings];
  const observations: VisualObservation[] = [];
  const visualCues: VisualCue[] = [];
  const expertInferences: ExpertVisualInference[] = [];
  const missingViews = [...payload.visual_enrichment.missing_views];
  const imageQualityLimits = [...payload.visual_enrichment.image_quality_limits];

  if (!env.openaiApiKey) {
    warnings.push("OPENAI_API_KEY is not configured; Stage 6 core analysis is disabled.");
  }

  const imageUrls = normaliseImageUrls(payload);
  if (imageUrls.length === 0) {
    warnings.push("visual enrichment skipped: product images not found");
  } else if (payload.visual_enrichment.status !== "requested") {
    warnings.push("visual enrichment skipped: extension payload did not request vision analysis");
  } else if (!env.geminiApiKey) {
    warnings.push("visual enrichment skipped: GEMINI_API_KEY is not configured");
  } else {
    const downloaded = await downloadImages(imageUrls, dependencies.fetcher || fetch, warnings);

    if (downloaded.length === 0) {
      warnings.push("visual enrichment skipped: no usable images could be fetched");
    } else {
      const modelResult = await runGeminiVision({
        apiKey: env.geminiApiKey,
        model: env.visionModel,
        prompt: payload.visual_enrichment.prompt || buildFallbackPrompt(),
        images: downloaded,
        fetcher: dependencies.fetcher || fetch
      });
      const cleanObservations = sanitiseVisualObservations(modelResult.observations);
      const cleanCues = sanitiseVisualCues(modelResult.visual_cues);
      const cleanInferences = sanitiseExpertVisualInferences(modelResult.expert_inferences);
      observations.push(...cleanObservations.observations);
      visualCues.push(...cleanCues.visual_cues);
      expertInferences.push(...cleanInferences.expert_inferences);
      missingViews.push(...modelResult.missing_views);
      imageQualityLimits.push(...modelResult.image_quality_limits);
      warnings.push(...cleanObservations.warnings, ...cleanCues.warnings, ...cleanInferences.warnings);
    }
  }

  const title = String(payload.page.product.fields.title.value || payload.page.title || "Untitled page");
  const visualCompleted = observations.length > 0 || visualCues.length > 0 || expertInferences.length > 0;
  const visualResult = {
    status: visualCompleted ? ("completed" as const) : ("skipped" as const),
    model: env.visionModel,
    image_count: imageUrls.length,
    observations,
    visual_cues: visualCues,
    expert_inferences: expertInferences,
    missing_views: uniqueStrings(missingViews).slice(0, 8),
    image_quality_limits: uniqueStrings(imageQualityLimits).slice(0, 8),
    warnings: uniqueStrings(warnings)
  };
  const matchedExamples = retrieveApprovedExamples(payload.classification);
  const verdict = await createStage6Verdict({
    payload,
    visual: visualResult,
    matchedExamples,
    env,
    fetcher: dependencies.fetcher || fetch
  });
  const analysis: BackendAnalysis = {
    stage: "stage_6",
    status: payload.page.product.page_state === "product_page" ? "completed" : "skipped",
    product: {
      title,
      url: payload.page.url,
      page_state: payload.page.product.page_state,
      source_confidence_score: payload.page.product.source_confidence_score,
      source_confidence_label: payload.classification.source_confidence_label
    },
    classification: payload.classification,
    visual_enrichment: visualResult,
    verdict,
    approved_examples: matchedExamples,
    model_config: {
      vision_model: env.visionModel,
      core_model: env.coreModel,
      premium_fallback_model: env.premiumFallbackModel,
      embedding_model: env.embeddingModel,
      openai_configured: Boolean(env.openaiApiKey)
    }
  };

  return {
    requestId: dependencies.requestId ? dependencies.requestId() : crypto.randomUUID(),
    summary: buildSummary(analysis),
    receivedUrl: payload.page.url,
    source: "backend",
    capturedTitle: title,
    analysis
  };
}

async function createStage6Verdict(context: Stage6Context): Promise<Stage6Verdict> {
  const fallback = createHeuristicVerdict(context, context.env.openaiApiKey ? "model_unavailable" : "heuristic_fallback");
  if (!context.env.openaiApiKey) return fallback;

  try {
    const modelVerdict = await runOpenAIVerdict(context, fallback);
    return sanitiseStage6Verdict(modelVerdict, fallback, context);
  } catch (error) {
    context.visual.warnings.push(
      `Stage 6 core analysis fell back to deterministic scoring: ${error instanceof Error ? error.message : "unknown error"}`
    );
    return fallback;
  }
}

async function runOpenAIVerdict(context: Stage6Context, fallback: Stage6Verdict): Promise<Partial<Stage6Verdict>> {
  const response = await context.fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${context.env.openaiApiKey}`
    },
    body: JSON.stringify({
      model: context.env.coreModel,
      temperature: 0,
      text: {
        format: {
          type: "json_schema",
          name: "quality_check_stage_6_verdict",
          strict: true,
          schema: stage6ResponseSchema()
        }
      },
      instructions: buildStage6Instructions(),
      input: JSON.stringify(buildStage6ModelInput(context, fallback))
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI verdict request failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as OpenAIResponsesResponse;
  const text =
    data.output_text ||
    data.output?.flatMap((item) => item.content || []).find((content) => content.type === "output_text" && content.text)?.text ||
    "{}";
  return parseModelJson(text) as Partial<Stage6Verdict>;
}

function createHeuristicVerdict(context: Stage6Context, status: Stage6Verdict["model_status"]): Stage6Verdict {
  const classification = context.payload.classification;
  const product = context.payload.page.product;
  const sourceConfidence = confidenceCap(product.page_state, classification.source_confidence_score);
  const guardrails = buildScoreGuardrails(classification, product.page_state, sourceConfidence);
  const anchorScores = averageAnchorScores(context.matchedExamples);
  const scores: VerdictScores = {
    quality: clampScore(blendScore(midpoint(guardrails.quality), anchorScores.quality, 0.35), guardrails.quality),
    value: clampScore(blendScore(midpoint(guardrails.value), anchorScores.value, 0.35), guardrails.value),
    durability: clampScore(blendScore(midpoint(guardrails.durability), anchorScores.durability, 0.35), guardrails.durability),
    aesthetic: clampScore(
      applyVisualEffects(blendScore(midpoint(guardrails.aesthetic), anchorScores.aesthetic, 0.3), context.visual.expert_inferences),
      guardrails.aesthetic
    ),
    confidence: round2(sourceConfidence)
  };
  const overall = deriveOverall(scores);
  const recommendation = chooseRecommendation(overall, scores, classification, product.page_state);
  const reasoningFlags = buildReasoningFlags(context);
  const confidenceLabel = verdictConfidence(scores.confidence);

  return {
    overall_rating: overall,
    recommendation,
    recommendation_summary: recommendationSummary(recommendation, classification, scores),
    scores,
    confidence_label: confidenceLabel,
    verdicts: {
      quality: qualityVerdict(context, scores, confidenceLabel),
      value: valueVerdict(classification, context.matchedExamples, scores),
      durability: durabilityVerdict(context, scores, confidenceLabel),
      aesthetic: aestheticVerdict(context, scores, confidenceLabel)
    },
    reasoning_flags: reasoningFlags,
    matched_examples: context.matchedExamples.map((item) => item.id),
    summary: summaryLine(recommendation, scores, classification),
    model: context.env.coreModel,
    model_status: status
  };
}

function sanitiseStage6Verdict(
  candidate: Partial<Stage6Verdict>,
  fallback: Stage6Verdict,
  context: Stage6Context
): Stage6Verdict {
  const guardrails = buildScoreGuardrails(
    context.payload.classification,
    context.payload.page.product.page_state,
    confidenceCap(context.payload.page.product.page_state, context.payload.classification.source_confidence_score)
  );
  const scores: VerdictScores = {
    quality: clampScore(numberOr(candidate.scores?.quality, fallback.scores.quality), guardrails.quality),
    value: clampScore(numberOr(candidate.scores?.value, fallback.scores.value), guardrails.value),
    durability: clampScore(numberOr(candidate.scores?.durability, fallback.scores.durability), guardrails.durability),
    aesthetic: clampScore(numberOr(candidate.scores?.aesthetic, fallback.scores.aesthetic), guardrails.aesthetic),
    confidence: fallback.scores.confidence
  };
  const overall = deriveOverall(scores);
  const recommendation = isRecommendation(candidate.recommendation) ? candidate.recommendation : chooseRecommendation(overall, scores, context.payload.classification, context.payload.page.product.page_state);
  const confidenceLabel = verdictConfidence(scores.confidence);

  return {
    overall_rating: overall,
    recommendation,
    recommendation_summary: cleanText(candidate.recommendation_summary, fallback.recommendation_summary, 180),
    scores,
    confidence_label: confidenceLabel,
    verdicts: {
      quality: cleanDimensionVerdict(candidate.verdicts?.quality, fallback.verdicts.quality, confidenceLabel),
      value: cleanDimensionVerdict(candidate.verdicts?.value, fallback.verdicts.value, confidenceLabel),
      durability: cleanDimensionVerdict(candidate.verdicts?.durability, fallback.verdicts.durability, confidenceLabel),
      aesthetic: cleanDimensionVerdict(candidate.verdicts?.aesthetic, fallback.verdicts.aesthetic, confidenceLabel)
    },
    reasoning_flags: uniqueStrings([...(candidate.reasoning_flags || []), ...fallback.reasoning_flags]).slice(0, 10),
    matched_examples: fallback.matched_examples,
    summary: cleanText(candidate.summary, fallback.summary, 160),
    model: context.env.coreModel,
    model_status: "model_completed"
  };
}

function retrieveApprovedExamples(classification: ProductClassification): MatchedApprovedExample[] {
  return APPROVED_EXAMPLES.map((item) => ({
    ...item,
    similarity: similarityScore(classification, item)
  }))
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 5);
}

function similarityScore(classification: ProductClassification, exampleItem: MatchedApprovedExample): number {
  let score = 0;
  if (classification.category === exampleItem.category) score += 0.42;
  if (classification.material_family === exampleItem.material_family) score += 0.24;
  if (classification.brand_tier === exampleItem.brand_tier) score += 0.16;
  if (priceBand(classification.price) === exampleItem.price_band) score += 0.08;
  if (classification.category !== exampleItem.category && exampleItem.category === "other") score += 0.02;
  return round2(Math.min(0.98, score + 0.1));
}

function buildScoreGuardrails(
  classification: ProductClassification,
  pageState: BackendPayload["page"]["product"]["page_state"],
  confidence: number
): ScoreGuardrails {
  if (pageState !== "product_page" || confidence < 0.3) {
    return {
      quality: { min: 1.5, max: 4.2 },
      value: { min: 1.5, max: 4.2 },
      durability: { min: 1.5, max: 4.2 },
      aesthetic: { min: 1.5, max: 5.0 }
    };
  }

  const base = materialBase(classification.material_family);
  const tierAdjustment = brandTierAdjustment(classification.brand_tier);
  const priceAdjustment = valuePriceAdjustment(classification.price, classification.brand_tier);
  const constructionPenalty = classification.construction_description.includes("not clearly stated") ? -0.3 : 0.2;
  const carePenalty = classification.quality_concerns.some((item) => item.includes("material composition not found")) ? -0.8 : 0;

  return {
    quality: range(base.quality + tierAdjustment + constructionPenalty + carePenalty, 1.1),
    value: range(base.value + priceAdjustment + carePenalty, 1.2),
    durability: range(base.durability + constructionPenalty + carePenalty, 1.1),
    aesthetic: range(base.aesthetic + tierAdjustment * 0.8, 1.4)
  };
}

function confidenceCap(pageState: BackendPayload["page"]["product"]["page_state"], score: number): number {
  if (pageState !== "product_page") return Math.min(score, 0.24);
  if (score < 0.45) return Math.min(score, 0.44);
  return Math.min(0.92, score);
}

function materialBase(material: MaterialFamily): Omit<VerdictScores, "confidence"> {
  const table: Record<MaterialFamily, Omit<VerdictScores, "confidence">> = {
    wool: { quality: 7.4, value: 6.8, durability: 6.8, aesthetic: 7.2 },
    cotton: { quality: 6.4, value: 6.8, durability: 6.2, aesthetic: 6.3 },
    linen: { quality: 6.9, value: 6.7, durability: 6.3, aesthetic: 7.0 },
    leather: { quality: 6.8, value: 6.3, durability: 6.7, aesthetic: 7.0 },
    silk: { quality: 7.2, value: 5.8, durability: 5.3, aesthetic: 7.7 },
    synthetic: { quality: 5.2, value: 5.8, durability: 5.8, aesthetic: 5.7 },
    viscose: { quality: 5.8, value: 6.2, durability: 5.3, aesthetic: 6.7 },
    blend: { quality: 6.1, value: 6.3, durability: 6.0, aesthetic: 6.3 },
    unknown: { quality: 4.0, value: 4.0, durability: 4.0, aesthetic: 5.0 }
  };
  return table[material];
}

function brandTierAdjustment(tier: BrandTier): number {
  return { budget: -0.6, "high-street": -0.2, "mid-premium": 0.25, premium: 0.45, luxury: 0.55, unknown: -0.25 }[tier];
}

function valuePriceAdjustment(price: string | null, tier: BrandTier): number {
  const amount = parsePrice(price);
  if (amount === null) return -0.4;
  const expensive = tier === "luxury" ? 700 : tier === "premium" ? 250 : tier === "mid-premium" ? 150 : 80;
  const cheap = tier === "luxury" ? 250 : tier === "premium" ? 100 : tier === "mid-premium" ? 60 : 30;
  if (amount > expensive) return -1.4;
  if (amount < cheap) return 0.6;
  return 0;
}

function deriveOverall(scores: VerdictScores): number {
  const raw = scores.quality * 0.32 + scores.value * 0.28 + scores.durability * 0.2 + scores.aesthetic * 0.14 + scores.confidence * 10 * 0.06;
  const capped = scores.confidence < 0.45 ? Math.min(raw, 5.2) : raw;
  return round1(capped);
}

function chooseRecommendation(
  overall: number,
  scores: VerdictScores,
  classification: ProductClassification,
  pageState: BackendPayload["page"]["product"]["page_state"]
): Recommendation {
  if (pageState !== "product_page" || scores.confidence < 0.45 || classification.material_family === "unknown") return "not_enough_info";
  if (scores.quality >= 7.3 && scores.value <= 5.2) return "overpriced";
  if (overall >= 8.2 && scores.value >= 7.2) return "strong_buy";
  if (overall >= 7.1 && scores.value >= 6.4) return "buy";
  if (overall >= 5.7) return "consider";
  if (overall >= 4.6) return "reconsider";
  return "avoid";
}

function buildReasoningFlags(context: Stage6Context): string[] {
  const product = context.payload.page.product;
  const flags: string[] = [];
  if (!product.fields.materials.value) flags.push("material_composition_not_found");
  if (!product.fields.care.value) flags.push("care_label_not_found");
  if (!product.fields.construction.value) flags.push("construction_method_not_verified");
  if (context.visual.status === "skipped") flags.push("visual_enrichment_skipped");
  if (context.visual.missing_views.length) flags.push("missing_close_up_views");
  if (product.source_confidence_score < 0.45) flags.push("weak_source_data");
  if (product.page_state !== "product_page") flags.push(`page_state_${product.page_state}`);
  return uniqueStrings(flags);
}

function qualityVerdict(context: Stage6Context, scores: VerdictScores, confidence: VerdictConfidence): DimensionVerdict {
  const classification = context.payload.classification;
  const signal = classification.quality_signals[0];
  const materialInsight = materialQualityInsight(classification);
  const construction = constructionExpectation(classification.category);
  const tone = scoreTone(scores.quality);

  if (classification.material_family === "unknown") {
    return dimension(
      "Quality is capped because the page does not give a reliable fibre composition. Without that, a clothing expert cannot separate a decent basic from a cheap lookalike.",
      "low",
      "unknown"
    );
  }

  if (signal) {
    return dimension(
      `${tone}: ${materialInsight} ${construction}`,
      confidence,
      signal.startsWith("stated on page") ? "stated_on_page" : "inferred_from_material"
    );
  }

  return dimension(`${tone}: ${materialInsight} ${construction}`, confidence, "inferred_from_material");
}

function valueVerdict(
  classification: ProductClassification,
  examples: MatchedApprovedExample[],
  scores: VerdictScores
): DimensionVerdict {
  if (!classification.price) return dimension("Price was not found, so value is uncertain.", "low", "unknown");
  const anchor = examples[0];
  const market = marketPriceContext(classification);
  const price = classification.price;
  const valueTone = scores.value >= 7 ? "looks strong" : scores.value < 5.5 ? "looks weak" : "looks fair but not exceptional";
  return dimension(
    `${price} ${valueTone} for this lane. ${market} The score is anchored against ${anchor?.id || "similar approved examples"}, not just the retailer's own positioning.`,
    "medium",
    "similar_approved_example"
  );
}

function durabilityVerdict(context: Stage6Context, scores: VerdictScores, confidence: VerdictConfidence): DimensionVerdict {
  const classification = context.payload.classification;
  const tone = scoreTone(scores.durability);
  const construction = constructionExpectation(classification.category);
  if (classification.material_family === "wool") {
    return dimension(`${tone}: Wool can be warm and resilient, but knitwear durability depends on yarn twist, gauge, abrasion points, washing, and pilling maintenance. ${construction}`, confidence, "general_material_knowledge");
  }
  if (classification.material_family === "leather") {
    return dimension(`${tone}: Leather can age well when the hide, lining, sole/zip hardware, and edge finishing are good; the page/image evidence does not prove those higher-end construction details.`, "medium", "general_material_knowledge");
  }
  if (classification.material_family === "synthetic") {
    return dimension(`${tone}: Synthetic fabrics can be easy-care and abrasion resistant, but cheaper versions often lose handle, pill, or look tired faster than better natural-fibre or technical fabrics.`, "medium", "general_material_knowledge");
  }
  if (classification.material_family === "cotton") {
    return dimension(`${tone}: Cotton is washable and breathable, but shirt lifespan depends on fabric weight, yarn quality, collar/placket structure, seam neatness, and button attachment. ${construction}`, confidence, "general_material_knowledge");
  }
  if (classification.material_family === "linen") {
    return dimension(`${tone}: Linen is strong and breathable but creases hard; durability is usually more about fabric weight, seam finish, and whether the loose weave distorts over time. ${construction}`, confidence, "general_material_knowledge");
  }
  return dimension(`${tone}: Expected lifespan is hard to separate from average without stronger fibre, care, and construction evidence. ${construction}`, "medium", "unknown");
}

function aestheticVerdict(context: Stage6Context, scores: VerdictScores, confidence: VerdictConfidence): DimensionVerdict {
  const inference = context.visual.expert_inferences.find((item) => item.score_dimension === "aesthetic");
  if (inference) return dimension(inference.inference, inference.confidence, "inferred_from_image");
  const tags = context.payload.classification.style_tags.join(", ");
  const classification = context.payload.classification;
  const tone = scoreTone(scores.aesthetic);
  const contextLine = aestheticContext(classification);
  return dimension(
    tags ? `${tone}: ${contextLine} The style reads as ${tags}, so the score is about versatility and refinement rather than novelty.` : `${tone}: Aesthetic judgement is limited by sparse product evidence.`,
    confidence,
    tags ? "stated_on_page" : "unknown"
  );
}

function buildStage6Instructions(): string {
  return [
    "You are Stage 6 of a clothing Quality Check Chrome extension. Write as a clothing-market expert advising a normal shopper.",
    "Return strict JSON only. Score within the supplied guardrails and stay consistent with matched approved examples.",
    "Each dimension verdict must explain WHY the score is what it is, not merely restate the product: mention material trade-offs, construction signals expected for the category, market price context, and what prevents a higher score.",
    "For value, compare the observed price to a realistic market lane such as budget, high-street, mid-premium, premium, or luxury, using the supplied market_context and approved examples.",
    "For ratings below 7.0, include at least one concrete limitation. For ratings above 7.0, include why it beats the average and what caveat remains.",
    "Do not use generic filler like 'construction quality cannot be fully verified from images' unless you specify the exact missing evidence, e.g. seam close-up, button attachment, collar/placket structure, lining, sole attachment, stitch regularity, edge finishing.",
    "Do not hard-claim fibre authenticity, exact construction, leather grade, guaranteed build quality, or long-term durability from images.",
    "Weak source data must cap confidence and can return not_enough_info. Confidence must be deterministic from source evidence."
  ].join("\n");
}

function buildStage6ModelInput(context: Stage6Context, fallback: Stage6Verdict) {
  return {
    product: context.payload.page.product,
    classification: context.payload.classification,
    visual_enrichment: context.visual,
    matched_approved_examples: context.matchedExamples,
    market_context: {
      price_context: marketPriceContext(context.payload.classification),
      construction_expected_evidence: constructionExpectation(context.payload.classification.category),
      material_expert_context: materialQualityInsight(context.payload.classification),
      aesthetic_context: aestheticContext(context.payload.classification)
    },
    score_guardrails: buildScoreGuardrails(
      context.payload.classification,
      context.payload.page.product.page_state,
      fallback.scores.confidence
    ),
    deterministic_baseline: fallback,
    required_variance_tolerance: {
      overall: 0.4,
      quality: 0.4,
      value: 0.5,
      durability: 0.4,
      aesthetic: 0.7,
      confidence: "deterministic"
    }
  };
}

function stage6ResponseSchema() {
  const scoreProperties = {
    quality: { type: "number" },
    value: { type: "number" },
    durability: { type: "number" },
    aesthetic: { type: "number" },
    confidence: { type: "number" }
  };
  const dimensionVerdict = {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "confidence", "evidence_type"],
    properties: {
      verdict: { type: "string" },
      confidence: { enum: ["high", "medium", "low"] },
      evidence_type: {
        enum: ["stated_on_page", "inferred_from_material", "inferred_from_image", "general_material_knowledge", "similar_approved_example", "unknown"]
      }
    }
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["overall_rating", "recommendation", "recommendation_summary", "scores", "confidence_label", "verdicts", "reasoning_flags", "matched_examples", "summary"],
    properties: {
      overall_rating: { type: "number" },
      recommendation: { enum: ["strong_buy", "buy", "consider", "reconsider", "overpriced", "avoid", "not_enough_info"] },
      recommendation_summary: { type: "string" },
      scores: { type: "object", additionalProperties: false, required: Object.keys(scoreProperties), properties: scoreProperties },
      confidence_label: { enum: ["high", "medium", "low"] },
      verdicts: {
        type: "object",
        additionalProperties: false,
        required: ["quality", "value", "durability", "aesthetic"],
        properties: { quality: dimensionVerdict, value: dimensionVerdict, durability: dimensionVerdict, aesthetic: dimensionVerdict }
      },
      reasoning_flags: { type: "array", items: { type: "string" } },
      matched_examples: { type: "array", items: { type: "string" } },
      summary: { type: "string" }
    }
  };
}

function example(
  id: string,
  category: ProductCategory,
  materialFamily: MaterialFamily,
  brandTier: BrandTier,
  priceBandValue: string,
  scores: [number, number, number, number, number],
  recommendation: Recommendation
): MatchedApprovedExample {
  return {
    id,
    category,
    material_family: materialFamily,
    brand_tier: brandTier,
    price_band: priceBandValue,
    similarity: 0,
    expected_scores: {
      quality: scores[0],
      value: scores[1],
      durability: scores[2],
      aesthetic: scores[3],
      confidence: scores[4]
    },
    recommendation
  };
}

function averageAnchorScores(examples: MatchedApprovedExample[]): VerdictScores {
  if (examples.length === 0) return { quality: 5, value: 5, durability: 5, aesthetic: 5, confidence: 0.5 };
  const weighted = examples.reduce(
    (acc, item) => {
      const weight = Math.max(0.05, item.similarity);
      acc.quality += item.expected_scores.quality * weight;
      acc.value += item.expected_scores.value * weight;
      acc.durability += item.expected_scores.durability * weight;
      acc.aesthetic += item.expected_scores.aesthetic * weight;
      acc.confidence += item.expected_scores.confidence * weight;
      acc.weight += weight;
      return acc;
    },
    { quality: 0, value: 0, durability: 0, aesthetic: 0, confidence: 0, weight: 0 }
  );
  return {
    quality: weighted.quality / weighted.weight,
    value: weighted.value / weighted.weight,
    durability: weighted.durability / weighted.weight,
    aesthetic: weighted.aesthetic / weighted.weight,
    confidence: weighted.confidence / weighted.weight
  };
}

function applyVisualEffects(score: number, inferences: ExpertVisualInference[]): number {
  return inferences.reduce((current, inference) => {
    if (inference.score_dimension !== "aesthetic" && inference.score_dimension !== "quality") return current;
    const delta = { none: 0, small_positive: 0.25, medium_positive: 0.4, small_negative: -0.25, medium_negative: -0.4 }[
      inference.score_effect
    ];
    return current + delta;
  }, score);
}

function range(center: number, radius: number): { min: number; max: number } {
  return { min: round1(Math.max(1, center - radius)), max: round1(Math.min(9.4, center + radius)) };
}

function midpoint(value: { min: number; max: number }): number {
  return (value.min + value.max) / 2;
}

function blendScore(local: number, anchor: number, anchorWeight: number): number {
  return local * (1 - anchorWeight) + anchor * anchorWeight;
}

function clampScore(value: number, guardrail: { min: number; max: number }): number {
  return round1(Math.min(guardrail.max, Math.max(guardrail.min, value)));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function parsePrice(price: string | null): number | null {
  if (!price) return null;
  const match = price.replace(/,/g, "").match(/(?:£|\$|€)?\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function priceBand(price: string | null): string {
  const value = parsePrice(price);
  if (value === null) return "unknown";
  if (value < 30) return "under £30";
  if (value < 50) return "under £50";
  if (value < 80) return "£30-£80";
  if (value < 150) return "£80-£150";
  if (value < 250) return "£150-£250";
  if (value < 600) return "£250-£600";
  return "£600+";
}

function verdictConfidence(score: number): VerdictConfidence {
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function recommendationSummary(recommendation: Recommendation, classification: ProductClassification, scores: VerdictScores): string {
  if (recommendation === "not_enough_info") return "Not enough trustworthy product evidence to make a buying call.";
  if (recommendation === "overpriced") return "Quality signal is credible, but value looks weak at this price.";
  if (recommendation === "buy" || recommendation === "strong_buy") return "Good material/value signal for this category, with normal care caveats.";
  if (recommendation === "avoid") return "Weak evidence and weak underlying score make this hard to justify.";
  return `${classification.material_family} ${classification.category} with mixed quality/value trade-offs.`;
}

function summaryLine(recommendation: Recommendation, scores: VerdictScores, classification: ProductClassification): string {
  if (recommendation === "not_enough_info") return "Not enough evidence: keep confidence low and avoid strong claims.";
  if (recommendation === "overpriced") return "Probably good, but the price is doing too much work.";
  if (scores.quality >= 7 && scores.value >= 7) return `Quietly good ${classification.category}: strong enough material signal and fair value.`;
  return `Mixed ${classification.category}: quality ${scores.quality}/10, value ${scores.value}/10.`;
}

function dimension(verdict: string, confidence: VerdictConfidence, evidenceType: VerdictEvidenceType): DimensionVerdict {
  return { verdict, confidence, evidence_type: evidenceType };
}

function scoreTone(score: number): string {
  if (score >= 8) return "Strong";
  if (score >= 7) return "Good";
  if (score >= 6) return "Solid but not special";
  if (score >= 5) return "Mixed";
  return "Weak";
}

function materialQualityInsight(classification: ProductClassification): string {
  const materialText = classification.material_description.toLowerCase();
  if (classification.material_family === "cotton") {
    if (/\bcombed\b/.test(materialText) || /\btriple[- ]twisted\b/.test(materialText)) {
      return "Combed or twisted cotton yarn is a better-than-basic signal because shorter fibres are removed and the yarn is smoother, stronger, and less fuzzy than generic cotton.";
    }
    if (/\b100%\s+cotton\b/.test(materialText)) {
      return "100% cotton is breathable, washable, and preferable to polyester-heavy shirting for comfort, but it is still a baseline material unless the page shows fabric weight, yarn quality, or finishing.";
    }
    return "Cotton is a sensible everyday material because it breathes and washes well, but quality varies heavily by fibre length, weave density, and finishing.";
  }
  if (classification.material_family === "wool") {
    if (/\bcashmere\b/.test(materialText)) {
      return "Cashmere is soft and premium, but the real quality spread depends on fibre length, ply, knit density, and pilling resistance, which most product pages do not fully evidence.";
    }
    if (/\bmerino\b/.test(materialText)) {
      return "Merino is a strong knitwear signal because it is finer, softer, and better at temperature regulation than ordinary wool, though gauge and yarn twist still matter.";
    }
    return "Wool is a positive material signal for warmth, drape, and odour resistance, but knit density and yarn quality decide whether it feels premium or merely acceptable.";
  }
  if (classification.material_family === "linen") {
    return "Linen is strong, breathable, and better in heat than cotton, but premium versions usually show better fabric weight, cleaner seams, and less transparent cloth.";
  }
  if (classification.material_family === "leather") {
    return "Leather can be a strong material signal, but grade, coating, lining, stitching, and edge finishing matter more than the word leather on its own.";
  }
  if (classification.material_family === "synthetic") {
    return "Synthetic fabric is not automatically bad, but in fashion basics it often means lower breathability and a cheaper hand unless there is a clear technical-performance reason.";
  }
  if (classification.material_family === "blend") {
    return "A blend can be practical, but the percentages matter: small synthetic content can improve recovery, while heavy synthetic content can cheapen handle and breathability.";
  }
  if (classification.material_family === "viscose") {
    return "Viscose can drape nicely and feel soft, but it is often less resilient when wet and can lose shape faster than stronger natural fibres.";
  }
  if (classification.material_family === "silk") {
    return "Silk is premium for handle, lustre, and drape, but it is delicate and value depends on weight, weave, and finishing.";
  }
  return "The material evidence is too thin to make a confident quality call.";
}

function constructionExpectation(category: ProductCategory): string {
  if (category === "shirt") {
    return "For construction, the useful evidence would be collar and placket structure, seam puckering, stitch regularity, button attachment, fabric transparency, and pattern matching.";
  }
  if (category === "knitwear") {
    return "For construction, the useful evidence would be knit density, seam linking, rib recovery at cuffs/hem, shoulder shape, neckline stability, and visible pilling or fuzz.";
  }
  if (category === "footwear") {
    return "For construction, the useful evidence would be sole attachment, stitch regularity, glue marks, lining material, heel counter structure, and edge finishing.";
  }
  if (category === "outerwear") {
    return "For construction, the useful evidence would be lining, seam finishing, hardware attachment, pocket construction, edge finishing, and whether close-ups show puckering or loose threads.";
  }
  if (category === "denim" || category === "trousers") {
    return "For construction, the useful evidence would be fabric weight, seam finish, waistband structure, pocket bags, stress-point reinforcement, and hem neatness.";
  }
  return "For construction, the useful evidence would be close-ups of seams, stitching, edges, lining, hardware, and stress points.";
}

function marketPriceContext(classification: ProductClassification): string {
  const category = classification.category;
  const material = classification.material_family;
  const tier = classification.brand_tier;
  const lane = `${tier} ${material} ${category}`.replace(/unknown\s*/g, "");

  if (category === "shirt" && material === "cotton" && (tier === "high-street" || tier === "budget")) {
    return "A high-street 100% cotton Oxford-style shirt typically sits around £20-£50; stronger mid-premium versions are often £70-£120 when fabric, collar, and finishing improve.";
  }
  if (category === "shirt" && (material === "linen" || material === "blend")) {
    return "High-street linen or cotton-linen shirts usually sit around £30-£70; cleaner mid-premium versions are commonly £80-£130 depending on fabric weight and finishing.";
  }
  if (category === "knitwear" && material === "wool") {
    return "Merino or wool knitwear ranges from about £35-£80 at high street, £90-£180 mid-premium, and much higher for luxury cashmere or dense specialist knits.";
  }
  if (category === "footwear" && material === "leather") {
    return "High-street leather trainers commonly sit around £50-£90; premium versions are more like £120-£250 when leather, lining, sole unit, and finishing improve.";
  }
  if (category === "outerwear" && material === "leather") {
    return "Leather jackets vary brutally: high-street versions can be £200-£400, credible premium pieces £450-£900, and luxury far above that, mostly depending on hide, hardware, lining, and make.";
  }
  if (category === "outerwear" && material === "synthetic") {
    return "Branded fleece and synthetic outerwear often ranges from £60-£180; higher prices need better fabric, patterning, durability details, or technical features to justify them.";
  }
  if (category === "t-shirt" && material === "cotton") {
    return "Cotton T-shirts range from under £15 for basics to £35-£80 for heavier, better-finished premium versions; fabric weight and collar recovery usually separate them.";
  }
  return `For ${lane.trim() || "this item"}, value depends on whether the material and construction evidence justify the brand tier rather than just matching the label price.`;
}

function aestheticContext(classification: ProductClassification): string {
  if (classification.category === "shirt") {
    return "A shirt scores aesthetically when the collar, placket, fabric opacity, colour, and fit make it easy to wear without looking flimsy or over-designed.";
  }
  if (classification.category === "knitwear") {
    return "Knitwear scores aesthetically when the gauge, neckline, shoulder shape, rib trims, and surface texture make it look clean rather than saggy or cheap.";
  }
  if (classification.category === "footwear") {
    return "Footwear scores aesthetically when the toe shape, sole proportions, upper finish, and edge details look balanced rather than bulky or plasticky.";
  }
  if (classification.category === "outerwear") {
    return "Outerwear scores aesthetically when silhouette, hardware, collar shape, pocket placement, and fabric body look intentional rather than generic.";
  }
  return "Aesthetic score reflects versatility, proportions, surface finish, and whether the piece looks refined for its market tier.";
}

function cleanDimensionVerdict(
  candidate: DimensionVerdict | undefined,
  fallback: DimensionVerdict,
  confidenceCapValue: VerdictConfidence
): DimensionVerdict {
  if (!candidate) return fallback;
  return {
    verdict: cleanText(candidate.verdict, fallback.verdict, 520),
    confidence: capVerdictConfidence(isVerdictConfidence(candidate.confidence) ? candidate.confidence : fallback.confidence, confidenceCapValue),
    evidence_type: isVerdictEvidenceType(candidate.evidence_type) ? candidate.evidence_type : fallback.evidence_type
  };
}

function capVerdictConfidence(value: VerdictConfidence, cap: VerdictConfidence): VerdictConfidence {
  const rank = { low: 0, medium: 1, high: 2 };
  return rank[value] > rank[cap] ? cap : value;
}

function cleanText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const cleaned = value.trim();
  if (cleaned.length <= maxLength) return cleaned;

  const shortened = cleaned.slice(0, maxLength);
  const lastSentenceEnd = Math.max(shortened.lastIndexOf("."), shortened.lastIndexOf("!"), shortened.lastIndexOf("?"));
  if (lastSentenceEnd >= Math.floor(maxLength * 0.55)) return shortened.slice(0, lastSentenceEnd + 1).trim();

  const lastBreak = Math.max(shortened.lastIndexOf(";"), shortened.lastIndexOf(","), shortened.lastIndexOf(" "));
  return `${shortened.slice(0, lastBreak > 0 ? lastBreak : maxLength).trim()}...`;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecommendation(value: unknown): value is Recommendation {
  return (
    value === "strong_buy" ||
    value === "buy" ||
    value === "consider" ||
    value === "reconsider" ||
    value === "overpriced" ||
    value === "avoid" ||
    value === "not_enough_info"
  );
}

function isVerdictConfidence(value: unknown): value is VerdictConfidence {
  return value === "high" || value === "medium" || value === "low";
}

function isVerdictEvidenceType(value: unknown): value is VerdictEvidenceType {
  return (
    value === "stated_on_page" ||
    value === "inferred_from_material" ||
    value === "inferred_from_image" ||
    value === "general_material_knowledge" ||
    value === "similar_approved_example" ||
    value === "unknown"
  );
}

function readQualityCheckEnv(env: Env): QualityCheckEnv {
  return {
    geminiApiKey: env.GEMINI_API_KEY || null,
    openaiApiKey: env.OPENAI_API_KEY || null,
    visionModel: env.QUALITY_CHECK_VISION_MODEL || DEFAULT_VISION_MODEL,
    coreModel: env.QUALITY_CHECK_CORE_MODEL || DEFAULT_CORE_MODEL,
    premiumFallbackModel: env.QUALITY_CHECK_PREMIUM_FALLBACK_MODEL || DEFAULT_PREMIUM_FALLBACK_MODEL,
    embeddingModel: env.QUALITY_CHECK_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL
  };
}

function validateStage5Payload(body: unknown): BackendPayload {
  if (!body || typeof body !== "object") {
    throw new RequestError(400, "Request body must be a Stage 5 payload object.");
  }

  const payload = body as Partial<BackendPayload>;
  if (payload.extension?.stage !== "stage_5") {
    throw new RequestError(400, "Only extension Stage 5 payloads are supported.");
  }

  if (!payload.page || typeof payload.page.url !== "string" || !payload.page.product) {
    throw new RequestError(400, "Stage 5 payload is missing page product evidence.");
  }

  if (!payload.classification || typeof payload.classification !== "object") {
    throw new RequestError(400, "Stage 5 payload is missing structured classification.");
  }

  if (!payload.visual_enrichment || typeof payload.visual_enrichment !== "object") {
    throw new RequestError(400, "Stage 5 payload is missing visual enrichment metadata.");
  }

  return payload as BackendPayload;
}

function normaliseImageUrls(payload: BackendPayload): string[] {
  const candidates = payload.visual_enrichment.image_urls.length
    ? payload.visual_enrichment.image_urls
    : payload.page.product.image_urls;

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    if (!isAllowedImageUrl(candidate)) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(candidate);
    if (urls.length >= MAX_IMAGES) break;
  }
  return urls;
}

function isAllowedImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return !/^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.|0\.0\.0\.|::1$)/i.test(url.hostname);
  } catch {
    return false;
  }
}

async function downloadImages(urls: string[], fetcher: Fetcher, warnings: string[]): Promise<DownloadedImage[]> {
  const downloaded: DownloadedImage[] = [];

  for (const url of urls) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(6000) });
      const contentType = response.headers.get("content-type") || "";

      if (!response.ok) {
        warnings.push(`image skipped: ${url} returned HTTP ${response.status}`);
        continue;
      }

      if (!contentType.toLowerCase().startsWith("image/")) {
        warnings.push(`image skipped: ${url} did not return an image content type`);
        continue;
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        warnings.push(`image skipped: ${url} exceeded ${MAX_IMAGE_BYTES} bytes`);
        continue;
      }

      downloaded.push({
        url,
        mimeType: contentType.split(";")[0],
        base64: bytes.toString("base64")
      });
    } catch {
      warnings.push(`image skipped: ${url} could not be fetched`);
    }
  }

  return downloaded;
}

async function runGeminiVision(options: {
  apiKey: string;
  model: string;
  prompt: string;
  images: DownloadedImage[];
  fetcher: Fetcher;
}): Promise<ParsedVisionResult> {
  const response = await options.fetcher(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(options.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        },
        contents: [
          {
            role: "user",
            parts: [
              { text: options.prompt },
              ...options.images.map((image) => ({
                inlineData: {
                  mimeType: image.mimeType,
                  data: image.base64
                }
              }))
            ]
          }
        ]
      })
    }
  );

  if (!response.ok) {
    throw new RequestError(502, `Gemini vision request failed with HTTP ${response.status}.`);
  }

  const data = (await response.json()) as GeminiGenerateContentResponse;
  const text = data.candidates?.flatMap((candidate) => candidate.content?.parts || []).find((part) => part.text)?.text;
  const parsed = parseModelJson(text || "{}");
  const rawObservations = Array.isArray(parsed.visual_observations)
    ? parsed.visual_observations
    : Array.isArray(parsed.observations)
      ? parsed.observations
      : [];
  const rawCues = Array.isArray(parsed.visual_cues) ? parsed.visual_cues : [];
  const rawInferences = Array.isArray(parsed.expert_inferences)
    ? parsed.expert_inferences
    : Array.isArray(parsed.shopper_insights)
      ? parsed.shopper_insights
      : [];

  return {
    observations: rawObservations.map(toVisualObservation).filter((observation): observation is VisualObservation => Boolean(observation)),
    visual_cues: rawCues.map(toVisualCue).filter((cue): cue is VisualCue => Boolean(cue)),
    expert_inferences: rawInferences
      .map(toExpertVisualInference)
      .filter((inference): inference is ExpertVisualInference => Boolean(inference)),
    missing_views: toStringArray(parsed.missing_views),
    image_quality_limits: toStringArray(parsed.image_quality_limits)
  };
}

function toVisualObservation(value: unknown): VisualObservation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.observation !== "string") return null;

  return {
    observation: record.observation,
    confidence: isConfidence(record.confidence) ? record.confidence : "low",
    evidence_type: isEvidenceType(record.evidence_type) ? record.evidence_type : "surface_detail",
    should_affect_score: record.should_affect_score === true
  };
}

function toVisualCue(value: unknown): VisualCue | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.cue !== "string") return null;

  return {
    cue: record.cue,
    confidence: isConfidence(record.confidence) ? record.confidence : "low",
    evidence_type: isEvidenceType(record.evidence_type) ? record.evidence_type : "surface_detail",
    image_limitations: toStringArray(record.image_limitations)
  };
}

function toExpertVisualInference(value: unknown): ExpertVisualInference | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.inference !== "string") return null;

  return {
    inference: record.inference,
    quality_dimension: isQualityDimension(record.quality_dimension) ? record.quality_dimension : "aesthetic_refinement",
    confidence: isConfidence(record.confidence) ? record.confidence : "low",
    basis: "inferred_from_image",
    why_it_matters: typeof record.why_it_matters === "string" ? record.why_it_matters : "Visible presentation can affect perceived quality and value.",
    caveat: typeof record.caveat === "string" ? record.caveat : "Image-only inference; not verified by product data.",
    score_dimension: isScoreDimension(record.score_dimension) ? record.score_dimension : "confidence",
    score_effect: isScoreEffect(record.score_effect) ? record.score_effect : "none"
  };
}

function sanitiseVisualObservations(observations: VisualObservation[]): {
  observations: VisualObservation[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const cleanObservations: VisualObservation[] = [];

  for (const observation of observations) {
    const text = observation.observation.trim();
    if (!text) continue;

    const makesForbiddenClaim = FORBIDDEN_STRONG_VISUAL_CLAIM_PATTERN.test(text);
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

function sanitiseVisualCues(cues: VisualCue[]): {
  visual_cues: VisualCue[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const cleanCues: VisualCue[] = [];

  for (const cue of cues) {
    const text = cue.cue.trim();
    if (!text) continue;

    const makesForbiddenClaim = FORBIDDEN_STRONG_VISUAL_CLAIM_PATTERN.test(text);
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

function sanitiseExpertVisualInferences(inferences: ExpertVisualInference[]): {
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

    const makesForbiddenClaim = FORBIDDEN_STRONG_VISUAL_CLAIM_PATTERN.test(text) && !hasUncertaintyLanguage(text);
    const isUnqualified = UNQUALIFIED_VISUAL_QUALITY_PATTERN.test(text) && !hasUncertaintyLanguage(text);
    const weakPositive = weakPositiveVisualInference(text, inference);
    const shouldDowngrade = makesForbiddenClaim || isUnqualified;
    const neutralisedInference = neutraliseWeakPositiveInference(text, inference);

    cleanInferences.push({
      inference: shouldDowngrade
        ? "Image-only inference removed because it asserted quality, construction, authenticity, or durability without uncertainty."
        : neutralisedInference || text.slice(0, 280),
      quality_dimension: inference.quality_dimension,
      confidence: shouldDowngrade || weakPositive ? "low" : inference.confidence,
      basis: "inferred_from_image",
      why_it_matters: whyItMatters.slice(0, 220),
      caveat: caveat.slice(0, 180),
      score_dimension: inference.score_dimension,
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

function isConfidence(value: unknown): value is VisualObservationConfidence {
  return value === "high" || value === "medium" || value === "low";
}

function isEvidenceType(value: unknown): value is VisualObservationEvidenceType {
  return (
    value === "colour" ||
    value === "silhouette" ||
    value === "texture_appearance" ||
    value === "fit_proportion" ||
    value === "surface_detail" ||
    value === "aesthetic_cue"
  );
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

function hasUncertaintyLanguage(value: string): boolean {
  return /\b(?:appears?|looks?|suggests?|may|might|could|can be consistent with|possibly|likely|seems|visible cue|from the image|not enough|cannot verify)\b/i.test(value);
}

function weakPositiveVisualInference(value: string, inference: ExpertVisualInference): boolean {
  if (inference.score_effect !== "small_positive" && inference.score_effect !== "medium_positive") return false;
  return (
    WEAK_POSITIVE_VISUAL_CONSTRUCTION_PATTERN.test(value) ||
    STYLING_AS_VISUAL_QUALITY_PATTERN.test(value) ||
    MATERIAL_BENEFIT_FROM_VISUAL_APPEARANCE_PATTERN.test(value)
  );
}

function neutraliseWeakPositiveInference(value: string, inference: ExpertVisualInference): string | null {
  if (!weakPositiveVisualInference(value, inference)) return null;
  if (STYLING_AS_VISUAL_QUALITY_PATTERN.test(value)) {
    return "Visible lining, trim, buttons, or styling details are aesthetic cues only; they do not establish better construction, durability, or value from images alone.";
  }
  if (MATERIAL_BENEFIT_FROM_VISUAL_APPEARANCE_PATTERN.test(value)) {
    return "Generic fabric texture or matte finish in a product image is not enough evidence to infer comfort, durability, or practical material benefits.";
  }
  return "Clean pressed edges or an absence of visible defects in studio product images are neutral; they do not establish construction quality without close-up seam, lining, or stitching evidence.";
}

function capScoreEffect(effect: VisualScoreEffect, confidence: ExpertVisualInference["confidence"]): VisualScoreEffect {
  if (confidence === "low" && (effect === "medium_positive" || effect === "medium_negative")) {
    return effect === "medium_positive" ? "small_positive" : "small_negative";
  }
  return effect;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function parseModelJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function buildFallbackPrompt(): string {
  return [
    "Return strict JSON with visual_observations only.",
    "Also include visual_cues, missing_views, image_quality_limits, and expert_inferences as an empty array.",
    "Temporarily do not generate expert inferences or shopper judgements.",
    "Prefer concrete visual cues over obvious captions.",
    "Be sceptical: clean studio photos and absence of visible defects are neutral, not evidence of good construction.",
    "Styling details such as lining, trim, and standard buttons are aesthetic only; do not use them to imply construction quality, durability, or value.",
    "Allowed: colour, silhouette, texture appearance, fit/proportion cues, surface details, aesthetic cues, visible finishing cues.",
    "Forbidden as hard claims from images alone: fabric quality, exact construction, authenticity, durability."
  ].join("\n");
}

function buildSummary(analysis: BackendAnalysis): string {
  return `Stage 6 verdict completed for "${analysis.product.title}": ${analysis.verdict.recommendation} (${analysis.verdict.overall_rating}/10).`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > REQUEST_BODY_LIMIT_BYTES) {
      throw new RequestError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new RequestError(400, "Request body is required.");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RequestError(400, "Request body must be valid JSON.");
  }
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  const allowOrigin = typeof origin === "string" && isAllowedOrigin(origin) ? origin : "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol === "chrome-extension:") return true;
    if ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && /^https?:$/.test(url.protocol)) return true;
    return false;
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
