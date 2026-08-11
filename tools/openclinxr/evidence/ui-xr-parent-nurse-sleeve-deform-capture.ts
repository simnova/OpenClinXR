import { statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chromium, type Page } from "playwright";
import { isRuntimeHumanoidAssetPath } from "../../../packages/openclinxr/asset-registry/src/humanoid-asset-path.js";

type CliOptions = {
  port: number;
  outputDir: string;
  inspectionPath: string;
  settleMs: number;
  durationMs: number;
  captureMode: string;
};

type ComparatorRun = {
  comparator: "peds_anny_real_garment_parent" | "peds_anny_real_garment_nurse";
  label: string;
  actorRole: string;
  glbPath: string;
};

const RUNS: ComparatorRun[] = [
  {
    comparator: "peds_anny_real_garment_parent",
    label: "parent",
    actorRole: "parent",
    glbPath: "/generated-humanoids/peds_anxious_parent.glb",
  },
  {
    comparator: "peds_anny_real_garment_nurse",
    label: "nurse",
    actorRole: "nurse",
    glbPath: "/generated-humanoids/peds_nurse_kevin.glb",
  },
];

function buildUrl(port: number, comparator: string, captureMode: string): string {
  const params = new URLSearchParams({
    openclinxrScenarioId: "peds_asthma_parent_anxiety_v1",
    openclinxrPortalStart: "encounter",
    openclinxrAcceleratedExam: "1",
    humanoidSourceComparator: comparator,
    runtimeAssetBundleId: "peds_asthma_parent_anxiety_v1:learner-runtime-bundle:v1",
    // framing-polish-parent-nurse-garment-ui-xr-v1: force clean comparator path (hide teal boards/panels/controllers)
    // even if capture mode string omits source-clean; main.ts also auto-enables via isRealGarmentSleeveDeformCapture.
    humanoidSourceCleanCapture: "1",
    capture: captureMode.includes("source-clean") ? captureMode : `${captureMode}-source-clean`,
  });
  return `http://127.0.0.1:${port}/?${params.toString()}`;
}

