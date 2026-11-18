/**
 * #117 — live standing arm abduction relative to each figure's own shoulder span.
 *
 * Reuses the idle-arm-hang / room-capture portless probe (spawnPortlessDevServer +
 * buildRoomCaptureUrl + waitForStationShell + minFrames). Does not invent a new harness.
 *
 * Bound (planted contract): wristLateral ≤ 1.3 × halfShoulderSpan for standing figures.
 * halfShoulderSpanLateral = 0.5 × |upper_armL.worldXZ − upper_armR.worldXZ| (live upper-arm joint
 * positions, not clavicles — clavicles are not a reliable biacromial proxy on these rigs). The
 * numerator is the wrist's LATERAL component about the shoulder mid-line (#678), so the ratio is
 * same-space; the 3D span stays recorded but is not the denominator.
 *
 * claimScope: standing wrist lateral offset vs live lateral half shoulder span after frames.
 * notEvidenceFor: natural resting-arm appearance, hand pose, Quest readiness, clinical posture.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { listShippedCastScenarioIds } from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { waitForSceneAssetsSettled } from "./declared-actors-rendered.js";
import {
  type MeasurementTreeStamp,
  tryReadStampedArtifact,
  withTreeStamp,
} from "./lib/measurement-tree-stamp.js";
import { type PortlessDevServer, spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";
import { chromium, type Page } from "./lib/slotted-playwright.js";
import {
  checkSampledDiskReport,
  refuseSampledAtCanonical,
  routedArtifactDefault,
  SampledMeasureCache,
  selectionIdentityKey,
  selectRawSample,
} from "./station-subset/sampled-measure.js";
import type { SampleRecord } from "./station-subset.js";
import {
  buildRoomCaptureUrl,
  ROOM_CAPTURE_MODE,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

export const ARM_ABDUCTION_CEILING_DIR = ".openclinxr/evidence/arm-abduction-ceiling";
export const PRE_FIX_NAME = "pre-fix.json";
/** S2: fixed sampled siblings — a sampled run writes here, never the canonical path. */
export const PRE_FIX_SAMPLED_NAME = "pre-fix.json.sampled.json";
export const LATEST_NAME = "latest.json";
export const LATEST_SAMPLED_NAME = "latest.json.sampled.json";

/** Same default stations as idle-arm-hang (#91) so pre/post ranges are comparable. */
export const ARM_ABDUCTION_DEFAULT_SCENARIO_IDS = [
  "psych_suicidal_ideation_safety_v1",
  "ward_delirium_med_rec_v1",
  "oncology_bad_news_family_v1",
  "peds_fever_v1",
  "telehealth_diabetes_health_literacy_v1",
] as const;

/**
 * Test-named stations (staging/arm-abduction-ceiling.test.ts): none — grep finds no
 * `*_v1` id there, so the sampled selection is the raw subset with no union.
 */
export const ARM_ABDUCTION_ASSERTED_SCENARIO_IDS = [] as const;

export type ArmAbduction = {
  scenarioId: string;
  actorId: string;
  posture: string;
  side: "L" | "R";
  /** Half the live 3D shoulder span of THIS figure: 0.5 * |shoulderL − shoulderR| world positions.
   *  Kept recorded; NOT the ratio denominator (#678 — it is a 3D span over a 2D numerator). */
  halfShoulderSpanMeters: number;
  /** Half the live LATERAL shoulder span: 0.5 * the XZ distance between the shoulders. Same space
   *  as the corrected lateral numerator; level shoulders make it agree with the 3D span. */
  halfShoulderSpanLateralMeters: number;
  /** Side-to-side distance of the wrist from the shoulder mid-line along the actor's own L→R
   *  shoulder axis (XZ) (#678) — the corrected lateral numerator. */
  wristLateralOffsetMeters: number;
  /** Signed perpendicular component about the shoulder mid-line; sign convention unlocked (#678). */
  wristForwardOffsetMeters: number;
  /** XZ distance from the shoulder mid-line to the wrist (reach, kept under an honest name). */
  wristHorizontalRadiusMeters: number;
  shoulderWorldY: number;
  wristWorldY: number;
  framesAdvanced: number;
};

