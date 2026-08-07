/**
 * #91 — live standing arm hang geometry after the mixer/frame loop.
 *
 * Extends the seated-posture / room-capture probe — boots portless, uses
 * buildRoomCaptureUrl + waitForStationShell + minFrames wait, then reads the
 * LIVE scene graph. Does NOT invent a fourth page.evaluate harness.
 *
 * claimScope: world-space wrist-below-shoulder + lateral wrist clearance after frames.
 * notEvidenceFor: hand pose, finger articulation, clinical posture appropriateness, Quest readiness.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { listShippedCastScenarioIds } from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { spawnPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

export const IDLE_ARM_HANG_DIR = ".openclinxr/evidence/idle-arm-hang";
export const PRE_FIX_NAME = "pre-fix.json";

export type ArmBoneLocal = {
  name: string;
  rotation: { x: number; y: number; z: number; order: string };
  quaternion: { x: number; y: number; z: number; w: number };
  worldPosition: { x: number; y: number; z: number };
};

export type ArmMeasurement = {
  scenarioId: string;
  actorId: string;
  posture: string;
  side: "L" | "R";
  shoulderBoneName: string;
  wristBoneName: string;
  shoulderWorldY: number;
  wristWorldY: number;
  /** Horizontal distance from the body mid-line (actor root XZ) to the wrist. */
  wristLateralOffsetMeters: number;
  framesAdvanced: number;
  /** Runtime bone names for the arm chain as the scene graph reports them. */
  armChainBoneNames: string[];
  /** Local rotation + quaternion after the render loop advanced. */
  armBones: ArmBoneLocal[];
};

export type IdleArmHangReport = {
  scenarios: string[];
  arms: ArmMeasurement[];
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.idle-arm-hang.v1";
  kind: "idle_arm_hang_live_geometry";
  label: string;
  generatedAt: string;
  claimScope: string[];
  notEvidenceFor: string[];
  report: IdleArmHangReport;
};

/** In-process cache so three vitest cases share one measure pass. */
let cachedReport: IdleArmHangReport | null = null;
let measureInFlight: Promise<IdleArmHangReport> | null = null;

function preFixPath(): string {
  return path.join(IDLE_ARM_HANG_DIR, PRE_FIX_NAME);
}

/**
 * Signature consumed by idle-arm-hang.test.ts planted contracts.
 * Measures once (or reuses in-process / disk cache). Numbers are world-space from the live page.
 */
export async function inspectIdleArmHang(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  /** When true, write/overwrite pre-fix.json (must be done BEFORE product edits). */
  writePreFix?: boolean;
}): Promise<IdleArmHangReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;
  if (!input?.force && !input?.writePreFix && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      const fromDisk = await tryReadArtifact(preFixPath());
      // Prefer a live re-measure for contract assertions when product may have changed;
      // disk cache is only for pre-fix proof existence + offline inspection.
      if (fromDisk && process.env.OPENCLINXR_IDLE_ARM_HANG_USE_DISK === "1") {
        cachedReport = fromDisk;
        return fromDisk;
      }
    }

    const report = await measureLiveArmHang({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
    });

    if (input?.writePreFix) {
      await writeArmHangDump(report, {
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

async function tryReadArtifact(filePath: string): Promise<IdleArmHangReport | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as ArtifactPayload;
    if (
      parsed?.report?.scenarios
      && Array.isArray(parsed.report.scenarios)
      && parsed.report.scenarios.length > 0
      && Array.isArray(parsed.report.arms)
      && parsed.report.arms.length > 0
    ) {
      return parsed.report;
    }
  } catch {
    // missing or corrupt
  }
  return null;
}

export async function writeArmHangDump(
  report: IdleArmHangReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? preFixPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload: ArtifactPayload = {
    schemaVersion: "openclinxr.idle-arm-hang.v1",
    kind: "idle_arm_hang_live_geometry",
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "live_arm_bone_world_positions_after_frame_loop",
      "runtime_bone_names_as_scene_graph_reports",
      "local_rotation_and_quaternion_after_mixer",
    ],
    notEvidenceFor: [
      "hand_pose",
      "finger_articulation",
      "clinical_posture_appropriateness",
      "quest_readiness",
    ],
    report,
  };
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`idle-arm-hang: wrote ${outputPath}\n`);
  return outputPath;
}

/**
 * Core measure: same server/boot/wait pattern as measureLivePostureGeometry,
 * then a page.evaluate that dumps arm-chain bones (names, local rot/quat, world pos).
 */
