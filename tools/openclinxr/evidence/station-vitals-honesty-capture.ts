/**
 * #115 observable half: read EHR vitals row for two stations (prose + placeholder eras).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";
import { buildRoomCaptureUrl } from "./ui-xr-environment-room-capture.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = path.join(root, ".openclinxr/evidence/station-vitals-honesty");

async function main(): Promise<void> {
  const ids = ["oncology_bad_news_family_v1", "ward_delirium_med_rec_v1"];
  await mkdir(outDir, { recursive: true });

  const server = await spawnPortlessDevServer({
    filter: "@openclinxr/ui-xr",
    readyTimeoutMs: 180_000,
  });
  const browser = await chromium.launch({ headless: true });
  const results: Array<{
    scenarioId: string;
    vitalsLabel: string;
    vitalsValue: string;
    chartedAttr: string | null;
    chiefConcern: string;
    imagePath: string;
  }> = [];
  try {
    for (const scenarioId of ids) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        const url = buildRoomCaptureUrl(server.url, scenarioId, "scene-overview");
        process.stdout.write(`vitals-capture: goto ${scenarioId}\n`);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await page.waitForSelector("#ehr-vitals-value", { timeout: 90_000 });
        await page.waitForTimeout(2500);
        const vitalsLabel = (await page.locator("#ehr-vitals-label").innerText()).trim();
        const vitalsValue = (await page.locator("#ehr-vitals-value").innerText()).trim();
        const chartedAttr = await page.locator("[data-ehr-vitals-charted]").getAttribute("data-ehr-vitals-charted");
        const chiefConcern = (await page.locator(".ehr-panel dd").first().innerText()).trim();
        const imagePath = `${scenarioId}-ehr-vitals.png`;
        await page.screenshot({ path: path.join(outDir, imagePath), fullPage: false });
        results.push({ scenarioId, vitalsLabel, vitalsValue, chartedAttr, chiefConcern, imagePath });
        process.stdout.write(
          `vitals-capture: ${scenarioId} label=${vitalsLabel} value=${vitalsValue} charted=${chartedAttr}\n`,
        );
      } finally {
        await page.close().catch(() => undefined);
      }
    }
    await writeFile(
      path.join(outDir, "capture-report.json"),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          claimScope: ["ehr_vitals_row_text_from_running_ui_xr"],
          notEvidenceFor: ["clinical_validity_of_vitals", "quest_readiness"],
          results,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } finally {
    await browser.close().catch(() => undefined);
    try {
      await stopPortlessDevServer(server.proc);
    } catch {
      // ignore
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
