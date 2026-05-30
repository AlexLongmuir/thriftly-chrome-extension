import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  BackendAnalysis,
  BackendPayload,
  BackendVerdict,
  BrandTier,
  DimensionVerdict,
  ExternalEvidenceCoverage,
  ExternalEvidenceAgentPack,
  ExternalEvidenceAffects,
  ExternalEvidenceItem,
  ExternalEvidenceSourceType,
  ExternalScoreImpact,
  ExpertVisualInference,
  MatchedApprovedExample,
  MaterialFamily,
  PageEvidenceItem,
  ProductCategory,
  ProductClassification,
  PublicEvidenceDimension,
  PublicEvidenceItem,
  PublicEvidenceSentiment,
  PublicEvidenceSourceType,
  PublicEvidenceSpecificity,
  Recommendation,
  RejectedExternalSource,
  CrossSourceTheme,
  EvidenceInsightTheme,
  ProductApplicability,
  ShopperEvidenceSourceType,
  ShopperSignal,
  ShopperSignalEvidenceBasis,
  ShopperSignalMetric,
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
  publicEvidenceSearchEnabled: boolean;
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
  evidencePack: EvidencePack;
  visual: BackendAnalysis["visual_enrichment"];
  matchedExamples: MatchedApprovedExample[];
  env: QualityCheckEnv;
  fetcher: Fetcher;
};

type EvidencePack = {
  pageEvidence: PageEvidenceItem[];
  externalEvidence: ExternalEvidenceItem[];
  benchmarkEvidence: ExternalEvidenceItem[];
  publicEvidence: PublicEvidenceItem[];
  scoringEvidence: PublicEvidenceItem[];
  externalCoverage: ExternalEvidenceCoverage;
  externalSourcesFound: boolean;
  usefulSourcesCount: number;
  externalScoreImpact: ExternalScoreImpact;
  rejectedSources: RejectedExternalSource[];
  keyExternalInsights: string[];
  repeatedThemes: CrossSourceTheme[];
  conflictingEvidence: string[];
  evidenceGaps: string[];
  crossSourceThemes: CrossSourceTheme[];
  externalSearchAttempted: boolean;
  diagnostics: string[];
  agentPack: ExternalEvidenceAgentPack;
};

type ScoreGuardrails = Record<keyof Omit<VerdictScores, "confidence">, { min: number; max: number }>;