async function measureLiveArmHang(input: {
  baseUrl?: string;
  scenarioIds?: string[];
}): Promise<IdleArmHangReport> {
  // Full bank is expensive; contracts need standing + at least one seated counterweight.
  // Default set: four pixel-graded standing stations + telehealth (seated patient).
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
    throw new Error("measureLiveArmHang: no scenarios to measure");
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
        const arms: ArmMeasurement[] = [];
        for (const scenarioId of scenarios) {
          process.stdout.write(`idle-arm-hang: goto ${scenarioId}\n`);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForHumanoidsAndFrames(page, 8, 180_000);
          // Extra settle so mixer + clinical idle re-apply have run several times.
          await page.waitForTimeout(900);
          const live = await readLiveArmHangFromPage(page);
          const sid = live.scenarioId || scenarioId;
          for (const a of live.arms) {
            const row: ArmMeasurement = { ...a, scenarioId: sid };
            arms.push(row);
            const drop = row.shoulderWorldY - row.wristWorldY;
            process.stdout.write(
              `  ${row.scenarioId}/${row.actorId} ${row.side} posture=${row.posture} `
              + `shoulder=${row.shoulderBoneName} wrist=${row.wristBoneName} `
              + `drop=${drop.toFixed(3)}m lateral=${row.wristLateralOffsetMeters.toFixed(3)}m `
              + `frames=${row.framesAdvanced} chain=[${row.armChainBoneNames.join(",")}]\n`,
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
        server.proc.kill("SIGTERM");
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
  // Fallback: first few shipped so contracts still have something to measure.
  return listShippedCastScenarioIds().slice(0, 5);
}

async function waitForHumanoidsAndFrames(
  page: Page,
  minFrames: number,
  timeoutMs: number,
): Promise<void> {
  await page.waitForFunction(
    ({ minFrames: need }) => {
      const win = window as unknown as {
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
 * String IIFE (not a TS arrow) so tsx/esbuild cannot inject `__name` into the browser.
 * Reads RUNTIME bone names, local rotation+quaternion, and shoulder/wrist world positions.
 */
export async function readLiveArmHangFromPage(page: Page): Promise<{
  scenarioId: string;
  arms: ArmMeasurement[];
}> {
  return page.evaluate(`(() => {
    const win = window;
    const framesAdvanced = (win.__openClinXrFrameStats && win.__openClinXrFrameStats.framesObserved) || 0;
    const scene = win.__openClinXrDebugScene;
    const params = new URLSearchParams(window.location.search);
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

    function boneLocal(o) {
      const r = o.rotation || { x: 0, y: 0, z: 0, order: "XYZ" };
      const q = o.quaternion || { x: 0, y: 0, z: 0, w: 1 };
      const wp = worldPos(o);
      return {
        name: o.name || "",
        rotation: { x: r.x || 0, y: r.y || 0, z: r.z || 0, order: r.order || "XYZ" },
        quaternion: { x: q.x || 0, y: q.y || 0, z: q.z || 0, w: q.w != null ? q.w : 1 },
        worldPosition: wp,
      };
    }

    function matchArmBone(name, side, part) {
      const n = (name || "").toLowerCase().replace(/[^a-z0-9_]+/g, "");
      const sideTokens = side === "L"
        ? ["l", "left", ".l", "_l"]
        : ["r", "right", ".r", "_r"];
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
      // Also collect skeleton bones if any skinned mesh holds extras.
      root.traverse(function (o) {
        if (!o.isSkinnedMesh || !o.skeleton || !o.skeleton.bones) return;
        if (typeof o.skeleton.update === "function") o.skeleton.update();
        for (let b = 0; b < o.skeleton.bones.length; b++) {
          const bone = o.skeleton.bones[b];
          if (bone && isBone(bone) && allBones.indexOf(bone) < 0) allBones.push(bone);
        }
      });

      for (const side of ["L", "R"]) {
        let upper = null;
        let fore = null;
        let hand = null;
        for (let b = 0; b < allBones.length; b++) {
          const bone = allBones[b];
          if (!upper && matchArmBone(bone.name, side, "upper")) upper = bone;
          if (!fore && matchArmBone(bone.name, side, "fore")) fore = bone;
          if (!hand && matchArmBone(bone.name, side, "hand")) hand = bone;
        }
        if (!upper) continue;
        const wrist = hand || fore || upper;
        const shoulderWp = worldPos(upper);
        const wristWp = worldPos(wrist);
        const dx = wristWp.x - rootWp.x;
        const dz = wristWp.z - rootWp.z;
        const lateral = Math.sqrt(dx * dx + dz * dz);

        const chain = [];
        const armBones = [];
        if (upper) { chain.push(upper.name); armBones.push(boneLocal(upper)); }
        if (fore) { chain.push(fore.name); armBones.push(boneLocal(fore)); }
        if (hand) { chain.push(hand.name); armBones.push(boneLocal(hand)); }

        arms.push({
          scenarioId: scenarioId,
          actorId: String(actorId),
          posture: String(posture),
          side: side,
          shoulderBoneName: upper.name || "",
          wristBoneName: wrist.name || "",
          shoulderWorldY: shoulderWp.y,
          wristWorldY: wristWp.y,
          wristLateralOffsetMeters: lateral,
          framesAdvanced: framesAdvanced,
          armChainBoneNames: chain,
          armBones: armBones,
        });
      }
    }
    return { scenarioId: scenarioId, arms: arms };
  })()`) as Promise<{ scenarioId: string; arms: ArmMeasurement[] }>;
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
  const report = await inspectIdleArmHang({
    force: true,
    writePreFix,
    label: writePreFix ? "pre-fix" : label,
    scenarioIds: scenarioFilter,
  });
  // Always write latest; only write pre-fix when --pre-fix is explicit (do not clobber).
  await writeArmHangDump(report, {
    outputPath: path.join(IDLE_ARM_HANG_DIR, writePreFix ? PRE_FIX_NAME : "latest.json"),
    label: writePreFix ? "pre-fix" : label,
  });
  process.stdout.write(
    `idle-arm-hang: ${report.arms.length} arm rows across ${report.scenarios.length} scenarios\n`,
  );
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("idle-arm-hang.ts")
    || process.argv[1].endsWith("idle-arm-hang.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
