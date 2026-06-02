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
  jsonLd: unknown[];
  hydration: EvidenceSnippet[];
  targetedText: EvidenceSnippet[];
  product: ProductExtraction;
  capturedAt: string;
};

export type PageState =
  | "product_page"
  | "not_product_page"
  | "blocked_or_unavailable"
  | "error_page"
  | "site_failover"
  | "thin_page"
  | "unsupported_page";

export type SourceMethod =
  | "json_ld"
  | "meta_tags"
  | "hydration_blob"
  | "dom_targeted"
  | "visible_text_fallback"
  | "mixed";

export type ProductFieldName =
  | "title"
  | "brand"
  | "price"
  | "currency"
  | "colour"
  | "description"
  | "materials"
  | "care"
  | "construction"
  | "origin"
  | "sizing"
  | "onSiteRating"
  | "onSiteReviewCount"
  | "reviewClaims"
  | "categoryBreadcrumbs";

export type EvidenceSource =
  | "json_ld"
  | "meta_tags"
  | "hydration_blob"
  | "dom_targeted"
  | "visible_text_fallback"
  | "image_extraction";

export type EvidenceSnippet = {
  source: EvidenceSource;
  label: string;
  text: string;
};

export type ExtractedField = {
  value: string | string[] | null;
  confidence: number;
  source: EvidenceSource | null;
  evidence: string[];
};

export type ProductExtraction = {
  pageState: PageState;
  page_state: PageState;
  sourceMethod: SourceMethod;
  source_method: SourceMethod;
  sourceConfidenceScore: number;
  source_confidence_score: number;
  fields: Record<ProductFieldName, ExtractedField>;
  imageUrls: string[];
  image_urls: string[];
  warnings: string[];
};

export type ProductCategory =
  | "knitwear"
  | "shirt"
  | "t-shirt"
  | "trousers"
  | "denim"
  | "outerwear"
  | "footwear"
  | "bag"
  | "accessory"
  | "dress"
  | "skirt"
  | "activewear"
  | "other";

export type MaterialFamily = "wool" | "cotton" | "linen" | "leather" | "silk" | "synthetic" | "viscose" | "blend" | "unknown";

export type BrandTier = "budget" | "high-street" | "mid-premium" | "premium" | "luxury" | "unknown";

export type SourceConfidenceLabel = "high" | "medium" | "low";

export type LabelledInference = {
  field: keyof ProductClassification;
  value: string;
  basis:
    | "stated_on_page"
    | "inferred_from_title"
    | "inferred_from_category"
    | "inferred_from_material"
    | "inferred_from_brand"
    | "inferred_from_image"
    | "unknown";
};

export type ProductClassification = {
  category: ProductCategory;
  brand: string | null;
  brand_tier: BrandTier;
  price: string | null;
  material_family: MaterialFamily;
  primary_colour: string | null;
  style_tags: string[];
  use_case: string;
  material_description: string;
  construction_description: string;
  quality_signals: string[];
  quality_concerns: string[];
  source_confidence_score: number;
  source_confidence_label: SourceConfidenceLabel;
  labelled_inferences: LabelledInference[];
};

export type PublicEvidenceSourceType =
  | "official"
  | "customer_review"
  | "expert_review"
  | "forum"
  | "retailer"
  | "brand_background";

export type PublicEvidenceSpecificity =
  | "exact_product"
  | "same_line"
  | "same_brand_category"
  | "close_competitor"
  | "category"
  | "category_general"
  | "material_context"
  | "brand_general";

export type PublicEvidenceDimension =
  | "quality"
  | "fabric"
  | "fit"
  | "sizing"
  | "durability"
  | "value"
  | "aesthetic"
  | "risk";

export type PublicEvidenceSentiment = "positive" | "negative" | "mixed" | "neutral";

export type PublicEvidenceItem = {
  sourceType: PublicEvidenceSourceType;
  specificity: PublicEvidenceSpecificity;
  dimension: PublicEvidenceDimension;
  claim: string;
  sentiment: PublicEvidenceSentiment;
  confidence: number;
  url: string;
  quote?: string;
  date?: string;
};

export type PageEvidenceItem = {
  source_domain: string;
  source_url: string;
  claim: string;
  quote: string;
  confidence: number;
  date?: string;
};

export type ExternalEvidenceSourceType =
  | "exact_product"
  | "third_party_retailer"
  | "independent_review"
  | "similar_product"
  | "competitor_benchmark"
  | "brand_reputation"
  | "category_benchmark"
  | "material_context";

