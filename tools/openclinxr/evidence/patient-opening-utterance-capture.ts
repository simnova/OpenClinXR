/**
 * #113 observable half: read Mock Dialogue panel text for selected stations.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";
import { buildRoomCaptureUrl } from "./ui-xr-environment-room-capture.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = path.join(root, ".openclinxr/evidence/patient-opening-utterance");

async function main(): Promise<void> {
  const scenarios = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const ids =
    scenarios.length > 0
      ? scenarios
      : ["ward_delirium_med_rec_v1", "primary_care_dyslipidemia_joint_pain_v1"];
  await mkdir(outDir, { recursive: true });

  const server = await spawnPortlessDevServer({
    filter: "@openclinxr/ui-xr",
    readyTimeoutMs: 180_000,
  });
  const browser = await chromium.launch({ headless: true });
  const results: Array<{ scenarioId: string; dialogueText: string; imagePath: string }> = [];
  try {
    for (const scenarioId of ids) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        const url = buildRoomCaptureUrl(server.url, scenarioId, "scene-overview");
        process.stdout.write(`opening-capture: goto ${scenarioId}\n`);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await page.waitForSelector("#dialogue-line", { timeout: 90_000 });
        await page.waitForTimeout(2500);
        // Re-select after station switch may rewrite the panel.
        const dialogueText = (await page.locator("#dialogue-line").innerText()).trim();
        const imagePath = `${scenarioId}-mock-dialogue.png`;
        await page.screenshot({ path: path.join(outDir, imagePath), fullPage: false });
        results.push({ scenarioId, dialogueText, imagePath });
        process.stdout.write(`opening-capture: ${scenarioId} => ${dialogueText}\n`);
      } finally {
        await page.close().catch(() => undefined);
      }
    }
    await writeFile(
      path.join(outDir, "capture-report.json"),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          claimScope: ["mock_dialogue_panel_text_from_running_ui_xr"],
          notEvidenceFor: ["clinical_review_of_opening_lines", "quest_readiness"],
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