export type ArmAbductionReport = {
  scenarios: string[];
  arms: ArmAbduction[];
  /** R6: the selection this report measured (null when it measured everything). */
  sample: SampleRecord | null;
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.arm-abduction-ceiling.v1";
  kind: "arm_abduction_ceiling_live_geometry";
  label: string;
  generatedAt: string;
  /** #141 — refuse cache when HEAD or tracked worktree dirtiness moves. */
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  report: ArmAbductionReport;
};

/** Keyed in-process cache: a full report never satisfies a sampled call or vice versa. */
const measureCache = new SampledMeasureCache<ArmAbductionReport>();

/** Test seam: replace the live browser measurement (no browser). Null = production path. */
type MeasureLiveArmAbductionFn = typeof measureLiveArmAbduction;
let measureLiveArmAbductionForTest: MeasureLiveArmAbductionFn | null = null;

/** Test seam: stub the live measurement. Pass null to restore production measurement. */
export function setArmAbductionMeasureLiveForTest(fn: MeasureLiveArmAbductionFn | null): void {
  measureLiveArmAbductionForTest = fn;
}

/** Test seam: restore production measurement and drop in-process caches. */
export function resetArmAbductionTestSeam(): void {
  measureLiveArmAbductionForTest = null;
  measureCache.reset();
}

function preFixPath(): string {
  return path.join(ARM_ABDUCTION_CEILING_DIR, PRE_FIX_NAME);
}

function latestPath(): string {
  return path.join(ARM_ABDUCTION_CEILING_DIR, LATEST_NAME);
}

function sampledPreFixPath(): string {
  return path.join(ARM_ABDUCTION_CEILING_DIR, PRE_FIX_SAMPLED_NAME);
}

function sampledLatestPath(): string {
  return path.join(ARM_ABDUCTION_CEILING_DIR, LATEST_SAMPLED_NAME);
}

/** S2: a sampled pre-fix write goes to the fixed sampled path, never canonical. */
export function armAbductionPreFixPathForReport(report: ArmAbductionReport): string {
  return report.sample ? sampledPreFixPath() : preFixPath();
}

/** S2: a sampled latest write goes to the fixed sampled path, never canonical. */
export function armAbductionLatestPathForReport(report: ArmAbductionReport): string {
  return report.sample ? sampledLatestPath() : latestPath();
}

/** CW1: pure selection — the sampled-or-full station list, no browser. */
export type ArmAbductionSampleSelection = {
  ids: string[];
  sample: SampleRecord | null;
};

/** CW1: full bank for this instrument (the 5-default intersected with shipped). */
export function listFullArmAbductionBankScenarioIds(): string[] {
  return intersectWithShipped([...ARM_ABDUCTION_DEFAULT_SCENARIO_IDS]);
}

export function selectArmAbductionScenarioIds(
  allIds: string[],
  env: NodeJS.ProcessEnv = process.env,
): ArmAbductionSampleSelection {
  return selectRawSample(allIds, env);
}

/**
 * Signature consumed by arm-abduction-ceiling.test.ts planted contracts.
 * Measures once (shared across the three vitest cases).
 */
