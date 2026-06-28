import { MESSAGE_TYPES } from "../../shared/messages";
import { fixtureExtraction, fixtureVerdict } from "./fixture";

type PreviewView = "empty" | "loading-read" | "loading-research" | "loaded" | "error";

const params = new URLSearchParams(window.location.search);
const view = (params.get("view") as PreviewView) || "empty";

const NEVER = new Promise<never>(() => {});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function installPreviewHarness(): void {
  const extractDelay = view === "loading-read" ? Number.POSITIVE_INFINITY : 220;
  const backendDelay = view === "loading-research" ? Number.POSITIVE_INFINITY : 420;

  const chromeMock = {
    runtime: {
      sendMessage: async (message: { type?: string }) => {
        if (message?.type !== MESSAGE_TYPES.EXTRACT_ACTIVE_TAB) {
          return { ok: false, error: "Unknown preview message." };
        }
        if (!Number.isFinite(extractDelay)) await NEVER;
        await wait(extractDelay);
        if (view === "error") {
          return { ok: false, error: "This page could not be read. Open a product page and try again." };
        }
        return { ok: true, result: fixtureExtraction };
      }
    }
  };

  const globalScope = window as unknown as { chrome?: unknown };
  try {
    globalScope.chrome = chromeMock;
  } catch {
    Object.assign((globalScope.chrome ??= {}) as object, chromeMock);
  }
  const installed = globalScope.chrome as { runtime?: unknown };
  if (!installed?.runtime || installed.runtime !== chromeMock.runtime) {
    Object.assign(installed as object, chromeMock);
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("quality-check")) {
      if (!Number.isFinite(backendDelay)) await NEVER;
      await wait(backendDelay);
      return new Response(JSON.stringify(fixtureVerdict), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.includes("product-views")) {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { angle?: number };
      const angle = body.angle ?? 0;
      await wait(900 + Math.random() * 600);
      return new Response(JSON.stringify(await mockGeneratedView(angle)), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return realFetch(input, init);
  }) as typeof window.fetch;
}

/* Stand-in for the Gemini endpoint: serves the fixture photo mirrored and/or
   dimmed per angle, so the turnaround mechanics (per-view depth, residual
   rotation, boundary crossfades) can be audited without an API key. */
async function mockGeneratedView(angle: number): Promise<{ angle: number; mime_type: string; data: string; source: string }> {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = fixtureExtraction.snapshot.product.imageUrls[0];
  });
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  const mirrored = angle > 90 && angle < 270;
  const backFacing = angle >= 120 && angle <= 240;
  if (mirrored) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  if (backFacing) ctx.filter = "brightness(0.94)";
  ctx.drawImage(image, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  return {
    angle,
    mime_type: "image/png",
    data: dataUrl.split(",")[1],
    source: "generated"
  };
}