const APPROVED_EXAMPLES: MatchedApprovedExample[] = [
  example("approved_merino_knit_mid_premium_001", "knitwear", "wool", "mid-premium", "£80-£150", [7.8, 7.8, 7.0, 7.5, 0.86], "buy", "COS", "Pure Cashmere Jumper", "£135", "https://www.cos.com/"),
  example("approved_cashmere_knit_luxury_001", "knitwear", "wool", "luxury", "£600+", [8.8, 4.8, 6.8, 8.7, 0.84], "overpriced", "Mr Porter", "Cashmere Sweater", "£695", "https://www.mrporter.com/"),
  example("approved_wool_blend_knit_high_street_001", "knitwear", "blend", "high-street", "£40-£90", [6.4, 6.8, 6.0, 6.5, 0.78], "consider", "ARKET", "Wool Blend Jumper", "£77", "https://www.arket.com/"),
  example("approved_acrylic_knit_budget_001", "knitwear", "synthetic", "budget", "under £40", [4.4, 5.4, 4.8, 5.2, 0.74], "reconsider", "H&M", "Rib-Knit Jumper", "£24.99", "https://www2.hm.com/"),
  example("approved_linen_shirt_mid_premium_001", "shirt", "linen", "mid-premium", "£60-£120", [7.2, 7.1, 6.6, 7.4, 0.82], "buy", "ARKET", "Relaxed Linen Shirt", "£67", "https://www.arket.com/"),
  example("approved_cotton_linen_shirt_high_street_001", "shirt", "blend", "high-street", "£30-£70", [6.4, 7.0, 6.2, 6.6, 0.78], "consider", "Zara", "Cotton-Linen Shirt", "£45.99", "https://www.zara.com/"),
  example("approved_cotton_shirt_budget_001", "shirt", "cotton", "budget", "under £30", [5.4, 6.2, 5.6, 5.4, 0.76], "consider", "Uniqlo", "Oxford Shirt", "£29.90", "https://www.uniqlo.com/"),
  example("approved_synthetic_shirt_high_street_001", "shirt", "synthetic", "high-street", "£30-£60", [4.8, 4.8, 5.0, 5.8, 0.72], "reconsider", "Mango", "Regular-Fit Shirt", "£35.99", "https://shop.mango.com/"),
  example("approved_leather_trainers_high_street_001", "footwear", "leather", "high-street", "£40-£90", [6.4, 7.0, 6.3, 6.2, 0.78], "consider", "M&S", "Leather Lace-Up Trainers", "£49.50", "https://www.marksandspencer.com/"),
  example("approved_leather_trainers_premium_001", "footwear", "leather", "premium", "£100-£220", [7.4, 6.3, 7.0, 7.1, 0.8], "consider", "Veja", "Campo Leather Trainers", "£130", "https://www.veja-store.com/"),
  example("approved_synthetic_trainers_budget_001", "footwear", "synthetic", "budget", "under £50", [4.8, 5.5, 4.9, 5.5, 0.7], "reconsider", "H&M", "Canvas Trainers", "£24.99", "https://www2.hm.com/"),
  example("approved_leather_jacket_premium_001", "outerwear", "leather", "premium", "£250-£600", [7.5, 6.4, 7.2, 7.8, 0.78], "consider", "AllSaints", "Miller Leather Jacket", "£349", "https://www.allsaints.com/"),
  example("approved_leather_jacket_luxury_001", "outerwear", "leather", "luxury", "£1200+", [8.2, 4.2, 7.4, 8.6, 0.72], "overpriced", "Celine", "Leather Biker Jacket", "£3,200", "https://www.celine.com/"),
  example("approved_poly_fleece_premium_001", "outerwear", "synthetic", "premium", "£80-£150", [6.8, 7.0, 7.2, 6.1, 0.82], "consider", "Patagonia", "Micro D Fleece Jacket", "£80", "https://www.patagonia.com/"),
  example("approved_recycled_fleece_premium_001", "outerwear", "synthetic", "premium", "£120-£220", [7.0, 6.6, 7.3, 6.6, 0.82], "consider", "Patagonia", "Better Sweater Jacket", "£130", "https://www.patagonia.com/"),
  example("approved_blazer_high_street_001", "outerwear", "blend", "high-street", "£50-£120", [5.8, 6.1, 5.7, 6.3, 0.74], "consider", "Next", "Textured Blazer", "£74", "https://www.next.co.uk/"),
  example("approved_denim_high_street_001", "denim", "cotton", "high-street", "£35-£80", [6.2, 6.8, 6.5, 6.1, 0.8], "consider", "Uniqlo", "Regular Fit Jeans", "£39.90", "https://www.uniqlo.com/"),
  example("approved_denim_premium_001", "denim", "cotton", "premium", "£120-£250", [7.4, 6.0, 7.2, 7.0, 0.82], "consider", "A.P.C.", "Petit Standard Jeans", "£190", "https://www.apcstore.com/"),
  example("approved_tshirt_cotton_budget_001", "t-shirt", "cotton", "budget", "under £20", [5.2, 6.5, 5.0, 5.2, 0.78], "consider", "Uniqlo", "Supima Cotton T-Shirt", "£14.90", "https://www.uniqlo.com/"),
  example("approved_tshirt_premium_cotton_001", "t-shirt", "cotton", "premium", "£40-£90", [6.8, 5.4, 6.2, 6.8, 0.8], "consider", "Sunspel", "Classic Cotton T-Shirt", "£75", "https://www.sunspel.com/"),
  example("approved_trousers_wool_mid_premium_001", "trousers", "wool", "mid-premium", "£90-£180", [7.4, 6.8, 7.0, 7.2, 0.8], "buy", "COS", "Tailored Wool Trousers", "£135", "https://www.cos.com/"),
  example("approved_trousers_synthetic_high_street_001", "trousers", "synthetic", "high-street", "£30-£80", [5.4, 6.0, 5.7, 5.9, 0.76], "consider", "Zara", "Technical Trousers", "£45.99", "https://www.zara.com/"),
  example("approved_bag_leather_premium_001", "bag", "leather", "premium", "£180-£450", [7.6, 6.4, 7.6, 7.5, 0.78], "consider", "Coach", "Leather Tote Bag", "£295", "https://uk.coach.com/"),
  example("approved_bag_synthetic_budget_001", "bag", "synthetic", "budget", "under £50", [4.8, 5.8, 5.0, 5.2, 0.72], "reconsider", "H&M", "Shopper Bag", "£19.99", "https://www2.hm.com/"),
  example("approved_dress_viscose_high_street_001", "dress", "viscose", "high-street", "£40-£100", [5.8, 6.4, 5.4, 6.8, 0.76], "consider", "Mango", "Viscose Shirt Dress", "£59.99", "https://shop.mango.com/"),
  example("approved_dress_silk_premium_001", "dress", "silk", "premium", "£180-£450", [7.8, 6.3, 6.2, 8.0, 0.78], "consider", "Reformation", "Silk Dress", "£278", "https://www.thereformation.com/"),
  example("approved_skirt_wool_mid_premium_001", "skirt", "wool", "mid-premium", "£80-£180", [7.2, 6.7, 6.8, 7.2, 0.78], "consider", "ARKET", "Wool A-Line Skirt", "£119", "https://www.arket.com/"),
  example("approved_activewear_synthetic_premium_001", "activewear", "synthetic", "premium", "£60-£150", [6.8, 6.7, 7.4, 6.2, 0.8], "consider", "Patagonia", "Performance Joggers", "£85", "https://www.patagonia.com/"),
  example("approved_accessory_leather_high_street_001", "accessory", "leather", "high-street", "£20-£80", [6.0, 6.8, 6.1, 6.0, 0.76], "consider", "M&S", "Leather Belt", "£25", "https://www.marksandspencer.com/"),
  example("approved_unknown_thin_page_001", "other", "unknown", "unknown", "unknown", [2.8, 2.8, 2.8, 2.8, 0.2], "not_enough_info", "", "", "", "")
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
  const evidencePack = await gatherEvidencePack(payload, env, dependencies.fetcher || fetch);
  const verdict = await createStage6Verdict({
    payload,
    evidencePack,
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
    page_evidence: evidencePack.pageEvidence,
    external_evidence: evidencePack.externalEvidence,
    benchmark_evidence: evidencePack.benchmarkEvidence,
    external_coverage: evidencePack.externalCoverage,
    external_sources_found: evidencePack.externalSourcesFound,
    useful_sources_count: evidencePack.usefulSourcesCount,
    external_score_impact: evidencePack.externalScoreImpact,
    rejected_sources: evidencePack.rejectedSources,
    key_external_insights: evidencePack.keyExternalInsights,
    repeated_themes: evidencePack.repeatedThemes,
    conflicting_evidence: evidencePack.conflictingEvidence,
    evidence_gaps: evidencePack.evidenceGaps,
    cross_source_themes: evidencePack.crossSourceThemes,
    external_search_diagnostics: evidencePack.diagnostics,
    external_evidence_pack: evidencePack.agentPack,
    public_evidence: evidencePack.publicEvidence,
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
  const sourceConfidence = externalCoverageConfidenceCap(
    confidenceCap(product.page_state, classification.source_confidence_score),
    context.evidencePack
  );
  const guardrails = buildScoreGuardrails(classification, product.page_state, sourceConfidence);
  const anchorScores = averageAnchorScores(context.matchedExamples);
  const scores: VerdictScores = {
    quality: clampScore(applyPublicEvidenceEffects(blendScore(midpoint(guardrails.quality), anchorScores.quality, 0.35), context.evidencePack.scoringEvidence, "quality"), guardrails.quality),
    value: clampScore(applyPublicEvidenceEffects(blendScore(midpoint(guardrails.value), anchorScores.value, 0.35), context.evidencePack.scoringEvidence, "value"), guardrails.value),
    durability: clampScore(applyPublicEvidenceEffects(blendScore(midpoint(guardrails.durability), anchorScores.durability, 0.35), context.evidencePack.scoringEvidence, "durability"), guardrails.durability),
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

  const baseVerdict = {
    overall_rating: overall,
    recommendation,
    recommendation_summary: recommendationSummary(recommendation, classification, scores),
    scores,
    confidence_label: confidenceLabel,
    good_signs: [],
    watch_outs: [],
    verdicts: {
      quality: qualityVerdict(context, scores, confidenceLabel),
      value: valueVerdict(classification, context.matchedExamples, scores),
      durability: durabilityVerdict(context, scores, confidenceLabel),
      aesthetic: aestheticVerdict(context, scores, confidenceLabel)
    },
    reasoning_flags: reasoningFlags,
    matched_examples: context.matchedExamples.map((item) => item.id),
    evidence_score_effects: describeEvidenceScoreEffects(context.evidencePack.scoringEvidence),
    summary: summaryLine(recommendation, scores, classification),
    model: context.env.coreModel,
    model_status: status
  };

  return addShopperSignals(baseVerdict, context);
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

  const baseVerdict: Stage6Verdict = {
    overall_rating: overall,
    recommendation,
    recommendation_summary: sentenceText(candidate.recommendation_summary, fallback.recommendation_summary, 90),
    scores,
    confidence_label: confidenceLabel,
    good_signs: [],
    watch_outs: [],
    verdicts: {
      quality: cleanDimensionVerdict(candidate.verdicts?.quality, fallback.verdicts.quality, confidenceLabel),
      value: cleanDimensionVerdict(candidate.verdicts?.value, fallback.verdicts.value, confidenceLabel),
      durability: cleanDimensionVerdict(candidate.verdicts?.durability, fallback.verdicts.durability, confidenceLabel),
      aesthetic: cleanDimensionVerdict(candidate.verdicts?.aesthetic, fallback.verdicts.aesthetic, confidenceLabel)
    },
    reasoning_flags: uniqueStrings([...(candidate.reasoning_flags || []), ...fallback.reasoning_flags]).slice(0, 10),
    matched_examples: fallback.matched_examples,
    evidence_score_effects: uniqueStrings([...(candidate.evidence_score_effects || []), ...fallback.evidence_score_effects]).slice(0, 10),
    summary: cleanText(candidate.summary, fallback.summary, 160),
    model: context.env.coreModel,
    model_status: "model_completed"
  };

  return addShopperSignals(baseVerdict, context, candidate);
}

function addShopperSignals(verdict: Stage6Verdict, context: Stage6Context, candidate?: Partial<Stage6Verdict>): Stage6Verdict {
  const fallbackGoodSigns = buildGoodSigns(verdict, context);
  const fallbackWatchOuts = buildWatchOuts(verdict, context);
  return {
    ...verdict,
    good_signs: completeShopperSignals(validateModelShopperSignals(candidate?.good_signs, "positive", context), fallbackGoodSigns),
    watch_outs: completeShopperSignals(validateModelShopperSignals(candidate?.watch_outs, "negative", context), fallbackWatchOuts)
  };
}

type ShopperSignalCategory = NonNullable<ShopperSignal["category"]>;

type LegacySignalInput = {
  label: string;
  detail: string;
  related_metric: ShopperSignalMetric;
  category?: ShopperSignalCategory;
  strength?: "low" | "medium" | "high";
  severity?: "low" | "medium" | "high";
  confidence: VerdictConfidence;
  evidence_basis: ShopperSignalEvidenceBasis[];
};

const SHOPPER_SIGNAL_CATEGORIES: ShopperSignalCategory[] = [
  "material",
  "value",
  "evidence",
  "construction",
  "fit",
  "durability",
  "style",
  "care"
];

const INTERNAL_SIGNAL_LANGUAGE =
  /\b(?:product fit evidence|product durability evidence|category anchors?|score cannot be pushed|retrieved evidence|based on scraped data|scraped data|backend|model|prompt|schema|stage\s*\d|guardrails?|metric|source data|external source|internal|system|deterministic|heuristic|confidence cap)\b/i;
const GENERIC_SIGNAL_TITLE =
  /^(?:quality point|good sign|watch[- ]?out|nice detail|something to note|important point|product evidence|quality evidence|material evidence|durability evidence)$/i;

function validateModelShopperSignals(value: unknown, tone: "positive" | "negative", context: Stage6Context): ShopperSignal[] {
  if (!Array.isArray(value)) return [];
  const evidenceText = shopperSignalEvidenceText(context);
  const accepted: ShopperSignal[] = [];

  for (const item of value) {
    if (accepted.length >= 3 || !item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const title = cleanText(record.title, "", 64);
    const description = twoSentenceText(record.description, "", 320);
    const category = normaliseShopperSignalCategory(record.category ?? record.evidence_type) ?? inferSignalCategory(`${title} ${description}`, tone);
    const confidence = isVerdictConfidence(record.confidence) ? record.confidence : "medium";
    const signal: ShopperSignal = {
      label: title,
      detail: description,
      related_metric: metricFromSignalCategory(category),
      category,
      strength: tone === "positive" ? confidence : undefined,
      severity: tone === "negative" ? confidence : undefined,
      confidence,
      evidence_basis: [basis("category_explanation", "model shopper signal", `${title}: ${description}`)]
    };

    if (!isValidModelShopperSignal(signal, evidenceText)) continue;
    if (accepted.some((existing) => duplicateSignal(existing, signal))) continue;
    accepted.push(signal);
  }

  return accepted;
}

function completeShopperSignals(modelSignals: ShopperSignal[], fallbackSignals: ShopperSignal[]): ShopperSignal[] {
  const result = [...modelSignals];
  for (const fallback of fallbackSignals) {
    if (result.length >= 3) break;
    if (result.some((existing) => duplicateSignal(existing, fallback))) continue;
    result.push(fallback);
  }
  return result.slice(0, 3);
}

function isValidModelShopperSignal(signal: ShopperSignal, evidenceText: string): boolean {
  const titleWords = signal.label.split(/\s+/).filter(Boolean);
  if (titleWords.length < 2 || titleWords.length > 5) return false;
  if (signal.detail.length < 40 || signal.detail.length > 320) return false;
  if (sentenceCount(signal.detail) > 2) return false;
  if (INTERNAL_SIGNAL_LANGUAGE.test(`${signal.label} ${signal.detail}`)) return false;
  if (GENERIC_SIGNAL_TITLE.test(signal.label)) return false;
  if (!hasSignalEvidenceSupport(signal, evidenceText)) return false;
  return true;
}

function sentenceCount(value: string): number {
  return value.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.filter((item) => item.trim()).length ?? 0;
}

function hasSignalEvidenceSupport(signal: ShopperSignal, evidenceText: string): boolean {
  const text = `${signal.label} ${signal.detail}`.toLowerCase();
  if (/\b(?:unclear|limited|missing|not stated|not shown|not enough|hard to judge|uncertain|cannot verify|not verified)\b/.test(text)) return true;
  const words = text
    .replace(/[^a-z0-9£$€.%\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !SIGNAL_SUPPORT_STOP_WORDS.has(word));
  if (words.some((word) => evidenceText.includes(word))) return true;
  return Boolean(signal.category && words.length >= 3);
}

const SIGNAL_SUPPORT_STOP_WORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "into",
  "than",
  "then",
  "they",
  "them",
  "what",
  "when",
  "where",
  "which",
  "because",
  "could",
  "would",
  "should",
  "looks",
  "look",
  "item",
  "product",
  "quality",
  "value",
  "fabric",
  "material",
  "wear",
  "feel",
  "judge",
  "buying"
]);

function shopperSignalEvidenceText(context: Stage6Context): string {
  return [
    JSON.stringify(context.payload.page.product.fields),
    context.payload.page.visibleText,
    context.payload.classification.material_description,
    context.payload.classification.construction_description,
    ...context.payload.classification.quality_signals,
    ...context.payload.classification.quality_concerns,
    ...context.evidencePack.pageEvidence.map((item) => item.claim),
    ...context.evidencePack.externalEvidence.map((item) => `${item.claim} ${item.concrete_insight}`),
    ...context.evidencePack.benchmarkEvidence.map((item) => `${item.claim} ${item.concrete_insight}`),
    ...context.evidencePack.keyExternalInsights,
    ...context.evidencePack.evidenceGaps,
    ...context.visual.visual_cues.map((item) => item.cue),
    ...context.visual.expert_inferences.map((item) => `${item.inference} ${item.why_it_matters} ${item.caveat}`)
  ]
    .join(" ")
    .toLowerCase();
}

function duplicateSignal(left: ShopperSignal, right: ShopperSignal): boolean {
  return cleanSignalTitle(left.label).toLowerCase() === cleanSignalTitle(right.label).toLowerCase() || left.detail.toLowerCase() === right.detail.toLowerCase();
}

function isShopperSignalCategory(value: unknown): value is ShopperSignalCategory {
  return typeof value === "string" && SHOPPER_SIGNAL_CATEGORIES.includes(value as ShopperSignalCategory);
}

function normaliseShopperSignalCategory(value: unknown): ShopperSignalCategory | null {
  if (isShopperSignalCategory(value)) return value;
  if (value === "price") return "value";
  if (value === "reviews" || value === "brand" || value === "other") return "evidence";
  return null;
}

function inferSignalCategory(text: string, tone: "positive" | "negative"): ShopperSignalCategory {
  if (/\b(?:cotton|wool|merino|linen|leather|silk|viscose|polyester|nylon|fabric|fibre|fiber|drape|breathab|opacity|soft|handle)\b/i.test(text)) return "material";
  if (/\b(?:price|priced|value|cost|£|\$|€|discount|expensive|cheap)\b/i.test(text)) return "value";
  if (/\b(?:review|owner|feedback|forum|reddit|reported|praised|complain)\b/i.test(text)) return "evidence";
  if (/\b(?:construction|seam|stitch|lining|buttons?|placket|collar|sole|hardware|finish)\b/i.test(text)) return "construction";
  if (/\b(?:fit|sizing|size|shrink|washing)\b/i.test(text)) return "fit";
  if (/\b(?:durab|last|age|pilling|wears?|wash|care|upkeep)\b/i.test(text)) return "durability";
  if (/\b(?:style|shape|silhouette|versatile|colour|color|smart|casual)\b/i.test(text)) return "style";
  if (/\b(?:brand|retailer|maker|label)\b/i.test(text)) return "evidence";
  return tone === "negative" ? "evidence" : "material";
}

function metricFromSignalCategory(category: ShopperSignalCategory): ShopperSignalMetric {
  if (category === "value") return "value";
  if (category === "durability" || category === "fit" || category === "care") return "durability";
  if (category === "style") return "style";
  return "quality";
}

function buildGoodSigns(verdict: Stage6Verdict, context: Stage6Context): ShopperSignal[] {
  const product = context.payload.page.product;
  const classification = context.payload.classification;
  const pageDomain = sourceDomain(context.payload.page.url) || "product page";
  const signals: ShopperSignal[] = [];
  const material = textField(product.fields.materials.value);
  const pageMaterialEvidence = context.evidencePack.pageEvidence.find((item) => /material/i.test(item.claim));
  const positiveExternal = [...context.evidencePack.externalEvidence, ...context.evidencePack.benchmarkEvidence]
    .filter((item) => item.sentiment === "positive" || (item.sentiment === "mixed" && !isRiskTheme(item.theme)))
    .sort((left, right) => right.confidence * right.relevance_score - left.confidence * left.relevance_score);
  const styleInference = context.visual.expert_inferences.find((item) => item.score_dimension === "aesthetic" && positiveVisualEffect(item.score_effect));

  if (material && classification.material_family !== "unknown") {
    const materialSignal = shopperMaterialSignal(classification, material);
    signals.push(signal({
      label: materialSignal.label,
      detail: materialSignal.detail,
      related_metric: "quality",
      strength: verdict.scores.quality >= 7 ? "high" : "medium",
      confidence: confidenceFromNumber(product.fields.materials.confidence),
      evidence_basis: [basis("product_fact", pageDomain, pageMaterialEvidence?.claim || `Retailer page states material: ${material}.`)]
    }));
  }

  if (classification.price && verdict.scores.value >= 6.4) {
    const valueSignal = shopperValueSignal(classification, verdict);
    signals.push(signal({
      label: valueSignal.label,
      detail: valueSignal.detail,
      related_metric: "value",
      strength: verdict.scores.value >= 7.2 ? "high" : "medium",
      confidence: "medium",
      evidence_basis: [
        basis("category_explanation", "value verdict", verdict.verdicts.value.verdict),
        basis("benchmark_evidence", "approved examples", `Matched examples: ${verdict.matched_examples.join(", ") || "category anchors"}.`)
      ]
    }));
  }

  for (const item of positiveExternal) {
    if (signals.length >= 4) break;
    const metric = signalMetricFromAffects(item.affects);
    const externalSignal = shopperExternalSignal(item, "positive");
    signals.push(signal({
      label: externalSignal.label,
      detail: externalSignal.detail,
      related_metric: metric,
      strength: item.applies_to_product === "directly" && item.confidence >= 0.65 ? "high" : "medium",
      confidence: confidenceFromNumber(item.confidence),
      evidence_basis: [basis(isBenchmarkEvidenceType(item.evidence_type) ? "benchmark_evidence" : "external_evidence", item.source_domain, item.claim)]
    }));
  }

  if (styleInference && signals.length < 5) {
    signals.push(signal({
      label: "Clean visual read",
      detail: twoSentenceText(
        styleInference.caveat ? `${styleInference.inference} ${styleInference.caveat}` : styleInference.inference,
        "The image supports the style read, but not build quality."
      ),
      related_metric: "style",
      strength: styleInference.score_effect === "medium_positive" ? "high" : "medium",
      confidence: styleInference.confidence,
      evidence_basis: [basis("visual_evidence", "product image", styleInference.caveat ? `${styleInference.inference} Caveat: ${styleInference.caveat}` : styleInference.inference)]
    }));
  }

  if (signals.length < 3 && verdict.scores.quality >= 6.2) {
    signals.push(signal({
      label: "Solid quality baseline",
      detail: twoSentenceText(verdict.verdicts.quality.verdict, "The material and category read look better than a thinly described basic, though the support is not complete."),
      related_metric: "quality",
      strength: verdict.scores.quality >= 7 ? "high" : "medium",
      confidence: verdict.confidence_label,
      evidence_basis: [basis("category_explanation", "quality verdict", verdict.verdicts.quality.verdict)]
    }));
  }

  if (signals.length < 3 && verdict.scores.durability >= 6) {
    signals.push(signal({
      label: "Good long-term wear",
      detail: twoSentenceText(verdict.verdicts.durability.verdict, "Nothing obvious drags durability down hard, though the support is still incomplete."),
      related_metric: "durability",
      strength: "medium",
      confidence: verdict.confidence_label,
      evidence_basis: [basis("category_explanation", "durability verdict", verdict.verdicts.durability.verdict)]
    }));
  }

  return dedupeShopperSignals(signals).slice(0, 3);
}

function buildWatchOuts(verdict: Stage6Verdict, context: Stage6Context): ShopperSignal[] {
  const product = context.payload.page.product;
  const classification = context.payload.classification;
  const signals: ShopperSignal[] = [];
  const evidenceGaps = context.evidencePack.evidenceGaps;
  const negativeExternal = [...context.evidencePack.externalEvidence, ...context.evidencePack.benchmarkEvidence]
    .filter((item) => item.sentiment === "negative" || item.sentiment === "mixed")
    .sort((left, right) => right.confidence * right.relevance_score - left.confidence * left.relevance_score);

  for (const item of negativeExternal) {
    if (signals.length >= 2) break;
    const externalSignal = shopperExternalSignal(item, "negative");
    signals.push(signal({
      label: externalSignal.label,
      detail: externalSignal.detail,
      related_metric: watchOutMetricFromExternal(item),
      severity: item.applies_to_product === "directly" && item.confidence >= 0.65 ? "high" : "medium",
      confidence: confidenceFromNumber(item.confidence),
      evidence_basis: [basis(isBenchmarkEvidenceType(item.evidence_type) ? "benchmark_evidence" : "external_evidence", item.source_domain, item.claim)]
    }));
  }

  if (!product.fields.construction.value || evidenceGaps.some((item) => /construction/i.test(item))) {
    const constructionSignal = shopperConstructionGap(classification.category);
    signals.push(signal({
      label: constructionSignal.label,
      detail: constructionSignal.detail,
      related_metric: "durability",
      severity: verdict.scores.durability < 5.8 ? "high" : "medium",
      confidence: "high",
      evidence_basis: [
        basis("missing_evidence", "product facts", "Retailer page did not provide construction details."),
        basis("missing_evidence", "evidence gaps", evidenceGaps.find((item) => /construction/i.test(item)) || constructionExpectation(classification.category))
      ]
    }));
  }

  if (!product.fields.care.value) {
    signals.push(signal({
      label: "Care details unclear",
      detail: "The page does not show enough care guidance, so wash behaviour, shrinkage, and upkeep risk remain uncertain.",
      related_metric: "durability",
      severity: "medium",
      confidence: "high",
      evidence_basis: [basis("missing_evidence", "product facts", "Care label not found in captured product facts.")]
    }));
  }

  if (!product.fields.sizing.value || evidenceGaps.some((item) => /fit|sizing|shrinkage|washing/i.test(item))) {
    const fitGap = evidenceGaps.find((item) => /shrinkage|washing/i.test(item))
      ? {
          label: "May shrink after washing",
          detail: "Fit after washing is not well supported by the available details. Treat shrinkage as a caution rather than a deal-breaker unless more owner feedback confirms it."
        }
      : {
          label: "Fit may be inconsistent",
          detail: "The page does not give enough sizing or fit-after-wear detail, so the buy recommendation is less secure for fit-sensitive shoppers."
        };
    signals.push(signal({
      label: fitGap.label,
      detail: fitGap.detail,
      related_metric: "value",
      severity: "medium",
      confidence: "medium",
      evidence_basis: [basis("missing_evidence", "evidence gaps", evidenceGaps.find((item) => /fit|sizing|shrinkage|washing/i.test(item)) || "Sizing or fit-after-washing evidence not found.")]
    }));
  }

  if (context.evidencePack.externalCoverage === "none" || context.evidencePack.externalCoverage === "limited") {
    signals.push(signal({
      label: "Quality evidence is thin",
      detail: context.evidencePack.externalCoverage === "none"
        ? "There is no accepted independent product feedback, so the verdict leans heavily on retailer facts. Treat it as a cautious read, not a settled call."
        : "Independent feedback is limited, so the verdict has to stay cautious even where the product facts look plausible.",
      related_metric: "quality",
      severity: context.evidencePack.externalCoverage === "none" ? "medium" : "low",
      confidence: "high",
      evidence_basis: [basis("missing_evidence", "external coverage", `External evidence coverage: ${context.evidencePack.externalCoverage}.`)]
    }));
  }

  if (verdict.scores.value < 5.8) {
    signals.push(signal({
      label: "Value is questionable",
      detail: twoSentenceText(verdict.verdicts.value.verdict, "The price asks more than the available quality detail comfortably supports."),
      related_metric: "value",
      severity: verdict.scores.value < 5 ? "high" : "medium",
      confidence: verdict.confidence_label,
      evidence_basis: [basis("category_explanation", "value verdict", verdict.verdicts.value.verdict)]
    }));
  }

  if (classification.material_family === "unknown" || !product.fields.materials.value) {
    signals.push(signal({
      label: "Fabric quality unclear",
      detail: "The listing does not give a reliable fibre composition, so fabric quality, handle, breathability, and likely wear are hard to judge.",
      related_metric: "quality",
      severity: "high",
      confidence: "high",
      evidence_basis: [basis("missing_evidence", "product facts", "Material composition was not found in captured product facts.")]
    }));
  }

  if (verdict.scores.confidence < 0.45) {
    signals.push(signal({
      label: "Quality evidence is thin",
      detail: "Source data is thin enough to cap the verdict, even if the item looks plausible. The recommendation should stay cautious until stronger product facts or owner feedback appear.",
      related_metric: "quality",
      severity: "high",
      confidence: "high",
      evidence_basis: [basis("missing_evidence", "source confidence", `Source confidence score: ${verdict.scores.confidence}.`)]
    }));
  }

  return dedupeShopperSignals(signals).slice(0, 3);
}

function signal(input: LegacySignalInput): ShopperSignal {
  const category = input.category || shopperSignalCategoryFromLegacySignal(input);
  return {
    label: cleanSignalTitle(input.label),
    detail: twoSentenceText(input.detail, "Evidence-grounded signal.", 300),
    related_metric: input.related_metric,
    category,
    strength: input.strength,
    severity: input.severity,
    confidence: input.confidence,
    evidence_basis: input.evidence_basis.filter((item) => item.claim.trim()).slice(0, 3)
  };
}

function basis(type: ShopperSignalEvidenceBasis["type"], source: string, claim: string): ShopperSignalEvidenceBasis {
  return {
    type,
    source: cleanText(source, "unknown", 120),
    claim: cleanText(claim, "Evidence unavailable.", 260)
  };
}

function dedupeShopperSignals(items: ShopperSignal[]): ShopperSignal[] {
  const seen = new Set<string>();
  const result: ShopperSignal[] = [];
  for (const item of items) {
    const key = `${item.label.toLowerCase()}:${item.category ?? item.related_metric}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function shopperSignalCategoryFromLegacySignal(input: LegacySignalInput): ShopperSignalCategory {
  if (input.category) return input.category;
  if (input.evidence_basis.some((item) => item.type === "external_evidence")) return "evidence";
  if (input.evidence_basis.some((item) => item.type === "visual_evidence")) return "style";
  if (input.evidence_basis.some((item) => item.type === "missing_evidence" && /fit|siz|shrink|wash/i.test(item.claim))) return "fit";
  if (input.evidence_basis.some((item) => item.type === "missing_evidence" && /construction|seam|stitch|lining|sole|hardware/i.test(item.claim))) return "construction";
  if (input.evidence_basis.some((item) => item.type === "missing_evidence" && /care|wash|upkeep/i.test(item.claim))) return "care";
  if (input.evidence_basis.some((item) => item.type === "product_fact" && /material|cotton|wool|linen|leather|silk|polyester|nylon/i.test(item.claim))) return "material";
  if (input.related_metric === "value") return "value";
  if (input.related_metric === "durability") return "durability";
  if (input.related_metric === "style") return "style";
  if (input.evidence_basis.some((item) => item.type === "benchmark_evidence")) return "evidence";
  return "evidence";
}

function confidenceFromNumber(value: number): VerdictConfidence {
  if (value >= 0.75) return "high";
  if (value >= 0.45) return "medium";
  return "low";
}

function signalMetricFromAffects(affects: ExternalEvidenceAffects[]): ShopperSignalMetric {
  if (affects.includes("quality")) return "quality";
  if (affects.includes("durability")) return "durability";
  if (affects.includes("value")) return "value";
  if (affects.includes("aesthetic")) return "style";
  return "quality";
}

function watchOutMetricFromExternal(item: ExternalEvidenceItem): ShopperSignalMetric {
  if (item.theme === "price_value") return "value";
  if (item.theme === "fit" || item.theme === "shrinkage") return "value";
  if (item.theme === "durability") return "durability";
  return signalMetricFromAffects(item.affects);
}

function positiveVisualEffect(effect: VisualScoreEffect): boolean {
  return effect === "small_positive" || effect === "medium_positive";
}

function shopperMaterialSignal(classification: ProductClassification, material: string): { label: string; detail: string } {
  const label = classification.material_family === "blend"
    ? "Practical fabric blend"
    : classification.material_family === "synthetic"
      ? "Practical fabric choice"
      : "Strong material choice";
  const materialLine = `The listing gives ${material}, which helps judge how the ${classification.category} may feel, wear, and sit.`;
  return {
    label,
    detail: `${materialLine} ${materialQualityInsight(classification)}`
  };
}

function shopperValueSignal(classification: ProductClassification, verdict: Stage6Verdict): { label: string; detail: string } {
  const label = verdict.scores.value >= 7.2 ? "Strong value" : "Fair value";
  const lane = `${classification.brand_tier} ${classification.material_family} ${classification.category}`.replace(/\bunknown\b/g, "").replace(/\s+/g, " ").trim();
  const priceLine = `At ${classification.price}, this looks ${verdict.scores.value >= 7.2 ? "strongly" : "reasonably"} priced for ${lane || "this item"}.`;
  return {
    label,
    detail: `${priceLine} ${marketPriceContext(classification)}`
  };
}

function shopperExternalSignal(item: ExternalEvidenceItem, polarity: "positive" | "negative"): { label: string; detail: string } {
  const limited = item.confidence < 0.58 || item.source_type === "reddit" || item.source_type === "forum";
  const directness = item.applies_to_product === "directly"
    ? ""
    : item.applies_to_product === "partially"
      ? ` This is related${limited ? " and limited" : ""} feedback rather than a direct comment on this exact item, so treat it as a caution.`
      : " This is category-level feedback, so it should guide expectations rather than decide the purchase.";
  const volumeCaveat = limited && item.applies_to_product === "directly"
    ? " The feedback base is limited, so it is not conclusive."
    : "";
  return {
    label: externalSignalTitle(item.theme, polarity),
    detail: `${item.concrete_insight || item.claim}${directness}${volumeCaveat}`
  };
}

function externalSignalTitle(theme: EvidenceInsightTheme, polarity: "positive" | "negative"): string {
  if (polarity === "positive") {
    if (theme === "durability") return "Holds up well";
    if (theme === "price_value") return "Strong value";
    if (theme === "style") return "Easy to style";
    if (theme === "comfort") return "Comfort sounds strong";
    if (theme === "construction") return "Good make reported";
    return "Strong owner feedback";
  }

  if (theme === "shrinkage") return "May shrink after washing";
  if (theme === "fit") return "Fit may be inconsistent";
  if (theme === "construction") return "Construction unclear";
  if (theme === "fabric_weight") return "Fabric quality unclear";
  if (theme === "price_value") return "Value is questionable";
  if (theme === "durability") return "Durability is uncertain";
  return "Sizing looks risky";
}

function shopperConstructionGap(category: ProductCategory): { label: string; detail: string } {
  const missing = categoryConstructionDetails(category);
  return {
    label: "Construction unclear",
    detail: `The listing does not give enough detail on ${missing}. Treat this as uncertainty, not proof of poor construction.`
  };
}

function categoryConstructionDetails(category: ProductCategory): string {
  if (category === "shirt") return "collar structure, seams, buttons, stitching, fabric weight, or transparency";
  if (category === "knitwear") return "knit density, seam linking, rib recovery, pilling, or neckline stability";
  if (category === "footwear") return "sole attachment, lining, stitch regularity, heel counter structure, or edge finishing";
  if (category === "outerwear") return "lining, seam finishing, hardware attachment, pockets, or edge finishing";
  if (category === "denim" || category === "trousers") return "fabric weight, seam finish, waistband structure, pocket bags, reinforcement, or hems";
  if (category === "bag") return "lining, hardware attachment, seam finishing, edge finishing, or stress points";
  return "seams, stitching, edges, lining, hardware, or stress points";
}

function isRiskTheme(theme: EvidenceInsightTheme): boolean {
  return theme === "fit" || theme === "shrinkage" || theme === "construction" || theme === "fabric_weight";
}

function retrieveApprovedExamples(classification: ProductClassification): MatchedApprovedExample[] {
  return APPROVED_EXAMPLES.map((item) => ({
    ...item,
    similarity: similarityScore(classification, item)
  }))
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 5);
}

async function gatherEvidencePack(payload: BackendPayload, env: QualityCheckEnv, fetcher: Fetcher): Promise<EvidencePack> {
  const pageEvidence = buildPageEvidence(payload);
  const diagnostics: string[] = [];
  const emptyAgentPack: ExternalEvidenceAgentPack = {
    external_sources_found: false,
    useful_sources_count: 0,
    external_evidence_quality: "none",
    external_score_impact: "none",
    evidence: [],
    key_external_insights: [],
    repeated_themes: [],
    conflicting_evidence: [],
    evidence_gaps: [],
    cross_source_themes: [],
    rejected_sources: []
  };
  if (!env.publicEvidenceSearchEnabled) {
    return {
      pageEvidence,
      externalEvidence: [],
      benchmarkEvidence: [],
      publicEvidence: [],
      scoringEvidence: buildOfficialEvidenceForScoring(payload),
      externalCoverage: "none",
      externalSourcesFound: false,
      usefulSourcesCount: 0,
      externalScoreImpact: "none",
      rejectedSources: [],
      keyExternalInsights: [],
      repeatedThemes: [],
      conflictingEvidence: [],
      evidenceGaps: [],
      crossSourceThemes: [],
      externalSearchAttempted: false,
      diagnostics: ["external_search_disabled"],
      agentPack: emptyAgentPack
    };
  }

  if (!env.openaiApiKey) {
    diagnostics.push("openai_web_search_skipped_no_api_key");
    return {
      pageEvidence,
      externalEvidence: [],
      benchmarkEvidence: [],
      publicEvidence: [],
      scoringEvidence: buildOfficialEvidenceForScoring(payload),
      externalCoverage: "none",
      externalSourcesFound: false,
      usefulSourcesCount: 0,
      externalScoreImpact: "none",
      rejectedSources: [],
      keyExternalInsights: [],
      repeatedThemes: [],
      conflictingEvidence: [],
      evidenceGaps: [],
      crossSourceThemes: [],
      externalSearchAttempted: true,
      diagnostics: uniqueStrings(diagnostics),
      agentPack: emptyAgentPack
    };
  }

  const agentPack = await runAIEvidenceAgent(payload, env, fetcher, diagnostics);
  const evidence = dedupeExternalEvidence(agentPack.evidence);
  const externalEvidence = evidence.filter((item) => !isBenchmarkEvidenceType(item.evidence_type)).slice(0, 8);
  const benchmarkEvidence = evidence.filter((item) => isBenchmarkEvidenceType(item.evidence_type)).slice(0, 6);
  const publicEvidence = dedupePublicEvidence([
    ...dedupeExternalEvidence(externalEvidence).slice(0, 8).map(externalEvidenceToPublicEvidence),
    ...dedupeExternalEvidence(benchmarkEvidence).slice(0, 6).map(externalEvidenceToPublicEvidence)
  ]).slice(0, 12);
  const scoringEvidence = dedupePublicEvidence([...buildOfficialEvidenceForScoring(payload), ...publicEvidence.filter(canAffectScores)]).slice(0, 16);
  const crossSourceThemes = buildCrossSourceThemes(evidence, agentPack.cross_source_themes);
  const repeatedThemes = mergeCrossSourceThemes(agentPack.repeated_themes, crossSourceThemes.filter((theme) => theme.source_count >= 2));
  const keyExternalInsights = buildKeyExternalInsights(evidence, repeatedThemes, agentPack.key_external_insights);

  return {
    pageEvidence,
    externalEvidence: dedupeExternalEvidence(externalEvidence).slice(0, 8),
    benchmarkEvidence: dedupeExternalEvidence(benchmarkEvidence).slice(0, 6),
    publicEvidence,
    scoringEvidence,
    externalCoverage: agentPack.external_evidence_quality,
    externalSourcesFound: agentPack.external_sources_found,
    usefulSourcesCount: agentPack.useful_sources_count,
    externalScoreImpact: agentPack.external_score_impact,
    rejectedSources: agentPack.rejected_sources,
    keyExternalInsights,
    repeatedThemes,
    conflictingEvidence: uniqueStrings(agentPack.conflicting_evidence.map((item) => cleanText(item, "", 260)).filter(Boolean)).slice(0, 6),
    evidenceGaps: buildEvidenceGaps(payload, evidence, agentPack.evidence_gaps),
    crossSourceThemes,
    externalSearchAttempted: true,
    diagnostics: uniqueStrings(diagnostics).slice(0, 16),
    agentPack: {
      ...agentPack,
      key_external_insights: keyExternalInsights,
      repeated_themes: repeatedThemes,
      conflicting_evidence: uniqueStrings(agentPack.conflicting_evidence.map((item) => cleanText(item, "", 260)).filter(Boolean)).slice(0, 6),
      evidence_gaps: buildEvidenceGaps(payload, evidence, agentPack.evidence_gaps),
      cross_source_themes: crossSourceThemes
    }
  };
}

async function runAIEvidenceAgent(
  payload: BackendPayload,
  env: QualityCheckEnv,
  fetcher: Fetcher,
  diagnostics: string[]
): Promise<ExternalEvidenceAgentPack> {
  try {
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.openaiApiKey}`
      },
      body: JSON.stringify({
        model: env.coreModel,
        temperature: 0,
        tools: [{ type: "web_search_preview" }],
        text: {
          format: {
            type: "json_schema",
            name: "quality_check_external_evidence_pack",
            strict: true,
            schema: evidenceAgentResponseSchema()
          }
        },
        instructions: buildEvidenceAgentInstructions(),
        input: JSON.stringify(buildEvidenceAgentInput(payload))
      }),
      signal: AbortSignal.timeout(35000)
    });

    if (!response.ok) {
      diagnostics.push(`ai_evidence_agent_http_${response.status}`);
      return emptyEvidenceAgentPack();
    }

    const data = (await response.json()) as OpenAIResponsesResponse;
    const text =
      data.output_text ||
      data.output?.flatMap((item) => item.content || []).find((content) => content.type === "output_text" && content.text)?.text ||
      "{}";
    const pack = sanitiseEvidenceAgentPack(parseModelJson(text), payload, diagnostics);
    diagnostics.push(`ai_evidence_agent_useful_${pack.useful_sources_count}`);
    diagnostics.push(`ai_evidence_agent_rejected_${pack.rejected_sources.length}`);
    return pack;
  } catch (error) {
    diagnostics.push(`ai_evidence_agent_failed_${error instanceof Error ? error.name : "unknown"}`);
    return emptyEvidenceAgentPack();
  }
}

