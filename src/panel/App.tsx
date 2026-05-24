import { useMemo, useState } from "react";
import { submitQualityCheck } from "../api/client";
import { classifyProductEvidence } from "../shared/classification";
import type {
  ActiveTabExtraction,
  BackendAnalysis,
  BackendVerdict,
  DimensionVerdict,
  MatchedApprovedExample,
  ProductClassification,
  Stage6Verdict
} from "../shared/messages";
import { createBackendPayload } from "../shared/pageSnapshot";
import { createVisualEnrichment } from "../shared/visualEnrichment";
import { requestActiveTabExtraction } from "./chromeApi";

type Status = "idle" | "extracting" | "sending" | "complete" | "error";

const DEFAULT_MONTHLY_WEARS = 8;

export function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [monthlyWears, setMonthlyWears] = useState(DEFAULT_MONTHLY_WEARS);
  const [extraction, setExtraction] = useState<ActiveTabExtraction | null>(null);
  const [verdict, setVerdict] = useState<BackendVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(isLocalDebugEnvironment());

  const classification = useMemo(
    () => (extraction ? classifyProductEvidence(extraction.snapshot.product) : null),
    [extraction]
  );
  const visualEnrichment = useMemo(
    () => (extraction && classification ? createVisualEnrichment(extraction.snapshot.product, classification) : null),
    [classification, extraction]
  );
  const analysis = verdict?.analysis ?? null;
  const productTitle =
    analysis?.product.title ||
    getFieldValue(extraction?.snapshot.product.fields.title.value) ||
    extraction?.snapshot.title ||
    "No product checked yet";
  const productBrand = analysis?.classification.brand || getFieldValue(extraction?.snapshot.product.fields.brand.value) || getDomain(extraction?.snapshot.url);
  const productPrice = analysis?.classification.price || getFieldValue(extraction?.snapshot.product.fields.price.value);
  const productImage = extraction?.snapshot.product.imageUrls[0] ?? null;
  const lifespan = analysis ? estimateLifespan(analysis.verdict.scores.durability, monthlyWears, analysis.verdict.confidence_label) : null;
  const isChecking = status === "extracting" || status === "sending";

  async function handleRunCheck() {
    setStatus("extracting");
    setError(null);

    try {
      const activeTabExtraction = await requestActiveTabExtraction();
      setExtraction(activeTabExtraction);

      setStatus("sending");
      const response = await submitQualityCheck(createBackendPayload(activeTabExtraction.snapshot));
      setVerdict(response);
      setStatus("complete");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unexpected extension error.";
      setError(message);
      setStatus("error");
    }
  }

  return (
    <main className="panel-shell">
      {error ? (
        <section className="notice notice--error">
          <h2>Check failed</h2>
          <p>{error}</p>
        </section>
      ) : null}

      {analysis ? (
        <>
          <ProductHero
            title={productTitle}
            brand={productBrand}
            price={productPrice}
            imageUrl={productImage}
            verdict={analysis.verdict}
            status={status}
            onRefresh={handleRunCheck}
            disabled={isChecking}
          />
          <DescriptionSection verdict={analysis.verdict} />
          <SignsSection title="Positive signs" tone="positive" items={placeholderGoodSigns} />
          <SignsSection title="Watch-outs" tone="negative" items={placeholderWatchOuts} />
          <AlternativesSection approvedExamples={analysis.approved_examples} />
          <HowScoresSection verdict={analysis.verdict} />
        </>
      ) : extraction && classification ? (
        <>
          <ProductSummary title={productTitle} brand={productBrand} price={productPrice} imageUrl={productImage} classification={classification} />
          <section className="notice">
            <h2>Product evidence captured</h2>
            <p>Backend verdict is not available yet. The raw extraction and structured classification are available in debug mode.</p>
          </section>
        </>
      ) : status === "idle" ? (
        <EmptyState onRunCheck={handleRunCheck} />
      ) : null}

      <section className="debug-shell">
        <button className="debug-toggle" type="button" onClick={() => setDebugOpen((open) => !open)}>
          <span>Debug evidence</span>
          <span>{debugOpen ? "Hide" : "Show"}</span>
        </button>
        {debugOpen ? (
          <div className="debug-stack">
            {analysis ? (
              <LegacyDebugSections
                analysis={analysis}
                monthlyWears={monthlyWears}
                onMonthlyWearsChange={setMonthlyWears}
                lifespan={lifespan}
              />
            ) : null}
            <DebugPanel
              extraction={extraction}
              classification={classification}
              visualEnrichment={visualEnrichment}
              verdict={verdict}
            />
          </div>
        ) : null}
      </section>
    </main>
  );
}

