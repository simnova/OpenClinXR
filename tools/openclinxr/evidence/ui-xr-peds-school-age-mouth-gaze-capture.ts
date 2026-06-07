import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chromium } from "playwright";

type CliOptions = {
  port: number;
  outputDir: string;
  screenshotPath: string;
  inspectionPath: string;
  waitMs: number;
};

const DEFAULT_URL =
  "http://127.0.0.1:5173/?openclinxrScenarioId=peds_asthma_parent_anxiety_v1" +
  "&openclinxrCaptureMode=mouth-gaze-pose" +
  "&openclinxrPortalStart=encounter" +
  "&openclinxrAcceleratedExam=1" +
  "&humanoidSourceComparator=peds_anny_school_age_mpfb2_eye_patient";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const glbPath = "apps/ui-xr/public/cagematch/anny-school-age/current/peds_patient_child_mpfb2_eye.glb";
  if (!existsSync(glbPath)) {
    throw new Error(`Missing UI-XR school-age comparator GLB: ${glbPath}`);
  }

  await mkdir(options.outputDir, { recursive: true });
  const server = spawn("pnpm", ["--filter", "@openclinxr/ui-xr", "dev:portless"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(options.port) },
    stdio: "pipe",
  });

  try {
    await waitForServer(options.port, server);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
      await page.goto(`${DEFAULT_URL.replace("127.0.0.1:5173", `127.0.0.1:${options.port}`)}`, {
        waitUntil: "networkidle",
      });
      await page.waitForFunction(
        () => {
          const evidence = window.__openClinXrMouthGazePoseComparatorEvidence;
          const sceneEvidence = window.__openClinXrSceneAssetEvidence;
          return Boolean(
            evidence?.comparator === "peds_anny_school_age_mpfb2_eye_patient"
            && evidence.captureMode.includes("mouth-gaze-pose")
            && (evidence.morphTargetAppliedTargetCount ?? 0) > 0
            && evidence.emotionTransitionCuePresent
            && evidence.visemeTimelineComparatorEvidencePresent
            && (
              evidence.gazeProbePlayback === "gltf_gaze_probe_clip_playing"
              || sceneEvidence?.gazeProbePlayback === "gltf_gaze_probe_clip_playing"
            ),
          );
        },
        { timeout: 180_000 },
      );
      await page.waitForTimeout(options.waitMs);
      await page.screenshot({ path: options.screenshotPath, fullPage: false });
      const inspection = await page.evaluate(() => ({
        mouthGaze: window.__openClinXrMouthGazePoseComparatorEvidence ?? null,
        speech: window.__openClinXrHumanoidSpeechEvidence ?? null,
        sceneAssets: window.__openClinXrSceneAssetEvidence ?? null,
        visemeComparator: window.__openClinXrSceneAssetEvidence ?? null,
        adaptiveDialogue: window.__openClinXrPedsAdaptiveDialogueEvidence ?? null,
        pageErrors: window.__openClinXrBootEvidence?.pageErrors ?? [],
      }));
      await writeFile(
        options.inspectionPath,
        `${JSON.stringify(
          {
            schemaVersion: "openclinxr.ui-xr-peds-school-age-mouth-gaze-capture.v1",
            generatedAt: new Date().toISOString(),
            claimScope: "ui_xr_school_age_mouth_gaze_comparator_runtime_evidence_no_promotion",
            url: page.url(),
            screenshotPath: options.screenshotPath,
            inspection,
            notEvidenceFor: [
              "b_plus_visual_realism_gate",
              "website_publication",
              "scene_placement_readiness",
              "quest_readiness",
              "production_asset_readiness",
              "learner_readiness",
              "clinical_validity",
              "scoring_validity",
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      process.stdout.write(`${options.inspectionPath}\n`);
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(server);
  }
}

async function waitForServer(port: number, server: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {
      // retry
    }
    if (server.exitCode !== null) throw new Error("UI-XR dev server exited before ready.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`UI-XR not ready on port ${port}`);
}

function stopServer(server: ChildProcessWithoutNullStreams): void {
  if (server.exitCode === null) server.kill("SIGTERM");
}

function parseArgs(args: string[]): CliOptions {
  const runId = "2026-06-07-school-aged-patient-mpfb2-eye-v1";
  const outputDir = path.join(".openclinxr/evidence/ui-xr-peds-school-age-mouth-gaze", runId);
  const options: CliOptions = {
    port: 5174,
    outputDir,
    screenshotPath: path.join(outputDir, `peds_school_age_mpfb2_eye_mouth_gaze_pose_${runId}.png`),
    inspectionPath: path.join(".openclinxr/openclaw", "ui-xr-peds-school-age-mouth-gaze-inspection.json"),
    waitMs: 2500,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port") options.port = Number(requireNext(args, ++index, arg));
    else if (arg === "--output-dir") options.outputDir = requireNext(args, ++index, arg);
    else if (arg === "--screenshot-path") options.screenshotPath = requireNext(args, ++index, arg);
    else if (arg === "--inspection-path") options.inspectionPath = requireNext(args, ++index, arg);
    else if (arg === "--wait-ms") options.waitMs = Number(requireNext(args, ++index, arg));
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}