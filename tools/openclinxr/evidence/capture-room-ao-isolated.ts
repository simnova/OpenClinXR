/**
 * Issue-526 phase B: isolated capture of ONE generated room under IBL, before/after the
 * bounded-AO rebake. Extends the proven #525/#529 interior-wall probe path (same portless
 * boot, same wall-band instrument) and adds an AO-off cell per state, so the pixel evidence
 * separates "the room is lit" from "the AO map is sane".
 *
 * States (driven by which GLB is on disk — the file IS the treatment):
 *   pre  : shipped cave-AO GLB   -> captured BEFORE promotion in this slice
 *   post : bounded-AO GLB        -> captured AFTER promotion
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SHEET_ROOM,
  SHEET_SCENARIO_ID,
} from "./interior-wall-lighting-variants.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";
import { buildRoomCaptureUrl, waitForStationShell } from "./ui-xr-environment-room-capture.js";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../..");
const OUT_DIR = pathResolve(HERE, "issue-526");

const WALL_BAND = { left: 0.08, top: 0.18, width: 0.42, height: 0.48 } as const;

function buildIblUrl(baseUrl: string, scenarioId: string): string {
  const url = new URL(buildRoomCaptureUrl(baseUrl, scenarioId, "scene-overview"));
  url.searchParams.set("stationLighting", "room_environment_ibl");
  return url.toString();
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const glbPath = pathResolve(REPO, `apps/ui-xr/public/xr-assets/environment/${SHEET_ROOM}.glb`);
  const glbSha256 = createHash("sha256").update(readFileSync(glbPath)).digest("hex");
  const label = process.argv[2] === "post" ? "post" : "pre";

  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd: REPO, readyTimeoutMs: 180_000 });
  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1007, height: 900 } });
      const url = buildIblUrl(server.url, SHEET_SCENARIO_ID);
      process.stdout.write(`room-ao-isolated[${label}]: goto ${url}\n`);
      await page.goto(url, { waitUntil: "load", timeout: 180_000 });
      await waitForStationShell(page, 180_000);
      await page.waitForFunction(
        `(() => {
          const scene = window.__openClinXrDebugScene;
          if (!scene || typeof scene.getObjectByName !== "function") return false;
          return !!scene.getObjectByName("openclinxr.station-environment.infinigen-room");
        })()`,
        null,
        { timeout: 180_000 },
      );
      await page.waitForTimeout(6000);

      // Hide HUD chrome; keep the canvas.
      await page.evaluate(`(() => {
        const hide = (sel) => {
          for (const el of document.querySelectorAll(sel)) {
            el.style.visibility = "hidden"; el.style.opacity = "0"; el.style.pointerEvents = "none";
          }
        };
        hide("[data-openclinxr-panel], .openclinxr-panel, #clinical-panel, #dialogue-panel");
        hide("button, nav, header, aside");
        const canvas = document.querySelector("canvas");
        if (canvas) { canvas.style.visibility = "visible"; canvas.style.opacity = "1"; }
      })()`);
      await page.waitForTimeout(300);

      for (const ao of [1, 0] as const) {
        const touched = await page.evaluate(`(() => {
          const scene = window.__openClinXrDebugScene;
          if (!scene || typeof scene.traverse !== "function") return -1;
          let n = 0;
          scene.traverse(function (o) {
            const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
            for (const m of mats) {
              if (m && ("aoMap" in m)) { m.aoMapIntensity = ${ao}; m.needsUpdate = true; n += 1; }
            }
          });
          return n;
        })()`);
        await page.waitForTimeout(400);
        const imagePath = pathResolve(OUT_DIR, `isolated-${label}-ao${ao}.png`);
        const bytes = new Uint8Array(await page.screenshot({ fullPage: false, type: "png" }));
        writeFileSync(imagePath, bytes);
        process.stdout.write(`room-ao-isolated[${label}]: aoMapIntensity=${ao} materials=${touched} -> ${imagePath}\n`);
      }

      const report = {
        schemaVersion: "openclinxr.room-ao-isolated-capture.v1",
        state: label,
        room: `${SHEET_ROOM}.glb`,
        scenarioId: SHEET_SCENARIO_ID,
        lightingVariant: "room_environment_ibl",
        cameraNote: "default scene-overview camera; HUD hidden",
        wallBandRegion: { ...WALL_BAND },
        glbSha256,
        images: ["isolated-" + label + "-ao1.png", "isolated-" + label + "-ao0.png"].map((n) => `tools/openclinxr/evidence/issue-526/${n}`),
        claimScope: "pixel evidence that the bounded-AO rebake removes the black-noise field under IBL",
        notEvidenceFor: ["product lighting default", "quest_readiness", "clinical_validity"],
      };
      writeFileSync(pathResolve(OUT_DIR, `isolated-${label}-report.json`), JSON.stringify(report, null, 2) + "\n");
    } finally {
      await browser.close();
    }
  } finally {
    await stopPortlessDevServer(server.proc);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
