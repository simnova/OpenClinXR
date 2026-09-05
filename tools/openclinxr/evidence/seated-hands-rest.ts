/**
 * #119 — live seated hand-to-thigh contact + elbow flexion after the mixer/frame loop.
 *
 * Extends the idle-arm-hang / arm-abduction / room-capture portless probe
 * (spawnPortlessDevServer + buildRoomCaptureUrl + waitForStationShell + minFrames).
 * Does NOT invent a new capture URL harness.
 *
 * Primary predicate (peer-round): wrist-to-thigh proximity as a fraction of the figure's
 * own arm length + required elbow flexion. Seated rest is a CONTACT problem (hands on
 * thighs / lap), not #117's standing lateral hang.
 *
 * claimScope: live wrist→thigh segment distance + elbow angle for seated actors after frames.
 * notEvidenceFor: natural sit appearance, clinical posture appropriateness, Quest readiness,
 * hand articulation, standing arm hang (covered by #117).
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

export const SEATED_HANDS_REST_DIR = ".openclinxr/evidence/seated-hands-rest";
export const PRE_FIX_NAME = "pre-fix.json";

export type SeatedHand = {
  scenarioId: string;
  actorId: string;
  posture: string;
  side: string;
  /** Shortest world distance from the wrist to this side's thigh bone segment. */
  wristToThighMeters: number;
  /** The figure's own upper-arm + forearm length, so the bound is relative. */
  armLengthMeters: number;
  /** Angle at the elbow. 180 degrees is a straight stick. */
  elbowAngleDegrees: number;
  framesAdvanced: number;
  /** Diagnostic: world positions used for the measure. */
  wristWorld?: { x: number; y: number; z: number };
  thighHeadWorld?: { x: number; y: number; z: number };
  thighTailWorld?: { x: number; y: number; z: number };
  wristLateralOffsetMeters?: number;
};

export type SeatedHandsRestReport = {
  seatedScenarios: string[];
  hands: SeatedHand[];
  /** All scenarios visited (includes standing stations measured for the counterweight path). */
  scenariosVisited: string[];
};

export type StandingAbductionArm = {
  scenarioId: string;
  actorId: string;
  side: string;
  ratio: number;
  halfShoulderSpanMeters: number;
  wristLateralOffsetMeters: number;
  posture: string;
};

export type StandingAbductionReport = {
  arms: StandingAbductionArm[];
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.seated-hands-rest.v1";
  kind: "seated_hands_rest_live_geometry";
  label: string;
  generatedAt: string;
  /** #141 — refuse cache when HEAD or tracked worktree dirtiness moves. */
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  report: SeatedHandsRestReport;
};

let cachedReport: SeatedHandsRestReport | null = null;
let measureInFlight: Promise<SeatedHandsRestReport> | null = null;

function preFixPath(): string {
  return path.join(SEATED_HANDS_REST_DIR, PRE_FIX_NAME);
}

/**
 * Signature consumed by seated-hands-rest.test.ts planted contracts.
 * Measures once (shared across vitest cases). Seated actors are enumerated from the LIVE
 * scene (posture === "seated"), not a hardcoded actor id.
 */
