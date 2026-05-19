import { useMemo, useState } from "react";
import { submitQualityCheck } from "../api/client";
import type { ActiveTabExtraction, BackendVerdict } from "../shared/messages";
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
    if (status === "sending") return "Sending test payload";
    if (status === "complete") return "Stage 1 connected";
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
          Stage 1 verifies the extension shell: side panel, active-tab messaging, content-script capture,
          backend payload submission, and response rendering.
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
          <h2>Active tab payload</h2>
          <dl className="details-list">
            <div>
              <dt>Title</dt>
              <dd>{extraction.snapshot.title || "No title captured"}</dd>
            </div>
            <div>
              <dt>URL</dt>
              <dd>{extraction.snapshot.url}</dd>
            </div>
            <div>
              <dt>Visible text</dt>
              <dd>{extraction.snapshot.visibleText ? `${extraction.snapshot.visibleText.length} characters captured` : "None captured"}</dd>
            </div>
            <div>
              <dt>Meta tags</dt>
              <dd>{Object.keys(extraction.snapshot.meta).length}</dd>
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
