/* Vercel serverless endpoint: generates a single turnaround view of a product
   from its photo using Gemini image generation.

   POST { image_url: string, angle: number, title?: string }
   ->   { angle, mime_type, data (base64), source: "generated" | "cache", model }

   One view per request keeps each response well under Vercel's body limits,
   lets the extension fetch angles in parallel, and makes a single failed
   angle non-fatal. Generated views are cached in Supabase (when configured)
   keyed by image hash + angle + model + prompt version, since turnarounds for
   a given photo never change. The Gemini key stays server-side only. */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";

const REQUEST_BODY_LIMIT_BYTES = 100_000;
const MAX_SOURCE_IMAGE_BYTES = 4_000_000;
const DEFAULT_IMAGE_MODEL = "gemini-3.0-flash-image";
const PROMPT_VERSION = "turnaround_v1";
const CACHE_TABLE = "product_view_cache";
const DEFAULT_CACHE_TTL_DAYS = 45;

/** Allowed turntable stops. 0 is the original photo and is never generated. */
const VIEW_ANGLES: Record<number, string> = {
  60: "a front three-quarter view, rotated 60 degrees so its right side comes toward the camera",
  120: "a back three-quarter view, rotated 120 degrees so most of its right side and part of its back face the camera",
  180: "directly from behind, showing the back of the garment",
  240: "a back three-quarter view, rotated 240 degrees so most of its left side and part of its back face the camera",
  300: "a front three-quarter view, rotated 300 degrees so its left side comes toward the camera"
};

type Env = Record<string, string | undefined>;
type Fetcher = typeof fetch;

type ViewRequest = {
  imageUrl: string;
  angle: number;
  title: string | null;
};

