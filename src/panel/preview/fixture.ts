import type {
  ActiveTabExtraction,
  BackendVerdict,
  ExtractedField,
  MatchedApprovedExample,
  ProductExtraction,
  ProductFieldName,
  ShopperSignal
} from "../../shared/messages";
import productImage from "../assets/arket-white-linen-shirt.avif";

function field(value: string | string[] | null, confidence: number): ExtractedField {
  return { value, confidence, source: value ? "json_ld" : null, evidence: value ? ["JSON-LD Product"] : [] };
}

const emptyFieldNames: ProductFieldName[] = [
  "currency",
  "colour",
  "description",
  "care",
  "construction",
  "origin",
  "sizing",
  "onSiteRating",
  "onSiteReviewCount",
  "reviewClaims",
  "categoryBreadcrumbs"
];

const fields = {
  title: field("Relaxed Linen Shirt", 0.96),
  brand: field("ARKET", 0.94),
  price: field("£87", 0.93),
  materials: field("100% linen", 0.9),
  ...Object.fromEntries(emptyFieldNames.map((name) => [name, field(null, 0)]))
} as ProductExtraction["fields"];

const product: ProductExtraction = {
  pageState: "product_page",
  page_state: "product_page",
  sourceMethod: "json_ld",
  source_method: "json_ld",
  sourceConfidenceScore: 0.88,
  source_confidence_score: 0.88,
  fields,
  imageUrls: [productImage],
  image_urls: [productImage],
  warnings: []
};

export const fixtureExtraction: ActiveTabExtraction = {
  tabId: 1,
  tabUrl: "https://www.arket.com/en_gbp/men/shirts/product.relaxed-linen-shirt-white.html",
  snapshot: {
    url: "https://www.arket.com/en_gbp/men/shirts/product.relaxed-linen-shirt-white.html",
    title: "Relaxed Linen Shirt - White - ARKET GB",
    visibleText: "Relaxed Linen Shirt. A relaxed-fit shirt cut from airy European linen.",
    meta: {},
    jsonLd: [],
    hydration: [],
    targetedText: [],
    product,
    capturedAt: new Date().toISOString()
  }
};

const goodSigns: ShopperSignal[] = [
  {
    label: "Pure European linen",
    detail: "100% linen with no synthetic fill — breathable, naturally durable and right for the price point.",
    related_metric: "quality",
    category: "material",
    confidence: "high",
    evidence_basis: [{ type: "product_fact", source: "page", claim: "100% linen stated on page" }]
  },
  {
    label: "Fair price for the fabric",
    detail: "Comparable 100% linen shirts from mid-premium brands sit at £90–£120.",
    related_metric: "value",
    category: "value",
    confidence: "medium",
    evidence_basis: [{ type: "benchmark_evidence", source: "category benchmark", claim: "linen shirt price band" }]
  },
  {
    label: "Clean seam finishing",
    detail: "Product photos show flat-felled seams and even topstitching at the collar and cuffs.",
    related_metric: "quality",
    category: "construction",
    confidence: "medium",
    evidence_basis: [{ type: "visual_evidence", source: "images", claim: "flat-felled seams visible" }]
  }
];

const watchOuts: ShopperSignal[] = [
  {
    label: "Creases like all linen",
    detail: "Expect visible wrinkling after an hour of wear — part of the fabric, but worth knowing.",
    related_metric: "quality",
    category: "care",
    confidence: "high",
    evidence_basis: [{ type: "category_explanation", source: "material knowledge", claim: "linen creases readily" }]
  },
  {
    label: "Boxy through the shoulders",
    detail: "Several buyers mention the relaxed cut runs wide; consider sizing down if between sizes.",
    related_metric: "style",
    category: "fit",
    confidence: "medium",
    evidence_basis: [{ type: "external_evidence", source: "reviews", claim: "runs wide in shoulders" }]
  }
];

const unverified: ShopperSignal[] = [
  {
    label: "Long-term colour fastness",
    detail: "No wash-test evidence found for this exact shirt, so colour hold after repeated washes is unconfirmed.",
    related_metric: "durability",
    category: "evidence",
    confidence: "low",
    evidence_basis: [{ type: "missing_evidence", source: "search", claim: "no wash-test reviews found" }]
  }
];

