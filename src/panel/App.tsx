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
  const statusLabel = statusLabels[status];
  const lifespan = analysis ? estimateLifespan(analysis.verdict.scores.durability, monthlyWears, analysis.verdict.confidence_label) : null;

  async function handleRunCheck() {
    setStatus("extracting");
    setError(null);
    setVerdict(null);

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
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          QC
        </div>
        <div className="topbar-copy">
          <div>
            <h1>Quality Check</h1>
            {extraction?.snapshot.url ? <p>{getDomain(extraction.snapshot.url)}</p> : <p>Clothing page verdict</p>}
          </div>
          <span className={`status-pill status-pill--${status}`}>{statusLabel}</span>
        </div>
      </header>

      <section className="action-strip">
        <div>
          <p className="eyebrow">Active tab</p>
          <p>{status === "idle" ? "Extract product evidence and run the verdict." : statusDescriptions[status]}</p>
        </div>
        <button className="primary-button" type="button" onClick={handleRunCheck} disabled={status === "extracting" || status === "sending"}>
          {status === "extracting" || status === "sending" ? "Checking" : verdict ? "Refresh" : "Run check"}
        </button>
      </section>

      {error ? (
        <section className="notice notice--error">
          <h2>Check failed</h2>
          <p>{error}</p>
        </section>
      ) : null}

      {status === "extracting" || status === "sending" ? <LoadingPanel status={status} /> : null}

      {analysis ? (
        <>
          <ProductSummary title={productTitle} brand={productBrand} price={productPrice} imageUrl={productImage} classification={analysis.classification} />
          <RecommendationPanel verdict={analysis.verdict} />
          <MainVerdict verdict={analysis.verdict} />
          <ScoreSection verdict={analysis.verdict} />
          <MaterialSection classification={analysis.classification} />
          <SignalSection title="Quality signals" items={analysis.classification.quality_signals} emptyLabel="No positive quality signals found." />
          <SignalSection title="Watch-outs" items={watchOutsFor(analysis)} emptyLabel="No material watch-outs found." />
          <EvidenceSection analysis={analysis} />
          {lifespan ? (
            <LifespanSection
              monthlyWears={monthlyWears}
              onMonthlyWearsChange={setMonthlyWears}
              lifespan={lifespan}
            />
          ) : null}
          <AlternativesSection approvedExamples={analysis.approved_examples} />
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
        <EmptyState />
      ) : null}

      <section className="debug-shell">
        <button className="debug-toggle" type="button" onClick={() => setDebugOpen((open) => !open)}>
          <span>Debug evidence</span>
          <span>{debugOpen ? "Hide" : "Show"}</span>
        </button>
        {debugOpen ? (
          <DebugPanel
            extraction={extraction}
            classification={classification}
            visualEnrichment={visualEnrichment}
            verdict={verdict}
          />
        ) : null}
      </section>
    </main>
  );
}

function LoadingPanel({ status }: { status: Status }) {
  return (
    <section className="panel-section loading-section">
      <div className="spinner" aria-hidden="true" />
      <div>
        <h2>{status === "extracting" ? "Reading the product page" : "Analysing the evidence"}</h2>
        <p>{status === "extracting" ? "Collecting structured data, page text, images and source confidence." : "Sending the captured product evidence to the quality verdict backend."}</p>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="empty-state">
      <p className="eyebrow">No verdict yet</p>
      <h2>Open a clothing product page, then run the check.</h2>
      <p>The panel will show the recommendation first, then the evidence and confidence behind it.</p>
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
  const evidenceItems = [
    `Page state: ${formatLabel(analysis.product.page_state)}`,
    `Source confidence: ${analysis.product.source_confidence_label} (${analysis.product.source_confidence_score.toFixed(2)})`,
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
      <SignalList title="Reasoning flags" items={analysis.verdict.reasoning_flags.map(formatLabel)} emptyLabel="None" />
      <SignalList title="Missing image views" items={analysis.visual_enrichment.missing_views} emptyLabel="None flagged" />
    </section>
  );
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
  return (
    <section className="panel-section">
      <SectionHeader title="Other options" meta={approvedExamples.length ? "comparison anchors" : "not available yet"} />
      {approvedExamples.length ? (
        <div className="alternative-list">
          {approvedExamples.slice(0, 3).map((example) => (
            <div className="alternative-row" key={example.id}>
              <div>
                <strong>{example.id}</strong>
                <span>
                  {formatLabel(example.category)} · {formatLabel(example.material_family)} · {example.price_band}
                </span>
              </div>
              <span className="mini-grade mini-grade--positive">{gradeFor(example.expected_scores.value)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">Better alternatives are a Stage 9 storage/recommendation feature. No alternatives were returned with this verdict.</p>
      )}
    </section>
  );
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

const statusLabels: Record<Status, string> = {
  idle: "Ready",
  extracting: "Reading",
  sending: "Analysing",
  complete: "Verdict ready",
  error: "Needs attention"
};

const statusDescriptions: Record<Status, string> = {
  idle: "Extract product evidence and run the verdict.",
  extracting: "Reading the active tab.",
  sending: "Sending the evidence bundle.",
  complete: "Verdict is up to date.",
  error: "Review the error and retry."
};
