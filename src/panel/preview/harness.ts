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
    return realFetch(input, init);
  }) as typeof window.fetch;
}
