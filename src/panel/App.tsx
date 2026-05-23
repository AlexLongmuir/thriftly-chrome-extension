import { useMemo, useState } from "react";
import { submitQualityCheck } from "../api/client";
import { classifyProductEvidence } from "../shared/classification";
import type {
  ActiveTabExtraction,
  BackendVerdict,
  DimensionVerdict,
  MatchedApprovedExample,
  ProductClassification,
  ProductFieldName,
  Stage6Verdict
} from "../shared/messages";
import { createBackendPayload } from "../shared/pageSnapshot";
import { createVisualEnrichment } from "../shared/visualEnrichment";
import { requestActiveTabExtraction } from "./chromeApi";

type Status = "idle" | "extracting" | "sending" | "complete" | "error";

export function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [extraction, setExtraction] = useState<ActiveTabExtraction | null>(null);
  const [verdict, setVerdict] = useState<BackendVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusLabel = useMemo(() => {
    if (status === "extracting") return "Reading active tab";
    if (status === "sending") return "Sending extraction payload";
    if (status === "complete") return "Verdict ready";
    if (status === "error") return "Needs attention";
    return "Ready";
  }, [status]);
  const classification = useMemo(
    () => (extraction ? classifyProductEvidence(extraction.snapshot.product) : null),
    [extraction]
  );
  const visualEnrichment = useMemo(
    () => (extraction && classification ? createVisualEnrichment(extraction.snapshot.product, classification) : null),
    [classification, extraction]
  );

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
      <header className="panel-header">
        <div>
          <p className="eyebrow">Quality Check</p>
          <h1>Quality verdict</h1>
        </div>
        <span className={`status-pill status-pill--${status}`}>{statusLabel}</span>
      </header>

      <section className="primary-panel">
        <p className="panel-copy">
          Extract product evidence from the active tab, run guarded visual enrichment, and return an evidence-labelled Stage 6 verdict.
        </p>
        <button className="primary-button" type="button" onClick={handleRunCheck} disabled={status === "extracting" || status === "sending"}>
          {status === "extracting" || status === "sending" ? "Checking..." : "Run page check"}
        </button>
      </section>

      {error ? (
        <section className="message-block message-block--error">
          <h2>Error</h2>
          <p>{error}</p>
        </section>
      ) : null}

      {extraction ? (
        <section className="message-block">
          <h2>Extracted evidence</h2>
          <dl className="details-list">
            <div>
              <dt>Page state</dt>
              <dd>{extraction.snapshot.product.pageState}</dd>
            </div>
            <div>
              <dt>Source method</dt>
              <dd>
                {extraction.snapshot.product.sourceMethod} · confidence{" "}
                {extraction.snapshot.product.sourceConfidenceScore.toFixed(2)}
              </dd>
            </div>
            {FIELD_ROWS.map((field) => (
              <div key={field}>
                <dt>{FIELD_LABELS[field]}</dt>
                <dd>
                  {formatFieldValue(extraction.snapshot.product.fields[field].value)}
                  {extraction.snapshot.product.fields[field].source ? (
                    <span className="field-meta">
                      {extraction.snapshot.product.fields[field].source} ·{" "}
                      {extraction.snapshot.product.fields[field].confidence.toFixed(2)}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
            <div>
              <dt>Images</dt>
              <dd>{extraction.snapshot.product.imageUrls.length}</dd>
            </div>
            <div>
              <dt>URL</dt>
              <dd>{extraction.snapshot.url}</dd>
            </div>
            <div>
              <dt>Warnings</dt>
              <dd>{extraction.snapshot.product.warnings.length ? extraction.snapshot.product.warnings.join("; ") : "None"}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {classification ? (
        <section className="message-block">
          <h2>Structured classification</h2>
          <div className="classification-grid">
            <Metric label="Category" value={classification.category} />
            <Metric label="Material" value={classification.material_family} />
            <Metric label="Brand tier" value={classification.brand_tier} />
            <Metric label="Confidence" value={`${classification.source_confidence_label} · ${classification.source_confidence_score.toFixed(2)}`} />
          </div>
          <dl className="details-list">
            {CLASSIFICATION_ROWS.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value(classification)}</dd>
              </div>
            ))}
          </dl>
          <ClassificationList title="Quality signals" items={classification.quality_signals} emptyLabel="None found" />
          <ClassificationList title="Quality concerns" items={classification.quality_concerns} emptyLabel="None found" />
          <div className="inference-table">
            <h3>Labelled inferences</h3>
            {classification.labelled_inferences.length ? (
              classification.labelled_inferences.map((inference, index) => (
                <div className="inference-row" key={`${inference.field}-${inference.value}-${index}`}>
                  <span>{inference.field}</span>
                  <strong>{inference.value}</strong>
                  <em>{inference.basis}</em>
                </div>
              ))
            ) : (
              <p className="empty-copy">None</p>
            )}
          </div>
        </section>
      ) : null}

      {visualEnrichment ? (
        <section className="message-block">
          <h2>Visual enrichment</h2>
          <div className="classification-grid">
            <Metric label="Status" value={visualEnrichment.status} />
            <Metric label="Vision model" value={visualEnrichment.model} />
            <Metric label="Images" value={String(visualEnrichment.image_urls.length)} />
            <Metric label="Fallback" value={visualEnrichment.fallback_model} />
          </div>
          <ClassificationList title="Vision guardrails" items={visualEnrichment.warnings} emptyLabel="None" />
        </section>
      ) : null}

      {verdict ? (
        <section className="message-block message-block--success">
          <h2>Backend response</h2>
          <p>{verdict.summary}</p>
          {verdict.analysis ? (
            <>
              <Stage6VerdictPanel verdict={verdict.analysis.verdict} approvedExamples={verdict.analysis.approved_examples} />
              <div className="classification-grid">
                <Metric label="Stage" value={verdict.analysis.stage} />
                <Metric label="Status" value={verdict.analysis.status} />
                <Metric label="Analysis model" value={verdict.analysis.verdict.model} />
                <Metric label="Model status" value={formatLabel(verdict.analysis.verdict.model_status)} />
              </div>
              <Stage5VisualPanel verdict={verdict} />
              <ClassificationList title="Backend warnings" items={verdict.analysis.visual_enrichment.warnings} emptyLabel="None" />
              <ClassificationList title="Reasoning flags" items={verdict.analysis.verdict.reasoning_flags.map(formatLabel)} emptyLabel="None" />
              <ClassificationList title="Matched examples" items={verdict.analysis.verdict.matched_examples} emptyLabel="None" />
            </>
          ) : null}
          <dl className="details-list response-meta">
            <div>
              <dt>Source</dt>
              <dd>{verdict.source}</dd>
            </div>
            <div>
              <dt>Request ID</dt>
              <dd>{verdict.requestId}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </main>
  );
}

function Stage6VerdictPanel({ verdict, approvedExamples }: { verdict: Stage6Verdict; approvedExamples: MatchedApprovedExample[] }) {
  return (
    <div className="verdict-panel">
      <div className="verdict-hero">
        <div>
          <span className={`recommendation recommendation--${verdict.recommendation}`}>{formatLabel(verdict.recommendation)}</span>
          <strong>{verdict.overall_rating.toFixed(1)}/10</strong>
        </div>
        <p>{verdict.recommendation_summary}</p>
      </div>

      <div className="score-grid">
        <ScoreMeter label="Quality" value={verdict.scores.quality} max={10} />
        <ScoreMeter label="Value" value={verdict.scores.value} max={10} />
        <ScoreMeter label="Durability" value={verdict.scores.durability} max={10} />
        <ScoreMeter label="Aesthetic" value={verdict.scores.aesthetic} max={10} />
        <ScoreMeter label="Confidence" value={verdict.scores.confidence} max={1} />
      </div>

      <div className="verdict-grid">
        <DimensionVerdictBlock title="Quality" score={verdict.scores.quality} verdict={verdict.verdicts.quality} />
        <DimensionVerdictBlock title="Value" score={verdict.scores.value} verdict={verdict.verdicts.value} />
        <DimensionVerdictBlock title="Durability" score={verdict.scores.durability} verdict={verdict.verdicts.durability} />
        <DimensionVerdictBlock title="Aesthetic" score={verdict.scores.aesthetic} verdict={verdict.verdicts.aesthetic} />
      </div>

      <ClassificationList
        title="Approved-example anchors"
        items={approvedExamples.map(
          (example) =>
            `${example.id} · ${example.category}/${example.material_family}/${example.brand_tier} · similarity ${example.similarity.toFixed(2)}`
        )}
        emptyLabel="None"
      />
      <p className="verdict-summary">{verdict.summary}</p>
    </div>
  );
}

function Stage5VisualPanel({ verdict }: { verdict: BackendVerdict }) {
  const visual = verdict.analysis?.visual_enrichment;
  if (!visual) return null;

  return (
    <div className="stage-panel">
      <div className="section-heading-row">
        <h3>Stage 5 visual response</h3>
        <span className="section-pill">{visual.status}</span>
      </div>
      <div className="classification-grid">
        <Metric label="Vision model" value={visual.model} />
        <Metric label="Images sent" value={String(visual.image_count)} />
        <Metric label="Visual cues" value={String(visual.visual_cues.length)} />
        <Metric label="Inferences" value={String(visual.expert_inferences.length)} />
      </div>
      <ClassificationList
        title="Diagnostic visual cues"
        items={visual.visual_cues.map((cue) => `${cue.cue} (${cue.confidence}, ${cue.evidence_type})`)}
        emptyLabel="None"
      />
      <ClassificationList
        title="Backend visual observations"
        items={visual.observations.map(
          (observation) => `${observation.observation} (${observation.confidence}, ${observation.evidence_type})`
        )}
        emptyLabel="None"
      />
      <ClassificationList
        title="Expert visual inferences"
        items={visual.expert_inferences.map(
          (inference) =>
            `${inference.inference} (${inference.confidence}, ${inference.quality_dimension}, ${inference.score_dimension}: ${inference.score_effect}) Caveat: ${inference.caveat}`
        )}
        emptyLabel="None"
      />
      <ClassificationList title="Missing image views" items={visual.missing_views} emptyLabel="None" />
      <ClassificationList title="Image limits" items={visual.image_quality_limits} emptyLabel="None" />
    </div>
  );
}

const FIELD_ROWS: ProductFieldName[] = [
  "title",
  "brand",
  "price",
  "currency",
  "colour",
  "description",
  "materials",
  "care",
  "construction",
  "origin",
  "sizing",
  "categoryBreadcrumbs"
];

const FIELD_LABELS: Record<ProductFieldName, string> = {
  title: "Product title",
  brand: "Brand",
  price: "Price",
  currency: "Currency",
  colour: "Colour",
  description: "Description",
  materials: "Materials",
  care: "Care",
  construction: "Construction",
  origin: "Origin",
  sizing: "Sizing",
  categoryBreadcrumbs: "Category"
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScoreMeter({ label, value, max }: { label: string; value: number; max: number }) {
  const displayValue = max === 1 ? value.toFixed(2) : value.toFixed(1);
  const percentage = Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <div className="score-meter">
      <div>
        <span>{label}</span>
        <strong>
          {displayValue}
          <small>/{max}</small>
        </strong>
      </div>
      <div className="score-track" aria-hidden="true">
        <span style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function DimensionVerdictBlock({ title, score, verdict }: { title: string; score: number; verdict: DimensionVerdict }) {
  return (
    <div className="dimension-verdict">
      <div>
        <h3>
          {title}
          <strong>{score.toFixed(1)}/10</strong>
        </h3>
        <span>{verdict.confidence}</span>
      </div>
      <p>{verdict.verdict}</p>
      <em>{formatLabel(verdict.evidence_type)}</em>
    </div>
  );
}

function ClassificationList({ title, items, emptyLabel }: { title: string; items: string[]; emptyLabel: string }) {
  return (
    <div className="classification-list">
      <h3>{title}</h3>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="empty-copy">{emptyLabel}</p>
      )}
    </div>
  );
}

const CLASSIFICATION_ROWS: Array<[string, (classification: ProductClassification) => string]> = [
  ["Brand", (classification) => classification.brand || "Unknown"],
  ["Price", (classification) => classification.price || "Unknown"],
  ["Primary colour", (classification) => classification.primary_colour || "Unknown"],
  ["Style tags", (classification) => (classification.style_tags.length ? classification.style_tags.join(", ") : "None")],
  ["Use case", (classification) => classification.use_case],
  ["Material description", (classification) => classification.material_description],
  ["Construction description", (classification) => classification.construction_description]
];

function formatFieldValue(value: string | string[] | null): string {
  if (Array.isArray(value)) return value.length ? value.join(" › ") : "Not found";
  return value || "Not found";
}

function formatLabel(value: string): string {
  return value.replace(/_/g, " ");
}
