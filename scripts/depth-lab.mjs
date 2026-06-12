/* Debug the depth/mask estimation: runs buildDepthMap inside the preview page
   (via vite's dev-server module graph) and writes the colour texture, the
   mask/depth field and stats to shots/depth/. Requires `npm run dev`.
   Usage: node scripts/depth-lab.mjs [imageUrl] */
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer";

const imageUrl = process.argv[2] ?? null;

mkdirSync("shots/depth", { recursive: true });

const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5173/preview.html?view=empty", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".panel-shell", { timeout: 8000 });

page.on("console", (message) => console.log("[page]", message.text()));

const result = await page.evaluate(async (overrideUrl) => {
  const { buildDepthMap } = await import("/src/panel/stage/depth.ts");
  let url = overrideUrl;
  if (!url) {
    const mod = await import("/src/panel/assets/arket-white-linen-shirt.avif?url");
    url = mod.default;
  }
  const image = new Image();
  image.crossOrigin = "anonymous";
  const loadError = await new Promise((resolve) => {
    image.onload = () => resolve(null);
    image.onerror = () => resolve(`image failed to load: ${url}`);
    image.src = url;
  });
  if (loadError) return { error: loadError };
  const map = buildDepthMap(image);
  if (!map) return { error: "buildDepthMap returned null" };

  const depthCanvas = document.createElement("canvas");
  depthCanvas.width = map.depthWidth;
  depthCanvas.height = map.depthHeight;
  const ctx = depthCanvas.getContext("2d");
  const img = ctx.createImageData(map.depthWidth, map.depthHeight);
  for (let i = 0; i < map.depth.length; i++) {
    const v = Math.round(map.depth[i] * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // Composite the cutout over a saturated colour so the mask edge is visible.
  const compositeCanvas = document.createElement("canvas");
  compositeCanvas.width = map.color.width;
  compositeCanvas.height = map.color.height;
  const compositeCtx = compositeCanvas.getContext("2d");
  compositeCtx.fillStyle = "#0e7490";
  compositeCtx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);
  compositeCtx.drawImage(map.color, 0, 0);

  return {
    coverage: map.coverage,
    silhouette: map.silhouette,
    color: compositeCanvas.toDataURL("image/png"),
    depth: depthCanvas.toDataURL("image/png")
  };
}, imageUrl);

if (result.error) {
  console.error(result.error);
} else {
  writeFileSync("shots/depth/color.png", Buffer.from(result.color.split(",")[1], "base64"));
  writeFileSync("shots/depth/depth.png", Buffer.from(result.depth.split(",")[1], "base64"));
  console.log(`coverage=${result.coverage.toFixed(3)} silhouette=${result.silhouette}`);
}

await browser.close();
