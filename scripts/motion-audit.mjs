/* Capture frame sequences of key interactions for motion auditing.
   Usage: node scripts/motion-audit.mjs   (requires `npm run dev`)
   Writes PNG frame strips to shots/motion/. */
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer";

const BASE = "http://127.0.0.1:5173";
const WIDTH = 360;
const HEIGHT = 760;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

mkdirSync("shots/motion", { recursive: true });

const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"] });
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });

async function frames(name, action, count, intervalMs) {
  await action();
  for (let i = 0; i < count; i++) {
    await page.screenshot({ path: `shots/motion/${name}-f${String(i).padStart(2, "0")}.png` });
    await sleep(intervalMs);
  }
  console.log(`ok ${name} (${count} frames @ ${intervalMs}ms)`);
}

// 1. Empty -> loading -> loaded sequence
await page.goto(`${BASE}/preview.html?view=loaded`, { waitUntil: "domcontentloaded" });
await sleep(400);
await frames("check-flow", () => page.click(".empty-cta button"), 16, 140);

// 2. Accordion open/close
await page.goto(`${BASE}/preview.html?view=loaded`, { waitUntil: "domcontentloaded" });
await sleep(300);
await page.click(".empty-cta button");
await page.waitForSelector(".scouted-hero", { timeout: 8000 });
await sleep(1600);
await page.evaluate(() => document.querySelector(".score-explainer")?.scrollIntoView({ block: "center" }));
await sleep(300);
const heads = await page.$$(".score-card-head");
await frames("accordion", () => heads[1].click(), 8, 90);

// 3. Page slide to alternatives
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(200);
await page.evaluate(() => document.querySelector(".view-all-row")?.scrollIntoView({ block: "center" }));
await sleep(200);
await frames("page-slide", () => page.click(".view-all-row"), 8, 80);

await browser.close();