function emptyEvidenceAgentPack(): ExternalEvidenceAgentPack {
  return {
    external_sources_found: false,
    useful_sources_count: 0,
    external_evidence_quality: "none",
    external_score_impact: "none",
    evidence: [],
    key_external_insights: [],
    repeated_themes: [],
    conflicting_evidence: [],
    evidence_gaps: [],
    cross_source_themes: [],
    rejected_sources: []
  };
}

function buildEvidenceAgentInstructions(): string {
  return [
    "You are an AI Evidence Agent for a clothing Quality Check Chrome extension.",
    "Research public web evidence and return strict JSON only.",
    "Use this priority order: 1 exact product independent reviews, 2 same product on third-party retailers, 3 close competitor benchmarks, 4 category price benchmarks, 5 material/construction context.",
    "For every accepted or partially accepted source, extract the shopper insight, not a source summary. Avoid claims like 'GQ has an article about Oxford shirts'; say what shoppers should care about, such as fabric weight, collar roll, shrinkage after washing, opacity, fit, construction, or price/value.",
    "Do not reject Reddit automatically. Treat each Reddit source as lower-confidence individually, but useful when several Reddit/forum/editorial/review sources repeat the same theme.",
    "Set source_type to one of: reddit, editorial_review, retailer_listing, forum, blog, expert_guide.",
    "Set theme to one of: fabric_weight, fit, shrinkage, durability, construction, price_value, brand_reputation, comfort, style.",
    "Set specificity to one of: exact_product, same_brand_category, close_competitor, category_general.",
    "Set applies_to_product to directly, partially, or generally.",
    "Reject the current retailer/current domain and close same-retailer domains.",
    "Reject weak or generic sources: unrelated T-shirts/items, wholesale blanks, marketplace spam, thin SEO pages, coupon pages, affiliate pages with no product evidence, and pages that do not match the product/category/material lane.",
    "Do not count weak or generic sources as useful. They belong in rejected_sources with a concrete reason.",
    "Only exact-product or high-specificity independent evidence may affect quality or durability.",
    "Exact-product evidence can affect quality, value, and durability. Same-brand-category Reddit/forum patterns can affect confidence and risk flags. Editorial/category reviews can define benchmark criteria and value expectations. Competitor listings should only affect value unless they include real reviews.",
    "Competitor, category, and material-context evidence should mainly affect value or confidence, not quality or durability.",
    "If evidence is only category/material context, external_evidence_quality must be limited at best and external_score_impact must be low or none.",
    "Moderate evidence requires genuinely relevant evidence, not merely several weak sources.",
    "Return key_external_insights, repeated_themes, conflicting_evidence, evidence_gaps, and cross_source_themes. cross_source_themes must group repeated opinions across Reddit/editorial/review/forum sources where themes recur."
  ].join("\n");
}