export async function inspectSeatedHandRest(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  /** When true, write/overwrite pre-fix.json (must be done BEFORE product edits). */
  writePreFix?: boolean;
}): Promise<SeatedHandsRestReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;
  if (!input?.force && !input?.writePreFix && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      const fromDisk = await tryReadArtifact(preFixPath());
      if (fromDisk && process.env.OPENCLINXR_SEATED_HANDS_USE_DISK === "1") {
        cachedReport = fromDisk;
        return fromDisk;
      }
    }

    const report = await measureLiveSeatedHands({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
    });

    if (input?.writePreFix) {
      await writeSeatedHandsDump(report, {
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

/**
 * Counterweight for #117: standing wrist lateral ≤ 1.3 × half shoulder span.
 * Reuses the same page-measure path; only standing arms are returned.
 */
export async function inspectStandingAbductionForCounterweight(input?: {
  baseUrl?: string;
  force?: boolean;
  scenarioIds?: string[];
}): Promise<StandingAbductionReport> {
  // Prefer a dedicated standing set so we do not depend on telehealth alone.
  const standingDefault = [
    "psych_suicidal_ideation_safety_v1",
    "ward_delirium_med_rec_v1",
    "peds_fever_v1",
  ];
  return measureStandingAbductionOnly({
    baseUrl: input?.baseUrl,
    scenarioIds: input?.scenarioIds ?? intersectWithShipped(standingDefault),
  });
}

async function tryReadArtifact(filePath: string): Promise<SeatedHandsRestReport | null> {
  // #141: refuse stale stamps (missing/mismatch → null). Fresh stamps still serve.
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = parsed.report as SeatedHandsRestReport | undefined;
    if (report?.seatedScenarios && Array.isArray(report.hands)) {
      return report;
    }
    return null;
  });
}

export async function writeSeatedHandsDump(
  report: SeatedHandsRestReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? preFixPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.seated-hands-rest.v1" as const,
    kind: "seated_hands_rest_live_geometry" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "live_wrist_to_thigh_segment_distance_after_frame_loop",
      "live_elbow_angle_seated_arms",
      "seated_actors_enumerated_from_runtime_posture",
    ],
    notEvidenceFor: [
      "natural_sit_appearance",
      "clinical_posture_appropriateness",
      "quest_readiness",
      "hand_articulation",
      "standing_arm_hang",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`seated-hands-rest: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLiveSeatedHands(input: {
  baseUrl?: string;
  scenarioIds?: string[];
  includeStandingArms?: boolean;
}): Promise<SeatedHandsRestReport> {
  // Dynamic bank walk: prefer known-seated telehealth + a few standing for context.
  // Seated hands are filtered by live posture === "seated" so a future seated station is covered.
  const defaultScenarios = [
    "telehealth_diabetes_health_literacy_v1",
    "psych_suicidal_ideation_safety_v1",
    "ward_delirium_med_rec_v1",
  ];
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : intersectWithShipped(defaultScenarios);

  if (scenarios.length === 0) {
    throw new Error("measureLiveSeatedHands: no scenarios to measure");
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
        const hands: SeatedHand[] = [];
        const seatedScenarios = new Set<string>();
        for (const scenarioId of scenarios) {
          process.stdout.write(`seated-hands-rest: goto ${scenarioId}\n`);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForHumanoidsAndFrames(page, 8, 180_000);
          await page.waitForTimeout(900);
          const live = await readLiveSeatedHandsFromPage(page);
          const sid = live.scenarioId || scenarioId;
          for (const h of live.hands) {
            if (h.posture !== "seated") continue;
            const row: SeatedHand = { ...h, scenarioId: sid };
            hands.push(row);
            seatedScenarios.add(sid);
            const ratio =
              row.armLengthMeters > 0
                ? row.wristToThighMeters / row.armLengthMeters
                : Number.NaN;
            process.stdout.write(
              `  SEATED ${row.scenarioId}/${row.actorId} ${row.side} `
              + `wrist→thigh=${row.wristToThighMeters.toFixed(3)}m `
              + `armLen=${row.armLengthMeters.toFixed(3)}m ratio=${ratio.toFixed(2)} `
              + `elbow=${row.elbowAngleDegrees.toFixed(0)}° `
              + `lateral=${(row.wristLateralOffsetMeters ?? 0).toFixed(3)}m `
              + `frames=${row.framesAdvanced}\n`,
            );
          }
          if (live.hands.filter((h) => h.posture === "seated").length === 0) {
            process.stdout.write(`  (no seated hands in ${scenarioId})\n`);
          }
        }
        return {
          seatedScenarios: [...seatedScenarios],
          hands,
          scenariosVisited: [...scenarios],
        };
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

async function measureStandingAbductionOnly(input: {
  baseUrl?: string;
  scenarioIds: string[];
}): Promise<StandingAbductionReport> {
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
        const arms: StandingAbductionArm[] = [];
        for (const scenarioId of input.scenarioIds) {
          process.stdout.write(`seated-hands-rest counterweight: goto ${scenarioId}\n`);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForHumanoidsAndFrames(page, 8, 180_000);
          await page.waitForTimeout(900);
          const live = await readStandingAbductionFromPage(page);
          const sid = live.scenarioId || scenarioId;
          for (const a of live.arms) {
            if (a.posture !== "standing") continue;
            arms.push({ ...a, scenarioId: sid });
            process.stdout.write(
              `  STANDING ${sid}/${a.actorId} ${a.side} ratio=${a.ratio.toFixed(2)} `
              + `lateral=${a.wristLateralOffsetMeters.toFixed(3)} halfSpan=${a.halfShoulderSpanMeters.toFixed(3)}\n`,
            );
          }
        }
        return { arms };
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
 * String IIFE — no TS syntax so tsx cannot inject `__name` into the browser.
 * Wrist→thigh: shortest distance from wrist world point to the thigh→shin bone segment.
 * Elbow angle: interior angle at elbow from shoulder–elbow–wrist world vectors (180 = straight).
 * Arm length: |upper→fore| + |fore→wrist|.
 */
export async function readLiveSeatedHandsFromPage(page: Page): Promise<{
  scenarioId: string;
  hands: SeatedHand[];
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
      return { scenarioId: scenarioId, hands: [] };
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

    function dist(a, b) {
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /** Point-to-segment distance in 3D. */
    function pointToSegment(p, a, b) {
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
      const ab2 = abx * abx + aby * aby + abz * abz;
      let t = ab2 > 1e-12 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      const cx = a.x + t * abx, cy = a.y + t * aby, cz = a.z + t * abz;
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    function matchBone(name, side, part) {
      const n = (name || "").toLowerCase().replace(/[^a-z0-9_]+/g, "");
      const hasSide =
        (side === "L" && (n.endsWith("l") || n.includes("left") || n.includes("_l")))
        || (side === "R" && (n.endsWith("r") || n.includes("right") || n.includes("_r")));
      if (!hasSide) return false;
      if (part === "upper") {
        return n.includes("upper_arm") || n.includes("upperarm") || n === "leftarm" || n === "rightarm"
          || (n.includes("arm") && !n.includes("fore") && !n.includes("hand") && !n.includes("lower")
            && !n.includes("thigh") && !n.includes("shin"));
      }
      if (part === "fore") {
        return n.includes("forearm") || n.includes("lowerarm") || n.includes("lower_arm");
      }
      if (part === "hand") {
        return n.includes("hand") || n.includes("wrist");
      }
      if (part === "thigh") {
        return n.includes("thigh") || n.includes("upleg") || n.includes("upperleg") || n === "leftupleg"
          || n === "rightupleg" || (n.includes("leg") && !n.includes("lower") && !n.includes("shin")
            && !n.includes("calf") && !n.includes("foot"));
      }
      if (part === "shin") {
        return n.includes("shin") || n.includes("lowerleg") || n.includes("calf")
          || (n.includes("leg") && (n.includes("lower") || n.includes("shin")));
      }
      return false;
    }

    const hands = [];
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

      for (const side of ["L", "R"]) {
        let upper = null, fore = null, hand = null, thigh = null, shin = null;
        for (let b = 0; b < allBones.length; b++) {
          const bone = allBones[b];
          if (!upper && matchBone(bone.name, side, "upper")) upper = bone;
          if (!fore && matchBone(bone.name, side, "fore")) fore = bone;
          if (!hand && matchBone(bone.name, side, "hand")) hand = bone;
          if (!thigh && matchBone(bone.name, side, "thigh")) thigh = bone;
          if (!shin && matchBone(bone.name, side, "shin")) shin = bone;
        }
        if (!upper || !thigh) continue;
        const elbow = fore || upper;
        const wrist = hand || fore || upper;
        const shoulderWp = worldPos(upper);
        const elbowWp = worldPos(elbow);
        const wristWp = worldPos(wrist);
        const thighHead = worldPos(thigh);
        // Thigh segment ends at shin head (knee) when present; else a short forward ray.
        const thighTail = shin
          ? worldPos(shin)
          : { x: thighHead.x, y: thighHead.y - 0.35, z: thighHead.z + 0.15 };

        const upperLen = dist(shoulderWp, elbowWp);
        const foreLen = dist(elbowWp, wristWp);
        const armLengthMeters = upperLen + foreLen;

        // Elbow interior angle: vectors elbow→shoulder and elbow→wrist.
        const v1x = shoulderWp.x - elbowWp.x, v1y = shoulderWp.y - elbowWp.y, v1z = shoulderWp.z - elbowWp.z;
        const v2x = wristWp.x - elbowWp.x, v2y = wristWp.y - elbowWp.y, v2z = wristWp.z - elbowWp.z;
        const n1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z) || 1e-9;
        const n2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z) || 1e-9;
        let cos = (v1x * v2x + v1y * v2y + v1z * v2z) / (n1 * n2);
        if (cos > 1) cos = 1;
        if (cos < -1) cos = -1;
        const elbowAngleDegrees = Math.acos(cos) * (180 / Math.PI);

        const wristToThighMeters = pointToSegment(wristWp, thighHead, thighTail);
        const dx = wristWp.x - rootWp.x;
        const dz = wristWp.z - rootWp.z;
        const lateral = Math.sqrt(dx * dx + dz * dz);

        hands.push({
          scenarioId: scenarioId,
          actorId: String(actorId),
          posture: String(posture),
          side: side,
          wristToThighMeters: wristToThighMeters,
          armLengthMeters: armLengthMeters,
          elbowAngleDegrees: elbowAngleDegrees,
          framesAdvanced: framesAdvanced,
          wristWorld: wristWp,
          thighHeadWorld: thighHead,
          thighTailWorld: thighTail,
          wristLateralOffsetMeters: lateral,
        });
      }
    }
    return { scenarioId: scenarioId, hands: hands };
  })()`) as Promise<{ scenarioId: string; hands: SeatedHand[] }>;
}

