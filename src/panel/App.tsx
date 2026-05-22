import { useMemo, useState } from "react";
import { submitQualityCheck } from "../api/client";
import { classifyProductEvidence } from "../shared/classification";
import type { ActiveTabExtraction, BackendVerdict, ProductClassification, ProductFieldName } from "../shared/messages";
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
    if (status === "complete") return "Stage 5 ready";
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
          <h1>Visual enrichment test</h1>
        </div>
        <span className={`status-pill status-pill--${status}`}>{statusLabel}</span>
      </header>

      <section className="primary-panel">
        <p className="panel-copy">
          Extract product evidence from the active tab, classify it, and prepare a guarded visual-enrichment request from product images.
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
              <div className="classification-grid">
                <Metric label="Stage" value={verdict.analysis.stage} />
                <Metric label="Status" value={verdict.analysis.status} />
                <Metric label="Vision" value={verdict.analysis.visual_enrichment.model} />
                <Metric label="Observations" value={String(verdict.analysis.visual_enrichment.observations.length)} />
              </div>
              <ClassificationList
                title="Diagnostic visual cues"
                items={verdict.analysis.visual_enrichment.visual_cues.map((cue) =>
                  `${cue.cue} (${cue.confidence}, ${cue.evidence_type})`
                )}
                emptyLabel="None"
              />
              <ClassificationList
                title="Backend visual observations"
                items={verdict.analysis.visual_enrichment.observations.map((observation) =>
                  `${observation.observation} (${observation.confidence}, ${observation.evidence_type})`
                )}
                emptyLabel="None"
              />
              <ClassificationList title="Missing image views" items={verdict.analysis.visual_enrichment.missing_views} emptyLabel="None" />
              <ClassificationList title="Image limits" items={verdict.analysis.visual_enrichment.image_quality_limits} emptyLabel="None" />
              <ClassificationList title="Backend warnings" items={verdict.analysis.visual_enrichment.warnings} emptyLabel="None" />
            </>
          ) : null}
          <dl className="details-list">
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
