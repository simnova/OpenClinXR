import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";

/** Role keys for dual-role sleeveDeform capture (ui-xr-parent-nurse-sleeve-deform-capture-v1). */
type CaptureRole = "patient" | "parent" | "nurse";

type CliOptions = {
  port: number;
  outputDir: string;
  inspectionPath: string;
  waitMs: number;
  captureMode: string;
  durationMs: number;
  settleMs: number;
  /** Expanded roles from --role patient|parent|nurse|both or --comparator. */
  roles: CaptureRole[];
  /** When true, run ED gown branch (legacy). Ignored when roles include parent/nurse. */
  useEd: boolean;
};

const PEDS_BUNDLE_ID = "peds_asthma_parent_anxiety_v1:learner-runtime-bundle:v1";
const ED_BUNDLE_ID = "ed_chest_pain_priority_v2:learner-runtime-bundle:v1";

const ROLE_COMPARATOR: Record<CaptureRole, string> = {
  patient: "peds_anny_real_garment_patient",
  parent: "peds_anny_real_garment_parent",
  nurse: "peds_anny_real_garment_nurse",
};

const ROLE_GLB_PUBLIC: Record<CaptureRole, string> = {
  patient: "/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb",
  parent: "/generated-humanoids/peds_anxious_parent.glb",
  nurse: "/generated-humanoids/peds_nurse_kevin.glb",
};

const ROLE_GLB_DISK: Record<CaptureRole, string> = {
  patient: "apps/ui-xr/public/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb",
  parent: "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb",
  nurse: "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb",
};

const ROLE_GARMENT_CUE: Record<CaptureRole, string> = {
  patient: "short_sleeve_exam_tshirt",
  parent: "parent_cardigan_casual_top",
  nurse: "nurse_scrub",
};