function buildEvidenceAgentInput(payload: BackendPayload) {
  const product = payload.page.product;
  const classification = payload.classification;
  const title = String(product.fields.title.value || payload.page.title || "").trim();
  const brand = classification.brand || textField(product.fields.brand.value);
  const material = textField(product.fields.materials.value) || classification.material_description;
  const code = extractProductCode(`${title} ${payload.page.visibleText}`) || "";
  const currentDomain = sourceDomain(payload.page.url);

  return {
    current_domain_to_exclude: currentDomain,
    product_facts: {
      title,
      brand,
      retailer_url: payload.page.url,
      product_id_or_sku_or_mpn: code,
      category: classification.category,
      material_family: classification.material_family,
      material,
      construction: textField(product.fields.construction.value) || classification.construction_description,
      price: classification.price,
      currency: product.fields.currency.value,
      breadcrumbs: product.fields.categoryBreadcrumbs.value,
      on_site_rating: product.fields.onSiteRating.value,
      on_site_review_count: product.fields.onSiteReviewCount.value
    },
    validation_rules: {
      reject_same_retailer_sources: true,
      reject_generic_weak_sources: ["unrelated T-shirts/items", "wholesale blanks", "SEO spam", "coupon/thin affiliate pages"],
      score_affect_rules: {
        quality_durability: "exact_product or high-specificity independent_review only",
        value: "same product third-party retailers, close competitor benchmarks, category price benchmarks",
        weak_sources: "must not affect scores or confidence"
      }
    },
    required_output_fields: [
      "external_sources_found",
      "useful_sources_count",
      "external_evidence_quality",
      "external_score_impact",
      "evidence",
      "key_external_insights",
      "repeated_themes",
      "conflicting_evidence",
      "evidence_gaps",
      "cross_source_themes",
      "rejected_sources"
    ]
  };
}