export async function readStandingAbductionFromPage(page: Page): Promise<{
  scenarioId: string;
  arms: StandingAbductionArm[];
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
      root.traverse(function (o) { if (isBone(o)) allBones.push(o); });
      root.traverse(function (o) {
        if (!o.isSkinnedMesh || !o.skeleton || !o.skeleton.bones) return;
        if (typeof o.skeleton.update === "function") o.skeleton.update();
        for (let b = 0; b < o.skeleton.bones.length; b++) {
          const bone = o.skeleton.bones[b];
          if (bone && isBone(bone) && allBones.indexOf(bone) < 0) allBones.push(bone);
        }
      });
      let upperL = null, upperR = null;
      for (let b = 0; b < allBones.length; b++) {
        const bone = allBones[b];
        if (!upperL && matchArmBone(bone.name, "L", "upper")) upperL = bone;
        if (!upperR && matchArmBone(bone.name, "R", "upper")) upperR = bone;
      }
      let halfShoulderSpanMeters = 0;
      if (upperL && upperR) {
        const sl = worldPos(upperL), sr = worldPos(upperR);
        const dx = sl.x - sr.x, dy = sl.y - sr.y, dz = sl.z - sr.z;
        halfShoulderSpanMeters = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      for (const side of ["L", "R"]) {
        let upper = side === "L" ? upperL : upperR;
        let fore = null, hand = null;
        for (let b = 0; b < allBones.length; b++) {
          const bone = allBones[b];
          if (!fore && matchArmBone(bone.name, side, "fore")) fore = bone;
          if (!hand && matchArmBone(bone.name, side, "hand")) hand = bone;
        }
        if (!upper) continue;
        const wrist = hand || fore || upper;
        const wristWp = worldPos(wrist);
        const dx = wristWp.x - rootWp.x;
        const dz = wristWp.z - rootWp.z;
        const lateral = Math.sqrt(dx * dx + dz * dz);
        const ratio = halfShoulderSpanMeters > 0 ? lateral / halfShoulderSpanMeters : 999;
        arms.push({
          scenarioId: scenarioId,
          actorId: String(actorId),
          side: side,
          ratio: ratio,
          halfShoulderSpanMeters: halfShoulderSpanMeters,
          wristLateralOffsetMeters: lateral,
          posture: String(posture),
        });
      }
    }
    return { scenarioId: scenarioId, arms: arms };
  })()`) as Promise<{ scenarioId: string; arms: StandingAbductionArm[] }>;
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
  const report = await inspectSeatedHandRest({
    force: true,
    writePreFix,
    label: writePreFix ? "pre-fix" : label,
    scenarioIds: scenarioFilter,
  });
  await writeSeatedHandsDump(report, {
    outputPath: path.join(SEATED_HANDS_REST_DIR, writePreFix ? PRE_FIX_NAME : "latest.json"),
    label: writePreFix ? "pre-fix" : label,
  });
  process.stdout.write(
    `seated-hands-rest: ${report.hands.length} seated hands across `
    + `${report.seatedScenarios.length} seated scenario(s) `
    + `(visited ${report.scenariosVisited.length})\n`,
  );
  for (const h of report.hands) {
    const ratio = h.armLengthMeters > 0 ? h.wristToThighMeters / h.armLengthMeters : NaN;
    process.stdout.write(
      `  ${h.scenarioId}/${h.actorId}.${h.side} ratio=${ratio.toFixed(2)} `
      + `elbow=${h.elbowAngleDegrees.toFixed(0)}° lateral=${(h.wristLateralOffsetMeters ?? 0).toFixed(3)}m\n`,
    );
  }
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("seated-hands-rest.ts")
    || process.argv[1].endsWith("seated-hands-rest.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
