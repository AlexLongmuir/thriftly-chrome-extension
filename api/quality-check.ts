import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  BackendAnalysis,
  BackendPayload,
  BackendVerdict,
  ExpertVisualInference,
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

type ParsedVisionResult = {
  observations: VisualObservation[];
  visual_cues: VisualCue[];
  expert_inferences: ExpertVisualInference[];
  missing_views: string[];
  image_quality_limits: string[];
};

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
  const analysis: BackendAnalysis = {
    stage: "stage_5",
    status: visualCompleted ? "completed" : "skipped",
    product: {
      title,
      url: payload.page.url,
      page_state: payload.page.product.page_state,
      source_confidence_score: payload.page.product.source_confidence_score,
      source_confidence_label: payload.classification.source_confidence_label
    },
    classification: payload.classification,
    visual_enrichment: {
      status: visualCompleted ? "completed" : "skipped",
      model: env.visionModel,
      image_count: imageUrls.length,
      observations,
      visual_cues: visualCues,
      expert_inferences: expertInferences,
      missing_views: uniqueStrings(missingViews).slice(0, 8),
      image_quality_limits: uniqueStrings(imageQualityLimits).slice(0, 8),
      warnings: uniqueStrings(warnings)
    },
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
    "Also include visual_cues, expert_inferences, missing_views, and image_quality_limits.",
    "Prefer diagnostic shopper cues with caveats over obvious captions.",
    "Be sceptical: clean studio photos and absence of visible defects are neutral, not evidence of good construction.",
    "Styling details such as lining, trim, and standard buttons are aesthetic only; do not use them to imply construction quality, durability, or value.",
    "Allowed: colour, silhouette, texture appearance, fit/proportion cues, surface details, aesthetic cues, visible finishing cues.",
    "Forbidden as hard claims from images alone: fabric quality, exact construction, authenticity, durability."
  ].join("\n");
}

function buildSummary(analysis: BackendAnalysis): string {
  const visual = analysis.visual_enrichment;
  if (visual.status === "completed") {
    return `Stage 5 visual enrichment completed for "${analysis.product.title}" with ${visual.observations.length} guarded observation(s).`;
  }
  return `Stage 5 payload accepted for "${analysis.product.title}"; visual enrichment skipped safely.`;
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