function evidenceAgentResponseSchema() {
  const shopperSourceTypes = ["reddit", "editorial_review", "retailer_listing", "forum", "blog", "expert_guide"];
  const insightThemes = ["fabric_weight", "fit", "shrinkage", "durability", "construction", "price_value", "brand_reputation", "comfort", "style"];
  const shopperSpecificities = ["exact_product", "same_brand_category", "close_competitor", "category_general"];
  const scoreDimensions = ["quality", "value", "durability", "aesthetic", "confidence"];
  const evidenceItem = {
    type: "object",
    additionalProperties: false,
    required: [
      "source_domain",
      "source_url",
      "evidence_type",
      "source_type",
      "specificity",
      "concrete_insight",
      "theme",
      "sentiment",
      "quote_or_snippet",
      "applies_to_product",
      "score_dimensions_affected",
      "claim",
      "quote",
      "relevance_score",
      "confidence",
      "affects",
      "reason_included"
    ],
    properties: {
      source_domain: { type: "string" },
      source_url: { type: "string" },
      evidence_type: { type: "string", enum: ["exact_product", "third_party_retailer", "independent_review", "similar_product", "competitor_benchmark", "brand_reputation", "category_benchmark", "material_context"] },
      source_type: { type: "string", enum: shopperSourceTypes },
      specificity: { type: "string", enum: shopperSpecificities },
      concrete_insight: { type: "string" },
      theme: { type: "string", enum: insightThemes },
      sentiment: { type: "string", enum: ["positive", "negative", "mixed", "neutral"] },
      quote_or_snippet: { type: "string" },
      applies_to_product: { type: "string", enum: ["directly", "partially", "generally"] },
      score_dimensions_affected: {
        type: "array",
        items: { type: "string", enum: scoreDimensions }
      },
      claim: { type: "string" },
      quote: { type: "string" },
      relevance_score: { type: "number", minimum: 0, maximum: 1 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      affects: {
        type: "array",
        items: { type: "string", enum: scoreDimensions }
      },
      reason_included: { type: "string" }
    }
  };
  const themeItem = {
    type: "object",
    additionalProperties: false,
    required: ["theme", "summary", "sentiment", "source_count", "source_types", "specificity", "applies_to_product", "score_dimensions_affected", "supporting_sources"],
    properties: {
      theme: { type: "string", enum: insightThemes },
      summary: { type: "string" },
      sentiment: { type: "string", enum: ["positive", "negative", "mixed", "neutral"] },
      source_count: { type: "integer", minimum: 0 },
      source_types: { type: "array", items: { type: "string", enum: shopperSourceTypes } },
      specificity: { type: "string", enum: shopperSpecificities },
      applies_to_product: { type: "string", enum: ["directly", "partially", "generally"] },
      score_dimensions_affected: { type: "array", items: { type: "string", enum: scoreDimensions } },
      supporting_sources: { type: "array", items: { type: "string" } }
    }
  };
  const rejectedItem = {
    type: "object",
    additionalProperties: false,
    required: ["source_domain", "source_url", "evidence_type", "specificity", "claim", "reason_rejected"],
    properties: {
      source_domain: { type: "string" },
      source_url: { type: "string" },
      evidence_type: { type: "string" },
      specificity: { type: "string" },
      claim: { type: "string" },
      reason_rejected: { type: "string" }
    }
  };

  return {
    type: "object",
    additionalProperties: false,
    required: [
      "external_sources_found",
      "useful_sources_count",
      "external_evidence_quality",
      "external_score_impact",
      "evidence",
      "key_external_insights",
      "repeated_themes",
      "conflicting_evidence",
      "evidence_gaps",
      "cross_source_themes",
      "rejected_sources"
    ],
    properties: {
      external_sources_found: { type: "boolean" },
      useful_sources_count: { type: "integer", minimum: 0 },
      external_evidence_quality: { type: "string", enum: ["strong", "moderate", "limited", "none"] },
      external_score_impact: { type: "string", enum: ["high", "medium", "low", "none"] },
      evidence: { type: "array", items: evidenceItem },
      key_external_insights: { type: "array", items: { type: "string" } },
      repeated_themes: { type: "array", items: themeItem },
      conflicting_evidence: { type: "array", items: { type: "string" } },
      evidence_gaps: { type: "array", items: { type: "string" } },
      cross_source_themes: { type: "array", items: themeItem },
      rejected_sources: { type: "array", items: rejectedItem }
    }
  };
}

function sanitiseEvidenceAgentPack(
  parsed: Record<string, unknown>,
  payload: BackendPayload,
  diagnostics: string[]
): ExternalEvidenceAgentPack {
  const rejectedSources: RejectedExternalSource[] = [];
  const rawEvidence = Array.isArray(parsed.evidence) ? parsed.evidence : [];
  const evidence = rawEvidence
    .map((record) => sanitiseEvidenceAgentItem(record, payload, rejectedSources))
    .filter((item): item is ExternalEvidenceItem => Boolean(item));
  const modelRejected = Array.isArray(parsed.rejected_sources) ? parsed.rejected_sources : [];
  rejectedSources.push(...modelRejected.map(sanitiseRejectedSource).filter((item): item is RejectedExternalSource => Boolean(item)));

  const dedupedEvidence = dedupeExternalEvidence(evidence).slice(0, 12);
  const crossSourceThemes = buildCrossSourceThemes(dedupedEvidence, Array.isArray(parsed.cross_source_themes) ? parsed.cross_source_themes.map(sanitiseCrossSourceTheme).filter((item): item is CrossSourceTheme => Boolean(item)) : []);
  const repeatedThemes = mergeCrossSourceThemes(
    Array.isArray(parsed.repeated_themes) ? parsed.repeated_themes.map(sanitiseCrossSourceTheme).filter((item): item is CrossSourceTheme => Boolean(item)) : [],
    crossSourceThemes.filter((theme) => theme.source_count >= 2)
  );
  const quality = classifyExternalCoverage(
    dedupedEvidence.filter((item) => !isBenchmarkEvidenceType(item.evidence_type)),
    dedupedEvidence.filter((item) => isBenchmarkEvidenceType(item.evidence_type))
  );
  const scoreImpact = classifyExternalScoreImpact(dedupedEvidence, quality);
  const usefulCount = dedupedEvidence.filter((item) => item.relevance_score >= 0.62 && item.confidence >= 0.5).length;
  if (parsed.external_evidence_quality && parsed.external_evidence_quality !== quality) {
    diagnostics.push(`ai_evidence_agent_quality_corrected_${String(parsed.external_evidence_quality)}_to_${quality}`);
  }

  return {
    external_sources_found: dedupedEvidence.length > 0 || rejectedSources.length > 0 || Boolean(parsed.external_sources_found),
    useful_sources_count: usefulCount,
    external_evidence_quality: quality,
    external_score_impact: scoreImpact,
    evidence: dedupedEvidence,
    key_external_insights: buildKeyExternalInsights(dedupedEvidence, repeatedThemes, Array.isArray(parsed.key_external_insights) ? parsed.key_external_insights : []),
    repeated_themes: repeatedThemes,
    conflicting_evidence: Array.isArray(parsed.conflicting_evidence) ? uniqueStrings(parsed.conflicting_evidence.map((item) => cleanText(item, "", 260)).filter(Boolean)).slice(0, 6) : [],
    evidence_gaps: buildEvidenceGaps(payload, dedupedEvidence, Array.isArray(parsed.evidence_gaps) ? parsed.evidence_gaps : []),
    cross_source_themes: crossSourceThemes,
    rejected_sources: dedupeRejectedSources(rejectedSources).slice(0, 16)
  };
}

function sanitiseEvidenceAgentItem(
  record: unknown,
  payload: BackendPayload,
  rejectedSources: RejectedExternalSource[]
): ExternalEvidenceItem | null {
  if (!record || typeof record !== "object") return null;
  const item = record as Record<string, unknown>;
  const sourceUrl = cleanText(item.source_url, "", 500);
  const domain = sourceDomain(sourceUrl);
  const evidenceType = isExternalEvidenceSourceType(item.evidence_type) ? item.evidence_type : isExternalEvidenceSourceType(item.source_type) ? item.source_type : "brand_reputation";
  const sourceType = sanitiseShopperSourceType(item.source_type, domain, sourceUrl);
  const specificity = normaliseEvidenceSpecificity(item.specificity, evidenceType);
  const concreteInsight = cleanText(item.concrete_insight, cleanText(item.claim, "", 320), 320);
  const theme = sanitiseInsightTheme(item.theme, `${concreteInsight} ${item.claim || ""}`);
  const sentiment = sanitiseEvidenceSentiment(item.sentiment, `${concreteInsight} ${item.claim || ""} ${item.quote || ""}`);
  const quoteOrSnippet = cleanText(item.quote_or_snippet, cleanText(item.quote, concreteInsight, 260), 260);
  const appliesToProduct = sanitiseApplicability(item.applies_to_product, specificity);
  const claim = cleanText(item.claim, concreteInsight, 320);
  const quote = cleanText(item.quote, quoteOrSnippet || claim, 260);
  const currentDomain = sourceDomain(payload.page.url);
  const rejectionBase = {
    source_domain: domain || cleanText(item.source_domain, "", 120),
    source_url: sourceUrl,
    evidence_type: evidenceType,
    specificity,
    claim
  };

  if (!domain || !sourceUrl || !claim || !quote) {
    rejectedSources.push({ ...rejectionBase, reason_rejected: "missing source URL, domain, claim, or quote" });
    return null;
  }
  if (domain === "duckduckgo.com" || sameRetailerDomain(domain, currentDomain)) {
    rejectedSources.push({ ...rejectionBase, reason_rejected: "same-retailer or search-result source" });
    return null;
  }
  if (isGenericWeakEvidence(`${claim} ${quote}`, payload, domain)) {
    rejectedSources.push({ ...rejectionBase, reason_rejected: "generic, unrelated, wholesale, SEO, coupon, or weak source" });
    return null;
  }
  if (isNothingyExternalClaim(`${concreteInsight} ${claim}`)) {
    rejectedSources.push({ ...rejectionBase, reason_rejected: "generic source-existence summary without shopper insight" });
    return null;
  }

  const relevanceScore = round2(Math.max(0, Math.min(1, numberOr(item.relevance_score, 0))));
  const confidence = round2(Math.max(0, Math.min(1, numberOr(item.confidence, 0))));
  if (relevanceScore < 0.5 || confidence < 0.42) {
    rejectedSources.push({ ...rejectionBase, reason_rejected: "below relevance/confidence threshold" });
    return null;
  }

  const affects = sanitiseEvidenceAffects(item.score_dimensions_affected || item.affects, evidenceType, specificity, relevanceScore, confidence, sourceType);
  if (affects.length === 0) {
    rejectedSources.push({ ...rejectionBase, reason_rejected: "not specific enough to affect scores or confidence" });
    return null;
  }

  return {
    source_domain: domain,
    source_url: sourceUrl,
    evidence_type: evidenceType,
    source_type: sourceType,
    specificity,
    concrete_insight: concreteInsight,
    theme,
    sentiment,
    quote_or_snippet: quoteOrSnippet,
    applies_to_product: appliesToProduct,
    score_dimensions_affected: affects,
    claim,
    quote,
    relevance_score: relevanceScore,
    confidence,
    affects,
    reason_included: cleanText(item.reason_included, "Relevant external evidence after validation.", 220)
  };
}

function sanitiseEvidenceAffects(
  value: unknown,
  evidenceType: ExternalEvidenceItem["evidence_type"],
  specificity: PublicEvidenceSpecificity,
  relevanceScore: number,
  confidence: number,
  sourceType: ShopperEvidenceSourceType
): ExternalEvidenceAffects[] {
  const raw = Array.isArray(value) ? value : [];
  const proposed = raw.filter((item): item is ExternalEvidenceAffects =>
    item === "quality" || item === "value" || item === "durability" || item === "aesthetic" || item === "confidence"
  );
  const highSpecificityIndependent =
    evidenceType === "independent_review" &&
    (specificity === "exact_product" || specificity === "same_line" || specificity === "same_brand_category") &&
    relevanceScore >= 0.72 &&
    confidence >= 0.6;
  const exactProduct = specificity === "exact_product" && relevanceScore >= 0.68 && confidence >= 0.55;
  const canAffectQualityDurability = exactProduct || highSpecificityIndependent;
  const result = proposed.filter((item) => {
    if (item === "quality" || item === "durability") return canAffectQualityDurability;
    if (item === "value") return evidenceType !== "material_context" || specificity !== "material_context";
    if (item === "confidence") return relevanceScore >= 0.58 && confidence >= 0.48;
    return exactProduct || highSpecificityIndependent;
  });

  if (result.length) return uniqueStrings(result) as ExternalEvidenceAffects[];
  if ((sourceType === "reddit" || sourceType === "forum") && specificity === "same_brand_category" && relevanceScore >= 0.58 && confidence >= 0.42) return ["confidence"];
  if (evidenceType === "competitor_benchmark" || evidenceType === "category_benchmark" || evidenceType === "third_party_retailer" || specificity === "category" || specificity === "category_general" || specificity === "close_competitor") {
    return ["value"];
  }
  if (evidenceType === "material_context") return ["confidence"];
  if (canAffectQualityDurability) return ["quality", "durability", "value"];
  return [];
}

function sanitiseRejectedSource(record: unknown): RejectedExternalSource | null {
  if (!record || typeof record !== "object") return null;
  const item = record as Record<string, unknown>;
  const sourceUrl = cleanText(item.source_url, "", 500);
  const domain = sourceDomain(sourceUrl) || cleanText(item.source_domain, "", 120);
  const reason = cleanText(item.reason_rejected, "", 240);
  if (!domain && !sourceUrl && !reason) return null;
  return {
    source_domain: domain,
    source_url: sourceUrl,
    evidence_type: typeof item.evidence_type === "string" ? item.evidence_type.slice(0, 80) : undefined,
    specificity: typeof item.specificity === "string" ? item.specificity.slice(0, 80) : undefined,
    claim: typeof item.claim === "string" ? item.claim.slice(0, 220) : undefined,
    reason_rejected: reason || "rejected by AI Evidence Agent"
  };
}

function dedupeRejectedSources(items: RejectedExternalSource[]): RejectedExternalSource[] {
  const seen = new Set<string>();
  const result: RejectedExternalSource[] = [];
  for (const item of items) {
    const key = `${item.source_domain}:${item.source_url}:${item.reason_rejected}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function isBenchmarkEvidenceType(type: ExternalEvidenceItem["evidence_type"]): boolean {
  return type === "competitor_benchmark" || type === "category_benchmark" || type === "material_context";
}

function isGenericWeakEvidence(text: string, payload: BackendPayload, domain: string): boolean {
  const lowered = text.toLowerCase();
  if (/\b(?:wholesale|blank(?:s)?|bulk|dropship|coupon|promo code|voucher|sale alert|seo|sponsored)\b/.test(lowered)) return true;
  if (/\b(?:best t[-\s]?shirts?|plain tees?|custom t[-\s]?shirts?)\b/.test(lowered) && payload.classification.category !== "t-shirt") return true;
  if (/\b(?:amazon|aliexpress|temu|shein|dhgate)\b/.test(domain) && !/\b(?:review|tested|compared)\b/.test(lowered)) return true;
  const category = payload.classification.category;
  if (category !== "other" && category !== "t-shirt" && /\bt[-\s]?shirt\b/.test(lowered) && !lowered.includes(category)) return true;
  return false;
}

function isPublicEvidenceSpecificity(value: unknown): value is PublicEvidenceSpecificity {
  return value === "exact_product" ||
    value === "same_line" ||
    value === "same_brand_category" ||
    value === "close_competitor" ||
    value === "category" ||
    value === "category_general" ||
    value === "material_context" ||
    value === "brand_general";
}

function normaliseEvidenceSpecificity(value: unknown, evidenceType: ExternalEvidenceItem["evidence_type"]): PublicEvidenceSpecificity {
  if (value === "category_general") return "category_general";
  if (value === "category") return "category_general";
  if (value === "same_line") return "same_brand_category";
  if (value === "material_context" || value === "brand_general") return "category_general";
  if (isPublicEvidenceSpecificity(value)) return value;
  return specificityFromEvidenceType(evidenceType);
}

function specificityFromEvidenceType(type: ExternalEvidenceItem["evidence_type"]): PublicEvidenceSpecificity {
  if (type === "exact_product" || type === "third_party_retailer" || type === "independent_review") return "exact_product";
  if (type === "competitor_benchmark") return "close_competitor";
  if (type === "category_benchmark" || type === "material_context") return "category_general";
  if (type === "similar_product") return "same_brand_category";
  return "category_general";
}

function sanitiseShopperSourceType(value: unknown, domain: string, url: string): ShopperEvidenceSourceType {
  if (value === "reddit" || value === "editorial_review" || value === "retailer_listing" || value === "forum" || value === "blog" || value === "expert_guide") return value;
  const lowered = `${domain} ${url}`.toLowerCase();
  if (lowered.includes("reddit.")) return "reddit";
  if (/\b(styleforum|askandy|fedoralounge|forum)\b/.test(lowered)) return "forum";
  if (/\b(gq|esquire|wirecutter|insidehook|putthison|permanentstyle|dieworkwear|fashionbeans)\b/.test(lowered)) return "editorial_review";
  if (/\b(blog|substack|medium)\b/.test(lowered)) return "blog";
  if (/\b(mrporter|nordstrom|endclothing|ssense|farfetch|johnlewis|marksandspencer|selfridges)\b/.test(lowered)) return "retailer_listing";
  return "expert_guide";
}

function sanitiseInsightTheme(value: unknown, text: string): EvidenceInsightTheme {
  if (value === "fabric_weight" || value === "fit" || value === "shrinkage" || value === "durability" || value === "construction" || value === "price_value" || value === "brand_reputation" || value === "comfort" || value === "style") return value;
  const lowered = text.toLowerCase();
  if (/\b(weight|gsm|heavy|substantial|thin|opaque|opacity|see[-\s]?through|fabric)\b/.test(lowered)) return "fabric_weight";
  if (/\b(fit|sizing|size|measurements|slim|regular|oversized|after wash)\b/.test(lowered)) return "fit";
  if (/\b(shrink|washing|wash|launder)\b/.test(lowered)) return "shrinkage";
  if (/\b(durable|durability|last|wear|pilling|fray|tear)\b/.test(lowered)) return "durability";
  if (/\b(collar|roll|placket|seam|stitch|buttons?|construction|lining|welt)\b/.test(lowered)) return "construction";
  if (/\b(price|value|affordable|expensive|cheap|discount|worth)\b/.test(lowered)) return "price_value";
  if (/\b(brand|reputation|quality control|qc)\b/.test(lowered)) return "brand_reputation";
  if (/\b(comfort|soft|scratchy|itchy|breathable|feel)\b/.test(lowered)) return "comfort";
  return "style";
}

function sanitiseEvidenceSentiment(value: unknown, text: string): PublicEvidenceSentiment {
  if (value === "positive" || value === "negative" || value === "mixed" || value === "neutral") return value;
  return classifyEvidenceSentiment(text.toLowerCase());
}

function sanitiseApplicability(value: unknown, specificity: PublicEvidenceSpecificity): ProductApplicability {
  if (value === "directly" || value === "partially" || value === "generally") return value;
  if (specificity === "exact_product") return "directly";
  if (specificity === "same_brand_category" || specificity === "close_competitor") return "partially";
  return "generally";
}

function sanitiseCrossSourceTheme(record: unknown): CrossSourceTheme | null {
  if (!record || typeof record !== "object") return null;
  const item = record as Record<string, unknown>;
  const summary = cleanText(item.summary, "", 360);
  if (!summary) return null;
  const theme = sanitiseInsightTheme(item.theme, summary);
  const sourceTypes = Array.isArray(item.source_types)
    ? uniqueStrings(item.source_types.map((value) => sanitiseShopperSourceType(value, "", "")).filter(Boolean)).slice(0, 6) as ShopperEvidenceSourceType[]
    : [];
  const dimensions = sanitiseEvidenceDimensions(item.score_dimensions_affected);
  const specificity = normaliseEvidenceSpecificity(item.specificity, "category_benchmark");
  return {
    theme,
    summary,
    sentiment: sanitiseEvidenceSentiment(item.sentiment, summary),
    source_count: Math.max(0, Math.round(numberOr(item.source_count, 0))),
    source_types: sourceTypes,
    specificity,
    applies_to_product: sanitiseApplicability(item.applies_to_product, specificity),
    score_dimensions_affected: dimensions.length ? dimensions : ["confidence"],
    supporting_sources: Array.isArray(item.supporting_sources)
      ? uniqueStrings(item.supporting_sources.map((value) => cleanText(value, "", 120)).filter(Boolean)).slice(0, 6)
      : []
  };
}

function sanitiseEvidenceDimensions(value: unknown): ExternalEvidenceAffects[] {
  const raw = Array.isArray(value) ? value : [];
  return uniqueStrings(raw.filter((item): item is ExternalEvidenceAffects =>
    item === "quality" || item === "value" || item === "durability" || item === "aesthetic" || item === "confidence"
  )) as ExternalEvidenceAffects[];
}

function buildCrossSourceThemes(evidence: ExternalEvidenceItem[], modelThemes: CrossSourceTheme[] = []): CrossSourceTheme[] {
  const groups = new Map<EvidenceInsightTheme, ExternalEvidenceItem[]>();
  for (const item of evidence) {
    const current = groups.get(item.theme) || [];
    current.push(item);
    groups.set(item.theme, current);
  }
  const generated = Array.from(groups.entries())
    .filter(([, items]) => items.length >= 2 || items.some((item) => item.source_type === "reddit" || item.source_type === "forum"))
    .map(([theme, items]) => {
      const sorted = [...items].sort((left, right) => right.confidence * right.relevance_score - left.confidence * left.relevance_score);
      const representative = sorted[0];
      const sentiment = dominantSentiment(sorted.map((item) => item.sentiment));
      const directness = sorted.some((item) => item.applies_to_product === "directly")
        ? "directly"
        : sorted.some((item) => item.applies_to_product === "partially")
          ? "partially"
          : "generally";
      return {
        theme,
        summary: cleanText(
          `${theme.replace(/_/g, " ")}: ${representative.concrete_insight}`,
          representative.concrete_insight,
          360
        ),
        sentiment,
        source_count: sorted.length,
        source_types: uniqueStrings(sorted.map((item) => item.source_type)).slice(0, 6) as ShopperEvidenceSourceType[],
        specificity: mostSpecific(sorted.map((item) => item.specificity)),
        applies_to_product: directness as ProductApplicability,
        score_dimensions_affected: uniqueStrings(sorted.flatMap((item) => item.score_dimensions_affected)).slice(0, 5) as ExternalEvidenceAffects[],
        supporting_sources: uniqueStrings(sorted.map((item) => item.source_domain)).slice(0, 6)
      };
    });
  return mergeCrossSourceThemes(modelThemes, generated).slice(0, 8);
}

function mergeCrossSourceThemes(...groups: CrossSourceTheme[][]): CrossSourceTheme[] {
  const seen = new Set<string>();
  const result: CrossSourceTheme[] = [];
  for (const item of groups.flat()) {
    const key = `${item.theme}:${item.summary.toLowerCase().slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      ...item,
      source_count: Math.max(0, item.source_count),
      source_types: uniqueStrings(item.source_types).slice(0, 6) as ShopperEvidenceSourceType[],
      score_dimensions_affected: uniqueStrings(item.score_dimensions_affected).slice(0, 5) as ExternalEvidenceAffects[],
      supporting_sources: uniqueStrings(item.supporting_sources).slice(0, 6)
    });
  }
  return result.sort((left, right) => right.source_count - left.source_count);
}

