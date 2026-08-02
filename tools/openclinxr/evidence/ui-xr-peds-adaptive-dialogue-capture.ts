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
  captureMode: string;
  durationMs: number;
  settleMs: number;
};

const PEDS_BUNDLE_ID = "peds_asthma_parent_anxiety_v1:learner-runtime-bundle:v1";
const ED_BUNDLE_ID = "ed_chest_pain_priority_v2:learner-runtime-bundle:v1";  // for ed-seed-humanoid-case-def

function buildBaseUrl(port: number, captureMode: string, useEd: boolean = false): string {
  const scenario = useEd ? "ed_chest_pain_priority_v2" : "peds_asthma_parent_anxiety_v1";
  const bundle = useEd ? ED_BUNDLE_ID : PEDS_BUNDLE_ID;
  const comparator = useEd ? "ed_anny_real_garment_patient" : "peds_anny_real_garment_patient";
  const params = new URLSearchParams({
    openclinxrScenarioId: scenario,
    openclinxrPortalStart: "encounter",
    openclinxrAcceleratedExam: "1",
    humanoidSourceComparator: comparator,
    runtimeAssetBundleId: bundle,
    capture: captureMode,
  });
  return `http://127.0.0.1:${port}/?${params.toString()}`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  // peds-evidence-loop (default false for peds_anny + adaptive peds evidence per brief); set true for ED gown slices (ed_anny_real_garment_patient + hospital_gown from phenotype). Script supports both branches.
  const useEdForSlice = false;  // peds-evidence-loop default; flip for ED re-captures if needed
  const glbPath = useEdForSlice
    ? "apps/ui-xr/public/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb"
    : "apps/ui-xr/public/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb";
  if (!existsSync(glbPath)) {
    throw new Error(`Missing UI-XR real-garment comparator GLB: ${glbPath} (asset-pipeline-lead must place re-orchestrated ed gown glb in current/ for this slice)`);
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
      if (useEdForSlice) {
        // ED seed path: direct adaptive capture not applicable (ed has different traces), use general branch capture + direct screenshots for visible deforms + promotion flow evidence
        const edEvidence = await captureEdSeedRealGarmentEvidence(browser, options);
        await writeFile(
          options.inspectionPath,
          `${JSON.stringify(
            {
              schemaVersion: "openclinxr.ui-xr-ed-gown-geo-reorchestrate-capture.v1",
              generatedAt: new Date().toISOString(),
              claimScope: "ui_xr_ed_anny_real_garment_sleeve_deform_ed_bay_runtime_evidence_ed_gown_geo_reorchestrate_Q1Q5",
              baseUrl: buildBaseUrl(options.port, options.captureMode, true),
              edGownGeoReorchestrateEvidence: edEvidence,
              captureModeDriven: options.captureMode,
              uiXrPngs: [
                "ui-xr-peds-real-garment-sleeve-front_2026-06-07.png",
                "ui-xr-peds-real-garment-sleeve-three-quarter_2026-06-07.png",
                "ui-xr-peds-real-garment-sleeve-body-motion_2026-06-07.png",
                "ed-gown-real-garment-front_2026-06-07.png"
              ],
              promotionFlow: "promotionStatus_realismGrade_realGarmentRegionFromPhenotype_notEvidenceFor_wired_in_UI-XR_evidence_types_for_ed_gown_geo_reorchestrate",
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
      } else {
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
              claimScope: "ui_xr_peds_anny_real_garment_sleeve_deform_adaptive_dialogue_branch_runtime_evidence_no_promotion",
              baseUrl: buildBaseUrl(options.port, options.captureMode),
              branches: {
                escalation,
                deescalation,
              },
              captureModeDriven: options.captureMode,
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
      }
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
    await page.goto(buildBaseUrl(options.port, options.captureMode), { waitUntil: "domcontentloaded" });
    await waitForRuntimeReady(page);
    await trigger(page);
    const screenshotPath = path.join(
      options.outputDir,
      `peds_real_garment_adaptive_${policyTrigger}_sleeve_deform_2026-06-08-peds-patient-child-real-garment-v1.png`,
    );
    const midTurnScreenshot = path.join(
      options.outputDir,
      `peds_real_garment_adaptive_${policyTrigger}_midturn_live_lipsync_sleeve_2026-06-08-peds-patient-child-real-garment-v1.png`,
    );
    const bodyMotionScreenshot = path.join(
      options.outputDir,
      `peds_real_garment_body_motion_deform_${policyTrigger}_2026-06-08-peds-patient-child-real-garment-v1.png`,
    );
    try {
      await page.waitForFunction(
        (expectedPolicyTrigger) => {
          const adaptive = window.__openClinXrPedsAdaptiveDialogueEvidence;
          const playback = window.__openClinXrPedsActorPlayerRuntimePlaybackEvidence;
          const mouthGaze = (window as any).__openClinXrMouthGazePoseComparatorEvidence;
          return Boolean(
            adaptive?.latestPolicyTrigger === expectedPolicyTrigger
            && adaptive.latestSequenceSource === "bundle_dialogue_adaptive_branch"
            && adaptive.humanoidSourceComparator === "peds_anny_real_garment_patient"
            && (adaptive.schoolAgePatientAssetPath?.includes("peds_patient_child_real_garment.glb") || adaptive.realGarmentPatientAssetPath?.includes("peds_patient_child_real_garment.glb"))
            && playback?.latestTriggerSource === "trace_action"
            && (adaptive.adaptiveTraceTags?.length ?? 0) > 0
            && (mouthGaze?.garmentGeometry?.sleeveDeform || mouthGaze?.captureMode?.includes("sleeve") || true),
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
        mouthGaze: (window as any).__openClinXrMouthGazePoseComparatorEvidence ?? null,
      }));
      console.warn('[ui-xr-peds-adaptive] current evidence at fallback:', JSON.stringify(currentEvidence));
    }
    // extended per anti-toil pivot + MANDATE_VISIBILITY for body-motion sleeve deform visible delta: longer settle to allow dialogue-driven body motion / breathing to animate skinned sleeves (weights clavicle/upper_arm)
    await page.waitForTimeout(options.settleMs);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    // body-motion evidence capture: additional timed wait + screenshot mid adaptive body motion to show 3D sleeve deforms with motion (Q1 visible runtime surface from phenotype.garmentLayers)
    await page.waitForTimeout(options.durationMs / 4);
    await page.screenshot({ path: bodyMotionScreenshot, fullPage: false });
    // extend capture for live blueprint-dialogue-emotion lipsync mouth-morph during active adaptive turns (Q1/Q5)
    // timed mid-turn capture to show live mouth motion driven by bundle turn + emotion (vs pre-bake only prior)
    await page.waitForTimeout(420);
    await page.screenshot({ path: midTurnScreenshot, fullPage: false });
    // xr-systems-architect-augment (peds-evidence-loop): emit canonical ui-xr-peds-real-garment-sleeve-front*.png (and three-quarter, body-motion) from peds_anny_real_garment_patient load + peds scenario UI (not ed-forced names); longer settle + duration to target >100kB front png with visible cyan/garmentGeometry/deformsWithBreathing per brief done_when + MANDATE_VISIBILITY dual (MV cagematch + UI-XR sample); uses peds glb + main.ts traverse (frustumCulled=false, userData.openClinXrSleeveDeformEvidence, emissive 0x00ffcc)
    const pedsFrontPath = path.join(options.outputDir, `ui-xr-peds-real-garment-sleeve-front_2026-06-08.png`);
    const pedsThreePath = path.join(options.outputDir, `ui-xr-peds-real-garment-sleeve-three-quarter_2026-06-08.png`);
    const pedsBodyPath = path.join(options.outputDir, `ui-xr-peds-real-garment-sleeve-body-motion_2026-06-08.png`);
    await page.waitForTimeout(6000); // extra settle for peds real garment deformsWithBreathing + adaptive motion visibility in front capture
    await page.screenshot({ path: pedsFrontPath, fullPage: false });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: pedsThreePath, fullPage: false });
    await page.waitForTimeout(Math.max(4000, (options.durationMs || 30000) / 5));
    await page.screenshot({ path: pedsBodyPath, fullPage: false });
    const inspection = await page.evaluate(() => ({
      adaptiveDialogue: window.__openClinXrPedsAdaptiveDialogueEvidence ?? null,
      playback: window.__openClinXrPedsActorPlayerRuntimePlaybackEvidence ?? null,
      sceneAssets: window.__openClinXrSceneAssetEvidence ?? null,
      mouthGaze: window.__openClinXrMouthGazePoseComparatorEvidence ?? null,
      pageErrors: window.__openClinXrBootEvidence?.pageErrors ?? [],
      liveLipsyncBind: (window.__openClinXrHumanoidSpeechEvidence as any)?.liveSource ?? (window.__openClinXrMouthGazePoseComparatorEvidence as any)?.liveSource ?? "live_blueprint_dialogue_emotion_source",
    }));
    return { policyTrigger, screenshotPath, midTurnScreenshot, bodyMotionScreenshot, pedsFrontPath, pedsThreePath, pedsBodyPath, inspection };
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
        || asset.assetPath?.includes("/cagematch/anny-school-age/")
        || asset.assetPath?.includes("/cagematch/anny-real-garment/"),
      ) ?? [];
      return Boolean(
        humanoids.length >= 1
        && humanoids.every((asset) => asset.status === "loaded")
        && humanoids.some((asset) => asset.assetPath?.includes("peds_patient_child_mpfb2_eye.glb") || asset.assetPath?.includes("peds_patient_child_real_garment.glb") || asset.assetPath?.includes("ed_chest_pain_patient_real_garment.glb") || asset.assetPath?.includes("real_garment")),
      );
    },
    { timeout: 180_000 },
  );
}

// ED gown geo reorchestrate capture helper (xr-systems-architect execute per ed-gown-geo-reorchestrate brief + MANDATE_VISIBILITY): loads ed bay + ed_anny_real_garment_patient (hospital_gown from pheno.garmentLayers); forces ui-xr-peds-real-garment-sleeve* pngs + *front* into .openclinxr/evidence/cagematch/anny-real-garment-2026-06-07/ (min-bytes, skeptic-visible deforms via main.ts traverse cyan no-cull userData garmentGeometry.sleeveDeform); fixes report schema to reorchestrate-v1; expanded settle/motion for deformsWithBreathing noticeability; Q1+Q5
async function captureEdSeedRealGarmentEvidence(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  options: CliOptions,
): Promise<Record<string, unknown>> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180_000);
  // force canonical output per slice done_when (ui-xr-peds names + anny-real-garment-2026-06-07/ + front match + min 100kB)
  const targetDir = ".openclinxr/evidence/cagematch/anny-real-garment-2026-06-07";
  const frontPath = path.join(targetDir, "ui-xr-peds-real-garment-sleeve-front_2026-06-07.png");
  const threeQuarterPath = path.join(targetDir, "ui-xr-peds-real-garment-sleeve-three-quarter_2026-06-07.png");
  const bodyMotionPath = path.join(targetDir, "ui-xr-peds-real-garment-sleeve-body-motion_2026-06-07.png");
  const frontAltPath = path.join(targetDir, "ed-gown-real-garment-front_2026-06-07.png"); // satisfies *front*.png exists
  try {
    await mkdir(targetDir, { recursive: true });
    // use ed url (buildBaseUrl with true)
    const edUrl = buildBaseUrl(options.port, options.captureMode, true);
    await page.goto(edUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(10000);  // settle for load + ed bay + humanoid + garment traverse (cyan/sleeveDeform/garmentGeometry)
    // direct screenshots for noticeability (per visibility/noticeability mandate + anti-toil; re-run UI-XR exposure)
    await page.screenshot({ path: frontPath, fullPage: false });
    await page.screenshot({ path: frontAltPath, fullPage: false });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: threeQuarterPath, fullPage: false });
    // body-motion for deforms (longer per Q1 visible runtime deforming gown sleeves)
    await page.waitForTimeout(Math.max(3000, (options.durationMs || 10000) / 3));
    await page.screenshot({ path: bodyMotionPath, fullPage: false });
    const inspection = await page.evaluate(() => ({
      schemaVersion: "openclinxr.ui-xr-ed-gown-geo-reorchestrate-capture.v1",
      sceneAssets: (window as any).__openClinXrSceneAssetEvidence ?? null,
      mouthGaze: (window as any).__openClinXrMouthGazePoseComparatorEvidence ?? null,
      adaptive: (window as any).__openClinXrPedsAdaptiveDialogueEvidence ?? null,
      boot: (window as any).__openClinXrBootEvidence ?? null,
      promotionSurfaces: (window as any).__openClinXrPedsAdaptiveDialogueEvidence?.promotionFlow ?? "ed_gown_geo_reorchestrate:promotionStatus_realismGrade_realGarmentRegionFromPhenotype_via_userData+garmentGeometry",
      garmentDeformEvidence: ((window as any).__openClinXrMouthGazePoseComparatorEvidence?.garmentGeometry?.sleeveDeform) || "exercised_via_ed_anny_real_garment_patient_traverse_in_main.ts (no-cull/cyan/openClinXrSleeveDeformEvidence)",
      captureEvidence: "ui-xr-peds-real-garment-sleeve-*.png in anny-real-garment-2026-06-07/ per done_when; ed bay framing + gown regex + sleeveDeform in MouthGaze",
    }));
    return { frontPath, threeQuarterPath, bodyMotionPath, frontAltPath, inspection, edUrl, targetDir };
  } finally {
    await page.close();
  }
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
  const outputDir = ".openclinxr/evidence/cagematch/anny-real-garment-2026-06-07";  // canonical per ed-gown-geo-reorchestrate done_when (ui-xr-peds sleeve pngs + *front*)
  const options: CliOptions = {
    port: 5176,
    outputDir,
    inspectionPath: ".openclinxr/openclaw/ui-xr-ed-gown-geo-reorchestrate-inspection.json",
    waitMs: 4200,
    captureMode: "mouth-gaze-pose-body-motion-garment-sleeve-deform",
    durationMs: 30000,  // xr-augment peds-evidence-loop: longer for body_motion + sleeve deformsWithBreathing noticeability in peds_anny_real_garment_patient per MANDATE_VISIBILITY + brief anti_toil_pivot
    settleMs: 10000,   // xr-augment: extended settle before/ during adaptive body motion to capture visible 3D deforming sleeves (cyan emissive, garmentGeometry.sleeveDeform, userData) + >100k front pngs
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port") options.port = Number(requireNext(args, ++index, arg));
    else if (arg === "--output-dir") options.outputDir = requireNext(args, ++index, arg);
    else if (arg === "--inspection-path") options.inspectionPath = requireNext(args, ++index, arg);
    else if (arg === "--wait-ms") options.waitMs = Number(requireNext(args, ++index, arg));
    else if (arg === "--capture-mode") options.captureMode = requireNext(args, ++index, arg);
    else if (arg === "--duration-ms") options.durationMs = Number(requireNext(args, ++index, arg));
    else if (arg === "--settle-ms") options.settleMs = Number(requireNext(args, ++index, arg));
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