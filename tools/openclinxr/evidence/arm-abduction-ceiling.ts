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
import { chromium, type Page } from "playwright";
import { listShippedCastScenarioIds } from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  tryReadStampedArtifact,
  withTreeStamp,
  type MeasurementTreeStamp,
} from "./lib/measurement-tree-stamp.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";
import { waitForSceneAssetsSettled } from "./declared-actors-rendered.js";

export const ARM_ABDUCTION_CEILING_DIR = ".openclinxr/evidence/arm-abduction-ceiling";
export const PRE_FIX_NAME = "pre-fix.json";

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

let cachedReport: ArmAbductionReport | null = null;
let measureInFlight: Promise<ArmAbductionReport> | null = null;

function preFixPath(): string {
  return path.join(ARM_ABDUCTION_CEILING_DIR, PRE_FIX_NAME);
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
}): Promise<ArmAbductionReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;
  if (!input?.force && !input?.writePreFix && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      const fromDisk = await tryReadArtifact(preFixPath());
      if (fromDisk && process.env.OPENCLINXR_ARM_ABDUCTION_USE_DISK === "1") {
        cachedReport = fromDisk;
        return fromDisk;
      }
    }

    const report = await measureLiveArmAbduction({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
    });

    if (input?.writePreFix) {
      await writeArmAbductionDump(report, {
        outputPath: preFixPath(),
        label: input?.label ?? "pre-fix",
      });
    }

    if (!input?.scenarioIds) {
      cachedReport = report;
    }
    return report;
  })();

  try {
    return await measureInFlight;
  } finally {
    measureInFlight = null;
  }
}

async function tryReadArtifact(filePath: string): Promise<ArmAbductionReport | null> {
  // #141: refuse stale stamps (missing/mismatch → null). Fresh stamps still serve.
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = parsed.report as ArmAbductionReport | undefined;
    if (
      report?.scenarios
      && Array.isArray(report.scenarios)
      && report.scenarios.length > 0
      && Array.isArray(report.arms)
      && report.arms.length > 0
    ) {
      return report;
    }
    return null;
  });
}

export async function writeArmAbductionDump(
  report: ArmAbductionReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? preFixPath();
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
}): Promise<ArmAbductionReport> {
  // Same default stations as idle-arm-hang (#91) so pre/post ranges are comparable.
  const defaultScenarios = [
    "psych_suicidal_ideation_safety_v1",
    "ward_delirium_med_rec_v1",
    "oncology_bad_news_family_v1",
    "peds_fever_v1",
    "telehealth_diabetes_health_literacy_v1",
  ];
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : intersectWithShipped(defaultScenarios);

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
    scenarioIds: scenarioFilter,
  });
  await writeArmAbductionDump(report, {
    outputPath: path.join(ARM_ABDUCTION_CEILING_DIR, writePreFix ? PRE_FIX_NAME : "latest.json"),
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