function buildKeyExternalInsights(evidence: ExternalEvidenceItem[], repeatedThemes: CrossSourceTheme[], modelInsights: unknown[]): string[] {
  const model = modelInsights.map((item) => cleanText(item, "", 320)).filter((item) => item && !isNothingyExternalClaim(item));
  const repeated = repeatedThemes.map((item) => item.summary);
  const sourceInsights = evidence
    .sort((left, right) => right.relevance_score * right.confidence - left.relevance_score * left.confidence)
    .map((item) => {
      const prefix = item.applies_to_product === "directly" ? "Direct evidence" : item.applies_to_product === "partially" ? "Partial evidence" : "General benchmark";
      return `${prefix}: ${item.concrete_insight}`;
    });
  return uniqueStrings([...model, ...repeated, ...sourceInsights].map((item) => cleanText(item, "", 340)).filter(Boolean)).slice(0, 8);
}

function buildEvidenceGaps(payload: BackendPayload, evidence: ExternalEvidenceItem[], modelGaps: unknown[]): string[] {
  const gaps = modelGaps.map((item) => cleanText(item, "", 260)).filter(Boolean);
  if (!evidence.some((item) => item.specificity === "exact_product")) gaps.push("No accepted exact-product external review evidence was found.");
  if (!evidence.some((item) => item.theme === "fabric_weight")) gaps.push("No accepted source confirms fabric weight, opacity, or density.");
  if (payload.classification.category === "shirt" && !evidence.some((item) => item.theme === "shrinkage")) gaps.push("No accepted source confirms shrinkage or fit after washing.");
  if (!evidence.some((item) => item.theme === "construction")) gaps.push("No accepted source gives close construction proof.");
  return uniqueStrings(gaps).slice(0, 8);
}

