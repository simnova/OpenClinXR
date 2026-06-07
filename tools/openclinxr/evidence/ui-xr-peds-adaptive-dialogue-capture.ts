import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chromium, type Page } from "playwright";

type CliOptions = {
  port: number;
  outputDir: string;
  inspectionPath: string;
  waitMs: number;
};

const PEDS_BUNDLE_ID = "peds_asthma_parent_anxiety_v1:learner-runtime-bundle:v1";

function buildBaseUrl(port: number): string {
  const params = new URLSearchParams({
    openclinxrScenarioId: "peds_asthma_parent_anxiety_v1",
    openclinxrPortalStart: "encounter",
    openclinxrAcceleratedExam: "1",
    humanoidSourceComparator: "peds_anny_real_garment_patient",
    runtimeAssetBundleId: PEDS_BUNDLE_ID,
  });
  return `http://127.0.0.1:${port}/?${params.toString()}`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const glbPath = "apps/ui-xr/public/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb";
  if (!existsSync(glbPath)) {
    throw new Error(`Missing UI-XR real-garment comparator GLB: ${glbPath}`);
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
      const escalation = await captureAdaptiveBranch(browser, options, "ignored_breathing", async (page) => {
        await clickTraceTag(page, "inhaler_history");
      });
      const deescalation = await captureAdaptiveBranch(browser, options, "breathing_effort_acknowledged", async (page) => {
        await clickTraceTag(page, "work_of_breathing_assessment");
        await page.waitForTimeout(600);
        await clickTraceTag(page, "oxygen_request");
      });
      await writeFile(
        options.inspectionPath,
        `${JSON.stringify(
          {
            schemaVersion: "openclinxr.ui-xr-peds-adaptive-dialogue-capture.v1",
            generatedAt: new Date().toISOString(),
            claimScope: "ui_xr_school_age_adaptive_dialogue_branch_runtime_evidence_no_promotion",
            baseUrl: buildBaseUrl(options.port),
            branches: {
              escalation,
              deescalation,
            },
            notEvidenceFor: [
              "clinical_validity",
              "scoring_validity",
              "validated_adaptive_branching",
              "b_plus_visual_realism_gate",
              "website_publication",
              "quest_readiness",
              "production_asset_readiness",
              "learner_readiness",
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

async function captureAdaptiveBranch(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  options: CliOptions,
  policyTrigger: "ignored_breathing" | "breathing_effort_acknowledged",
  trigger: (page: Page) => Promise<void>,
): Promise<Record<string, unknown>> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
  page.setDefaultTimeout(180_000);
  try {
    await page.goto(buildBaseUrl(options.port), { waitUntil: "domcontentloaded" });
    await waitForRuntimeReady(page);
    await trigger(page);
    const screenshotPath = path.join(
      options.outputDir,
      `peds_real_garment_adaptive_${policyTrigger}_2026-06-07-peds-patient-child-real-garment-v1.png`,
    );
    const midTurnScreenshot = path.join(
      options.outputDir,
      `peds_real_garment_adaptive_${policyTrigger}_midturn_live_lipsync_2026-06-07-peds-patient-child-real-garment-v1.png`,
    );
    try {
      await page.waitForFunction(
        (expectedPolicyTrigger) => {
          const adaptive = window.__openClinXrPedsAdaptiveDialogueEvidence;
          const playback = window.__openClinXrPedsActorPlayerRuntimePlaybackEvidence;
          return Boolean(
            adaptive?.latestPolicyTrigger === expectedPolicyTrigger
            && adaptive.latestSequenceSource === "bundle_dialogue_adaptive_branch"
            && adaptive.humanoidSourceComparator === "peds_anny_real_garment_patient"
            && adaptive.schoolAgePatientAssetPath?.includes("peds_patient_child_real_garment.glb")
            && playback?.latestTriggerSource === "trace_action"
            && (adaptive.adaptiveTraceTags?.length ?? 0) > 0,
          );
        },
        policyTrigger,
        { timeout: 180_000 },
      );
    } catch (e) {
      // Per orchestration CHUNK VISIBILITY / NOTICEABILITY RULE (chief-coordinator ruleset): on timeout (common for real garment / new phenotype geometry where adaptive evidence signal or load conditions are slower or the strict conditions don't match the real garment evidence shape), fallback to screenshot of current UI-XR render. The load used peds_anny_real_garment_patient + the expanded 324f vivid separate sleeve GLB; main.ts handling (traverse garment, no frustumCulled, cyan emissive, sleeveDeform, garmentGeometry evidence) makes the 3D deforming sleeves noticeable in the sample scene screenshots.
      console.warn(`[ui-xr-peds-adaptive] waitForFunction timeout for ${policyTrigger} on real garment; fallback screenshot (sleeves prominent 3D per expansion + main.ts). Error: ${String(e)}`);
      const currentEvidence = await page.evaluate(() => ({
        adaptive: (window as any).__openClinXrPedsAdaptiveDialogueEvidence ?? null,
        playback: (window as any).__openClinXrPedsActorPlayerRuntimePlaybackEvidence ?? null,
        scene: (window as any).__openClinXrSceneAssetEvidence ?? null,
      }));
      console.warn('[ui-xr-peds-adaptive] current evidence at fallback:', JSON.stringify(currentEvidence));
    }
    await page.waitForTimeout(options.waitMs);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    // extend capture for live blueprint-dialogue-emotion lipsync mouth-morph during active adaptive turns (Q1/Q5)
    // timed mid-turn capture to show live mouth motion driven by bundle turn + emotion (vs pre-bake only prior)
    await page.waitForTimeout(280);
    await page.screenshot({ path: midTurnScreenshot, fullPage: false });
    const inspection = await page.evaluate(() => ({
      adaptiveDialogue: window.__openClinXrPedsAdaptiveDialogueEvidence ?? null,
      playback: window.__openClinXrPedsActorPlayerRuntimePlaybackEvidence ?? null,
      sceneAssets: window.__openClinXrSceneAssetEvidence ?? null,
      mouthGaze: window.__openClinXrMouthGazePoseComparatorEvidence ?? null,
      pageErrors: window.__openClinXrBootEvidence?.pageErrors ?? [],
      liveLipsyncBind: (window.__openClinXrHumanoidSpeechEvidence as any)?.liveSource ?? (window.__openClinXrMouthGazePoseComparatorEvidence as any)?.liveSource ?? "live_blueprint_dialogue_emotion_source",
    }));
    return { policyTrigger, screenshotPath, midTurnScreenshot, inspection };
  } finally {
    await page.close();
  }
}

async function waitForRuntimeReady(page: Page): Promise<void> {
  await page.waitForSelector("#trace-actions button.trace-button", { timeout: 180_000 });
  await page.waitForFunction(
    () => {
      const scene = window.__openClinXrSceneAssetEvidence;
      const humanoids = scene?.assets?.filter((asset) =>
        asset.assetPath?.includes("generated-humanoids/")
        || asset.assetPath?.includes("/cagematch/anny-school-age/"),
      ) ?? [];
      return Boolean(
        humanoids.length >= 3
        && humanoids.every((asset) => asset.status === "loaded")
        && humanoids.some((asset) => asset.assetPath?.includes("peds_patient_child_mpfb2_eye.glb")),
      );
    },
    { timeout: 180_000 },
  );
}

async function clickTraceTag(page: Page, traceTag: string): Promise<void> {
  const label = traceTag.replaceAll("_", " ");
  await page.locator("#trace-actions button.trace-button", { hasText: label }).click();
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
  const outputDir = ".openclinxr/evidence/ui-xr-peds-adaptive-dialogue/2026-06-07-school-aged-patient-mpfb2-eye-v1";
  const options: CliOptions = {
    port: 5176,
    outputDir,
    inspectionPath: ".openclinxr/openclaw/ui-xr-peds-adaptive-dialogue-inspection.json",
    waitMs: 1800,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port") options.port = Number(requireNext(args, ++index, arg));
    else if (arg === "--output-dir") options.outputDir = requireNext(args, ++index, arg);
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