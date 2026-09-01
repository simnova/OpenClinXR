import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const OUT = process.env["OPENCLINXR_SHOT_OUT"] ?? "docs/assets";
const ORIGIN = process.env["OPENCLINXR_ADMIN_ORIGIN"] ?? "http://127.0.0.1:5174";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 1600 },
  deviceScaleFactor: 1,
});

await page.goto(`${ORIGIN}/factory-station-cards-shot.html`, { waitUntil: "networkidle", timeout: 60_000 });
const cards = page.getByRole("group", { name: "Factory station cards" });
await cards.waitFor({ timeout: 30_000 });
await cards.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await cards.screenshot({
  path: `${OUT}/factory-station-cards-2026-09-01.png`,
});
const equipment = page.getByLabel("equipment_generate station card", { exact: true });
await equipment.scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await equipment.screenshot({
  path: `${OUT}/factory-station-equipment-generate-2026-09-01.png`,
});

await browser.close();
console.log(`wrote ${OUT}/factory-station-cards-2026-09-01.png`);