export async function inspectArmAbduction(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  /** When true, write/overwrite pre-fix.json (must be done BEFORE product edits). */
  writePreFix?: boolean;
  /** Test-only: redirect artifact reads/writes under this root (default: repo CWD). */
  evidenceRoot?: string;
}): Promise<ArmAbductionReport> {
  // S1: the seeded subset applies whenever the caller did not name stations —
  // including force:true re-measures, so each forced call re-measures the SAME
  // sampled ids (same seed -> same ids). Explicit scenarioIds bypass sampling.
  // One `station-subset: seed=` line is printed here on sampled runs.
  const selection: ArmAbductionSampleSelection = input?.scenarioIds?.length
    ? { ids: [...input.scenarioIds], sample: null }
    : selectArmAbductionScenarioIds(listFullArmAbductionBankScenarioIds());
  const sampled = selection.sample !== null;
  const needed = selection.ids;
  // F2: reuse only the exact selection identity (see SampledMeasureCache).
  // R3-F1: an explicit scenarioIds call gets its own key, distinct from "full".
  const key = selectionIdentityKey(input?.scenarioIds, selection.sample);
  if (!input?.force && !input?.writePreFix) {
    const hit = measureCache.peek(key) ?? measureCache.peekFlight(key);
    if (hit) return hit;
  }

  const task: Promise<ArmAbductionReport> = (async () => {
    const atRoot = (p: string): string =>
      input?.evidenceRoot ? path.join(input.evidenceRoot, p) : p;
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      if (process.env["OPENCLINXR_ARM_ABDUCTION_USE_DISK"] === "1") {
        // Sampled runs read only the sampled artifact; full runs read only canonical.
        const fromDisk = sampled
          ? await tryReadArtifact(atRoot(sampledPreFixPath()))
          : await tryReadArtifact(atRoot(preFixPath()));
        const hit = checkSampledDiskReport({
          instrument: "arm-abduction-ceiling",
          fromDisk,
          sampled,
          selectionSample: selection.sample,
          neededIds: needed,
          diskSample: fromDisk ? fromDisk.sample : null,
          diskMeasuredIds: fromDisk ? fromDisk.scenarios : [],
        });
        if (hit) {
          measureCache.store(hit, key);
          return hit;
        }
      }
    }

    const liveBaseUrl = input?.baseUrl;
    const measured = await (measureLiveArmAbductionForTest ?? measureLiveArmAbduction)({
      ...(liveBaseUrl === undefined ? {} : { baseUrl: liveBaseUrl }),
      scenarioIds: needed,
    });
    // S2: the measured report records its own selection (null on full runs).
    const report: ArmAbductionReport = {
      scenarios: measured.scenarios,
      arms: measured.arms,
      sample: selection.sample,
    };

    if (input?.writePreFix) {
      await writeArmAbductionDump(report, {
        outputPath: atRoot(armAbductionPreFixPathForReport(report)),
        label: input?.label ?? "pre-fix",
      });
    }

    // R3-F1: every completed call is cached under its own key, so a repeated
    // explicit selection is served without re-measuring.
    measureCache.store(report, key);
    return report;
  })();

  return measureCache.run(key, task);
}

async function tryReadArtifact(filePath: string): Promise<ArmAbductionReport | null> {
  // #141: refuse stale stamps (missing/mismatch → null). Fresh stamps still serve.
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = (parsed["report"] ?? parsed) as Partial<ArmAbductionReport> | undefined;
    if (
      report?.scenarios
      && Array.isArray(report.scenarios)
      && report.scenarios.length > 0
      && Array.isArray(report.arms)
      && report.arms.length > 0
    ) {
      return {
        scenarios: report.scenarios,
        arms: report.arms,
        sample: report.sample ?? null,
      } satisfies ArmAbductionReport;
    }
    return null;
  });
}

