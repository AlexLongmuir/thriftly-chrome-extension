/* Capture cropped frames of the 3D product stage across a full rotation.
   Usage: node scripts/stage-frames.mjs [--view empty|loaded] (requires `npm run dev`)
   Writes shots/stage/<view>-f00..png */
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer";

const args = process.argv.slice(2);
const VIEW = args.includes("--view") ? args[args.indexOf("--view") + 1] : "empty";
const FRAMES = 14;
const INTERVAL_MS = 420;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

mkdirSync("shots/stage", { recursive: true });

const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"] });
const page = await browser.newPage();
await page.setViewport({ width: 360, height: 760, deviceScaleFactor: 2 });
await page.goto(`http://127.0.0.1:5173/preview.html?view=${VIEW === "empty" ? "empty" : "loaded"}`, {
  waitUntil: "domcontentloaded"
});
await page.waitForSelector(".panel-shell", { timeout: 8000 });

if (VIEW === "loaded") {
  await page.click(".empty-cta button");
  await page.waitForSelector(".rating-row", { timeout: 8000 });
}

await page.waitForSelector('.product-stage-canvas[data-active="true"]', { timeout: 8000 });
await sleep(800);

const stage = await page.$(".product-stage");
for (let i = 0; i < FRAMES; i++) {
  await stage.screenshot({ path: `shots/stage/${VIEW}-f${String(i).padStart(2, "0")}.png` });
  await sleep(INTERVAL_MS);
}
console.log(`ok ${FRAMES} frames for ${VIEW}`);
await browser.close();