type CachedView = {
  cache_key: string;
  image_url: string;
  angle: number;
  mime_type: string;
  data: string;
  model: string;
  created_at?: string;
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  const env = process.env as Env;
  const apiKey = env.GEMINI_API_KEY || null;
  const model = env.PRODUCT_VIEWS_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;

  try {
    if (!apiKey) {
      throw new RequestError(503, "Image generation is not configured: GEMINI_API_KEY is missing.");
    }

    const request = parseViewRequest(await readJsonBody(req));
    const cacheKey = buildCacheKey(request, model);
    const cache = createViewCache(env, fetch);

    const cached = await cache?.get(cacheKey).catch(() => null);
    if (cached) {
      sendJson(res, 200, {
        angle: cached.angle,
        mime_type: cached.mime_type,
        data: cached.data,
        source: "cache",
        model: cached.model
      });
      return;
    }

    const source = await downloadSourceImage(request.imageUrl, fetch);
    const view = await generateView({ apiKey, model, request, source, fetcher: fetch });

    await cache
      ?.put({
        cache_key: cacheKey,
        image_url: request.imageUrl,
        angle: request.angle,
        mime_type: view.mimeType,
        data: view.base64,
        model
      })
      .catch(() => undefined);

    sendJson(res, 200, {
      angle: request.angle,
      mime_type: view.mimeType,
      data: view.base64,
      source: "generated",
      model
    });
  } catch (error) {
    if (error instanceof RequestError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    sendJson(res, 500, { error: "Unexpected product-views error." });
  }
}

function parseViewRequest(body: unknown): ViewRequest {
  if (!body || typeof body !== "object") {
    throw new RequestError(400, "Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  const imageUrl = typeof record.image_url === "string" ? record.image_url.trim() : "";
  const angle = typeof record.angle === "number" ? record.angle : NaN;

  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new RequestError(400, "image_url must be a valid URL.");
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new RequestError(400, "image_url must be http(s).");
  }
  if (!(angle in VIEW_ANGLES)) {
    throw new RequestError(400, `angle must be one of: ${Object.keys(VIEW_ANGLES).join(", ")}.`);
  }

  return {
    imageUrl,
    angle,
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim().slice(0, 140) : null
  };
}

function buildCacheKey(request: ViewRequest, model: string): string {
  return createHash("sha256")
    .update(`${request.imageUrl}\n${request.angle}\n${model}\n${PROMPT_VERSION}`)
    .digest("hex");
}

async function downloadSourceImage(
  url: string,
  fetcher: Fetcher
): Promise<{ mimeType: string; base64: string }> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: "image/*" } });
  } catch {
    throw new RequestError(422, "The product image could not be fetched.");
  }
  if (!response.ok) {
    throw new RequestError(422, `The product image responded with HTTP ${response.status}.`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    throw new RequestError(422, "The product image URL did not return an image.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new RequestError(422, "The product image is too large.");
  }
  return { mimeType: contentType.split(";")[0], base64: bytes.toString("base64") };
}

async function generateView(options: {
  apiKey: string;
  model: string;
  request: ViewRequest;
  source: { mimeType: string; base64: string };
  fetcher: Fetcher;
}): Promise<{ mimeType: string; base64: string }> {
  const subject = options.request.title ? `this exact garment (${options.request.title})` : "this exact garment";
  const prompt = [
    `Professional e-commerce studio product photograph of ${subject}, shown from ${VIEW_ANGLES[options.request.angle]}.`,
    "It must be the identical item: same colour, fabric, proportions, details and construction.",
    "Lay it out exactly like the reference photo (same presentation style: flat lay or ghost mannequin to match).",
    "Pure white seamless background, soft even studio lighting, garment centred and fully visible.",
    "No person, no mannequin visible, no props, no text, no watermark, no shadows of other objects."
  ].join(" ");

  const response = await options.fetcher(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(options.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          temperature: 0.25
        },
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              { inlineData: { mimeType: options.source.mimeType, data: options.source.base64 } }
            ]
          }
        ]
      })
    }
  );

  if (!response.ok) {
    throw new RequestError(502, `Gemini image generation failed with HTTP ${response.status}.`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  };
  const imagePart = data.candidates
    ?.flatMap((candidate) => candidate.content?.parts || [])
    .find((part) => part.inlineData?.data);

  if (!imagePart?.inlineData?.data) {
    throw new RequestError(502, "Gemini did not return an image for this view.");
  }

  return {
    mimeType: imagePart.inlineData.mimeType || "image/png",
    base64: imagePart.inlineData.data
  };
}

function createViewCache(env: Env, fetcher: Fetcher) {
  const supabaseUrl = env.SUPABASE_URL || null;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || null;
  if (!supabaseUrl || !serviceRoleKey) return null;

  const baseUrl = supabaseUrl.replace(/\/+$/, "");
  const ttlDays = Number(env.PRODUCT_VIEWS_CACHE_TTL_DAYS) || DEFAULT_CACHE_TTL_DAYS;
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  };

  return {
    async get(cacheKey: string): Promise<CachedView | null> {
      const response = await fetcher(
        `${baseUrl}/rest/v1/${CACHE_TABLE}?cache_key=eq.${encodeURIComponent(cacheKey)}&select=*&limit=1`,
        { headers }
      );
      if (!response.ok) return null;
      const rows = (await response.json()) as CachedView[];
      const row = rows[0];
      if (!row) return null;
      if (row.created_at && Date.now() - Date.parse(row.created_at) > ttlDays * 86_400_000) {
        return null;
      }
      return row;
    },
    async put(view: CachedView): Promise<void> {
      await fetcher(`${baseUrl}/rest/v1/${CACHE_TABLE}?on_conflict=cache_key`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify([view])
      });
    }
  };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > REQUEST_BODY_LIMIT_BYTES) {
      throw new RequestError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    throw new RequestError(400, "Request body is required.");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RequestError(400, "Request body must be valid JSON.");
  }
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  const allowOrigin = typeof origin === "string" && isAllowedOrigin(origin) ? origin : "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol === "chrome-extension:") return true;
    if ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && /^https?:$/.test(url.protocol)) return true;
    return false;
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
