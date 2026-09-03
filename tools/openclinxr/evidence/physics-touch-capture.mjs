/**
 * Self-contained portless Playwright capture for physics clinical touch R3 evidence.
 *
 * Spawns UI-XR dev:portless, polls until ready, captures ED patient with
 * physics-clinical-touch mode, writes PNGs + inspection.json, asserts size
 * gate (> 100 KB), and SIGTERMs the child process in finally.
 *
 * Prefer adopting spawnPortlessDevServer() from ./lib/portless-server.ts (parse
 * Vite Local: line) instead of local findFreePort + assumed PORT bind.
 *
 * Run from repo root:
 *   node tools/openclinxr/evidence/physics-touch-capture.mjs
 *
 * Or via package.json script:
 *   "evidence:physics-touch:portless": "node tools/openclinxr/evidence/physics-touch-capture.mjs"
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import playwright from "playwright";
import { PHYSICS_TOUCH_CAPTURE_OUTPUT_DIR } from "./physics-touch-capture-output.mjs";

// ── Config ──────────────────────────────────────────────────────────
// Declared once in ./physics-touch-capture-output.mjs; the contract tests and
// the arena consumer import the same constant instead of redeclaring it.
const OUTPUT_DIR = PHYSICS_TOUCH_CAPTURE_OUTPUT_DIR;
const SETTLE_MS = 25_000;
const SECOND_SHOT_MS = 5_000;
const SCREENSHOT_MIN_BYTES = 100_000;
const SERVER_READY_TIMEOUT_MS = 90_000;

// ── Free-port helper ────────────────────────────────────────────────
function findFreePort(start = 5199) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(start, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// ── Server lifecycle ────────────────────────────────────────────────
function waitForServer(port, child) {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (child.exitCode !== null) {
        return reject(new Error(`UI-XR dev server exited before ready (code ${child.exitCode})`));
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        if (res.ok) return resolve();
      } catch { /* retry */ }
      if (Date.now() > deadline) return reject(new Error(`UI-XR not ready on port ${port} within ${SERVER_READY_TIMEOUT_MS}ms`));
      setTimeout(poll, 750);
    };
    poll();
  });
}

function stopServer(child) {
  if (child.exitCode === null) child.kill("SIGTERM");
}