const alternatives: MatchedApprovedExample[] = [
  {
    id: "alt-1",
    category: "shirt",
    material_family: "linen",
    brand_tier: "mid-premium",
    price_band: "£80-£120",
    brand: "COS",
    title: "Linen Long-Sleeve Shirt",
    url: "https://www.cos.com/example",
    price_display: "£79",
    image_url: productImage,
    score: 84,
    similarity: 0.91,
    expected_scores: { quality: 8.2, value: 8.4, durability: 7.8, aesthetic: 8.1, confidence: 0.8 },
    recommendation: "worth_buying"
  },
  {
    id: "alt-2",
    category: "shirt",
    material_family: "linen",
    brand_tier: "premium",
    price_band: "£100-£150",
    brand: "Sunspel",
    title: "Cotton-Linen Overshirt",
    url: "https://www.sunspel.com/example",
    price_display: "£135",
    image_url: null,
    score: 86,
    similarity: 0.84,
    expected_scores: { quality: 8.8, value: 7.4, durability: 8.3, aesthetic: 8.5, confidence: 0.82 },
    recommendation: "excellent_pick"
  },
  {
    id: "alt-3",
    category: "shirt",
    material_family: "linen",
    brand_tier: "high-street",
    price_band: "£30-£60",
    brand: "Uniqlo",
    title: "Premium Linen Shirt",
    url: "https://www.uniqlo.com/example",
    price_display: "£35",
    image_url: productImage,
    score: 76,
    similarity: 0.82,
    expected_scores: { quality: 7.1, value: 8.9, durability: 7.0, aesthetic: 7.4, confidence: 0.78 },
    recommendation: "worth_buying"
  }
];

export const fixtureVerdict: BackendVerdict = {
  requestId: "preview-1",
  summary: "Stage 6 verdict completed.",
  receivedUrl: fixtureExtraction.snapshot.url,
  source: "backend",
  capturedTitle: fixtureExtraction.snapshot.title,
  analysis: {
    stage: "stage_6",
    status: "completed",
    product: {
      title: "Relaxed Linen Shirt",
      url: fixtureExtraction.snapshot.url,
      page_state: "product_page",
      source_confidence_score: 0.88,
      source_confidence_label: "high"
    },
    classification: {
      category: "shirt",
      brand: "ARKET",
      brand_tier: "mid-premium",
      price: "£87",
      material_family: "linen",
      primary_colour: "white",
      style_tags: ["relaxed", "summer", "minimal"],
      use_case: "warm-weather casual",
      material_description: "100% European linen.",
      construction_description: "Flat-felled seams, single-button cuffs.",
      quality_signals: ["stated on page: 100% linen"],
      quality_concerns: [],
      source_confidence_score: 0.88,
      source_confidence_label: "high",
      labelled_inferences: []
    },
    page_evidence: [
      {
        source_domain: "arket.com",
        source_url: fixtureExtraction.snapshot.url,
        claim: "100% linen stated on page",
        quote: "100% linen",
        confidence: 0.95
      }
    ],
    external_evidence: [],
    benchmark_evidence: [],
    external_coverage: "moderate",
    external_sources_found: true,
    useful_sources_count: 4,
    external_score_impact: "low",
    rejected_sources: [],
    key_external_insights: ["Buyers consistently praise the fabric weight for summer."],
    repeated_themes: [],
    conflicting_evidence: [],
    evidence_gaps: ["No long-term wash-test evidence for this exact shirt."],
    cross_source_themes: [],
    public_evidence: [],
    visual_enrichment: {
      status: "completed",
      model: "gemini-3.0-flash",
      image_count: 1,
      observations: [],
      visual_cues: [],
      expert_inferences: [],
      missing_views: [],
      image_quality_limits: [],
      warnings: []
    },
    verdict: {
      overall_rating: 7.8,
      recommendation: "worth_buying",
      recommendation_summary: "A real linen shirt at a fair price — you'll just be ironing it.",
      scores: { quality: 7.9, value: 8.2, durability: 7.2, aesthetic: 7.8, confidence: 0.82 },
      confidence_label: "high",
      good_signs: goodSigns,
      watch_outs: watchOuts,
      unverified,
      verdicts: {
        quality: {
          verdict: "Pure linen with clean visible finishing puts this above most high-street equivalents.",
          confidence: "high",
          evidence_type: "stated_on_page"
        },
        value: {
          verdict: "At £87 it sits below the typical £90–£120 band for comparable 100% linen shirts.",
          confidence: "medium",
          evidence_type: "similar_approved_example"
        },
        durability: {
          verdict: "Linen is naturally hard-wearing, but long-term wash evidence for this shirt is missing.",
          confidence: "medium",
          evidence_type: "general_material_knowledge"
        },
        aesthetic: {
          verdict: "Relaxed minimal cut that matches current styling; the boxy shoulder is the one polarising note.",
          confidence: "medium",
          evidence_type: "inferred_from_image"
        }
      },
      reasoning_flags: [],
      matched_examples: ["alt-1", "alt-2"],
      evidence_score_effects: [],
      summary:
        "A genuinely well-made linen shirt at a price slightly under its peers. The fabric and finishing are the draw; the relaxed cut and linen's creasing are the trade-offs.",
      model: "gpt-5.4-mini",
      model_status: "model_completed"
    },
    approved_examples: alternatives,
    timings_ms: {
      total_backend: 6400,
      visual_enrichment: 1800,
      external_evidence: 3200,
      stage6_verdict: 1400
    },
    model_config: {
      vision_model: "gemini-3.0-flash",
      core_model: "gpt-5.4-mini",
      embedding_model: "text-embedding-3-small",
      openai_configured: true
    }
  }
};
