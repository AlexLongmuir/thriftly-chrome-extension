import { useMemo, useState } from "react";
import { submitQualityCheck } from "../api/client";
import { classifyProductEvidence } from "../shared/classification";
import sampleLinenShirtImage from "./assets/arket-white-linen-shirt.avif";
import type {
  ActiveTabExtraction,
  BackendAnalysis,
  BackendVerdict,
  DimensionVerdict,
  MatchedApprovedExample,
  ProductClassification,
  Recommendation,
  ShopperSignal,
  Stage6Verdict
} from "../shared/messages";
import { createBackendPayload } from "../shared/pageSnapshot";
import { createVisualEnrichment } from "../shared/visualEnrichment";
import { requestActiveTabExtraction } from "./chromeApi";

type Status = "idle" | "extracting" | "sending" | "scoring" | "complete" | "error";
type ActivePage = "summary" | "alternatives" | "how-it-works";
type SignalIconMetric = ShopperSignal["related_metric"] | NonNullable<ShopperSignal["category"]> | "fit";
type SignalTone = "positive" | "negative" | "neutral";

const DEFAULT_MONTHLY_WEARS = 8;
const LOADING_STEP_ACKNOWLEDGEMENT_MS = 650;
const SHOW_DEBUG_EVIDENCE = import.meta.env.VITE_SCOUTED_DEBUG_EVIDENCE === "true";
const SAMPLE_ANALYSIS = {
  brand: "Arket",
  title: "Relaxed Linen Shirt",
  price: "£67",
  overall_rating: 7.4,
  recommendation: "consider" as Recommendation,
  verdict: "A real linen shirt at a fair price - you'll just be ironing it.",
  positiveSignals: [
    {
      metric: "material" as SignalIconMetric,
      title: "Strong material choice",
      body: "Linen is breathable, natural, and right for a relaxed summer shirt."
    },
    {
      metric: "value" as SignalIconMetric,
      title: "Strong value",
      body: "The material-to-price ratio looks good for this category."
    }
  ],
  watchOut: {
    metric: "fit" as SignalIconMetric,
    title: "Fit may be inconsistent",
    body: "Some feedback suggests the cut may not work for every build."
  }
};