export type ExternalEvidenceCoverage = "none" | "limited" | "moderate" | "strong";

export type ExternalScoreImpact = "none" | "low" | "medium" | "high";

export type ExternalEvidenceAffects = "quality" | "value" | "durability" | "aesthetic" | "confidence";

export type ShopperEvidenceSourceType =
  | "reddit"
  | "editorial_review"
  | "retailer_listing"
  | "forum"
  | "blog"
  | "expert_guide";

export type EvidenceInsightTheme =
  | "fabric_weight"
  | "fit"
  | "shrinkage"
  | "durability"
  | "construction"
  | "price_value"
  | "brand_reputation"
  | "comfort"
  | "style";

export type ProductApplicability = "directly" | "partially" | "generally";

export type ExternalEvidenceItem = {
  source_domain: string;
  source_url: string;
  evidence_type: ExternalEvidenceSourceType;
  source_type: ShopperEvidenceSourceType;
  specificity: PublicEvidenceSpecificity;
  concrete_insight: string;
  theme: EvidenceInsightTheme;
  sentiment: PublicEvidenceSentiment;
  quote_or_snippet: string;
  applies_to_product: ProductApplicability;
  score_dimensions_affected: ExternalEvidenceAffects[];
  claim: string;
  quote: string;
  relevance_score: number;
  confidence: number;
  affects: ExternalEvidenceAffects[];
  reason_included: string;
  freshness?: string;
  date?: string;
};

export type RejectedExternalSource = {
  source_domain: string;
  source_url: string;
  evidence_type?: ExternalEvidenceSourceType | string;
  specificity?: PublicEvidenceSpecificity | string;
  claim?: string;
  reason_rejected: string;
};

export type CrossSourceTheme = {
  theme: EvidenceInsightTheme;
  summary: string;
  sentiment: PublicEvidenceSentiment;
  source_count: number;
  source_types: ShopperEvidenceSourceType[];
  specificity: PublicEvidenceSpecificity;
  applies_to_product: ProductApplicability;
  score_dimensions_affected: ExternalEvidenceAffects[];
  supporting_sources: string[];
};

export type ExternalEvidenceAgentPack = {
  external_sources_found: boolean;
  useful_sources_count: number;
  external_evidence_quality: ExternalEvidenceCoverage;
  external_score_impact: ExternalScoreImpact;
  evidence: ExternalEvidenceItem[];
  key_external_insights: string[];
  repeated_themes: CrossSourceTheme[];
  conflicting_evidence: string[];
  evidence_gaps: string[];
  cross_source_themes: CrossSourceTheme[];
  rejected_sources: RejectedExternalSource[];
};

export type VisualObservationConfidence = "high" | "medium" | "low";

export type VisualObservationEvidenceType =
  | "colour"
  | "silhouette"
  | "texture_appearance"
  | "fit_proportion"
  | "surface_detail"
  | "aesthetic_cue";

export type VisualObservation = {
  observation: string;
  confidence: VisualObservationConfidence;
  evidence_type: VisualObservationEvidenceType;
  should_affect_score: boolean;
};

export type VisualQualityDimension =
  | "material_finish"
  | "construction_finish"
  | "hardware_trim"
  | "fit_drape"
  | "surface_wear"
  | "aesthetic_refinement";

export type VisualScoreDimension = "quality" | "durability" | "aesthetic" | "confidence";

export type VisualScoreEffect =
  | "none"
  | "small_positive"
  | "small_negative"
  | "medium_positive"
  | "medium_negative";

export type VisualCue = {
  cue: string;
  evidence_type: VisualObservationEvidenceType;
  confidence: VisualObservationConfidence;
  image_limitations: string[];
};

export type ExpertVisualInference = {
  inference: string;
  quality_dimension: VisualQualityDimension;
  confidence: VisualObservationConfidence;
  basis: "inferred_from_image";
  why_it_matters: string;
  caveat: string;
  score_dimension: VisualScoreDimension;
  score_effect: VisualScoreEffect;
};

export type VisualEnrichmentStatus = "requested" | "skipped";

export type VisualEnrichment = {
  status: VisualEnrichmentStatus;
  model: string;
  fallback_model: string;
  image_urls: string[];
  observations: VisualObservation[];
  visual_cues: VisualCue[];
  expert_inferences: ExpertVisualInference[];
  missing_views: string[];
  image_quality_limits: string[];
  warnings: string[];
  prompt: string | null;
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
  analysis?: BackendAnalysis;
};