function EmptyState({ onRunCheck }: { onRunCheck: () => void }) {
  return (
    <section className="empty-state">
      <p className="eyebrow">No verdict yet</p>
      <h2>Open a clothing product page, then run the check.</h2>
      <p>Scouted by Thriftly reads the active product page and returns a clear clothing purchase verdict.</p>
      <button className="primary-button" type="button" onClick={onRunCheck}>
        Run check
      </button>
    </section>
  );
}

function ProductHero({
  title,
  brand,
  price,
  imageUrl,
  verdict,
  status,
  onRefresh,
  disabled
}: {
  title: string;
  brand: string;
  price: string | null;
  imageUrl: string | null;
  verdict: Stage6Verdict;
  status: Status;
  onRefresh: () => void;
  disabled: boolean;
}) {
  const score = scoreOutOf100(verdict.overall_rating);
  const tone = scoreTone(score);

  return (
    <section className="scouted-hero">
      <div className="scouted-product-image" aria-label={imageUrl ? "Product image" : "Product image unavailable"}>
        {imageUrl ? <img src={imageUrl} alt="" /> : <span>Image unavailable</span>}
      </div>
      <div className="scouted-product-copy">
        <div className="brand-line">
          <p>{brand}</p>
          <button className="refresh-button" type="button" onClick={onRefresh} disabled={disabled}>
            {status === "extracting" ? "Reading" : status === "sending" ? "Analysing" : "Refresh"}
          </button>
        </div>
        <div className="item-line">
          <h2>{title}</h2>
          {price ? <span>{price}</span> : null}
        </div>
        <div className="grade-line">
          <div className={`grade-tile grade-tile--${tone}`}>{gradeFor(verdict.overall_rating)}</div>
          <div className="grade-meta">
            <strong className={`score-text score-text--${tone}`}>{score}/100</strong>
            <span className={`recommendation-tag recommendation-tag--${verdict.recommendation}`}>{formatLabel(verdict.recommendation)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function DescriptionSection({ verdict }: { verdict: Stage6Verdict }) {
  return (
    <section className="description-section">
      <h2>{verdict.recommendation_summary}</h2>
      <p>{verdict.summary}</p>
    </section>
  );
}

type SignItem = {
  label: string;
  detail: string;
  related_metric: "quality" | "value" | "durability" | "style";
  strength?: "low" | "medium" | "high";
  severity?: "low" | "medium" | "high";
};

function SignsSection({ title, tone, items }: { title: string; tone: "positive" | "negative"; items: SignItem[] }) {
  return (
    <section className="panel-section sign-section">
      <SectionHeader title={title} />
      <div className="sign-list">
        {items.map((item) => {
          const level = item.strength ?? item.severity ?? "medium";
          return (
            <div className="sign-row" key={`${title}-${item.label}`}>
              <div className="sign-icon" aria-hidden="true">
                {metricInitial(item.related_metric)}
              </div>
              <div>
                <strong>{item.label}</strong>
                <p>{item.detail}</p>
              </div>
              <span className={`signal-dot signal-dot--${tone}-${level}`} aria-label={`${level} ${tone} signal`} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProductSummary({
  title,
  brand,
  price,
  imageUrl,
  classification
}: {
  title: string;
  brand: string;
  price: string | null;
  imageUrl: string | null;
  classification: ProductClassification;
}) {
  return (
    <section className="product-summary">
      <div className="product-image" aria-label={imageUrl ? "Product image" : "Product image unavailable"}>
        {imageUrl ? <img src={imageUrl} alt="" /> : <span>Image unavailable</span>}
      </div>
      <div className="product-copy">
        <p className="eyebrow">
          {brand}
          {price ? ` · ${price}` : ""}
        </p>
        <h2>{title}</h2>
        <div className="tag-row">
          <span>{formatLabel(classification.category)}</span>
          <span>{formatLabel(classification.material_family)}</span>
          <span>{formatLabel(classification.brand_tier)}</span>
        </div>
      </div>
    </section>
  );
}

function RecommendationPanel({ verdict }: { verdict: Stage6Verdict }) {
  return (
    <section className={`recommendation-card recommendation-card--${verdict.recommendation}`}>
      <div className="rating-mark">{gradeFor(verdict.overall_rating)}</div>
      <div>
        <p className="recommendation-label">
          {formatLabel(verdict.recommendation)} · {verdict.overall_rating.toFixed(1)}/10 · {verdict.confidence_label} confidence
        </p>
        <h2>{verdict.recommendation_summary}</h2>
        <p>{verdict.summary}</p>
      </div>
    </section>
  );
}

function MainVerdict({ verdict }: { verdict: Stage6Verdict }) {
  return (
    <section className="panel-section verdict-section">
      <SectionHeader title="Verdict" meta={`${Math.round(verdict.scores.confidence * 100)}% confidence`} />
      <p>{verdict.summary || verdict.recommendation_summary}</p>
    </section>
  );
}

function ScoreSection({ verdict }: { verdict: Stage6Verdict }) {
  return (
    <section className="panel-section">
      <SectionHeader title="Scores" meta="tap a row to expand" />
      <div className="score-list">
        <ScoreRow title="Quality" score={verdict.scores.quality} verdict={verdict.verdicts.quality} />
        <ScoreRow title="Value" score={verdict.scores.value} verdict={verdict.verdicts.value} />
        <ScoreRow title="Durability" score={verdict.scores.durability} verdict={verdict.verdicts.durability} />
        <ScoreRow title="Aesthetic" score={verdict.scores.aesthetic} verdict={verdict.verdicts.aesthetic} />
      </div>
    </section>
  );
}

function ScoreRow({ title, score, verdict }: { title: string; score: number; verdict: DimensionVerdict }) {
  return (
    <details className="score-row" open={title === "Quality"}>
      <summary>
        <span>{title}</span>
        <span className="score-row-preview">{truncate(verdict.verdict, 46)}</span>
        <span className={`mini-grade mini-grade--${gradeTone(score)}`}>{gradeFor(score)}</span>
        <strong>{score.toFixed(1)}</strong>
      </summary>
      <div className="score-row-body">
        <Meter value={score} max={10} />
        <p>{verdict.verdict}</p>
        <div className="tag-row">
          <span>{verdict.confidence} confidence</span>
          <span>{formatLabel(verdict.evidence_type)}</span>
        </div>
      </div>
    </details>
  );
}

function MaterialSection({ classification }: { classification: ProductClassification }) {
  return (
    <section className="panel-section">
      <SectionHeader title="Material notes" meta={classification.source_confidence_label} />
      <Field label="Composition" value={classification.material_description} />
      <Field label="Construction" value={classification.construction_description} />
      <Field label="Use case" value={classification.use_case} />
    </section>
  );
}

function SignalSection({ title, items, emptyLabel }: { title: string; items: string[]; emptyLabel: string }) {
  return (
    <section className="panel-section">
      <SectionHeader title={title} />
      {items.length ? (
        <ul className="signal-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">{emptyLabel}</p>
      )}
    </section>
  );
}

function EvidenceSection({ analysis }: { analysis: BackendAnalysis }) {
  const externalDomains = [
    ...analysis.external_evidence.map((item) => item.source_domain),
    ...analysis.benchmark_evidence.map((item) => item.source_domain)
  ].filter((domain, index, domains) => domain && domains.indexOf(domain) === index);
  const evidenceItems = [
    `Page state: ${formatLabel(analysis.product.page_state)}`,
    `Source confidence: ${analysis.product.source_confidence_label} (${analysis.product.source_confidence_score.toFixed(2)})`,
    `External evidence: ${formatExternalEvidenceQuality(analysis)}`,
    `External score impact: ${analysis.external_score_impact}`,
    `Source domains: ${externalDomains.length ? externalDomains.join(", ") : "none"}`,
    `Vision: ${analysis.visual_enrichment.status} · ${analysis.visual_enrichment.image_count} images`,
    `Model: ${analysis.verdict.model} · ${formatLabel(analysis.verdict.model_status)}`
  ];

  return (
    <section className="panel-section">
      <SectionHeader title="Evidence and confidence" meta={analysis.verdict.confidence_label} />
      <div className="metric-grid">
        {evidenceItems.map((item) => (
          <div className="metric" key={item}>
            {item}
          </div>
        ))}
      </div>
      <SignalList title="Page facts" items={analysis.page_evidence.map((item) => item.claim)} emptyLabel="No first-party page facts captured" />
      <SignalList title="Outside evidence" items={formatExternalInsightItems(analysis)} emptyLabel="No useful external insights found" />
      <SignalList title="Repeated themes" items={analysis.repeated_themes.map((item) => `${formatLabel(item.theme)}: ${item.summary}`)} emptyLabel="No repeated external themes found" />
      <SignalList title="Conflicting evidence" items={analysis.conflicting_evidence} emptyLabel="No conflicts found" />
      <SignalList title="Evidence gaps" items={analysis.evidence_gaps} emptyLabel="No evidence gaps flagged" />
      <SignalList title="Rejected sources" items={analysis.rejected_sources.map((item) => `${item.source_domain || "unknown"}: ${item.reason_rejected}`)} emptyLabel="No rejected sources returned" />
      <SignalList title="Reasoning flags" items={analysis.verdict.reasoning_flags.map(formatLabel)} emptyLabel="None" />
      <SignalList title="Missing image views" items={analysis.visual_enrichment.missing_views} emptyLabel="None flagged" />
    </section>
  );
}

function formatExternalInsightItems(analysis: BackendAnalysis): string[] {
  const synthesized = analysis.key_external_insights.map((item) => `External insight: ${item}`);
  const perSource = [...analysis.external_evidence, ...analysis.benchmark_evidence].map((item) => {
    const applies = item.applies_to_product === "directly" ? "direct" : item.applies_to_product === "partially" ? "partial" : "general";
    const dimensions = item.score_dimensions_affected.length ? item.score_dimensions_affected.map(formatLabel).join(", ") : "confidence";
    return `${item.source_domain} · ${formatLabel(item.source_type)} · ${formatLabel(item.theme)} · ${applies}: ${item.concrete_insight} (${dimensions})`;
  });
  return [...synthesized, ...perSource].slice(0, 12);
}

function formatExternalEvidenceQuality(analysis: BackendAnalysis): string {
  if (analysis.external_coverage === "none") return "none";
  return `${analysis.external_coverage} (${analysis.useful_sources_count} useful)`;
}

function LifespanSection({
  monthlyWears,
  onMonthlyWearsChange,
  lifespan
}: {
  monthlyWears: number;
  onMonthlyWearsChange: (value: number) => void;
  lifespan: LifespanEstimate;
}) {
  return (
    <section className="panel-section">
      <SectionHeader title="Estimated lifespan" meta="rough estimate" />
      <div className="lifespan-result">
        <strong>{lifespan.label}</strong>
        <span>{lifespan.confidence} confidence</span>
      </div>
      <label className="slider-label" htmlFor="monthly-wears">
        <span>Monthly wears</span>
        <strong>{monthlyWears}</strong>
      </label>
      <input
        id="monthly-wears"
        type="range"
        min="1"
        max="30"
        value={monthlyWears}
        onChange={(event) => onMonthlyWearsChange(Number(event.target.value))}
      />
      <ul className="assumption-list">
        {lifespan.assumptions.map((assumption) => (
          <li key={assumption}>{assumption}</li>
        ))}
      </ul>
    </section>
  );
}

function AlternativesSection({ approvedExamples }: { approvedExamples: MatchedApprovedExample[] }) {
  const alternatives = placeholderAlternatives.map((alternative, index) => {
    const approvedExample = approvedExamples[index];
    return approvedExample
      ? {
          ...alternative,
          rating: scoreOutOf100(approvedExample.expected_scores.value),
          itemName: `${formatLabel(approvedExample.material_family)} ${formatLabel(approvedExample.category)}`,
          price: approvedExample.price_band
        }
      : alternative;
  });

  return (
    <section className="panel-section alternatives-section">
      <SectionHeader title="Alternatives" />
      <div className="alternative-list">
        {alternatives.slice(0, 2).map((alternative) => (
          <AlternativeRow key={alternative.url} alternative={alternative} />
        ))}
      </div>
      {alternatives.length > 2 ? (
        <details className="view-more">
          <summary>View more</summary>
          <div className="alternative-list">
            {alternatives.slice(2).map((alternative) => (
              <AlternativeRow key={alternative.url} alternative={alternative} />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function AlternativeRow({ alternative }: { alternative: AlternativeItem }) {
  const tone = scoreTone(alternative.rating);

  return (
    <a className="alternative-row" href={alternative.url} target="_blank" rel="noreferrer">
      <div className="alternative-thumb">
        {alternative.thumbnail ? <img src={alternative.thumbnail} alt="" /> : <span />}
      </div>
      <div className="alternative-copy">
        <span>{alternative.brand}</span>
        <strong>{alternative.itemName}</strong>
      </div>
      <div className="alternative-score">
        <span>{alternative.price}</span>
        <strong className={`score-text score-text--${tone}`}>{alternative.rating}/100</strong>
      </div>
      <span className="chevron" aria-hidden="true" />
    </a>
  );
}

function HowScoresSection({ verdict }: { verdict: Stage6Verdict }) {
  const rows = [
    { title: "Quality", score: verdict.scores.quality, verdict: verdict.verdicts.quality },
    { title: "Value", score: verdict.scores.value, verdict: verdict.verdicts.value },
    { title: "Durability", score: verdict.scores.durability, verdict: verdict.verdicts.durability },
    { title: "Style", score: verdict.scores.aesthetic, verdict: verdict.verdicts.aesthetic }
  ];

  return (
    <section className="panel-section score-explainer">
      <SectionHeader title="How scores are calculated" />
      <div className="score-card-list">
        {rows.map((row) => {
          const score = scoreOutOf100(row.score);
          const tone = scoreTone(score);
          return (
            <details className="score-card" key={row.title} open={row.title === "Quality"}>
              <summary>
                <span>{row.title}</span>
                <span>
                  <strong className={`score-text score-text--${tone}`}>{score}/100</strong>
                  <span className="chevron" aria-hidden="true" />
                </span>
              </summary>
              <p>{row.verdict.verdict}</p>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function LegacyDebugSections({
  analysis,
  monthlyWears,
  onMonthlyWearsChange,
  lifespan
}: {
  analysis: BackendAnalysis;
  monthlyWears: number;
  onMonthlyWearsChange: (value: number) => void;
  lifespan: LifespanEstimate | null;
}) {
  return (
    <div className="legacy-debug">
      <p className="debug-label">Previous components</p>
      <MainVerdict verdict={analysis.verdict} />
      <ScoreSection verdict={analysis.verdict} />
      <MaterialSection classification={analysis.classification} />
      <SignalSection title="Quality signals" items={analysis.classification.quality_signals} emptyLabel="No positive quality signals found." />
      <SignalSection title="Watch-outs" items={watchOutsFor(analysis)} emptyLabel="No material watch-outs found." />
      <EvidenceSection analysis={analysis} />
      {lifespan ? (
        <LifespanSection
          monthlyWears={monthlyWears}
          onMonthlyWearsChange={onMonthlyWearsChange}
          lifespan={lifespan}
        />
      ) : null}
    </div>
  );
}

type AlternativeItem = {
  brand: string;
  itemName: string;
  price: string;
  rating: number;
  url: string;
  thumbnail: string | null;
};

const placeholderGoodSigns: SignItem[] = [
  {
    label: "100% cotton",
    detail: "Natural single-fibre material, generally a good sign for comfort and breathability.",
    related_metric: "quality",
    strength: "high"
  },
  {
    label: "Fair price",
    detail: "The listed price looks reasonable for a cotton Oxford shirt from a high-street retailer.",
    related_metric: "value",
    strength: "medium"
  }
];

const placeholderWatchOuts: SignItem[] = [
  {
    label: "Limited construction detail",
    detail: "No clear evidence on fabric weight, stitching, seams, buttons, or collar structure.",
    related_metric: "durability",
    severity: "medium"
  },
  {
    label: "Not premium evidence",
    detail: "The page supports a solid basic shirt, but not a premium-quality verdict.",
    related_metric: "quality",
    severity: "low"
  }
];

const placeholderAlternatives: AlternativeItem[] = [
  {
    brand: "Uniqlo",
    itemName: "Oxford Slim Fit Long Sleeved Shirt",
    price: "£29.90",
    rating: 74,
    url: "https://www.uniqlo.com/",
    thumbnail: null
  },
  {
    brand: "Arket",
    itemName: "Oxford Shirt",
    price: "£59",
    rating: 78,
    url: "https://www.arket.com/",
    thumbnail: null
  },
  {
    brand: "Charles Tyrwhitt",
    itemName: "Non-Iron Oxford Shirt",
    price: "£39.75",
    rating: 72,
    url: "https://www.charlestyrwhitt.com/",
    thumbnail: null
  },
  {
    brand: "Mango",
    itemName: "Regular-Fit Cotton Shirt",
    price: "£35.99",
    rating: 66,
    url: "https://shop.mango.com/",
    thumbnail: null
  }
];

function metricInitial(metric: SignItem["related_metric"]): string {
  const initials: Record<SignItem["related_metric"], string> = {
    quality: "Q",
    value: "V",
    durability: "D",
    style: "S"
  };
  return initials[metric];
}

function scoreOutOf100(score: number): number {
  return Math.round(score * 10);
}

function scoreTone(score: number): "positive" | "neutral" | "warning" {
  if (score >= 72) return "positive";
  if (score >= 55) return "neutral";
  return "warning";
}

function DebugPanel({
  extraction,
  classification,
  visualEnrichment,
  verdict
}: {
  extraction: ActiveTabExtraction | null;
  classification: ProductClassification | null;
  visualEnrichment: unknown;
  verdict: BackendVerdict | null;
}) {
  const debugPayload = {
    extracted_facts: extraction?.snapshot.product.fields ?? null,
    quality_signals: classification?.quality_signals ?? [],
    page_evidence: verdict?.analysis?.page_evidence ?? [],
    external_evidence: verdict?.analysis?.external_evidence ?? [],
    benchmark_evidence: verdict?.analysis?.benchmark_evidence ?? [],
    external_coverage: verdict?.analysis?.external_coverage ?? "none",
    external_sources_found: verdict?.analysis?.external_sources_found ?? false,
    useful_sources_count: verdict?.analysis?.useful_sources_count ?? 0,
    external_score_impact: verdict?.analysis?.external_score_impact ?? "none",
    rejected_sources: verdict?.analysis?.rejected_sources ?? [],
    key_external_insights: verdict?.analysis?.key_external_insights ?? [],
    repeated_themes: verdict?.analysis?.repeated_themes ?? [],
    conflicting_evidence: verdict?.analysis?.conflicting_evidence ?? [],
    evidence_gaps: verdict?.analysis?.evidence_gaps ?? [],
    cross_source_themes: verdict?.analysis?.cross_source_themes ?? [],
    external_search_diagnostics: verdict?.analysis?.external_search_diagnostics ?? [],
    external_evidence_pack: verdict?.analysis?.external_evidence_pack ?? null,
    external_source_domains: [
      ...(verdict?.analysis?.external_evidence ?? []).map((item) => item.source_domain),
      ...(verdict?.analysis?.benchmark_evidence ?? []).map((item) => item.source_domain)
    ].filter((domain, index, domains) => domain && domains.indexOf(domain) === index),
    public_evidence: verdict?.analysis?.public_evidence ?? [],
    evidence_score_effects: verdict?.analysis?.verdict.evidence_score_effects ?? [],
    extraction,
    classification,
    visual_enrichment: visualEnrichment,
    backend_response: verdict
  };

  return (
    <div className="debug-panel">
      <p>
        Shows the underlying extraction, classification, visual guardrails and backend response. This opens by default in local/dev builds.
      </p>
      <pre>{JSON.stringify(debugPayload, null, 2)}</pre>
    </div>
  );
}

function SectionHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {meta ? <span>{meta}</span> : null}
    </div>
  );
}

function SignalList({ title, items, emptyLabel }: { title: string; items: string[]; emptyLabel: string }) {
  return (
    <div className="sub-list">
      <p className="eyebrow">{title}</p>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">{emptyLabel}</p>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="field-row">
      <span>{label}</span>
      <p>{value || "Not found"}</p>
    </div>
  );
}

function Meter({ value, max }: { value: number; max: number }) {
  const percentage = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="meter" aria-hidden="true">
      <span style={{ width: `${percentage}%` }} />
    </div>
  );
}

type LifespanEstimate = {
  label: string;
  confidence: "low" | "medium";
  assumptions: string[];
};

function estimateLifespan(durability: number, monthlyWears: number, verdictConfidence: string): LifespanEstimate {
  const baselineWears = Math.max(45, durability * 35);
  const years = baselineWears / Math.max(1, monthlyWears) / 12;
  const lowYears = Math.max(0.5, years * 0.75);
  const highYears = Math.max(lowYears + 0.5, years * 1.25);
  const label = `${formatYearRange(lowYears)}-${formatYearRange(highYears)} years`;

  return {
    label,
    confidence: verdictConfidence === "high" && durability >= 6 ? "medium" : "low",
    assumptions: ["normal care", "rotated with other clothing", "not worn in harsh conditions"]
  };
}

function formatYearRange(value: number): string {
  if (value < 1) return "<1";
  if (value < 2) return value.toFixed(1);
  return String(Math.round(value));
}

function watchOutsFor(analysis: BackendAnalysis): string[] {
  return [
    ...analysis.classification.quality_concerns,
    ...analysis.verdict.reasoning_flags.map(formatLabel),
    ...analysis.visual_enrichment.warnings,
    ...analysis.visual_enrichment.image_quality_limits
  ].filter(Boolean);
}

function getFieldValue(value: string | string[] | null | undefined): string | null {
  if (Array.isArray(value)) return value.filter(Boolean).join(" · ") || null;
  return value || null;
}

function getDomain(url: string | undefined): string {
  if (!url) return "unknown retailer";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown retailer";
  }
}

function gradeFor(score: number): string {
  if (score >= 8.5) return "A";
  if (score >= 7.5) return "A-";
  if (score >= 6.5) return "B+";
  if (score >= 5.5) return "B";
  if (score >= 4.5) return "C";
  return "D";
}

function gradeTone(score: number): "positive" | "neutral" | "warning" {
  if (score >= 7.2) return "positive";
  if (score >= 5.5) return "neutral";
  return "warning";
}

function formatLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function isLocalDebugEnvironment(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof chrome === "undefined" || !chrome.runtime?.getManifest) return true;
  const manifest = chrome.runtime.getManifest();
  return !("update_url" in manifest);
}