function dominantSentiment(sentiments: PublicEvidenceSentiment[]): PublicEvidenceSentiment {
  const unique = uniqueStrings(sentiments);
  if (unique.length === 0) return "neutral";
  if (unique.length > 1 && (unique.includes("positive") || unique.includes("negative"))) return "mixed";
  return unique[0] as PublicEvidenceSentiment;
}

function mostSpecific(values: PublicEvidenceSpecificity[]): PublicEvidenceSpecificity {
  if (values.includes("exact_product")) return "exact_product";
  if (values.includes("same_brand_category") || values.includes("same_line")) return "same_brand_category";
  if (values.includes("close_competitor")) return "close_competitor";
  return "category_general";
}

function isNothingyExternalClaim(text: string): boolean {
  return /\b(?:has|have|published|lists?|article|roundup|thread|post)\b.{0,60}\b(?:about|on|for)\b/i.test(text) &&
    !/\b(?:fabric|weight|gsm|collar|roll|shrink|fit|wash|opacity|construction|seam|stitch|price|value|durab|comfort|sizing)\b/i.test(text);
}

function classifyExternalScoreImpact(evidence: ExternalEvidenceItem[], quality: ExternalEvidenceCoverage): ExternalScoreImpact {
  if (quality === "none" || evidence.length === 0) return "none";
  const scoringItems = evidence.filter((item) => item.affects.some((affect) => affect !== "confidence") && item.confidence >= 0.55 && item.relevance_score >= 0.62);
  if (quality === "strong" && scoringItems.some((item) => item.affects.includes("quality") || item.affects.includes("durability"))) return "high";
  if (quality === "moderate" && scoringItems.length >= 1) return "medium";
  if (scoringItems.length >= 1) return "low";
  return "none";
}

function buildPageEvidence(payload: BackendPayload): PageEvidenceItem[] {
  const product = payload.page.product;
  const classification = payload.classification;
  const url = payload.page.url;
  const pageDomain = sourceDomain(url);
  const items: PageEvidenceItem[] = [];

  function add(claim: string, confidence = 0.88): void {
    items.push({
      source_domain: pageDomain,
      source_url: url,
      claim,
      confidence,
      quote: claim
    });
  }

  if (product.fields.materials.value) add(`Retailer page states material: ${textField(product.fields.materials.value)}.`);
  if (product.fields.origin.value) add(`Retailer page states origin: ${textField(product.fields.origin.value)}.`);
  if (product.fields.construction.value) add(`Retailer page states construction details: ${textField(product.fields.construction.value)}.`);
  if (product.fields.onSiteRating.value && product.fields.onSiteReviewCount.value) {
    add(`On-site reviews show ${textField(product.fields.onSiteRating.value)}/5 from ${textField(product.fields.onSiteReviewCount.value)} reviews.`, 0.76);
  }
  for (const signal of classification.quality_signals) add(signal, 0.74);

  return dedupePageEvidence(items).slice(0, 8);
}

function buildOfficialEvidenceForScoring(payload: BackendPayload): PublicEvidenceItem[] {
  const product = payload.page.product;
  const classification = payload.classification;
  const url = payload.page.url;
  const items: PublicEvidenceItem[] = [];

  function add(dimension: PublicEvidenceDimension, claim: string, confidence = 0.88): void {
    items.push({
      sourceType: "official",
      specificity: "exact_product",
      dimension,
      claim,
      sentiment: "positive",
      confidence,
      url,
      quote: claim
    });
  }

  if (product.fields.materials.value) add("fabric", `Retailer page states material: ${textField(product.fields.materials.value)}.`);
  if (product.fields.origin.value) add("quality", `Retailer page states origin: ${textField(product.fields.origin.value)}.`);
  if (product.fields.construction.value) add("quality", `Retailer page states construction details: ${textField(product.fields.construction.value)}.`);
  if (product.fields.onSiteRating.value && product.fields.onSiteReviewCount.value) {
    add("risk", `On-site reviews show ${textField(product.fields.onSiteRating.value)}/5 from ${textField(product.fields.onSiteReviewCount.value)} reviews.`, 0.76);
  }
  for (const signal of classification.quality_signals) add(signal.includes("reviews") ? "risk" : "quality", signal, 0.74);

  return dedupePublicEvidence(items).slice(0, 8);
}

function dedupePageEvidence(items: PageEvidenceItem[]): PageEvidenceItem[] {
  const seen = new Set<string>();
  const result: PageEvidenceItem[] = [];
  for (const item of items) {
    const key = `${item.source_domain}:${item.claim.toLowerCase().slice(0, 90)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...item, confidence: round2(Math.max(0, Math.min(1, item.confidence))) });
  }
  return result;
}

function dedupeExternalEvidence(items: ExternalEvidenceItem[]): ExternalEvidenceItem[] {
  const seen = new Set<string>();
  const result: ExternalEvidenceItem[] = [];
  for (const item of items) {
    const key = `${item.source_domain}:${item.source_type}:${item.claim.toLowerCase().slice(0, 90)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...item, confidence: round2(Math.max(0, Math.min(1, item.confidence))) });
  }
  return result;
}

function isExternalEvidenceSourceType(value: unknown): value is ExternalEvidenceSourceType {
  return value === "exact_product" ||
    value === "third_party_retailer" ||
    value === "independent_review" ||
    value === "similar_product" ||
    value === "competitor_benchmark" ||
    value === "brand_reputation" ||
    value === "category_benchmark" ||
    value === "material_context";
}

function externalEvidenceToPublicEvidence(item: ExternalEvidenceItem): PublicEvidenceItem {
  const specificity: PublicEvidenceSpecificity =
    item.specificity ||
    (item.evidence_type === "exact_product" || item.evidence_type === "third_party_retailer" || item.evidence_type === "independent_review"
      ? "exact_product"
      : item.evidence_type === "similar_product"
        ? "same_brand_category"
        : item.evidence_type === "competitor_benchmark"
          ? "close_competitor"
          : "category_general");
  const text = `${item.concrete_insight || item.claim} ${item.quote_or_snippet || item.quote}`.toLowerCase();
  const dimension = item.affects.includes("quality")
    ? "quality"
    : item.affects.includes("durability")
      ? "durability"
      : item.affects.includes("value")
        ? "value"
        : classifyEvidenceDimension(text);
  return {
    sourceType: classifyEvidenceSource(item.source_url, text),
    specificity,
    dimension,
    claim: item.concrete_insight || item.claim,
    sentiment: item.sentiment || classifyEvidenceSentiment(text),
    confidence: item.evidence_type === "category_benchmark" || item.evidence_type === "competitor_benchmark" || item.evidence_type === "material_context" || item.source_type === "reddit" || item.source_type === "forum"
      ? Math.min(item.confidence, 0.56)
      : item.confidence,
    url: item.source_url,
    quote: item.quote_or_snippet || item.quote,
    date: item.date || item.freshness
  };
}

function classifyExternalCoverage(
  externalEvidence: ExternalEvidenceItem[],
  benchmarkEvidence: ExternalEvidenceItem[]
): ExternalEvidenceCoverage {
  const exactCount = externalEvidence.filter((item) => item.specificity === "exact_product" && item.confidence >= 0.62 && item.relevance_score >= 0.68).length;
  const highSpecificityIndependentCount = externalEvidence.filter((item) =>
    item.evidence_type === "independent_review" &&
    (item.specificity === "exact_product" || item.specificity === "same_line" || item.specificity === "same_brand_category") &&
    item.confidence >= 0.6 &&
    item.relevance_score >= 0.72
  ).length;
  const usefulExternalCount = externalEvidence.filter((item) => item.confidence >= 0.52 && item.relevance_score >= 0.62).length;
  const usefulBenchmarkCount = benchmarkEvidence.filter((item) => item.confidence >= 0.5 && item.relevance_score >= 0.6).length;
  const domains = new Set([...externalEvidence, ...benchmarkEvidence].map((item) => item.source_domain));

  if (usefulExternalCount + usefulBenchmarkCount === 0) return "none";
  if (exactCount >= 2 && domains.size >= 2) return "strong";
  if (exactCount >= 1 && usefulExternalCount >= 2) return "moderate";
  if (highSpecificityIndependentCount >= 1 && (usefulExternalCount >= 2 || usefulBenchmarkCount >= 1)) return "moderate";
  if (usefulExternalCount >= 1 && usefulBenchmarkCount >= 1 && domains.size >= 2) return "moderate";
  return "limited";
}

function externalCoverageConfidenceCap(confidence: number, evidencePack: EvidencePack): number {
  if (!evidencePack.externalSearchAttempted) return confidence;
  const cap = {
    none: 0.62,
    limited: 0.72,
    moderate: 0.84,
    strong: 0.92
  }[evidencePack.externalCoverage];
  return round2(Math.min(confidence, cap));
}