export type BackendPayload = {
  page: PageSnapshot;
  classification: ProductClassification;
  visual_enrichment: VisualEnrichment;
  extension: {
    stage: "stage_5";
    version: string;
  };
};

export type VerdictEvidenceType =
  | "stated_on_page"
  | "inferred_from_material"
  | "inferred_from_image"
  | "general_material_knowledge"
  | "similar_approved_example"
  | "unknown";

export type Recommendation =
  | "strong_buy"
  | "buy"
  | "consider"
  | "reconsider"
  | "overpriced"
  | "avoid"
  | "not_enough_info";

export type VerdictConfidence = "high" | "medium" | "low";

export type VerdictScores = {
  quality: number;
  value: number;
  durability: number;
  aesthetic: number;
  confidence: number;
};

export type DimensionVerdict = {
  verdict: string;
  confidence: VerdictConfidence;
  evidence_type: VerdictEvidenceType;
};

export type ShopperSignalMetric = "quality" | "value" | "durability" | "style";

export type ShopperSignalBasisType =
  | "product_fact"
  | "external_evidence"
  | "benchmark_evidence"
  | "category_explanation"
  | "visual_evidence"
  | "missing_evidence";

export type ShopperSignalEvidenceBasis = {
  type: ShopperSignalBasisType;
  source: string;
  claim: string;
};

export type ShopperSignal = {
  label: string;
  detail: string;
  related_metric: ShopperSignalMetric;
  category?: "material" | "value" | "durability" | "construction" | "fit" | "style" | "care" | "evidence";
  strength?: "low" | "medium" | "high";
  severity?: "low" | "medium" | "high";
  confidence: VerdictConfidence;
  evidence_basis: ShopperSignalEvidenceBasis[];
};

export type MatchedApprovedExample = {
  id: string;
  category: ProductCategory;
  material_family: MaterialFamily;
  brand_tier: BrandTier;
  price_band: string;
  brand: string;
  title: string;
  url: string;
  price_display: string;
  image_url?: string | null;
  score?: number;
  similarity: number;
  expected_scores: VerdictScores;
  recommendation: Recommendation;
};

export type Stage6Verdict = {
  overall_rating: number;
  recommendation: Recommendation;
  recommendation_summary: string;
  scores: VerdictScores;
  confidence_label: VerdictConfidence;
  good_signs: ShopperSignal[];
  watch_outs: ShopperSignal[];
  unverified: ShopperSignal[];
  verdicts: {
    quality: DimensionVerdict;
    value: DimensionVerdict;
    durability: DimensionVerdict;
    aesthetic: DimensionVerdict;
  };
  reasoning_flags: string[];
  matched_examples: string[];
  evidence_score_effects: string[];
  summary: string;
  model: string;
  model_status: "model_completed";
};

export type BackendVisualEnrichmentResult = {
  status: "completed" | "skipped";
  model: string;
  image_count: number;
  observations: VisualObservation[];
  visual_cues: VisualCue[];
  expert_inferences: ExpertVisualInference[];
  missing_views: string[];
  image_quality_limits: string[];
  warnings: string[];
};

export type BackendAnalysis = {
  stage: "stage_6";
  status: "completed" | "skipped";
  product: {
    title: string;
    url: string;
    page_state: PageState;
    source_confidence_score: number;
    source_confidence_label: SourceConfidenceLabel;
  };
  classification: ProductClassification;
  page_evidence: PageEvidenceItem[];
  external_evidence: ExternalEvidenceItem[];
  benchmark_evidence: ExternalEvidenceItem[];
  external_coverage: ExternalEvidenceCoverage;
  external_sources_found: boolean;
  useful_sources_count: number;
  external_score_impact: ExternalScoreImpact;
  rejected_sources: RejectedExternalSource[];
  key_external_insights: string[];
  repeated_themes: CrossSourceTheme[];
  conflicting_evidence: string[];
  evidence_gaps: string[];
  cross_source_themes: CrossSourceTheme[];
  external_search_diagnostics?: string[];
  external_evidence_pack?: ExternalEvidenceAgentPack;
  public_evidence: PublicEvidenceItem[];
  visual_enrichment: BackendVisualEnrichmentResult;
  verdict: Stage6Verdict;
  approved_examples: MatchedApprovedExample[];
  model_config: {
    vision_model: string;
    core_model: string;
    embedding_model: string;
    openai_configured: boolean;
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
