import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const OUT = "docs/assets";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1600, height: 1200 },
  deviceScaleFactor: 1,
});

await page.goto("http://127.0.0.1:5174/exam-forms", { waitUntil: "networkidle", timeout: 60_000 });
const compile = page.getByRole("group", { name: "Faculty compile this encounter" });
await compile.waitFor({ timeout: 30_000 });
await compile.scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await page.screenshot({
  path: `${OUT}/worldview-exam-forms-queue-2026-08-31.png`,
  fullPage: false,
});

const graph = page.locator(".compile-graph-canvas");
await graph.waitFor({ timeout: 15_000 });
await graph.evaluate((el) => {
  const node = el as HTMLElement;
  node.style.width = "1100px";
  node.style.height = "640px";
  node.style.maxWidth = "none";
  window.dispatchEvent(new Event("resize"));
});
await page.waitForTimeout(900);
await graph.screenshot({ path: `${OUT}/worldview-compile-graph-2026-08-31.png` });

await page.goto("http://127.0.0.1:5174/authoring", { waitUntil: "networkidle", timeout: 60_000 });
const loadExample = page.getByRole("button", { name: /Load ED Chest Pain example/i });
if (await loadExample.count()) {
  await loadExample.first().click();
  await page.waitForTimeout(500);
}
await page.screenshot({
  path: `${OUT}/worldview-case-authoring-2026-08-31.png`,
  fullPage: false,
});
const actorsStep = page.getByText("Actors & interactions");
if (await actorsStep.count()) {
  await actorsStep.first().click();
  await page.waitForTimeout(500);
  await page.screenshot({
    path: `${OUT}/worldview-case-authoring-actors-2026-08-31.png`,
    fullPage: false,
  });
}

await browser.close();
console.log("wrote worldview screenshots to docs/assets/");