function dedupePublicEvidence(items: PublicEvidenceItem[]): PublicEvidenceItem[] {
  const seen = new Set<string>();
  const result: PublicEvidenceItem[] = [];
  for (const item of items) {
    const key = `${item.sourceType}:${item.specificity}:${item.dimension}:${item.claim.toLowerCase().slice(0, 90)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...item, confidence: round2(Math.max(0, Math.min(1, item.confidence))) });
  }
  return result;
}

function applyPublicEvidenceEffects(score: number, evidence: PublicEvidenceItem[], dimension: PublicEvidenceDimension): number {
  const delta = evidence.reduce((total, item) => {
    if (item.dimension !== dimension && !(dimension === "quality" && item.dimension === "fabric")) return total;
    if (!canAffectScores(item)) return total;
    if ((dimension === "quality" || dimension === "durability") && item.sourceType !== "official" && item.specificity !== "exact_product" && item.specificity !== "same_line") return total;
    const specificity = {
      exact_product: 0.28,
      same_line: 0.18,
      same_brand_category: 0.08,
      close_competitor: dimension === "value" ? 0.14 : 0.03,
      category: dimension === "value" ? 0.1 : 0,
      category_general: dimension === "value" ? 0.1 : 0,
      material_context: 0,
      brand_general: 0.03
    }[item.specificity];
    const direction = item.sentiment === "positive" ? 1 : item.sentiment === "negative" ? -1 : 0;
    return total + direction * specificity * item.confidence;
  }, 0);
  return score + Math.max(-0.45, Math.min(0.45, delta));
}

function canAffectScores(item: PublicEvidenceItem): boolean {
  if (item.sourceType === "official") return true;
  if (item.confidence < 0.55 || item.sentiment === "neutral") return false;
  if ((item.dimension === "quality" || item.dimension === "durability" || item.dimension === "fabric") && item.specificity !== "exact_product" && item.specificity !== "same_line") return false;
  if (item.specificity === "material_context" && item.dimension !== "risk") return false;
  if ((item.specificity === "category" || item.specificity === "category_general") && item.dimension !== "value") return false;
  if (item.specificity === "close_competitor" && item.dimension !== "value") return false;
  return true;
}

function describeEvidenceScoreEffects(evidence: PublicEvidenceItem[]): string[] {
  return evidence
    .filter((item) => item.sentiment !== "neutral" && item.confidence >= 0.55)
    .map((item) => `${item.sentiment} ${item.dimension}: ${item.specificity} ${item.sourceType} evidence - ${item.claim}`)
    .slice(0, 8);
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
  if (!product.fields.sizing.value) flags.push("sizing_not_verified");
  if (context.visual.status === "skipped") flags.push("visual_enrichment_skipped");
  if (context.visual.missing_views.length) flags.push("missing_close_up_views");
  if (product.source_confidence_score < 0.45) flags.push("weak_source_data");
  flags.push(`external_evidence_${context.evidencePack.externalCoverage}`);
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
    "recommendation_summary must be one punchy sentence under 90 characters. No second explanatory sentence.",
    "Return max 3 good_signs and max 3 watch_outs. Each item has title, description, optional evidence_type, and optional confidence.",
    "Good-sign and watch-out titles must be 2-5 words, shopper-facing verdicts, e.g. Strong material choice, Strong value, Holds up well, Fit may be inconsistent, May shrink after washing, Fabric quality unclear, Construction unclear.",
    "Descriptions must be 1-2 short sentences, ideally 120-240 characters. Be concrete, consequence-led, and useful at purchase time.",
    "Include fashion insight where evidence supports it: feel, drape, breathability, structure, opacity, softness, ageing, care, styling, and how the fabric may sit or wear.",
    "Caveat uncertainty when evidence is limited. Missing evidence should be framed as uncertainty, not proof of poor quality.",
    "Never use internal/process language in good_signs or watch_outs: no product fit evidence, product durability evidence, 100% cotton stated, category anchors, score cannot be pushed, retrieved evidence, based on scraped data, guardrails, backend, source data, or model wording.",
    "Each dimension verdict must explain WHY the score is what it is, not merely restate the product: mention material trade-offs, construction signals expected for the category, market price context, and what prevents a higher score.",
    "For value, compare the observed price to a realistic market lane such as budget, high-street, mid-premium, premium, or luxury, using the supplied market_context and approved examples.",
    "For ratings below 7.0, include at least one concrete limitation. For ratings above 7.0, include why it beats the average and what caveat remains.",
    "Do not use generic filler like 'construction quality cannot be fully verified from images' unless you specify the exact missing evidence, e.g. seam close-up, button attachment, collar/placket structure, lining, sole attachment, stitch regularity, edge finishing.",
    "Do not hard-claim fibre authenticity, exact construction, leather grade, guaranteed build quality, or long-term durability from images.",
    "Treat page_evidence as first-party retailer/product-page facts only. Do not call it public or external evidence.",
    "Use external_evidence only for sources outside the current retailer domain. Exact-product outside evidence can move scores more than brand-reputation evidence.",
    "Use key_external_insights and repeated_themes as the synthesized shopper evidence layer. These should influence confidence/risk flags when Reddit/forum patterns repeat, and value expectations when editorial/category benchmarks define criteria.",
    "Use benchmark_evidence only for comparable products, price bands, or category norms; never treat benchmark/general sources as exact-product proof. Make score changes traceable in evidence_score_effects.",
    "Weak source data must cap confidence and can return not_enough_info. Confidence must be deterministic from source evidence."
  ].join("\n");
}

function buildStage6ModelInput(context: Stage6Context, fallback: Stage6Verdict) {
  return {
    product: context.payload.page.product,
    classification: context.payload.classification,
    page_evidence: context.evidencePack.pageEvidence,
    external_evidence: context.evidencePack.externalEvidence,
    benchmark_evidence: context.evidencePack.benchmarkEvidence,
    key_external_insights: context.evidencePack.keyExternalInsights,
    repeated_themes: context.evidencePack.repeatedThemes,
    conflicting_evidence: context.evidencePack.conflictingEvidence,
    evidence_gaps: context.evidencePack.evidenceGaps,
    cross_source_themes: context.evidencePack.crossSourceThemes,
    external_coverage: context.evidencePack.externalCoverage,
    public_evidence: context.evidencePack.publicEvidence,
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
  const shopperSignal = {
    type: "object",
    additionalProperties: false,
    required: ["title", "description", "evidence_type", "confidence"],
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      evidence_type: { enum: ["material", "price", "reviews", "construction", "fit", "durability", "style", "brand", "other"] },
      confidence: { enum: ["high", "medium", "low"] }
    }
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["overall_rating", "recommendation", "recommendation_summary", "scores", "confidence_label", "good_signs", "watch_outs", "verdicts", "reasoning_flags", "matched_examples", "evidence_score_effects", "summary"],
    properties: {
      overall_rating: { type: "number" },
      recommendation: { enum: ["strong_buy", "buy", "consider", "reconsider", "overpriced", "avoid", "not_enough_info"] },
      recommendation_summary: { type: "string" },
      scores: { type: "object", additionalProperties: false, required: Object.keys(scoreProperties), properties: scoreProperties },
      confidence_label: { enum: ["high", "medium", "low"] },
      good_signs: { type: "array", maxItems: 3, items: shopperSignal },
      watch_outs: { type: "array", maxItems: 3, items: shopperSignal },
      verdicts: {
        type: "object",
        additionalProperties: false,
        required: ["quality", "value", "durability", "aesthetic"],
        properties: { quality: dimensionVerdict, value: dimensionVerdict, durability: dimensionVerdict, aesthetic: dimensionVerdict }
      },
      reasoning_flags: { type: "array", items: { type: "string" } },
      matched_examples: { type: "array", items: { type: "string" } },
      evidence_score_effects: { type: "array", items: { type: "string" } },
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
  recommendation: Recommendation,
  brand: string,
  title: string,
  priceDisplay: string,
  url: string,
  imageUrl: string | null = null
): MatchedApprovedExample {
  return {
    id,
    category,
    material_family: materialFamily,
    brand_tier: brandTier,
    price_band: priceBandValue,
    brand,
    title,
    url,
    price_display: priceDisplay,
    image_url: imageUrl,
    score: Math.round(scores[1] * 10),
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

function textField(value: string | string[] | null): string {
  return Array.isArray(value) ? value.join("; ") : value || "";
}

function extractProductCode(value: string): string | null {
  return value.match(/\b[A-Z]{1,6}\d{2,}[A-Z0-9-]*\b/i)?.[0] || null;
}

function sourceDomain(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sameRetailerDomain(left: string, right: string): boolean {
  const leftRoot = registrableDomain(left);
  const rightRoot = registrableDomain(right);
  return Boolean(leftRoot && rightRoot && leftRoot === rightRoot);
}

function registrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  const lastThree = parts.slice(-3).join(".");
  if (/\b(?:co|com|ac|org|net|gov)\.[a-z]{2}$/.test(lastTwo)) return lastThree;
  return lastTwo;
}

function classifyEvidenceSource(url: string, text: string): PublicEvidenceSourceType {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (/reddit|styleforum|askandy|fedoralounge/.test(host)) return host.includes("reddit") ? "forum" : "forum";
  if (/review|blog|magazine|putthison|permanentstyle|ivy-style|dieworkwear/.test(`${host} ${url}`) || /\breview\b/.test(text)) return "expert_review";
  if (/shop|store|shirts|retailer|mrporter|nordstrom|amazon/.test(host)) return "retailer";
  return "brand_background";
}

function classifyEvidenceDimension(text: string): PublicEvidenceDimension {
  if (/\b(size|sizing|fits?|fit)\b/.test(text)) return /\bsizing\b/.test(text) ? "sizing" : "fit";
  if (/\b(fabric|cotton|linen|wool|material|cloth)\b/.test(text)) return "fabric";
  if (/\b(durable|last|wears?|fray|shrink|pilling)\b/.test(text)) return "durability";
  if (/\b(price|value|worth|expensive|cheap)\b/.test(text)) return "value";
  if (/\b(style|look|aesthetic|ivy|classic)\b/.test(text)) return "aesthetic";
  if (/\b(problem|issue|risk|complaint|return)\b/.test(text)) return "risk";
  return "quality";
}

function classifyEvidenceSentiment(text: string): PublicEvidenceSentiment {
  const positive = /\b(good|great|excellent|well made|quality|recommend|positive|classic|durable|comfortable)\b/.test(text);
  const negative = /\b(bad|poor|issue|problem|complaint|shrink|thin|cheap|return|negative|inconsistent)\b/.test(text);
  if (positive && negative) return "mixed";
  if (positive) return "positive";
  if (negative) return "negative";
  return "neutral";
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

function twoSentenceText(value: unknown, fallback: string, maxLength = 280): string {
  const cleaned = cleanText(value, fallback, maxLength * 2)
    .replace(/\s+/g, " ")
    .trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((item) => item.trim()).filter(Boolean) || [];
  const selected = sentences.slice(0, 2).join(" ") || fallback;
  return cleanText(selected, fallback, maxLength);
}

function cleanSignalTitle(value: unknown): string {
  const fallback = "Quality point";
  const raw = typeof value === "string" ? value.trim() : "";
  const banned = /\b(?:evidence|stated|retrieved|source|category anchors?|known fibre|product fit|external source|proof|metric)\b/i;
  const allowedEvidenceTitle = /^Quality evidence is thin$/i.test(raw);
  const candidate = raw && (!banned.test(raw) || allowedEvidenceTitle) ? raw : fallback;
  const words = candidate.split(/\s+/).filter(Boolean);
  const shortened = words.length > 5 ? words.slice(0, 5).join(" ") : candidate;
  return cleanText(shortened, fallback, 48);
}

function sentenceText(value: unknown, fallback: string, maxLength: number): string {
  const cleaned = cleanText(value, fallback, maxLength * 2);
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0]?.trim() || cleaned;
  return cleanText(firstSentence, fallback, maxLength);
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
    embeddingModel: env.QUALITY_CHECK_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
    publicEvidenceSearchEnabled: env.QUALITY_CHECK_PUBLIC_EVIDENCE_SEARCH !== "disabled"
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
