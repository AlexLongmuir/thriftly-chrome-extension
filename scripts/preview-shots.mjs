/* Screenshot every panel state at side-panel widths using the preview harness.
   Usage: node scripts/preview-shots.mjs [--base http://127.0.0.1:5173] [--widths 360]
   Requires `npm run dev` to be running. Writes PNGs to shots/. */
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

const BASE = flag("base", "http://127.0.0.1:5173");
const WIDTHS = flag("widths", "320,360,420").split(",").map(Number);
const ONLY = flag("only", "").split(",").filter(Boolean);
const HEIGHT = 760;

const SCENARIOS = [
  { name: "empty", view: "empty" },
  {
    name: "loading-read",
    view: "loading-read",
    drive: async (page) => {
      await clickCta(page);
      await page.waitForSelector(".loading-state", { timeout: 5000 });
      await sleep(700);
    }
  },
  {
    name: "loading-research",
    view: "loading-research",
    drive: async (page) => {
      await clickCta(page);
      await page.waitForSelector(".loading-state", { timeout: 5000 });
      await sleep(1400);
    }
  },
  {
    name: "loaded",
    view: "loaded",
    drive: async (page) => {
      await clickCta(page);
      await page.waitForSelector(".scouted-hero", { timeout: 8000 });
      await sleep(1600);
    }
  },
  {
    name: "loaded-bottom",
    view: "loaded",
    drive: async (page) => {
      await clickCta(page);
      await page.waitForSelector(".scouted-hero", { timeout: 8000 });
      await sleep(1600);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(400);
    }
  },
  {
    name: "alternatives",
    view: "loaded",
    drive: async (page) => {
      await clickCta(page);
      await page.waitForSelector(".scouted-hero", { timeout: 8000 });
      await sleep(1200);
      await page.click(".view-all-row");
      await page.waitForSelector(".alternatives-page", { timeout: 5000 });
      await sleep(700);
    }
  },
  {
    name: "how-it-works",
    view: "empty",
    drive: async (page) => {
      await page.waitForSelector(".technical-link-button", { timeout: 5000 });
      await page.click(".technical-link-button");
      await page.waitForSelector(".how-page", { timeout: 5000 });
      await sleep(700);
    }
  },
  {
    name: "error",
    view: "error",
    drive: async (page) => {
      await clickCta(page);
      await page.waitForSelector(".notice--error", { timeout: 8000 });
      await sleep(700);
    }
  }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickCta(page) {
  const selector = (await page.$(".empty-cta button")) ? ".empty-cta button" : ".primary-button";
  await page.click(selector);
}

mkdirSync("shots", { recursive: true });

const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"] });

for (const scenario of SCENARIOS) {
  if (ONLY.length && !ONLY.includes(scenario.name)) continue;
  for (const width of WIDTHS) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: HEIGHT, deviceScaleFactor: 2 });
    try {
      await page.goto(`${BASE}/preview.html?view=${scenario.view}`, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForSelector(".panel-shell", { timeout: 8000 });
      await sleep(600);
      if (scenario.drive) await scenario.drive(page);
      await page.screenshot({ path: `shots/${scenario.name}-${width}.png` });
      console.log(`ok ${scenario.name}-${width}`);
    } catch (error) {
      console.error(`fail ${scenario.name}-${width}: ${error.message}`);
      try {
        await page.screenshot({ path: `shots/${scenario.name}-${width}-FAILED.png` });
      } catch {}
    } finally {
      await page.close();
    }
  }
}

await browser.close();