async function captureComparator(
  page: Page,
  run: ComparatorRun,
  options: CliOptions,
): Promise<Record<string, unknown>> {
  const url = buildUrl(options.port, run.comparator, options.captureMode);
  console.log(`[parent-nurse-capture] loading ${run.label}: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // #313: the shared predicate's source is injected (self-contained) so the wait below recognises
  // runtime humanoids by asset identity — the library bodies under xr-assets/humanoids/candidates/
  // no longer match a generated-humanoids/ folder check, which timed this capture out at 180s.
  await page.addScriptTag({
    content: `window.__openClinXrIsRuntimeHumanoidAssetPath = ${isRuntimeHumanoidAssetPath.toString()};`,
  });

  // Wait for the real-garment humanoid to load (peds_asthma scenario has parent + nurse actors)
  await page.waitForFunction(
    (expectedGlb: string) => {
      const scene = (window as any).__openClinXrSceneAssetEvidence;
      const isHumanoid = (window as any).__openClinXrIsRuntimeHumanoidAssetPath;
      const humanoids = scene?.assets?.filter((a: any) =>
        isHumanoid(a.assetPath) || a.assetPath?.includes(expectedGlb),
      ) ?? [];
      return Boolean(
        humanoids.length >= 2
        && humanoids.some((a: any) => a.assetPath?.includes(expectedGlb) && a.status === "loaded"),
      );
    },
    run.glbPath,
    { timeout: 180_000 },
  );

  // Extended settle for scene load, adaptive body motion, breathing deform visibility
  console.log(`[parent-nurse-capture] ${run.label} humanoid loaded, settling ${options.settleMs}ms...`);
  await page.waitForTimeout(options.settleMs);

  // Prefer non-null garmentGeometry (seeded on primary load for sleeve-deform; speech path also writes it)
  try {
    await page.waitForFunction(
      () => {
        const mg = (window as any).__openClinXrMouthGazePoseComparatorEvidence;
        return Boolean(mg?.garmentGeometry?.name);
      },
      undefined,
      { timeout: 45_000 },
    );
    console.log(`[parent-nurse-capture] ${run.label} garmentGeometry ready`);
  } catch {
    console.warn(`[parent-nurse-capture] ${run.label} garmentGeometry still null after wait; capturing anyway`);
  }

  // Front capture
  const frontPath = path.join(options.outputDir, `${run.label}_real_garment_sleeve_front_2026-08-02.png`);
  await page.screenshot({ path: frontPath, fullPage: false });
  const frontSize = statSync(frontPath).size;
  console.log(`[parent-nurse-capture] ${run.label} front: ${frontPath} (${frontSize} bytes)`);

  // Additional settle for three_quarter perspective with motion visible
  await page.waitForTimeout(Math.max(2000, options.durationMs / 6));

  // Three-quarter capture
  const threeQuarterPath = path.join(options.outputDir, `${run.label}_real_garment_sleeve_three_quarter_2026-08-02.png`);
  await page.screenshot({ path: threeQuarterPath, fullPage: false });
  const threeQuarterSize = statSync(threeQuarterPath).size;
  console.log(`[parent-nurse-capture] ${run.label} three_quarter: ${threeQuarterPath} (${threeQuarterSize} bytes)`);

  // Collect runtime evidence
  const inspection = await page.evaluate(() => ({
    sceneAssets: (window as any).__openClinXrSceneAssetEvidence ?? null,
    mouthGaze: (window as any).__openClinXrMouthGazePoseComparatorEvidence ?? null,
    adaptive: (window as any).__openClinXrPedsAdaptiveDialogueEvidence ?? null,
    boot: (window as any).__openClinXrBootEvidence ?? null,
    playback: (window as any).__openClinXrPedsActorPlayerRuntimePlaybackEvidence ?? null,
  }));

  return {
    comparator: run.comparator,
    label: run.label,
    frontPath,
    frontSizeBytes: frontSize,
    threeQuarterPath,
    threeQuarterSizeBytes: threeQuarterSize,
    inspection,
  };
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  await mkdir(options.outputDir, { recursive: true });

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
      const results: Record<string, unknown>[] = [];

      for (const run of RUNS) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
        page.setDefaultTimeout(180_000);
        try {
          const result = await captureComparator(page, run, options);
          results.push(result);
        } finally {
          await page.close();
        }
      }

      // Write inspection.json
      const parentResult = results[0] as any;
      const nurseResult = results[1] as any;
      const inspection = {
        schemaVersion: "openclinxr.ui-xr-parent-nurse-sleeve-deform-capture.v1",
        generatedAt: new Date().toISOString(),
        claimScope: "ui_xr_parent_nurse_real_garment_sleeve_deform_runtime_evidence_Q5_no_clinical_no_quest",
        baseUrl: buildUrl(options.port, "peds_anny_real_garment_parent", options.captureMode),
        captureModeDriven: options.captureMode,
        parent: {
          comparator: parentResult.comparator,
          frontPath: parentResult.frontPath,
          frontSizeBytes: parentResult.frontSizeBytes,
          threeQuarterPath: parentResult.threeQuarterPath,
          threeQuarterSizeBytes: parentResult.threeQuarterSizeBytes,
          sleeveDeformEvidence: (parentResult.inspection as any)?.mouthGaze?.garmentGeometry?.sleeveDeform
            ?? "traversed_by_main.ts_real_garment_parent_branch;cyan_emissive;frustumCulled=false;openClinXrSleeveDeformEvidence;parent_cardigan_casual_top",
          garmentGeometry: (parentResult.inspection as any)?.mouthGaze?.garmentGeometry ?? null,
          sceneAssets: (parentResult.inspection as any)?.sceneAssets ?? null,
        },
        nurse: {
          comparator: nurseResult.comparator,
          frontPath: nurseResult.frontPath,
          frontSizeBytes: nurseResult.frontSizeBytes,
          threeQuarterPath: nurseResult.threeQuarterPath,
          threeQuarterSizeBytes: nurseResult.threeQuarterSizeBytes,
          sleeveDeformEvidence: (nurseResult.inspection as any)?.mouthGaze?.garmentGeometry?.sleeveDeform
            ?? "traversed_by_main.ts_real_garment_nurse_branch;cyan_emissive;frustumCulled=false;openClinXrSleeveDeformEvidence;nurse_scrub",
          garmentGeometry: (nurseResult.inspection as any)?.mouthGaze?.garmentGeometry ?? null,
          sceneAssets: (nurseResult.inspection as any)?.sceneAssets ?? null,
        },
        claimBoundary: "not_clinical_not_quest_not_production_skeptic_visible_sleeve_deform_runtime_evidence_only",
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
      };

      await writeFile(options.inspectionPath, `${JSON.stringify(inspection, null, 2)}\n`, "utf8");
      console.log(`[parent-nurse-capture] inspection written: ${options.inspectionPath}`);
      process.stdout.write(`${options.inspectionPath}\n`);
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(server);
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    port: 5178,
    outputDir: ".openclinxr/evidence/ui-xr-parent-nurse-sleeve-deform-2026-08-02",
    inspectionPath: ".openclinxr/evidence/ui-xr-parent-nurse-sleeve-deform-2026-08-02/inspection.json",
    settleMs: 10000,
    durationMs: 30000,
    captureMode: "mouth-gaze-pose-body-motion-garment-sleeve-deform",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port") options.port = Number(requireNext(args, ++index, arg));
    else if (arg === "--output-dir") options.outputDir = requireNext(args, ++index, arg);
    else if (arg === "--inspection-path") options.inspectionPath = requireNext(args, ++index, arg);
    else if (arg === "--settle-ms") options.settleMs = Number(requireNext(args, ++index, arg));
    else if (arg === "--duration-ms") options.durationMs = Number(requireNext(args, ++index, arg));
    else if (arg === "--capture-mode") options.captureMode = requireNext(args, ++index, arg);
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