export function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [monthlyWears, setMonthlyWears] = useState(DEFAULT_MONTHLY_WEARS);
  const [extraction, setExtraction] = useState<ActiveTabExtraction | null>(null);
  const [verdict, setVerdict] = useState<BackendVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [activePage, setActivePage] = useState<ActivePage>("summary");

  const classification = useMemo(
    () => (extraction ? classifyProductEvidence(extraction.snapshot.product) : null),
    [extraction]
  );
  const visualEnrichment = useMemo(
    () => (extraction && classification ? createVisualEnrichment(extraction.snapshot.product, classification) : null),
    [classification, extraction]
  );
  const analysis = verdict?.analysis ?? null;
  const extractedTitle = getFieldValue(extraction?.snapshot.product.fields.title.value) || extraction?.snapshot.title || null;
  const extractedBrand = getFieldValue(extraction?.snapshot.product.fields.brand.value) || getDomain(extraction?.snapshot.url);
  const extractedPrice = getFieldValue(extraction?.snapshot.product.fields.price.value);
  const productTitle = analysis?.product.title || extractedTitle || "No product checked yet";
  const productBrand = analysis?.classification.brand || extractedBrand;
  const productPrice = analysis?.classification.price || extractedPrice;
  const productImage = extraction?.snapshot.product.imageUrls[0] ?? null;
  const loadingTitle = extractedTitle || "Reading current page";
  const loadingBrand = extraction ? extractedBrand : "Scouted";
  const loadingPrice = extraction ? classification?.price || extractedPrice : null;
  const loadingImage = extraction ? productImage : null;
  const lifespan = analysis ? estimateLifespan(analysis.verdict.scores.durability, monthlyWears, analysis.verdict.confidence_label) : null;
  const isChecking = status === "extracting" || status === "sending" || status === "scoring";
  const isStateView = activePage === "summary" && (status === "idle" || isChecking);
  const showAnalysisAction = Boolean(analysis) && activePage === "summary";

  async function handleRunCheck() {
    setVerdict(null);
    setExtraction(null);
    setError(null);
    setActivePage("summary");
    setStatus("extracting");

    try {
      const activeTabExtraction = await requestActiveTabExtraction();
      setExtraction(activeTabExtraction);

      setStatus("sending");
      const response = await submitQualityCheck(createBackendPayload(activeTabExtraction.snapshot));
      setStatus("scoring");
      await waitForLoadingStepAcknowledgement();
      setVerdict(response);
      setStatus("complete");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unexpected extension error.";
      setError(message);
      setStatus("error");
    }
  }

  return (
    <main className={`panel-shell${isStateView ? " panel-shell--state" : ""}`}>
      {activePage === "how-it-works" ? (
        <HowItWorksPage onBack={() => setActivePage("summary")} />
      ) : status === "idle" ? (
        <>
          <div className="state-scroll">
            <EmptyState onShowTechnicalDetails={() => setActivePage("how-it-works")} />
          </div>
          <StateFooter buttonLabel="Analyse this item" onClick={handleRunCheck} disabled={false} />
        </>
      ) : isChecking ? (
        <>
          <div className="state-scroll">
            <LoadingState
              status={status}
              title={loadingTitle}
              brand={loadingBrand}
              price={loadingPrice}
              imageUrl={loadingImage}
              classification={classification}
            />
          </div>
          <LoadingFooter />
        </>
      ) : (
        <>
          {error ? (
            <section className="notice notice--error">
              <h2>Check Failed</h2>
              <p>{error}</p>
              <button className="primary-button" type="button" onClick={handleRunCheck}>
                Try again
              </button>
            </section>
          ) : null}

          {analysis ? (
            activePage === "alternatives" ? (
              <AlternativesPage approvedExamples={analysis.approved_examples} onBack={() => setActivePage("summary")} />
            ) : (
              <>
                {showAnalysisAction ? <AnalysisActionBar onRefresh={handleRunCheck} disabled={isChecking} /> : null}
                <ProductHero
                  title={productTitle}
                  brand={productBrand}
                  price={productPrice}
                  imageUrl={productImage}
                  verdict={analysis.verdict}
                />
                <SignsSection title="In its favour" tone="positive" items={analysis.verdict.good_signs} />
                <SignsSection title="Worth watching" tone="negative" items={analysis.verdict.watch_outs} />
                <SignsSection title="Couldn't verify" tone="neutral" items={analysis.verdict.unverified} />
                <AlternativesSection approvedExamples={analysis.approved_examples} onViewAll={() => setActivePage("alternatives")} />
                <HowScoresSection verdict={analysis.verdict} />
              </>
            )
          ) : extraction && classification ? (
            <>
              <ProductSummary title={productTitle} brand={productBrand} price={productPrice} imageUrl={productImage} classification={classification} />
              <section className="notice">
                <h2>Product Evidence Captured</h2>
                <p>Backend verdict is not available yet. Try again once the backend is reachable.</p>
              </section>
            </>
          ) : null}

          {SHOW_DEBUG_EVIDENCE && status !== "error" ? <section className="debug-shell">
            <button className="debug-toggle" type="button" onClick={() => setDebugOpen((open) => !open)}>
              <span>Debug Evidence</span>
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
          </section> : null}
        </>
      )}
    </main>
  );
}

function AnalysisActionBar({
  onRefresh,
  disabled
}: {
  onRefresh: () => void;
  disabled: boolean;
}) {
  return (
    <div className="analysis-action-bar">
      <div className="analysis-brand">Scouted</div>
      <button className="refresh-button" type="button" onClick={onRefresh} disabled={disabled}>
        <ScanIcon />
        <span>Analyse This Item</span>
      </button>
    </div>
  );
}

function ScanIcon() {
  return (
    <svg className="scan-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M4 7V5.8C4 4.8 4.8 4 5.8 4H7" />
      <path d="M13 4h1.2C15.2 4 16 4.8 16 5.8V7" />
      <path d="M16 13v1.2c0 1-.8 1.8-1.8 1.8H13" />
      <path d="M7 16H5.8C4.8 16 4 15.2 4 14.2V13" />
      <path d="M6.5 10h7" />
    </svg>
  );
}

