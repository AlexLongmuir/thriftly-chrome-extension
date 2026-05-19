import { useMemo, useState } from "react";
import { submitQualityCheck } from "../api/client";
import type { ActiveTabExtraction, BackendVerdict, ProductFieldName } from "../shared/messages";
import { createBackendPayload } from "../shared/pageSnapshot";
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
    if (status === "complete") return "Stage 2 extracted";
    if (status === "error") return "Needs attention";
    return "Ready";
  }, [status]);

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
          <h1>Product page test</h1>
        </div>
        <span className={`status-pill status-pill--${status}`}>{statusLabel}</span>
      </header>

      <section className="primary-panel">
        <p className="panel-copy">
          Extract product evidence from the active tab, prioritising structured page data before targeted DOM
          text and visible-text fallback.
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

      {verdict ? (
        <section className="message-block message-block--success">
          <h2>Backend response</h2>
          <p>{verdict.summary}</p>
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

function formatFieldValue(value: string | string[] | null): string {
  if (Array.isArray(value)) return value.length ? value.join(" › ") : "Not found";
  return value || "Not found";
}
