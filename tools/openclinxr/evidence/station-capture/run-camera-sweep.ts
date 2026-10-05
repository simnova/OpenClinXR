/**
 * Camera-only sweep runner (measurement only; no staging or fixture changes).
 *
 * Per case: load the shipped scene once, run the production refine (current
 * search), record its applied score, then run the in-page camera sweep over
 * the requested look-target x FOV x eye-sampling variants and leave the
 * camera on the overall-best variant. Writes results.json rows; screenshots
 * only the newly-passing cases plus a contact sheet.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalComputeServices } from "@openclinxr/service-local-compute";
import {
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "../lib/portless-server.js";
import {
  buildRoomCaptureUrl,
  ROOM_CAPTURE_MODE,
  shippedStationIds,
  waitForHumanoidAssetsLoaded,
  waitForStationShell,
  reframeCameraForRoom,
} from "../ui-xr-environment-room-capture.js";
import { refineCameraForOcclusionAndContainment } from "./refine-camera-for-occlusion-and-containment.js";
import {
  DEFAULT_SWEEP_EYES,
  DEFAULT_SWEEP_FOVS,
  DEFAULT_SWEEP_LOOKS,
  runCameraSweepInPage,
  sweepGatePass,
  variantIdOf,
  type AppliedCameraScore,
  type CameraSweepEyes,
  type CameraSweepLookMode,
  type CameraSweepRow,
} from "./camera-sweep-search.js";
import type { Browser, Page } from "playwright";
import { buildContactSheet } from "../isolated-subject-harness.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export const SWEEP_OUT_REL = "docs/openclinxr/camera-sweep/results.json";
export const SWEEP_BEST_DIR_REL = "docs/openclinxr/camera-sweep/best";
export const SWEEP_SHEET_REL = "docs/openclinxr/camera-sweep/best-sheet.png";

const PHASE1_CASES = [
  "peds_fever_v1",
  "postop_fever_consult_pressure_v1",
  "psych_suicidal_ideation_safety_v1",
  "ward_delirium_med_rec_v1",
  "primary_care_dyslipidemia_joint_pain_v1",
  "ed_stroke_alert_handoff_v1",
  "oncology_bad_news_family_v1",
  "peds_asthma_parent_anxiety_v1",
];

function gitSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function parseArgs(argv: string[]): {
  cases: string[];
  fovs: number[];
  eyes: CameraSweepEyes[];
  looks: CameraSweepLookMode[];
  onlyVariants: string[];
  shots: boolean;
} {
  const out = {
    cases: [] as string[],
    fovs: [...DEFAULT_SWEEP_FOVS] as number[],
    eyes: [...DEFAULT_SWEEP_EYES],
    looks: [...DEFAULT_SWEEP_LOOKS],
    onlyVariants: [] as string[],
    shots: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--cases" && argv[i + 1]) out.cases = argv[++i]!.split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--fovs" && argv[i + 1]) out.fovs = argv[++i]!.split(",").map(Number).filter((n) => Number.isFinite(n));
    else if (arg === "--eyes" && argv[i + 1]) {
      out.eyes = argv[++i]!.split(",").map((s) => s.trim()).filter((s) => s === "orbit" || s === "grid") as CameraSweepEyes[];
    } else if (arg === "--looks" && argv[i + 1]) {
      const ok: CameraSweepLookMode[] = ["union", "per-actor-chest", "sphere", "patient"];
      out.looks = argv[++i]!.split(",").map((s) => s.trim()).filter((s): s is CameraSweepLookMode => (ok as string[]).includes(s));
    } else if (arg === "--only-variant" && argv[i + 1]) out.onlyVariants.push(argv[++i]!);
    else if (arg === "--no-shots") out.shots = false;
  }
  return out;
}

/** Read the currently applied camera score (production refine or sweep best). */
async function readAppliedCameraScore(page: Page): Promise<AppliedCameraScore | null> {
  const script = String.raw`(() => {
    var scene = globalThis.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return null;
    scene.updateMatrixWorld(true);
    var camera = null;
    scene.traverse(function (o) {
      if (!camera && (o.isPerspectiveCamera || o.type === "PerspectiveCamera")) camera = o;
    });
    if (!camera) return null;
    var e = camera.matrixWorld.elements;
    var ud = camera.userData || {};
    var containment = null;
    if (typeof ud.openClinXrActorContainment === "string") {
      var m = /^(\d+)\/(\d+)$/.exec(ud.openClinXrActorContainment);
      if (m) containment = { contained: Number(m[1]), total: Number(m[2]) };
    }
    var rawLook = ud.openClinXrCameraLookAt;
    return {
      eye: [e[12], e[13], e[14]],
      look: Array.isArray(rawLook) && rawLook.length === 3 ? rawLook : null,
      fov: typeof camera.fov === "number" ? camera.fov : null,
      refineTag: typeof ud.openClinXrRefineTag === "string" ? ud.openClinXrRefineTag : null,
      n: containment ? containment.contained : 0,
      total: containment ? containment.total : 0,
      facing: typeof ud.openClinXrMeanFacingDeg === "number" ? ud.openClinXrMeanFacingDeg : null,
      near: typeof ud.openClinXrNearOcclusionFraction === "number" ? ud.openClinXrNearOcclusionFraction : null,
      placardBack: ud.openClinXrPlacardBack === true,
      framingConstraintsMet: typeof ud.openClinXrFramingConstraintsMet === "boolean" ? ud.openClinXrFramingConstraintsMet : null,
      crownChest: Array.isArray(ud.openClinXrActorVisibility) ? ud.openClinXrActorVisibility : []
    };
  })()`;
  return page.evaluate(script) as Promise<AppliedCameraScore | null>;
}