function HowItWorksPage({ onBack }: { onBack: () => void }) {
  const steps = [
    {
      title: "Extract Product Evidence",
      body:
        "The content script reads the rendered product page the shopper already has open, then pulls structured product data, Open Graph/meta tags, hydration blobs, targeted DOM snippets, visible text and image URLs. Facts are normalised into fields like title, brand, price, materials, care, construction, sizing, review claims and breadcrumbs, each with confidence rather than fake certainty.",
      chips: ["Structured Data", "Hydration Blobs", "Field Confidence"]
    },
    {
      title: "Classify The Item",
      body:
        "Messy retailer data is converted into controlled schema fields: category, material family, brand tier, colour, style tags, use case and source confidence. Inferred fields are labelled separately from facts stated on the page, so the system knows what it knows and what it is guessing.",
      chips: ["Controlled Schema", "Labelled Inferences", "Source Confidence"]
    },
    {
      title: "Enrich With Product Images",
      body:
        "Gemini-3.0-Flash reviews product images for diagnostic cues: silhouette, texture appearance, drape, seam or edge neatness, hardware, transparency, pilling, fuzz and missing close-ups. Vision is guarded: it cannot hard-claim fibre content, leather grade, exact construction, durability or authenticity from images alone.",
      chips: ["Gemini-3.0-Flash", "Visual Cues", "Claim Guardrails"]
    },
    {
      title: "Research Outside Evidence",
      body:
        "An evidence agent searches for exact-product reviews, third-party retailer evidence, independent reviews, Reddit or forum patterns, competitor benchmarks, category benchmarks and material context. Sources are validated for confidence, relevance and specificity; weak search-spam pages, coupons, same-retailer repeats and irrelevant comparisons are rejected or kept out of scoring.",
      chips: ["Evidence Agent", "Source Rejection", "Repeated Themes"]
    },
    {
      title: "Generate Shopper Verdict",
      body:
        "Gpt-5.4-Mini generates the quality, value, durability, style, confidence, recommendation, good signs, watch-outs and short decision summary from the evidence packet. The backend validates the structure, ranges, evidence discipline and visual-claim safety rules before showing the result.",
      chips: ["Gpt-5.4-Mini", "Structured Json", "Backend Validation"]
    },
    {
      title: "Retrieve Better Alternatives",
      body:
        "The recommendations layer uses a Text-Embedding-3-Small product intelligence blob for similarity retrieval, then ranks items by matching category, use case, style, material, price band, stronger scores and enough confidence. Approved examples act as cold-start anchors, while analysed products compound into a more useful recommendation base.",
      chips: ["Text Embedding", "Similarity Retrieval", "Approved Examples"]
    }
  ];

  const technicalNotes = [
    "Rendered-page extraction avoids brittle backend scraping and blocked headless requests.",
    "Controlled schemas reduce model drift across messy retailer pages.",
    "Confidence labels and evidence gaps stop the system overclaiming.",
    "External evidence is validated before it can affect scores.",
    "Embeddings make recommendations improve as analysed products accumulate."
  ];

  return (
    <section className="how-page">
      <button className="back-button" type="button" onClick={onBack}>
        <span className="chevron chevron--back" aria-hidden="true" />
        <span>Back</span>
      </button>

      <div className="how-intro">
        <p className="eyebrow">Backend Pipeline</p>
        <h2>How Scouted Turns A Product Page Into A Buying Verdict</h2>
        <p>
          The extension separates extraction, classification, visual evidence, outside research, scoring and recommendations so the final call is useful without hiding the evidence.
        </p>
      </div>

      <div className="pipeline-list">
        {steps.map((step, index) => (
          <article className="pipeline-step" key={step.title}>
            <div className="pipeline-number">{String(index + 1).padStart(2, "0")}</div>
            <div className="pipeline-copy">
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <div className="model-chip-row" aria-label={`${step.title} technical details`}>
                {step.chips.map((chip) => (
                  <span key={chip}>{chip}</span>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>

      <section className="panel-section technical-note-list">
        <SectionHeader title="What This Shows Technically" />
        <div>
          {technicalNotes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      </section>
    </section>
  );
}

function EmptyState({ onShowTechnicalDetails }: { onShowTechnicalDetails: () => void }) {
  return (
    <section className="empty-preview-state">
      <div className="empty-hook">
        <h1>Is it actually<br />worth buying?</h1>
        <p>Scouted reads the page and what reviewers really say, then gives a straight verdict.</p>
      </div>
      <SampleAnalysisCard />
      <HowScoutedWorks onShowTechnicalDetails={onShowTechnicalDetails} />
    </section>
  );
}

function SampleAnalysisCard() {
  const score = scoreOutOf100(SAMPLE_ANALYSIS.overall_rating);
  const tone = scoreTone(score);

  return (
    <section className="sample-analysis" aria-label="Sample analysis">
      <div className="sample-tag"><span aria-hidden="true" />Sample analysis</div>
      <div className="sample-product-row">
        <div className="sample-product-image">
          <img src={sampleLinenShirtImage} alt="" />
        </div>
        <div className="sample-product-copy">
          <p>{SAMPLE_ANALYSIS.brand}</p>
          <strong>{SAMPLE_ANALYSIS.title}</strong>
          <span>{SAMPLE_ANALYSIS.price}</span>
        </div>
      </div>
      <div className="sample-score-row">
        <div className={`sample-grade grade-tile--${tone}`}>
          <strong>{gradeFor(SAMPLE_ANALYSIS.overall_rating)}</strong>
          <span>{score}/100</span>
        </div>
        <div className="sample-verdict-copy">
          <span className={`recommendation-tag recommendation-tag--${SAMPLE_ANALYSIS.recommendation}`}>
            {recommendationLabel(SAMPLE_ANALYSIS.recommendation)}
          </span>
          <blockquote>"{SAMPLE_ANALYSIS.verdict}"</blockquote>
        </div>
      </div>
      <section className="panel-section sign-section">
        <SectionHeader title="Good Signs" />
        <div className="sign-list">
          {SAMPLE_ANALYSIS.positiveSignals.map((signal) => (
            <SampleSignalRow key={signal.title} tone="positive" metric={signal.metric} title={signal.title} body={signal.body} />
          ))}
        </div>
      </section>
      <section className="panel-section sign-section">
        <SectionHeader title="Watch-outs" />
        <div className="sign-list">
          <SampleSignalRow tone="negative" metric={SAMPLE_ANALYSIS.watchOut.metric} title={SAMPLE_ANALYSIS.watchOut.title} body={SAMPLE_ANALYSIS.watchOut.body} />
        </div>
      </section>
    </section>
  );
}

function SampleSignalRow({
  tone,
  metric,
  title,
  body
}: {
  tone: "positive" | "negative";
  metric: SignalIconMetric;
  title: string;
  body: string;
}) {
  return (
    <div className="sign-row">
      <div className={`sign-icon sign-icon--${tone}`} aria-hidden="true">
        <SignalIcon category={metric} tone={tone} />
      </div>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
      <span className={`signal-dot signal-dot--${tone}-medium`} aria-label={`medium ${tone} signal`} />
    </div>
  );
}

function HowScoutedWorks({ onShowTechnicalDetails }: { onShowTechnicalDetails: () => void }) {
  const steps = [
    { title: "Reads this page", body: "Material, price, care and construction signals." },
    { title: "Gathers the evidence", body: "Independent reviews, forums and comparable items." },
    { title: "Gives a verdict", body: "Score, good signs, watch-outs and a buy call." }
  ];

  return (
    <section className="how-compact">
      <SectionHeader title="How Scouted Works" />
      <div className="how-step-list">
        {steps.map((step, index) => (
          <div className="how-step-row" key={step.title}>
            <span>{index + 1}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </div>
          </div>
        ))}
      </div>
      <button className="technical-link-button" type="button" onClick={onShowTechnicalDetails}>
        Learn more about the technical implementation
      </button>
    </section>
  );
}

function StateFooter({ buttonLabel, onClick, disabled }: { buttonLabel: string; onClick: () => void; disabled: boolean }) {
  return (
    <footer className="state-footer">
      <button className="primary-button primary-button--wide" type="button" onClick={onClick} disabled={disabled}>
        {buttonLabel}
      </button>
    </footer>
  );
}

function LoadingFooter() {
  return (
    <footer className="loading-footer">
      <div className="loading-progress" aria-hidden="true"><span /></div>
      <p>Usually takes 5-10 seconds</p>
    </footer>
  );
}

function LoadingState({
  status,
  title,
  brand,
  price,
  imageUrl,
  classification
}: {
  status: Status;
  title: string;
  brand: string;
  price: string | null;
  imageUrl: string | null;
  classification: ProductClassification | null;
}) {
  const signalLine = classification ? loadingSignalLine(classification, price) : "Reading product details from this page.";
  const imageStepBody = imageUrl
    ? "Looking for visible cues like texture, drape, finish and missing close-ups."
    : "No useful product image found yet, so image confidence stays lower.";
  const steps = [
    {
      state: status === "extracting" ? "active" : "done",
      title: "Reading the product page",
      body: status === "extracting" ? "Finding the title, brand, price and material signals." : signalLine
    },
    {
      state: status === "extracting" ? "pending" : "done",
      title: "Checking product images",
      body: imageStepBody
    },
    {
      state: status === "extracting" ? "pending" : "done",
      title: "Understanding the item",
      body: "Matching category, material, price and use case."
    },
    {
      state: status === "sending" ? "active" : status === "scoring" ? "done" : "pending",
      title: "Looking for outside evidence",
      body: "Checking useful reviews, forums, benchmarks and similar products."
    },
    {
      state: status === "scoring" ? "active" : "pending",
      title: "Building your verdict",
      body: "Weighing quality, value, durability, style and confidence."
    }
  ] satisfies Array<{ state: "done" | "active" | "pending"; title: string; body: string }>;

  return (
    <section className="loading-state">
      <div className="loading-product">
        <div className="loading-product-image">
          {imageUrl ? <img src={imageUrl} alt="" /> : <ShirtPlaceholder />}
        </div>
        <div>
          <p>{toTitleCase(brand)}</p>
          <h2>{title}</h2>
          {price ? <span>{price}</span> : null}
        </div>
      </div>
      <div className="tracker-list">
        {steps.map((step, index) => (
          <TrackerStep key={step.title} state={step.state} number={index + 1} title={step.title} body={step.body} />
        ))}
      </div>
      <LoadingSkeleton />
    </section>
  );
}

function TrackerStep({ state, number, title, body }: { state: "done" | "active" | "pending"; number: number; title: string; body: string }) {
  return (
    <div className={`tracker-step tracker-step--${state}`}>
      <span className="tracker-marker">{state === "done" ? "✓" : state === "active" ? <span className="tracker-spinner" aria-hidden="true" /> : number}</span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <section className="loading-skeleton" aria-label="Analysis preview loading">
      <div className="skeleton-hero">
        <div className="skeleton-block skeleton-image" />
        <div className="skeleton-stack">
          <div className="skeleton-line skeleton-line--wide" />
          <div className="skeleton-line skeleton-line--medium" />
        </div>
      </div>
      <div className="skeleton-verdict">
        <div className="skeleton-line skeleton-line--full" />
        <div className="skeleton-line skeleton-line--long" />
      </div>
      <div className="skeleton-tile-row">
        <div className="skeleton-row" />
        <div className="skeleton-row" />
      </div>
    </section>
  );
}

function ProductHero({
  title,
  brand,
  price,
  imageUrl,
  verdict
}: {
  title: string;
  brand: string;
  price: string | null;
  imageUrl: string | null;
  verdict: Stage6Verdict;
}) {
  const score = scoreOutOf100(verdict.overall_rating);
  const verdictLine = conciseSentence(verdict.recommendation_summary || verdict.summary);

  return (
    <section className="scouted-hero">
      <div className="scouted-product-row">
        <div className="scouted-product-image" aria-label={imageUrl ? "Product image" : "Product image unavailable"}>
          {imageUrl ? <img src={imageUrl} alt="" /> : <ShirtPlaceholder />}
        </div>
        <div className="scouted-product-copy">
          <p>{toTitleCase(brand)}</p>
          <h2>{title}</h2>
          {price ? <span>{price}</span> : null}
        </div>
      </div>
      <div className="result-divider" />
      <div className="rating-row">
        <div className="grade-tile">
          <div className="grade-score">{score}<small>/100</small></div>
        </div>
        <div className="rating-right">
          <span className={`recommendation-tag recommendation-tag--${verdict.recommendation}`}>{recommendationLabel(verdict.recommendation)}</span>
          <p className="verdict-line">"{verdictLine}"</p>
        </div>
      </div>
    </section>
  );
}

function SignsSection({ title, tone, items }: { title: string; tone: SignalTone; items: ShopperSignal[] }) {
  if (items.length === 0) return null;

  return (
    <section className="panel-section sign-section">
      <SectionHeader title={title} />
      <div className="sign-list">
        {items.map((item) => {
          const level = item.confidence ?? "medium";
          return (
            <div className="sign-row" key={`${title}-${item.label}`}>
              <div className={`sign-icon sign-icon--${tone}`} aria-hidden="true">
                <SignalIcon category={item.category ?? item.related_metric} tone={tone} />
              </div>
              <div>
                <strong>{item.label}</strong>
                <p>{item.detail.trim()}</p>
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
          <span>{toTitleCase(formatLabel(classification.category))}</span>
          <span>{toTitleCase(formatLabel(classification.material_family))}</span>
          <span>{toTitleCase(formatLabel(classification.brand_tier))}</span>
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
          {toTitleCase(formatLabel(verdict.recommendation))} · {verdict.overall_rating.toFixed(1)}/10 · {toTitleCase(verdict.confidence_label)} Confidence
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
      <SectionHeader title="Verdict" meta={`${Math.round(verdict.scores.confidence * 100)}% Confidence`} />
      <p>{verdict.summary || verdict.recommendation_summary}</p>
    </section>
  );
}

function ScoreSection({ verdict }: { verdict: Stage6Verdict }) {
  return (
    <section className="panel-section">
      <SectionHeader title="Scores" meta="Tap A Row To Expand" />
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
          <span>{toTitleCase(verdict.confidence)} Confidence</span>
          <span>{toTitleCase(formatLabel(verdict.evidence_type))}</span>
        </div>
      </div>
    </details>
  );
}

function MaterialSection({ classification }: { classification: ProductClassification }) {
  return (
    <section className="panel-section">
      <SectionHeader title="Material Notes" meta={toTitleCase(classification.source_confidence_label)} />
      <Field label="Composition" value={classification.material_description} />
      <Field label="Construction" value={classification.construction_description} />
      <Field label="Use Case" value={classification.use_case} />
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
      <SectionHeader title="Evidence And Confidence" meta={toTitleCase(analysis.verdict.confidence_label)} />
      <div className="metric-grid">
        {evidenceItems.map((item) => (
          <div className="metric" key={item}>
            {item}
          </div>
        ))}
      </div>
      <SignalList title="Page Facts" items={analysis.page_evidence.map((item) => item.claim)} emptyLabel="No First-Party Page Facts Captured" />
      <SignalList title="Outside Evidence" items={formatExternalInsightItems(analysis)} emptyLabel="No Useful External Insights Found" />
      <SignalList title="Repeated Themes" items={analysis.repeated_themes.map((item) => `${toTitleCase(formatLabel(item.theme))}: ${item.summary}`)} emptyLabel="No Repeated External Themes Found" />
      <SignalList title="Conflicting Evidence" items={analysis.conflicting_evidence} emptyLabel="No Conflicts Found" />
      <SignalList title="Evidence Gaps" items={analysis.evidence_gaps} emptyLabel="No Evidence Gaps Flagged" />
      <SignalList title="Rejected Sources" items={analysis.rejected_sources.map((item) => `${item.source_domain || "unknown"}: ${item.reason_rejected}`)} emptyLabel="No Rejected Sources Returned" />
      <SignalList title="Reasoning Flags" items={analysis.verdict.reasoning_flags.map((item) => toTitleCase(formatLabel(item)))} emptyLabel="None" />
      <SignalList title="Missing Image Views" items={analysis.visual_enrichment.missing_views} emptyLabel="None Flagged" />
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
      <SectionHeader title="Estimated Lifespan" meta="Rough Estimate" />
      <div className="lifespan-result">
        <strong>{lifespan.label}</strong>
        <span>{toTitleCase(lifespan.confidence)} Confidence</span>
      </div>
      <label className="slider-label" htmlFor="monthly-wears">
        <span>Monthly Wears</span>
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

function AlternativesSection({ approvedExamples, onViewAll }: { approvedExamples: MatchedApprovedExample[]; onViewAll: () => void }) {
  const alternatives = buildAlternatives(approvedExamples);
  if (alternatives.length === 0) return null;

  return (
    <section className="panel-section alternatives-section">
      <SectionHeader title="Other options" />
      <div className="alternative-list">
        {alternatives.slice(0, 2).map((alternative) => (
          <AlternativeRow key={alternative.url} alternative={alternative} />
        ))}
        {alternatives.length > 2 ? <ViewAllAlternativesRow count={alternatives.length} onViewAll={onViewAll} /> : null}
      </div>
    </section>
  );
}

function AlternativesPage({ approvedExamples, onBack }: { approvedExamples: MatchedApprovedExample[]; onBack: () => void }) {
  const alternatives = buildAlternatives(approvedExamples);

  return (
    <section className="alternatives-page">
      <button className="back-button" type="button" onClick={onBack}>
        <span className="chevron chevron--back" aria-hidden="true" />
        <span>Alternatives</span>
      </button>
      <div className="alternative-list alternative-list--full">
        {alternatives.map((alternative) => (
          <AlternativeRow key={alternative.url} alternative={alternative} />
        ))}
      </div>
    </section>
  );
}

function ViewAllAlternativesRow({ count, onViewAll }: { count: number; onViewAll: () => void }) {
  return (
    <button className="view-all-row" type="button" onClick={onViewAll}>
      <span>View all {count} alternatives</span>
      <ChevronRightIcon />
    </button>
  );
}

function buildAlternatives(approvedExamples: MatchedApprovedExample[]): AlternativeItem[] {
  return approvedExamples
    .filter((approvedExample) => approvedExample.brand && approvedExample.title && approvedExample.url && approvedExample.price_display)
    .map((approvedExample) => ({
      brand: approvedExample.brand,
      itemName: approvedExample.title,
      price: approvedExample.price_display,
      rating: approvedExample.score ?? scoreOutOf100(approvedExample.expected_scores.value),
      url: approvedExample.url,
      thumbnail: approvedExample.image_url ?? null
    }));
}

function AlternativeRow({ alternative }: { alternative: AlternativeItem }) {
  function handleOpenAlternative() {
    window.open(alternative.url, "_blank", "noopener,noreferrer");
  }

  return (
    <button className="alternative-row" type="button" onClick={handleOpenAlternative}>
      <div className="alternative-thumb">
        {alternative.thumbnail ? <img src={alternative.thumbnail} alt="" /> : <span />}
      </div>
      <div className="alternative-copy">
        <span>{toTitleCase(alternative.brand)}</span>
        <strong>{toTitleCase(alternative.itemName)}</strong>
      </div>
      <div className="alternative-score">
        <span>{alternative.price}</span>
        <strong>{alternative.rating}<small>/100</small></strong>
      </div>
    </button>
  );
}

function HowScoresSection({ verdict }: { verdict: Stage6Verdict }) {
  const [openCategory, setOpenCategory] = useState<string | null>("Quality");
  const rows = [
    { title: "Quality", score: verdict.scores.quality, verdict: verdict.verdicts.quality },
    { title: "Value", score: verdict.scores.value, verdict: verdict.verdicts.value },
    { title: "Durability", score: verdict.scores.durability, verdict: verdict.verdicts.durability },
    { title: "Style", score: verdict.scores.aesthetic, verdict: verdict.verdicts.aesthetic }
  ].filter((row) => Number.isFinite(row.score) && row.verdict.verdict.trim());

  if (rows.length === 0) return null;

  return (
    <section className="panel-section score-explainer">
      <SectionHeader title="Why this score?" />
      <div className="score-card-list">
        {rows.map((row) => {
          const score = scoreOutOf100(row.score);
          const isOpen = openCategory === row.title;
          return (
            <div className={`score-card${isOpen ? " score-card--open" : ""}`} key={row.title}>
              <button className="score-card-head" type="button" onClick={() => setOpenCategory(isOpen ? null : row.title)} aria-expanded={isOpen}>
                <span>{row.title}</span>
                <strong>{score}<small>/100</small></strong>
                <ChevronDownIcon />
              </button>
              <div className="score-card-body" aria-hidden={!isOpen}>
                <Meter value={score} max={100} />
                <p>{row.verdict.verdict}</p>
              </div>
            </div>
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
      <p className="debug-label">Previous Components</p>
      <MainVerdict verdict={analysis.verdict} />
      <ScoreSection verdict={analysis.verdict} />
      <MaterialSection classification={analysis.classification} />
      <SignalSection title="Quality Signals" items={analysis.classification.quality_signals} emptyLabel="No Positive Quality Signals Found." />
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

function SignalIcon({ category, tone }: { category: SignalIconMetric; tone: SignalTone }) {
  if (category === "material" || category === "quality") {
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label="Material">
        <path d="M7 4l-3 3 2 3v10h12V10l2-3-3-3-4 2H11z" />
      </svg>
    );
  }

  if (category === "value") {
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label="Value">
        <path d="M20 12l-8 8-8-8V4h8z" />
        <circle cx="8" cy="8" r="1.5" />
      </svg>
    );
  }

  if (category === "durability") {
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label="Durability">
        <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
        <path d="M8.5 12l2.5 2.5L16 9.5" />
      </svg>
    );
  }

  if (category === "fit") {
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label="Fit">
        <rect x="3" y="9" width="18" height="7" rx="1" />
        <path d="M7 9v2M11 9v3M15 9v2M19 9v3" />
      </svg>
    );
  }

  if (category === "style") {
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label="Style">
        <path d="M12 3l1.5 5 5 1.5-5 1.5-1.5 5-1.5-5-5-1.5 5-1.5z" />
        <path d="M18 15l.6 2 2 .6-2 .6-.6 2-.6-2-2-.6 2-.6z" />
      </svg>
    );
  }

  if (tone === "negative" || tone === "neutral") {
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label="Evidence">
        <path d="M6 4h9l3 3v13H6z" />
        <path d="M14 4v4h4M9 12h6M9 16h4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" role="img" aria-label="Signal">
      <path d="M7 4l-3 3 2 3v10h12V10l2-3-3-3-4 2H11z" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="caret-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ShirtPlaceholder() {
  return (
    <svg className="shirt-placeholder" width="54" height="60" viewBox="0 0 160 175" aria-hidden="true">
      <path d="M46 50 L16 70 Q12 73 14 78 L24 96 Q26 100 31 97 L52 84 Z" />
      <path d="M114 50 L144 70 Q148 73 146 78 L136 96 Q134 100 129 97 L108 84 Z" />
      <path d="M52 48 L62 48 Q80 66 98 48 L108 48 Q113 49 113 56 L117 152 Q117 160 108 160 L52 160 Q43 160 43 152 L47 56 Q47 49 52 48 Z" />
      <path d="M62 48 L80 64 L67 50 Z" />
      <path d="M98 48 L80 64 L93 50 Z" />
      <line x1="80" y1="64" x2="80" y2="156" />
      <circle cx="80" cy="84" r="1.8" />
      <circle cx="80" cy="104" r="1.8" />
      <circle cx="80" cy="124" r="1.8" />
      <circle cx="80" cy="144" r="1.8" />
    </svg>
  );
}

function scoreOutOf100(score: number): number {
  return Math.round(score * 10);
}

function scoreTone(score: number): "positive" | "neutral" | "warning" {
  if (score >= 85) return "positive";
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
    good_signs: verdict?.analysis?.verdict.good_signs ?? [],
    watch_outs: verdict?.analysis?.verdict.watch_outs ?? [],
    unverified: verdict?.analysis?.verdict.unverified ?? [],
    extraction,
    classification,
    visual_enrichment: visualEnrichment,
    backend_response: verdict
  };

  return (
    <div className="debug-panel">
      <p>
        Shows the underlying extraction, classification, visual guardrails and backend response for bug testing builds.
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
  return toGrade(scoreOutOf100(score));
}

function toGrade(score: number): string {
  if (score >= 85) return "A";
  if (score >= 65) return "B+";
  if (score >= 50) return "B";
  if (score >= 35) return "C";
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

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function recommendationLabel(recommendation: Recommendation): string {
  if (recommendation === "excellent_pick") return "Excellent pick";
  if (recommendation === "worth_buying") return "Worth buying";
  if (recommendation === "poor_value") return "Poor value";
  if (recommendation === "cant_assess") return "Can’t assess";
  return toTitleCase(formatLabel(recommendation));
}

function loadingSignalLine(classification: ProductClassification, price: string | null): string {
  const category = classification.category !== "other" ? toTitleCase(formatLabel(classification.category)) : null;
  const material = loadingMaterialFact(classification);
  const details = [category, material, price].filter(Boolean);
  return details.length ? `${details.join(", ")}.` : "Product details picked up from this page.";
}

function loadingMaterialFact(classification: ProductClassification): string | null {
  if (classification.material_description) return stripTrailingPunctuation(classification.material_description);
  if (classification.material_family !== "unknown") return toTitleCase(formatLabel(classification.material_family));
  return null;
}

function stripTrailingPunctuation(value: string): string {
  return value.trim().replace(/[.,;:]+$/, "");
}

function waitForLoadingStepAcknowledgement(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, LOADING_STEP_ACKNOWLEDGEMENT_MS));
}

function conciseSentence(value: string): string {
  const sentence = value.split(/(?<=[.!?])\s+/)[0]?.trim() || value.trim();
  return sentence.length > 118 ? truncate(sentence, 118) : sentence;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}