export async function writeArmAbductionDump(
  report: ArmAbductionReport,
  input?: { outputPath?: string; label?: string; evidenceRoot?: string },
): Promise<string> {
  // F1: routed default + canonical refusal live in station-subset/sampled-measure.
  const outputPath = routedArtifactDefault({
    reportSample: report.sample,
    canonicalRel: preFixPath(),
    sampledRel: armAbductionPreFixPathForReport(report),
    evidenceRoot: input?.evidenceRoot,
    outputPath: input?.outputPath,
  });
  refuseSampledAtCanonical({
    instrument: "arm-abduction-ceiling",
    kind: "sampled report",
    reportSample: report.sample,
    outputPath,
    canonicalRels: [preFixPath(), latestPath()],
    canonicalSuffix: (matched) => ` (canonical artifact ${matched})`,
    // No evidenceRoot exemption: the original S4 refusal throws on every
    // public path, exactly like station-room-not-empty's R3-F3 writer.
    evidenceRoot: undefined,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.arm-abduction-ceiling.v1" as const,
    kind: "arm_abduction_ceiling_live_geometry" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "live_wrist_lateral_vs_half_shoulder_span_after_frame_loop",
      "standing_arm_abduction_relative_bound",
    ],
    notEvidenceFor: [
      "natural_resting_arm_appearance",
      "hand_pose",
      "finger_articulation",
      "clinical_posture_appropriateness",
      "quest_readiness",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`arm-abduction-ceiling: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLiveArmAbduction(input: {
  baseUrl?: string;
  scenarioIds?: string[];
}): Promise<Omit<ArmAbductionReport, "sample">> {
  // Same default stations as idle-arm-hang (#91) so pre/post ranges are comparable.
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : intersectWithShipped([...ARM_ABDUCTION_DEFAULT_SCENARIO_IDS]);

  if (scenarios.length === 0) {
    throw new Error("measureLiveArmAbduction: no scenarios to measure");
  }

  let server: PortlessDevServer | undefined;
  let ownedServer = false;
  try {
    const baseUrl =
      input.baseUrl
      ?? (await (async () => {
        ownedServer = true;
        server = await spawnPortlessDevServer({
          filter: "@openclinxr/ui-xr",
          readyTimeoutMs: 180_000,
        });
        return server.url;
      })());

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        const arms: ArmAbduction[] = [];
        for (const scenarioId of scenarios) {
          process.stdout.write(`arm-abduction-ceiling: goto ${scenarioId}\n`);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForHumanoidsAndFrames(page, 8, 180_000);
          // #675: waitForHumanoidsAndFrames returns as soon as ONE skinned mesh exists; sibling
          // GLBs may still be loading, so their actor roots are absent at the sample instant.
          // Wait for the settle signal before sampling; a failed asset counts as settled.
          await waitForSceneAssetsSettled(page, 60_000);
          await page.waitForTimeout(900);
          const live = await readLiveArmAbductionFromPage(page);
          const sid = live.scenarioId || scenarioId;
          for (const a of live.arms) {
            const row: ArmAbduction = { ...a, scenarioId: sid };
            arms.push(row);
            const drop = row.shoulderWorldY - row.wristWorldY;
            const ratio =
              row.halfShoulderSpanLateralMeters > 0
                ? row.wristLateralOffsetMeters / row.halfShoulderSpanLateralMeters
                : Number.NaN;
            process.stdout.write(
              `  ${row.scenarioId}/${row.actorId} ${row.side} posture=${row.posture} `
              + `drop=${drop.toFixed(3)}m lateral=${row.wristLateralOffsetMeters.toFixed(3)}m `
              + `forward=${row.wristForwardOffsetMeters.toFixed(3)}m `
              + `halfSpanLateral=${row.halfShoulderSpanLateralMeters.toFixed(3)}m ratio=${ratio.toFixed(2)} `
              + `frames=${row.framesAdvanced}\n`,
            );
          }
          if (live.arms.length === 0) {
            process.stdout.write(`  WARN: no arms measured for ${scenarioId}\n`);
          }
        }
        return { scenarios: [...scenarios], arms };
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (ownedServer && server) {
      try {
        await stopPortlessDevServer(server.proc);
      } catch {
        // ignore
      }
    }
  }
}

function intersectWithShipped(preferred: string[]): string[] {
  const shipped = new Set(listShippedCastScenarioIds());
  const hit = preferred.filter((id) => shipped.has(id));
  if (hit.length > 0) return hit;
  return listShippedCastScenarioIds().slice(0, 5);
}

async function waitForHumanoidsAndFrames(
  page: Page,
  minFrames: number,
  timeoutMs: number,
): Promise<void> {
  await page.waitForFunction(
    ({ minFrames: need }) => {
      const win = browserPageWindow as unknown as {
        __openClinXrFrameStats?: { framesObserved?: number };
        __openClinXrDebugScene?: {
          traverse?: (cb: (o: {
            userData?: Record<string, unknown>;
            isSkinnedMesh?: boolean;
          }) => void) => void;
        };
      };
      const frames = win.__openClinXrFrameStats?.framesObserved ?? 0;
      if (frames < need) return false;
      const scene = win.__openClinXrDebugScene;
      if (!scene?.traverse) return false;
      let skinned = 0;
      let postureTagged = 0;
      scene.traverse((object) => {
        if (object.isSkinnedMesh) skinned += 1;
        const p = object.userData?.openClinXrActorPosture;
        if (p === "standing" || p === "seated" || p === "supine") postureTagged += 1;
      });
      return skinned >= 1 && postureTagged >= 1;
    },
    { minFrames },
    { timeout: timeoutMs },
  );
}

/**
 * String IIFE so tsx/esbuild cannot inject `__name` into the browser.
 * Decision: shoulder span from upper_arm L/R world positions (not clavicles).
 */
export async function readLiveArmAbductionFromPage(page: Page): Promise<{
  scenarioId: string;
  arms: ArmAbduction[];
}> {
  return page.evaluate(`(() => {
    const win = browserPageWindow;
    const framesAdvanced = (win.__openClinXrFrameStats && win.__openClinXrFrameStats.framesObserved) || 0;
    const scene = win.__openClinXrDebugScene;
    const params = new URLSearchParams(browserPageWindow.location.search);
    let scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";
    if (scene && scene.userData && scene.userData.openClinXrStationEnvironment &&
        typeof scene.userData.openClinXrStationEnvironment.scenarioId === "string") {
      scenarioId = scene.userData.openClinXrStationEnvironment.scenarioId || scenarioId;
    }
    if (!scene || typeof scene.traverse !== "function") {
      return { scenarioId: scenarioId, arms: [] };
    }

    const tagged = [];
    scene.traverse(function (object) {
      const posture = object.userData && object.userData.openClinXrActorPosture;
      if (posture === "standing" || posture === "seated" || posture === "supine") {
        tagged.push(object);
      }
    });
    const humanoidRoots = tagged.filter(function (root) {
      let hasTaggedDescendant = false;
      if (typeof root.traverse === "function") {
        root.traverse(function (child) {
          if (child === root) return;
          const p = child.userData && child.userData.openClinXrActorPosture;
          if (p === "standing" || p === "seated" || p === "supine") hasTaggedDescendant = true;
        });
      }
      return !hasTaggedDescendant;
    });

    function isBone(o) {
      return o && (o.isBone === true || o.type === "Bone");
    }

    function worldPos(o) {
      if (typeof o.updateWorldMatrix === "function") o.updateWorldMatrix(true, false);
      else if (typeof o.updateMatrixWorld === "function") o.updateMatrixWorld(true);
      const e = o.matrixWorld && o.matrixWorld.elements;
      if (!e) return { x: 0, y: 0, z: 0 };
      return { x: e[12], y: e[13], z: e[14] };
    }

    function matchArmBone(name, side, part) {
      const n = (name || "").toLowerCase().replace(/[^a-z0-9_]+/g, "");
      const hasSide =
        (side === "L" && (n.endsWith("l") || n.includes("left") || n.includes("_l")))
        || (side === "R" && (n.endsWith("r") || n.includes("right") || n.includes("_r")));
      if (!hasSide) return false;
      if (part === "upper") {
        return n.includes("upper_arm") || n.includes("upperarm") || n === "leftarm" || n === "rightarm"
          || (n.includes("arm") && !n.includes("fore") && !n.includes("hand") && !n.includes("lower"));
      }
      if (part === "fore") {
        return n.includes("forearm") || n.includes("lowerarm") || n.includes("lower_arm");
      }
      if (part === "hand") {
        return n.includes("hand") || n.includes("wrist");
      }
      return false;
    }

    const arms = [];
    for (let i = 0; i < humanoidRoots.length; i++) {
      const root = humanoidRoots[i];
      const posture = (root.userData && root.userData.openClinXrActorPosture) || "unknown";
      const actorId =
        (root.userData && (root.userData.openClinXrActorId || root.userData.actorId))
        || root.name
        || ("actor_" + i);
      if (typeof root.updateMatrixWorld === "function") root.updateMatrixWorld(true);

      const rootWp = worldPos(root);
      const allBones = [];
      root.traverse(function (o) {
        if (isBone(o)) allBones.push(o);
      });
      root.traverse(function (o) {
        if (!o.isSkinnedMesh || !o.skeleton || !o.skeleton.bones) return;
        if (typeof o.skeleton.update === "function") o.skeleton.update();
        for (let b = 0; b < o.skeleton.bones.length; b++) {
          const bone = o.skeleton.bones[b];
          if (bone && isBone(bone) && allBones.indexOf(bone) < 0) allBones.push(bone);
        }
      });

      let upperL = null;
      let upperR = null;
      for (let b = 0; b < allBones.length; b++) {
        const bone = allBones[b];
        if (!upperL && matchArmBone(bone.name, "L", "upper")) upperL = bone;
        if (!upperR && matchArmBone(bone.name, "R", "upper")) upperR = bone;
      }
      // Decision: spans from upper_arm L/R world positions (not clavicles). The LATERAL (XZ) span
      // is the same-space denominator for the corrected wrist lateral numerator (#678); the 3D span
      // stays recorded for consumers that want it. Level shoulders make the two agree to ~2 mm.
      let halfShoulderSpanMeters = 0;
      let halfShoulderSpanLateralMeters = 0;
      let shoulderMid = { x: rootWp.x, z: rootWp.z };
      let axisX = 1;
      let axisZ = 0;
      if (upperL && upperR) {
        const sl = worldPos(upperL);
        const sr = worldPos(upperR);
        const spanDx = sl.x - sr.x;
        const spanDy = sl.y - sr.y;
        const spanDz = sl.z - sr.z;
        halfShoulderSpanMeters = 0.5 * Math.sqrt(spanDx * spanDx + spanDy * spanDy + spanDz * spanDz);
        halfShoulderSpanLateralMeters = 0.5 * Math.sqrt(spanDx * spanDx + spanDz * spanDz);
        shoulderMid = { x: 0.5 * (sl.x + sr.x), z: 0.5 * (sl.z + sr.z) };
        const axisLen = Math.hypot(sr.x - sl.x, sr.z - sl.z);
        if (axisLen > 1e-6) {
          axisX = (sr.x - sl.x) / axisLen;
          axisZ = (sr.z - sl.z) / axisLen;
        }
      }
      // Perpendicular to the L→R shoulder axis in XZ (90° counter-clockwise viewed from +Y);
      // sign convention unlocked (#678) — magnitudes are what the bound asserts.
      const perpX = -axisZ;
      const perpZ = axisX;

      for (const side of ["L", "R"]) {
        let upper = side === "L" ? upperL : upperR;
        let fore = null;
        let hand = null;
        for (let b = 0; b < allBones.length; b++) {
          const bone = allBones[b];
          if (!fore && matchArmBone(bone.name, side, "fore")) fore = bone;
          if (!hand && matchArmBone(bone.name, side, "hand")) hand = bone;
        }
        if (!upper) continue;
        const wrist = hand || fore || upper;
        const shoulderWp = worldPos(upper);
        const wristWp = worldPos(wrist);
        const wx = wristWp.x - shoulderMid.x;
        const wz = wristWp.z - shoulderMid.z;
        const lateral = Math.abs(wx * axisX + wz * axisZ);
        const forward = wx * perpX + wz * perpZ;
        const horizontalRadius = Math.sqrt(wx * wx + wz * wz);

        arms.push({
          scenarioId: scenarioId,
          actorId: String(actorId),
          posture: String(posture),
          side: side,
          halfShoulderSpanMeters: halfShoulderSpanMeters,
          halfShoulderSpanLateralMeters: halfShoulderSpanLateralMeters,
          wristLateralOffsetMeters: lateral,
          wristForwardOffsetMeters: forward,
          wristHorizontalRadiusMeters: horizontalRadius,
          shoulderWorldY: shoulderWp.y,
          wristWorldY: wristWp.y,
          framesAdvanced: framesAdvanced,
        });
      }
    }
    return { scenarioId: scenarioId, arms: arms };
  })()`) as Promise<{ scenarioId: string; arms: ArmAbduction[] }>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let label = "cli";
  let writePreFix = false;
  let scenarioFilter: string[] | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--label" && args[i + 1]) label = args[++i]!;
    else if (arg === "--pre-fix") writePreFix = true;
    else if (arg === "--scenario" && args[i + 1]) {
      scenarioFilter = (scenarioFilter ?? []).concat(args[++i]!);
    }
  }
  const report = await inspectArmAbduction({
    force: true,
    writePreFix,
    label: writePreFix ? "pre-fix" : label,
    ...(scenarioFilter === undefined ? {} : { scenarioIds: scenarioFilter }),
  });
  // S2: sampled runs write the sampled siblings, never the canonical artifacts.
  await writeArmAbductionDump(report, {
    outputPath: writePreFix
      ? armAbductionPreFixPathForReport(report)
      : armAbductionLatestPathForReport(report),
    label: writePreFix ? "pre-fix" : label,
  });
  const standing = report.arms.filter((a) => a.posture === "standing");
  const ratios = standing
    .filter((a) => a.halfShoulderSpanLateralMeters > 0)
    .map((a) => a.wristLateralOffsetMeters / a.halfShoulderSpanLateralMeters);
  const minR = ratios.length ? Math.min(...ratios) : NaN;
  const maxR = ratios.length ? Math.max(...ratios) : NaN;
  process.stdout.write(
    `arm-abduction-ceiling: ${report.arms.length} arm rows (${standing.length} standing) `
    + `across ${report.scenarios.length} scenarios; standing ratio range ${minR.toFixed(2)}–${maxR.toFixed(2)}\n`,
  );
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("arm-abduction-ceiling.ts")
    || process.argv[1].endsWith("arm-abduction-ceiling.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