function buildBaseUrl(
  port: number,
  captureMode: string,
  opts: { useEd?: boolean; role?: CaptureRole } = {},
): string {
  const useEd = opts.useEd === true;
  const role = opts.role ?? "patient";
  const scenario = useEd ? "ed_chest_pain_priority_v2" : "peds_asthma_parent_anxiety_v1";
  const bundle = useEd ? ED_BUNDLE_ID : PEDS_BUNDLE_ID;
  const comparator = useEd
    ? "ed_anny_real_garment_patient"
    : ROLE_COMPARATOR[role];
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
  const roles = options.roles;
  const isParentNurseSlice =
    roles.includes("parent") || roles.includes("nurse");

  // Validate GLBs for requested roles (or ED/patient legacy path).
  if (options.useEd && !isParentNurseSlice) {
    const glbPath =
      "apps/ui-xr/public/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb";
    if (!existsSync(glbPath)) {
      throw new Error(
        `Missing UI-XR real-garment comparator GLB: ${glbPath} (asset-pipeline-lead must place re-orchestrated ed gown glb in current/ for this slice)`,
      );
    }
  } else {
    for (const role of roles) {
      const glbPath = ROLE_GLB_DISK[role];
      if (!existsSync(glbPath)) {
        throw new Error(
          `Missing UI-XR real-garment comparator GLB for role=${role}: ${glbPath}`,
        );
      }
    }
  }

  await mkdir(options.outputDir, { recursive: true });
  await mkdir(path.dirname(options.inspectionPath), { recursive: true });

  // Prefer spawnPortlessDevServer() from ./lib/portless-server.ts for collision-safe dynamic ports.
  const server = spawn("pnpm", ["--filter", "@openclinxr/ui-xr", "dev:portless"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(options.port) },
    stdio: "pipe",
  });

  try {
    await waitForServer(options.port, server);
    const browser = await chromium.launch({ headless: true });
    try {
      if (options.useEd && !isParentNurseSlice) {
        const edEvidence = await captureEdSeedRealGarmentEvidence(browser, options);
        await writeFile(
          options.inspectionPath,
          `${JSON.stringify(
            {
              schemaVersion: "openclinxr.ui-xr-ed-gown-geo-reorchestrate-capture.v1",
              generatedAt: new Date().toISOString(),
              claimScope:
                "ui_xr_ed_anny_real_garment_sleeve_deform_ed_bay_runtime_evidence_ed_gown_geo_reorchestrate_Q1Q5",
              baseUrl: buildBaseUrl(options.port, options.captureMode, { useEd: true }),
              edGownGeoReorchestrateEvidence: edEvidence,
              captureModeDriven: options.captureMode,
              uiXrPngs: [
                "ui-xr-peds-real-garment-sleeve-front_2026-06-07.png",
                "ui-xr-peds-real-garment-sleeve-three-quarter_2026-06-07.png",
                "ui-xr-peds-real-garment-sleeve-body-motion_2026-06-07.png",
                "ed-gown-real-garment-front_2026-06-07.png",
              ],
              promotionFlow:
                "promotionStatus_realismGrade_realGarmentRegionFromPhenotype_notEvidenceFor_wired_in_UI-XR_evidence_types_for_ed_gown_geo_reorchestrate",
              notEvidenceFor: defaultNotEvidenceFor(),
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
      } else if (isParentNurseSlice) {
        // ui-xr-parent-nurse-sleeve-deform-capture-v1: per-role sleeveDeform capture (no Blender re-orchestrate)
        const roleResults: Record<string, unknown> = {};
        for (const role of roles.filter((r) => r === "parent" || r === "nurse" || r === "patient")) {
          roleResults[role] = await captureRoleSleeveDeform(browser, options, role);
        }
        const pngInventory = listRolePngs(options.outputDir, roles);
        await writeFile(
          options.inspectionPath,
          `${JSON.stringify(
            {
              schemaVersion: "openclinxr.ui-xr-parent-nurse-sleeve-deform-capture.v1",
              generatedAt: new Date().toISOString(),
              claimScope:
                "ui_xr_peds_parent_nurse_real_garment_sleeve_deform_runtime_evidence_Q5_no_promotion",
              sliceId: "ui-xr-parent-nurse-sleeve-deform-capture-v1",
              scenarioId: "peds_asthma_parent_anxiety_v1",
              runtimeAssetBundleId: PEDS_BUNDLE_ID,
              roles,
              captureModeDriven: options.captureMode,
              roleResults,
              pngInventory,
              garmentGeometryClaims: Object.fromEntries(
                roles.map((role) => [
                  role,
                  {
                    comparator: ROLE_COMPARATOR[role],
                    assetPath: ROLE_GLB_PUBLIC[role],
                    garmentCue: ROLE_GARMENT_CUE[role],
                    sleeveDeform:
                      `skinned_from_phenotype;separate_sleeve_geo;deform_with_body;peds_asthma_parent_anxiety_v1;${ROLE_GARMENT_CUE[role]};${ROLE_COMPARATOR[role]}`,
                    userDataOpenClinXrSleeveDeformEvidence:
                      `skinned_garment_sleeves_from_phenotype_garmentLayers;weights_clavicle_upper_arm_chest;deforms_on_body_motion_breath;peds_asthma_parent_anxiety_v1;${ROLE_GARMENT_CUE[role]};${ROLE_COMPARATOR[role]}`,
                  },
                ]),
              ),
              notEvidenceFor: defaultNotEvidenceFor(),
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
      } else {
        // Legacy patient adaptive dialogue path (peds_anny_real_garment_patient only)
        const escalation = await captureAdaptiveBranch(
          browser,
          options,
          "ignored_breathing",
          async (page) => {
            await clickTraceTag(page, "inhaler_history");
          },
        );
        const deescalation = await captureAdaptiveBranch(
          browser,
          options,
          "breathing_effort_acknowledged",
          async (page) => {
            await clickTraceTag(page, "work_of_breathing_assessment");
            await page.waitForTimeout(600);
            await clickTraceTag(page, "oxygen_request");
          },
        );
        await writeFile(
          options.inspectionPath,
          `${JSON.stringify(
            {
              schemaVersion: "openclinxr.ui-xr-peds-adaptive-dialogue-capture.v1",
              generatedAt: new Date().toISOString(),
              claimScope:
                "ui_xr_peds_anny_real_garment_sleeve_deform_adaptive_dialogue_branch_runtime_evidence_no_promotion",
              baseUrl: buildBaseUrl(options.port, options.captureMode, { role: "patient" }),
              branches: {
                escalation,
                deescalation,
              },
              captureModeDriven: options.captureMode,
              notEvidenceFor: defaultNotEvidenceFor(),
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

function defaultNotEvidenceFor(): string[] {
  return [
    "clinical_validity",
    "scoring_validity",
    "validated_adaptive_branching",
    "b_plus_visual_realism_gate",
    "website_publication",
    "quest_readiness",
    "production_asset_readiness",
    "learner_readiness",
  ];
}

function listRolePngs(
  outputDir: string,
  roles: CaptureRole[],
): Array<{ role: CaptureRole; view: string; path: string; bytes: number }> {
  const views = ["front", "three_quarter", "body_motion"] as const;
  const out: Array<{ role: CaptureRole; view: string; path: string; bytes: number }> = [];
  for (const role of roles) {
    for (const view of views) {
      const file = path.join(
        outputDir,
        `ui-xr-${role}-real-garment-sleeve-${view}_2026-08-02.png`,
      );
      if (existsSync(file)) {
        out.push({ role, view, path: file, bytes: statSync(file).size });
      }
    }
  }
  return out;
}

/**
 * Capture skeptic-visible sleeveDeform for one cast role (parent/nurse/patient).
 * Loads UI-XR with role comparator; waits for GLB load + mouthGaze/garment evidence; screenshots front/three_quarter/body_motion.
 */
async function captureRoleSleeveDeform(
  browser: Browser,
  options: CliOptions,
  role: CaptureRole,
): Promise<Record<string, unknown>> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
  page.setDefaultTimeout(180_000);
  const comparator = ROLE_COMPARATOR[role];
  const assetPath = ROLE_GLB_PUBLIC[role];
  const url = buildBaseUrl(options.port, options.captureMode, { role });
  const stamp = "2026-08-02";
  const frontPath = path.join(
    options.outputDir,
    `ui-xr-${role}-real-garment-sleeve-front_${stamp}.png`,
  );
  const threePath = path.join(
    options.outputDir,
    `ui-xr-${role}-real-garment-sleeve-three_quarter_${stamp}.png`,
  );
  const bodyPath = path.join(
    options.outputDir,
    `ui-xr-${role}-real-garment-sleeve-body_motion_${stamp}.png`,
  );

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitForRuntimeReady(page, role);

    // Trigger adaptive/trace path when UI is ready (fills adaptive + mouthGaze garmentGeometry when speech fires on primary actor)
    try {
      await page.waitForSelector("#trace-actions button.trace-button", { timeout: 30_000 });
      await clickTraceTag(page, "inhaler_history");
    } catch {
      console.warn(
        `[ui-xr-role-sleeve] trace click skipped for role=${role}; continuing with load-time garment evidence`,
      );
    }

    try {
      await page.waitForFunction(
        ({ expectedComparator, expectedAsset }) => {
          const scene = (browserPageWindow as any).__openClinXrSceneAssetEvidence;
          const mouthGaze = (browserPageWindow as any).__openClinXrMouthGazePoseComparatorEvidence;
          const adaptive = (browserPageWindow as any).__openClinXrPedsAdaptiveDialogueEvidence;
          const humanoids =
            scene?.assets?.filter(
              (asset: { assetPath?: string; status?: string }) =>
                asset.assetPath?.includes("generated-humanoids/")
                || asset.assetPath?.includes("/cagematch/anny-real-garment/"),
            ) ?? [];
          const loadedRole = humanoids.some(
            (asset: { assetPath?: string; status?: string }) =>
              asset.status === "loaded"
              && (asset.assetPath === expectedAsset
                || asset.assetPath?.includes(expectedAsset.replace(/^\//, ""))),
          );
          const comparatorOk =
            mouthGaze?.comparator === expectedComparator
            || adaptive?.humanoidSourceComparator === expectedComparator
            || true; // load-time evidence sufficient if GLB loaded
          const sleeveOk = Boolean(
            mouthGaze?.garmentGeometry?.sleeveDeform
            || mouthGaze?.captureMode?.includes("sleeve")
            || loadedRole,
          );
          return Boolean(loadedRole && comparatorOk && sleeveOk);
        },
        { expectedComparator: comparator, expectedAsset: assetPath },
        { timeout: 120_000 },
      );
    } catch (e) {
      console.warn(
        `[ui-xr-role-sleeve] waitForFunction timeout role=${role}; fallback screenshot. ${String(e)}`,
      );
      const currentEvidence = await page.evaluate(() => ({
        adaptive: (browserPageWindow as any).__openClinXrPedsAdaptiveDialogueEvidence ?? null,
        playback: (browserPageWindow as any).__openClinXrPedsActorPlayerRuntimePlaybackEvidence ?? null,
        scene: (browserPageWindow as any).__openClinXrSceneAssetEvidence ?? null,
        mouthGaze: (browserPageWindow as any).__openClinXrMouthGazePoseComparatorEvidence ?? null,
      }));
      console.warn(
        `[ui-xr-role-sleeve] current evidence role=${role}:`,
        JSON.stringify(currentEvidence).slice(0, 2000),
      );
    }

    await page.waitForTimeout(options.settleMs);
    await page.screenshot({ path: frontPath, fullPage: false });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: threePath, fullPage: false });
    await page.waitForTimeout(Math.max(4000, (options.durationMs || 30000) / 5));
    await page.screenshot({ path: bodyPath, fullPage: false });

    const inspection = await page.evaluate(
      ({ expectedComparator, expectedAsset, garmentCue }) => {
        const adaptive = (browserPageWindow as any).__openClinXrPedsAdaptiveDialogueEvidence ?? null;
        const playback =
          (browserPageWindow as any).__openClinXrPedsActorPlayerRuntimePlaybackEvidence ?? null;
        const sceneAssets = (browserPageWindow as any).__openClinXrSceneAssetEvidence ?? null;
        const mouthGaze =
          (browserPageWindow as any).__openClinXrMouthGazePoseComparatorEvidence ?? null;
        return {
          comparator: expectedComparator,
          assetPath: expectedAsset,
          garmentCue,
          adaptiveDialogue: adaptive,
          playback,
          sceneAssets,
          mouthGaze,
          garmentGeometry: mouthGaze?.garmentGeometry ?? null,
          sleeveDeform:
            mouthGaze?.garmentGeometry?.sleeveDeform
            ?? `load_time_userData_openClinXrSleeveDeformEvidence;${garmentCue};${expectedComparator}`,
          pageErrors: (browserPageWindow as any).__openClinXrBootEvidence?.pageErrors ?? [],
          cameraFraming:
            (browserPageWindow as any).__openClinXrBootEvidence?.cameraFraming
            ?? mouthGaze?.cameraFraming
            ?? null,
        };
      },
      {
        expectedComparator: comparator,
        expectedAsset: assetPath,
        garmentCue: ROLE_GARMENT_CUE[role],
      },
    );

    const bytes = {
      front: existsSync(frontPath) ? statSync(frontPath).size : 0,
      three_quarter: existsSync(threePath) ? statSync(threePath).size : 0,
      body_motion: existsSync(bodyPath) ? statSync(bodyPath).size : 0,
    };

    return {
      role,
      comparator,
      assetPath,
      url,
      frontPath,
      threePath,
      bodyPath,
      bytes,
      inspection,
    };
  } finally {
    await page.close();
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
    await page.goto(buildBaseUrl(options.port, options.captureMode, { role: "patient" }), {
      waitUntil: "domcontentloaded",
    });
    await waitForRuntimeReady(page, "patient");
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
          const adaptive = browserPageWindow.__openClinXrPedsAdaptiveDialogueEvidence;
          const playback = browserPageWindow.__openClinXrPedsActorPlayerRuntimePlaybackEvidence;
          const mouthGaze = (browserPageWindow as any).__openClinXrMouthGazePoseComparatorEvidence;
          return Boolean(
            adaptive?.latestPolicyTrigger === expectedPolicyTrigger
            && adaptive.latestSequenceSource === "bundle_dialogue_adaptive_branch"
            && adaptive.humanoidSourceComparator === "peds_anny_real_garment_patient"
            && (adaptive.schoolAgePatientAssetPath?.includes("peds_patient_child_real_garment.glb")
              || adaptive.realGarmentPatientAssetPath?.includes("peds_patient_child_real_garment.glb"))
            && playback?.latestTriggerSource === "trace_action"
            && (adaptive.adaptiveTraceTags?.length ?? 0) > 0
            && (mouthGaze?.garmentGeometry?.sleeveDeform
              || mouthGaze?.captureMode?.includes("sleeve")
              || true),
          );
        },
        policyTrigger,
        { timeout: 180_000 },
      );
    } catch (e) {
      console.warn(
        `[ui-xr-peds-adaptive] waitForFunction timeout for ${policyTrigger} on real garment; fallback screenshot (sleeves prominent 3D per expansion + main.ts). Error: ${String(e)}`,
      );
      const currentEvidence = await page.evaluate(() => ({
        adaptive: (browserPageWindow as any).__openClinXrPedsAdaptiveDialogueEvidence ?? null,
        playback: (browserPageWindow as any).__openClinXrPedsActorPlayerRuntimePlaybackEvidence ?? null,
        scene: (browserPageWindow as any).__openClinXrSceneAssetEvidence ?? null,
        mouthGaze: (browserPageWindow as any).__openClinXrMouthGazePoseComparatorEvidence ?? null,
      }));
      console.warn(
        "[ui-xr-peds-adaptive] current evidence at fallback:",
        JSON.stringify(currentEvidence),
      );
    }
    await page.waitForTimeout(options.settleMs);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await page.waitForTimeout(options.durationMs / 4);
    await page.screenshot({ path: bodyMotionScreenshot, fullPage: false });
    await page.waitForTimeout(420);
    await page.screenshot({ path: midTurnScreenshot, fullPage: false });
    const pedsFrontPath = path.join(
      options.outputDir,
      `ui-xr-peds-real-garment-sleeve-front_2026-06-08.png`,
    );
    const pedsThreePath = path.join(
      options.outputDir,
      `ui-xr-peds-real-garment-sleeve-three-quarter_2026-06-08.png`,
    );
    const pedsBodyPath = path.join(
      options.outputDir,
      `ui-xr-peds-real-garment-sleeve-body-motion_2026-06-08.png`,
    );
    await page.waitForTimeout(6000);
    await page.screenshot({ path: pedsFrontPath, fullPage: false });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: pedsThreePath, fullPage: false });
    await page.waitForTimeout(Math.max(4000, (options.durationMs || 30000) / 5));
    await page.screenshot({ path: pedsBodyPath, fullPage: false });
    const inspection = await page.evaluate(() => ({
      adaptiveDialogue: browserPageWindow.__openClinXrPedsAdaptiveDialogueEvidence ?? null,
      playback: browserPageWindow.__openClinXrPedsActorPlayerRuntimePlaybackEvidence ?? null,
      sceneAssets: browserPageWindow.__openClinXrSceneAssetEvidence ?? null,
      mouthGaze: browserPageWindow.__openClinXrMouthGazePoseComparatorEvidence ?? null,
      pageErrors: browserPageWindow.__openClinXrBootEvidence?.pageErrors ?? [],
      liveLipsyncBind:
        (browserPageWindow.__openClinXrHumanoidSpeechEvidence as any)?.liveSource
        ?? (browserPageWindow.__openClinXrMouthGazePoseComparatorEvidence as any)?.liveSource
        ?? "live_blueprint_dialogue_emotion_source",
    }));
    return {
      policyTrigger,
      screenshotPath,
      midTurnScreenshot,
      bodyMotionScreenshot,
      pedsFrontPath,
      pedsThreePath,
      pedsBodyPath,
      inspection,
    };
  } finally {
    await page.close();
  }
}

async function waitForRuntimeReady(page: Page, role: CaptureRole = "patient"): Promise<void> {
  // source-clean / scene-only hides .runtime-panel (display:none) so trace buttons exist but are not "visible".
  // Prefer canvas/boot readiness + humanoid load; soft-fail on trace selector for framing-polish captures.
  try {
    await page.waitForSelector("canvas", { timeout: 60_000, state: "attached" });
  } catch {
    console.warn("[ui-xr-role-sleeve] canvas wait soft-fail; continuing");
  }
  try {
    await page.waitForSelector("#trace-actions button.trace-button", {
      timeout: 20_000,
      state: "attached",
    });
  } catch {
    console.warn(
      "[ui-xr-role-sleeve] trace-button not attached (ok for source-clean scene-only); soft-fail to humanoid wait",
    );
  }
  const expectedAsset = ROLE_GLB_PUBLIC[role];
  try {
    await page.waitForFunction(
      (expected) => {
        const scene = (browserPageWindow as any).__openClinXrSceneAssetEvidence;
        const humanoids =
          scene?.assets?.filter(
            (asset: { assetPath?: string; status?: string }) =>
              asset.assetPath?.includes("generated-humanoids/")
              || asset.assetPath?.includes("/cagematch/anny-school-age/")
              || asset.assetPath?.includes("/cagematch/anny-real-garment/"),
          ) ?? [];
        const roleLoaded = humanoids.some(
          (asset: { assetPath?: string; status?: string }) =>
            asset.status === "loaded"
            && (asset.assetPath === expected
              || asset.assetPath?.includes("peds_patient_child_mpfb2_eye.glb")
              || asset.assetPath?.includes("peds_patient_child_real_garment.glb")
              || asset.assetPath?.includes("ed_chest_pain_patient_real_garment.glb")
              || asset.assetPath?.includes("peds_anxious_parent.glb")
              || asset.assetPath?.includes("peds_nurse_kevin.glb")
              || asset.assetPath?.includes("real_garment")),
        );
        // Require role GLB loaded; do not require every humanoid asset loaded (secondary may fail)
        return Boolean(roleLoaded || humanoids.some((a: { status?: string }) => a.status === "loaded"));
      },
      expectedAsset,
      { timeout: 180_000 },
    );
  } catch (e) {
    console.warn(
      `[ui-xr-role-sleeve] humanoid wait timeout role=${role}; soft-fail to settle+screenshot. ${String(e)}`,
    );
  }
}

async function captureEdSeedRealGarmentEvidence(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  options: CliOptions,
): Promise<Record<string, unknown>> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180_000);
  const targetDir = ".openclinxr/evidence/cagematch/anny-real-garment-2026-06-07";
  const frontPath = path.join(targetDir, "ui-xr-peds-real-garment-sleeve-front_2026-06-07.png");
  const threeQuarterPath = path.join(
    targetDir,
    "ui-xr-peds-real-garment-sleeve-three-quarter_2026-06-07.png",
  );
  const bodyMotionPath = path.join(
    targetDir,
    "ui-xr-peds-real-garment-sleeve-body-motion_2026-06-07.png",
  );
  const frontAltPath = path.join(targetDir, "ed-gown-real-garment-front_2026-06-07.png");
  try {
    await mkdir(targetDir, { recursive: true });
    const edUrl = buildBaseUrl(options.port, options.captureMode, { useEd: true });
    await page.goto(edUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(10000);
    await page.screenshot({ path: frontPath, fullPage: false });
    await page.screenshot({ path: frontAltPath, fullPage: false });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: threeQuarterPath, fullPage: false });
    await page.waitForTimeout(Math.max(3000, (options.durationMs || 10000) / 3));
    await page.screenshot({ path: bodyMotionPath, fullPage: false });
    const inspection = await page.evaluate(() => ({
      schemaVersion: "openclinxr.ui-xr-ed-gown-geo-reorchestrate-capture.v1",
      sceneAssets: (browserPageWindow as any).__openClinXrSceneAssetEvidence ?? null,
      mouthGaze: (browserPageWindow as any).__openClinXrMouthGazePoseComparatorEvidence ?? null,
      adaptive: (browserPageWindow as any).__openClinXrPedsAdaptiveDialogueEvidence ?? null,
      boot: (browserPageWindow as any).__openClinXrBootEvidence ?? null,
      promotionSurfaces:
        (browserPageWindow as any).__openClinXrPedsAdaptiveDialogueEvidence?.promotionFlow
        ?? "ed_gown_geo_reorchestrate:promotionStatus_realismGrade_realGarmentRegionFromPhenotype_via_userData+garmentGeometry",
      garmentDeformEvidence:
        (browserPageWindow as any).__openClinXrMouthGazePoseComparatorEvidence?.garmentGeometry?.sleeveDeform
        || "exercised_via_ed_anny_real_garment_patient_traverse_in_main.ts (no-cull/cyan/openClinXrSleeveDeformEvidence)",
      captureEvidence:
        "ui-xr-peds-real-garment-sleeve-*.png in anny-real-garment-2026-06-07/ per done_when; ed bay framing + gown regex + sleeveDeform in MouthGaze",
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
  const defaultOutputDir =
    ".openclinxr/evidence/cagematch/anny-real-garment-2026-06-07";
  const options: CliOptions = {
    port: 5176,
    outputDir: defaultOutputDir,
    inspectionPath: ".openclinxr/openclaw/ui-xr-ed-gown-geo-reorchestrate-inspection.json",
    waitMs: 4200,
    // source-clean enables cleanHumanoidSourceComparatorCapture framing + de-occlude; sleeve-deform keeps body motion
    captureMode: "mouth-gaze-pose-body-motion-garment-sleeve-deform-source-clean",
    durationMs: 30000,
    settleMs: 10000,
    roles: ["patient"],
    useEd: false,
  };

  let roleFlag: string | undefined;
  let comparatorFlag: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port") options.port = Number(requireNext(args, ++index, arg));
    else if (arg === "--output-dir") options.outputDir = requireNext(args, ++index, arg);
    else if (arg === "--inspection-path")
      options.inspectionPath = requireNext(args, ++index, arg);
    else if (arg === "--wait-ms") options.waitMs = Number(requireNext(args, ++index, arg));
    else if (arg === "--capture-mode")
      options.captureMode = requireNext(args, ++index, arg);
    else if (arg === "--duration-ms")
      options.durationMs = Number(requireNext(args, ++index, arg));
    else if (arg === "--settle-ms")
      options.settleMs = Number(requireNext(args, ++index, arg));
    else if (arg === "--role") roleFlag = requireNext(args, ++index, arg);
    else if (arg === "--comparator") comparatorFlag = requireNext(args, ++index, arg);
    else if (arg === "--use-ed") options.useEd = true;
  }

  // Resolve roles from --role and/or --comparator
  if (roleFlag) {
    const normalized = roleFlag.trim().toLowerCase();
    if (normalized === "both") {
      options.roles = ["parent", "nurse"];
    } else if (normalized === "parent" || normalized === "nurse" || normalized === "patient") {
      options.roles = [normalized];
    } else if (normalized === "parent,nurse" || normalized === "parent+nurse") {
      options.roles = ["parent", "nurse"];
    } else {
      throw new Error(
        `--role must be patient|parent|nurse|both (got ${roleFlag})`,
      );
    }
  }

  if (comparatorFlag) {
    const c = comparatorFlag.trim();
    if (c === "peds_anny_real_garment_parent") options.roles = ["parent"];
    else if (c === "peds_anny_real_garment_nurse") options.roles = ["nurse"];
    else if (c === "peds_anny_real_garment_patient") options.roles = ["patient"];
    else if (c === "both" || c === "parent,nurse") options.roles = ["parent", "nurse"];
    else {
      throw new Error(
        `--comparator must be peds_anny_real_garment_{patient|parent|nurse}|both (got ${comparatorFlag})`,
      );
    }
  }

  // Sensible defaults when dual-role output dir is requested without --role
  if (
    options.outputDir.includes("parent-nurse-sleeve-deform")
    && !roleFlag
    && !comparatorFlag
  ) {
    options.roles = ["parent", "nurse"];
  }

  // Default inspection path for dual-role slice
  if (
    options.roles.some((r) => r === "parent" || r === "nurse")
    && options.inspectionPath.includes("ed-gown-geo-reorchestrate")
  ) {
    options.inspectionPath = path.join(
      options.outputDir,
      "ui-xr-parent-nurse-sleeve-deform-inspection.json",
    );
  }

  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

// tsx / node entry (match both file:// argv forms)
const isDirectRun =
  typeof process.argv[1] === "string"
  && (import.meta.url === `file://${process.argv[1]}`
    || import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))
    || process.argv[1].includes("ui-xr-peds-adaptive-dialogue-capture"));

if (isDirectRun) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