function scoreOf(applied: AppliedCameraScore | null): {  n: number;
  total: number;
  facing: number | null;
  near: number | null;
  gatePass: boolean;
  crownChestOk: boolean;
} {
  const crownChestOk =
    applied !== null &&
    applied.crownChest.length > 0 &&
    applied.crownChest.every((r) => r.crownVisible && r.chestVisible);
  const gatePass =
    applied !== null &&
    applied.facing !== null &&
    applied.near !== null &&
    sweepGatePass({ n: applied.n, total: applied.total, facing: applied.facing, near: applied.near }) &&
    crownChestOk;
  return {
    n: applied?.n ?? 0,
    total: applied?.total ?? 0,
    facing: applied?.facing ?? null,
    near: applied?.near ?? null,
    gatePass,
    crownChestOk,
  };
}

function rowOf(row: CameraSweepRow): Record<string, unknown> {
  return {
    variant: row.variant,
    n: row.n,
    total: row.total,
    facing: Number(row.facing.toFixed(2)),
    near: Number(row.near.toFixed(4)),
    gatePass: row.gatePass,
    placardBack: row.placardBack,
    margin: Number(row.margin.toFixed(4)),
    eye: row.eye.map((v) => Number(v.toFixed(3))),
    look: row.look.map((v) => Number(v.toFixed(3))),
    fov: row.fov,
    failures: row.failures,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const allCases = shippedStationIds();
  if (allCases.length === 0) throw new Error("shippedStationIds() is empty");
  const cases = args.cases.length > 0 ? args.cases : allCases;
  const sampled = args.cases.length > 0;
  const jobTmp = path.join(process.env.OPENCLINXR_JOB_TMP ?? tmpdir(), `ocxr-camera-sweep-${process.pid}-${Date.now()}`);
  mkdirSync(jobTmp, { recursive: true });
  const bestDir = path.join(REPO_ROOT, SWEEP_BEST_DIR_REL);
  mkdirSync(bestDir, { recursive: true });

  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
  const caseRows: Record<string, unknown> = {};
  const newlyPassing: Array<{ caseId: string; variant: string }> = [];
  try {
    await createLocalComputeServices().sceneCapture.withBrowser("camera-sweep", async (handle) => {
      const browser = handle as Browser;
    for (let ci = 0; ci < cases.length; ci += 1) {
      const caseId = cases[ci]!;
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        const url = buildRoomCaptureUrl(server.url, caseId, ROOM_CAPTURE_MODE);
        process.stdout.write(`sweep: goto ${caseId}\n`);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        const live = await waitForStationShell(page, 180_000);
        await waitForHumanoidAssetsLoaded(page, 180_000);
        await reframeCameraForRoom(page, live.environmentId);
        await page.waitForTimeout(1500);
        const currentNote = await refineCameraForOcclusionAndContainment(page);
        const currentApplied = await readAppliedCameraScore(page);
        const current = scoreOf(currentApplied);
        process.stdout.write(`sweep: ${caseId} current ${currentNote} gate=${current.gatePass ? "pass" : "fail"}\n`);
        const sweep = await runCameraSweepInPage(page, {
          fovs: args.fovs,
          eyes: args.eyes,
          looks: args.looks,
          onlyVariantIds: args.onlyVariants.length > 0 ? args.onlyVariants : undefined,
          applyBest: true,
        });
        process.stdout.write(`sweep: ${caseId} ${sweep.note}\n`);
        const variants = sweep.rows.map(rowOf);
        const bestRow = sweep.rows.length > 0 ? sweep.rows[0]! : null;
        const bestGate = bestRow !== null && bestRow.gatePass && !bestRow.placardBack;
        if (args.shots && !current.gatePass && bestGate && bestRow) {
          const shotPath = path.join(bestDir, `${caseId}.png`);
          await page.waitForTimeout(800);
          await page.screenshot({ path: shotPath, fullPage: false });
          newlyPassing.push({ caseId, variant: bestRow.variant });
        }
        caseRows[caseId] = {
          current: {
            ...current,
            refineTag: currentApplied?.refineTag ?? null,
            variant: variantIdOf("union", 70, "orbit"),
          },
          variantCount: variants.length,
          eyeCounts: sweep.eyeCounts,
          timingMs: sweep.timingMs,
          bestVariant: sweep.bestVariant,
          bestGatePass: bestGate,
          variants,
        };
      } finally {
        await page.close().catch(() => undefined);
      }
    }
    if (args.shots && newlyPassing.length > 0) {
      const sheetPage = await browser.newPage();
      try {
        await buildContactSheet({
          page: sheetPage,
          cells: newlyPassing.map((s) => ({
            imagePath: path.join(bestDir, `${s.caseId}.png`),
            label: `${s.caseId} ${s.variant}`,
          })),
          outPath: path.join(REPO_ROOT, SWEEP_SHEET_REL),
          columns: 2,
          cellWidth: 720,
          cellHeight: 450,
        });
      } finally {
        await sheetPage.close().catch(() => undefined);
      }
    }
    });
  } finally {
    await stopPortlessDevServer(server.proc);
  }

  const winCounts: Record<string, number> = {};
  let currentPass = 0;
  let bestPass = 0;
  for (const caseId of Object.keys(caseRows)) {
    const entry = caseRows[caseId] as { current: { gatePass: boolean }; bestVariant: string | null; bestGatePass: boolean };
    if (entry.current.gatePass) currentPass += 1;
    if (entry.bestGatePass) bestPass += 1;
    if (entry.bestVariant) winCounts[entry.bestVariant] = (winCounts[entry.bestVariant] ?? 0) + 1;
  }
  const results = {
    schemaVersion: "openclinxr.camera-sweep.v1",
    generatedAt: new Date().toISOString(),
    treeSha: gitSha(),
    gate: "crown+chest visible, all actors whole, facing<=90, near<=0.10",
    sampled,
    phase1Cases: PHASE1_CASES,
    summary: {
      caseCount: Object.keys(caseRows).length,
      currentSearchPass: currentPass,
      bestVariantPass: bestPass,
      variantWinCounts: winCounts,
    },
    cases: caseRows,
  };
  const outPath = path.join(REPO_ROOT, SWEEP_OUT_REL);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote ${outPath} current=${currentPass} best=${bestPass} newlyShot=${newlyPassing.length}\n`);
}

const isDirectRun =
  typeof process.argv[1] === "string" && /run-camera-sweep\.(ts|js)$/.test(process.argv[1]);

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