// ── Main capture ────────────────────────────────────────────────────
async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. Find free port
  const port = await findFreePort();
  console.log(`[capture] Acquired free port: ${port}`);

  // 2. Spawn UI-XR dev:portless
  const child = spawn("pnpm", ["--filter", "@openclinxr/ui-xr", "dev:portless"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: "pipe",
  });

  try {
    // 3. Wait for server ready
    console.log(`[capture] Waiting for UI-XR on http://127.0.0.1:${port}/ ...`);
    await waitForServer(port, child);
    console.log("[capture] UI-XR ready.");

    // 4. Launch Playwright + capture ED patient with physics-clinical-touch
    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      const consoleErrors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text().substring(0, 300));
      });
      page.on("pageerror", (err) => consoleErrors.push(err.message.substring(0, 300)));

      const params = new URLSearchParams({
        humanoidSourceComparator: "ed_anny_real_garment_patient",
        capture: "physics-clinical-touch",
        openclinxrScenarioId: "ed_chest_pain_priority_v1",
        openclinxrPortalStart: "encounter",
        openclinxrAcceleratedExam: "1",
      });
      const url = `http://127.0.0.1:${port}/?${params.toString()}`;
      console.log(`[capture] Navigating to ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

      console.log(`[capture] Waiting ${SETTLE_MS}ms for humanoid load + physics settle...`);
      await page.waitForTimeout(SETTLE_MS);

      // Console errors dump
      if (consoleErrors.length > 0) {
        console.log(`[capture] ${consoleErrors.length} console/page errors:`);
        consoleErrors.slice(0, 10).forEach((e) => console.log(`  [err] ${e}`));
      }

      // Deep debug probe: boot phases only (lightweight)
      const bootInfo = await page.evaluate(() => {
        const w = window;
        const bootEvidence = w.__openClinXrBootEvidence;
        const scene = w.__openClinXrDebugScene;
        let meshCount = 0;
        if (scene) scene.traverse(() => { meshCount++; });
        return {
          hasScene: !!scene,
          meshCount,
          bootPhases: bootEvidence?.events?.map((e) => e.phase) ?? [],
        };
      });
      console.log("[capture] Boot:", JSON.stringify(bootInfo, null, 2));

      // Collect runtime evidence
      const evidence = await page.evaluate(() => {
        const w = window;
        return {
          hasMouthGazeEvidence: !!(w.__openClinXrMouthGazePoseComparatorEvidence),
          comparator: w.__openClinXrMouthGazePoseComparatorEvidence?.comparator ?? "none",
          hasGarmentGeometry: !!(w.__openClinXrMouthGazePoseComparatorEvidence?.garmentGeometry),
          sleeveDeform: w.__openClinXrMouthGazePoseComparatorEvidence?.garmentGeometry?.sleeveDeform ?? "none",
        };
      });
      console.log("[capture] Evidence:", JSON.stringify(evidence, null, 2));

      // Physics touch userData probe
      const physicsUserData = await page.evaluate(() => {
        const results = [];
        const scene = window.__openClinXrDebugScene;
        if (scene) {
          scene.traverse((obj) => {
            if (obj.userData?.openClinXrPhysicsTouchEvidence) {
              results.push({
                name: obj.name ?? "unnamed",
                physicsTouch: obj.userData.openClinXrPhysicsTouchEvidence,
              });
            }
          });
        }
        return results;
      });
      console.log("[capture] Physics touch userData:", JSON.stringify(physicsUserData, null, 2));

      // Emissive surface probe
      const emissiveInfo = await page.evaluate(() => {
        const results = [];
        const scene = window.__openClinXrDebugScene;
        if (scene) {
          scene.traverse((obj) => {
            if (obj.material?.emissive) {
              results.push({
                name: obj.name ?? "unnamed",
                emissive: `#${obj.material.emissive.getHexString()}`,
                intensity: obj.material.emissiveIntensity,
              });
            }
          });
        }
        return results;
      });
      console.log("[capture] Emissive surfaces:", JSON.stringify(emissiveInfo.slice(0, 5), null, 2));

      // Screenshot 1 – front
      const shot1Path = path.join(OUTPUT_DIR, "physics-touch-ed-patient-front.png");
      await page.screenshot({ path: shot1Path });
      const shot1Stat = statSync(shot1Path);
      console.log(`[capture] Screenshot 1: ${shot1Path} (${(shot1Stat.size / 1024).toFixed(1)} KB)`);

      // Second settle + screenshot – palpation phase
      await page.waitForTimeout(SECOND_SHOT_MS);
      const shot2Path = path.join(OUTPUT_DIR, "physics-touch-ed-patient-palpation.png");
      await page.screenshot({ path: shot2Path });
      const shot2Stat = statSync(shot2Path);
      console.log(`[capture] Screenshot 2: ${shot2Path} (${(shot2Stat.size / 1024).toFixed(1)} KB)`);

      // Inspection JSON
      const inspection = {
        schemaVersion: "openclinxr.physics-touch-capture.v1",
        capturedAt: new Date().toISOString(),
        portUsed: port,
        url,
        evidence,
        physicsUserData,
        emissiveInfo: emissiveInfo.slice(0, 10),
        screenshots: [
          { path: shot1Path, sizeBytes: shot1Stat.size },
          { path: shot2Path, sizeBytes: shot2Stat.size },
        ],
        claimScope: "ed_anny_real_garment_patient_physics_clinical_touch_runtime_evidence_Q5_no_clinical_no_quest",
        notEvidenceFor: [
          "clinical_validity",
          "exam_equivalence",
          "scoring",
          "learner_readiness",
          "quest_readiness",
          "website_publication",
        ],
      };
      const inspectionPath = path.join(OUTPUT_DIR, "inspection.json");
      writeFileSync(inspectionPath, `${JSON.stringify(inspection, null, 2)}\n`, "utf8");
      console.log(`[capture] Inspection: ${inspectionPath}`);

      // ── Assertions ─────────────────────────────────────────────────
      let failed = false;
      for (const s of inspection.screenshots) {
        if (s.sizeBytes < SCREENSHOT_MIN_BYTES) {
          console.error(`[capture] FAIL: ${s.path} is ${s.sizeBytes} bytes, below minimum ${SCREENSHOT_MIN_BYTES}`);
          failed = true;
        }
      }
      if (failed) {
        throw new Error("Screenshot size gate failed.");
      }
      console.log(`[capture] Size gate passed (all screenshots > ${SCREENSHOT_MIN_BYTES} bytes).`);

      // Physics evidence advisory (non-fatal)
      if (physicsUserData.length === 0) {
        console.log("[capture] ADVISORY: No physics touch userData found on garment meshes (capture mode may still be active).");
      } else {
        console.log(`[capture] Physics evidence confirmed on ${physicsUserData.length} mesh(es).`);
      }
    } finally {
      await browser.close();
    }
  } finally {
    // 6. SIGTERM child process
    stopServer(child);
    console.log("[capture] UI-XR server stopped.");
  }

  // Print output path for handoff
  const inspectionPath = path.join(OUTPUT_DIR, "inspection.json");
  process.stdout.write(`${inspectionPath}\n`);
  console.log("[capture] Done.");
}

main().catch((err) => {
  console.error("[capture] ERROR:", err);
  process.exit(1);
});
