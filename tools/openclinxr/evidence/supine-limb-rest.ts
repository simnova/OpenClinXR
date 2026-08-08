/**
 * #153 — live supine limb + head rest staging (world positions, not eulers).
 *
 * Extends the #150 supine-patient-on-deck live probe with per-limb landmarks.
 * Reuses portless room-capture harness; does not invent a second capture path.
 *
 * claimScope: ED primary_patient wrist/head staging relative to deck + pillow after frames.
 * notEvidenceFor: clinical lying validity, anatomical joint angles, Quest readiness,
 * other stations' posture, garment quality.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { spawnPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
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

export const SUPINE_LIMB_REST_DIR = ".openclinxr/evidence/supine-limb-rest";
export const ISSUE_153_PRE_FIX = ".openclinxr/evidence/issue-153/pre-fix.json";
export const ED_SCENARIO = "ed_chest_pain_priority_v1";

export type Vec3 = { x: number; y: number; z: number };

export type SupineLimbFacts = {
  scenarioId: string;
  actorId: string;
  posture: string;
  head: Vec3;
  neck: Vec3;
  shoulderL: Vec3;
  shoulderR: Vec3;
  elbowL: Vec3;
  elbowR: Vec3;
  wristL: Vec3;
  wristR: Vec3;
  hipL: Vec3;
  hipR: Vec3;
  kneeL: Vec3;
  kneeR: Vec3;
  ankleL: Vec3;
  ankleR: Vec3;
  deckTopY: number;
  torsoAxis: Vec3;
  torsoHalfWidth: number;
  railHalfWidth: number;
  pillowEnd: Vec3;
  neckPoseSource: string;
  framesAdvanced: number;
};

export type SupineLimbRestReport = {
  scenarios: string[];
  actors: SupineLimbFacts[];
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.supine-limb-rest.v1";
  kind: "supine_limb_rest";
  label: string;
  generatedAt: string;
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  report: SupineLimbRestReport;
};

let cachedReport: SupineLimbRestReport | null = null;
let measureInFlight: Promise<SupineLimbRestReport> | null = null;

/**
 * Contract entry for planted #153 REDs.
 * Default: ED only (scope first measurement to one station).
 */
export async function inspectSupineLimbRest(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  writePreFix?: boolean;
}): Promise<SupineLimbRestReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;
  if (!input?.force && !input?.writePreFix && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      const fromDisk = await tryReadArtifact(path.join(SUPINE_LIMB_REST_DIR, "latest.json"));
      if (fromDisk && process.env.OPENCLINXR_SUPINE_LIMB_USE_DISK === "1") {
        cachedReport = fromDisk;
        return fromDisk;
      }
    }

    const report = await measureLive({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds ?? [ED_SCENARIO],
    });

    await writeDump(report, {
      outputPath: path.join(SUPINE_LIMB_REST_DIR, "latest.json"),
      label: input?.label ?? "measure",
    });

    if (input?.writePreFix) {
      await writeDump(report, {
        outputPath: ISSUE_153_PRE_FIX,
        label: "pre-fix",
      });
    }

    if (!input?.scenarioIds || input.scenarioIds.length === 0) {
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

async function tryReadArtifact(filePath: string): Promise<SupineLimbRestReport | null> {
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = parsed.report as SupineLimbRestReport | undefined;
    if (
      report?.scenarios
      && Array.isArray(report.scenarios)
      && report.scenarios.length > 0
      && Array.isArray(report.actors)
      && report.actors.length > 0
    ) {
      return report;
    }
    return null;
  });
}

export async function writeDump(
  report: SupineLimbRestReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? path.join(SUPINE_LIMB_REST_DIR, "latest.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.supine-limb-rest.v1" as const,
    kind: "supine_limb_rest" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "ed_supine_wrist_head_world_positions_after_frame_loop",
      "staging_not_clinical_joint_angles",
      "deck_pillow_relative_limb_landmarks",
    ],
    notEvidenceFor: [
      "clinical_lying_validity",
      "anatomical_joint_angle_correctness",
      "quest_readiness",
      "other_station_posture",
      "garment_quality",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`supine-limb-rest: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLive(input: {
  baseUrl?: string;
  scenarioIds: string[];
}): Promise<SupineLimbRestReport> {
  const scenarios = input.scenarioIds;
  if (scenarios.length === 0) {
    throw new Error("inspectSupineLimbRest: no scenarios");
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
        const actors: SupineLimbFacts[] = [];
        for (const scenarioId of scenarios) {
          process.stdout.write(`supine-limb-rest: goto ${scenarioId}\n`);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForHumanoidsAndFrames(page, 12, 180_000);
          // Extra settle so per-frame supine re-apply is visible to the inspector.
          await page.waitForTimeout(1500);

          const live = await readLiveLimbRestFromPage(page);
          const sid = live.scenarioId || scenarioId;
          for (const a of live.actors) {
            const row: SupineLimbFacts = { ...a, scenarioId: sid || a.scenarioId };
            actors.push(row);
            const wristAboveL = row.wristL.y - row.deckTopY;
            const wristAboveR = row.wristR.y - row.deckTopY;
            process.stdout.write(
              `  ${row.scenarioId}/${row.actorId} posture=${row.posture} frames=${row.framesAdvanced} `
              + `neckSrc=${row.neckPoseSource} `
              + `wristY_above=[${wristAboveL.toFixed(3)},${wristAboveR.toFixed(3)}] `
              + `head=(${row.head.x.toFixed(3)},${row.head.y.toFixed(3)},${row.head.z.toFixed(3)}) `
              + `pillow=(${row.pillowEnd.x.toFixed(3)},${row.pillowEnd.y.toFixed(3)},${row.pillowEnd.z.toFixed(3)})\n`,
            );
          }
          if (live.actors.length === 0) {
            process.stdout.write(`  WARN: no actors measured for ${scenarioId}\n`);
          }
        }
        return { scenarios: [...scenarios], actors };
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
          traverse?: (cb: (o: { isSkinnedMesh?: boolean }) => void) => void;
        };
      };
      const frames = win.__openClinXrFrameStats?.framesObserved ?? 0;
      if (frames < need) return false;
      const scene = win.__openClinXrDebugScene;
      if (!scene || typeof scene.traverse !== "function") return false;
      let skinned = 0;
      scene.traverse((o) => {
        if (o.isSkinnedMesh) skinned += 1;
      });
      return skinned > 0;
    },
    { minFrames },
    { timeout: timeoutMs },
  );
}

/**
 * String IIFE so tsx/esbuild cannot inject __name into the browser payload.
 */
async function readLiveLimbRestFromPage(page: Page): Promise<{
  scenarioId: string;
  actors: SupineLimbFacts[];
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
      return { scenarioId: scenarioId, actors: [] };
    }

    // Deck / stretcher / pillow world rest point.
    let stretcherRoot = null;
    let deckTopY = 0.55;
    let stretcherX = 0;
    let stretcherZ = 0;
    let pillowWorld = null;
    let railHalfWidth = 0.45;
    scene.traverse(function (obj) {
      const ud = obj.userData || {};
      if (ud.openClinXrStretcherKind === "procedural_patient_stretcher" || ud.fixtureSlotId === "stretcher") {
        if (!stretcherRoot) {
          stretcherRoot = obj;
          if (obj.position) {
            stretcherX = obj.position.x;
            stretcherZ = obj.position.z;
          }
        }
        if (typeof ud.deckTopYMeters === "number") deckTopY = ud.deckTopYMeters;
        if (typeof ud.railHalfWidthMeters === "number") railHalfWidth = ud.railHalfWidthMeters;
      }
      const name = (obj.name || "").toLowerCase();
      // Prefer procedural stretcher pillow (…fixture-slot.stretcher.pillow), not HUD labels.
      // Use live matrix Y — pillow rides the HOB back section (#159/#171). Forcing
      // deckTopY+0.23 was a flat-deck assumption and made head-to-pillow distance
      // jump by ~0.4 m whenever the deck raised.
      if (name.indexOf("pillow") >= 0 && name.indexOf("stretcher") >= 0) {
        if (typeof obj.updateWorldMatrix === "function") obj.updateWorldMatrix(true, false);
        else if (typeof obj.updateMatrixWorld === "function") obj.updateMatrixWorld(true);
        const e = obj.matrixWorld && obj.matrixWorld.elements;
        if (e) {
          pillowWorld = { x: e[12], y: e[13], z: e[14] };
        }
      }
    });
    if (stretcherRoot) {
      if (typeof stretcherRoot.updateWorldMatrix === "function") stretcherRoot.updateWorldMatrix(true, true);
      if (stretcherRoot.position) {
        stretcherX = stretcherRoot.position.x;
        stretcherZ = stretcherRoot.position.z;
      }
    }
    // Fallback: procedural pillow is at stretcher local (−length*0.38, 0) = (−0.836, 0).
    const pillowEnd = pillowWorld || {
      x: stretcherX - 0.836,
      y: deckTopY + 0.04,
      z: stretcherZ
    };

    function worldPos(obj) {
      if (typeof obj.updateWorldMatrix === "function") obj.updateWorldMatrix(true, false);
      else if (typeof obj.updateMatrixWorld === "function") obj.updateMatrixWorld(true);
      const e = obj.matrixWorld && obj.matrixWorld.elements;
      if (!e) return { x: 0, y: 0, z: 0 };
      return { x: e[12], y: e[13], z: e[14] };
    }

    function resolveActorId(root, index) {
      if (root.userData && typeof root.userData.openClinXrActorId === "string" && root.userData.openClinXrActorId.length > 0) {
        return root.userData.openClinXrActorId;
      }
      let p = root.parent;
      let d = 0;
      while (p && d < 6) {
        if (p.userData && typeof p.userData.openClinXrActorId === "string" && p.userData.openClinXrActorId.length > 0) {
          return p.userData.openClinXrActorId;
        }
        p = p.parent;
        d++;
      }
      return (root.name && root.name.length > 0) ? root.name : ("actor_" + index);
    }

    function resolvePosture(root) {
      if (root.userData && typeof root.userData.openClinXrActorPosture === "string") {
        return root.userData.openClinXrActorPosture;
      }
      let p = root.parent;
      let d = 0;
      while (p && d < 6) {
        if (p.userData && typeof p.userData.openClinXrActorPosture === "string") {
          return p.userData.openClinXrActorPosture;
        }
        p = p.parent;
        d++;
      }
      return "standing";
    }

    function collectBones(root) {
      const byName = {};
      function consider(obj) {
        const n = obj.name || "";
        if (!n) return;
        const isBone = obj.isBone === true || obj.type === "Bone";
        if (!isBone) return;
        // Prefer first occurrence; skeleton bones often duplicate scene graph.
        if (!byName[n]) byName[n] = obj;
      }
      if (typeof root.traverse === "function") {
        root.traverse(consider);
        root.traverse(function (object) {
          if (!object.isSkinnedMesh || !object.skeleton || !object.skeleton.bones) return;
          if (typeof object.skeleton.update === "function") object.skeleton.update();
          for (let i = 0; i < object.skeleton.bones.length; i++) {
            consider(object.skeleton.bones[i]);
          }
        });
      }
      return byName;
    }

    function pickBone(byName, names) {
      for (let i = 0; i < names.length; i++) {
        if (byName[names[i]]) return byName[names[i]];
      }
      // Case-insensitive fallback.
      const keys = Object.keys(byName);
      for (let i = 0; i < names.length; i++) {
        const want = names[i].toLowerCase();
        for (let k = 0; k < keys.length; k++) {
          if (keys[k].toLowerCase() === want) return byName[keys[k]];
        }
      }
      return null;
    }

    function boneWorld(byName, names) {
      const b = pickBone(byName, names);
      return b ? worldPos(b) : { x: 0, y: 0, z: 0 };
    }

    function neckSource(byName) {
      const neck = pickBone(byName, ["neck", "Neck"]);
      const head = pickBone(byName, ["head", "Head"]);
      const candidates = [neck, head].filter(Boolean);
      for (let i = 0; i < candidates.length; i++) {
        const ud = candidates[i].userData || {};
        if (ud.openClinXrSupinePose || ud.openClinXrNeckPoseSource === "supine_map") {
          return "supine_map";
        }
        if (typeof ud.openClinXrNeckPoseSource === "string" && ud.openClinXrNeckPoseSource.length > 0) {
          return ud.openClinXrNeckPoseSource;
        }
        if (ud.openClinXrClinicalIdlePosture) return "clinical_idle";
        if (ud.openClinXrRoleSpecificPose) return "role_specific";
      }
      // Root-level marker written by applySupinePose when neck is in the map.
      return "unknown_or_bind";
    }

    // Humanoid roots (staged actor ids only — same discriminator as #150).
    const humanoidRoots = [];
    scene.traverse(function (obj) {
      if (!obj.isSkinnedMesh) return;
      let root = obj;
      let depth = 0;
      while (root.parent && depth < 12) {
        const p = root.parent;
        if (p === scene) break;
        root = p;
        depth++;
      }
      if (humanoidRoots.indexOf(root) < 0) humanoidRoots.push(root);
    });

    const actors = [];
    for (let r = 0; r < humanoidRoots.length; r++) {
      const root = humanoidRoots[r];
      const rawSlotId =
        root.userData && typeof root.userData.openClinXrActorId === "string"
          ? root.userData.openClinXrActorId
          : "";
      let hasStagedActorId = typeof rawSlotId === "string" && rawSlotId.length > 0;
      if (!hasStagedActorId) {
        let p = root.parent;
        let depth = 0;
        while (p && depth < 6) {
          if (p.userData && typeof p.userData.openClinXrActorId === "string" && p.userData.openClinXrActorId.length > 0) {
            hasStagedActorId = true;
            break;
          }
          p = p.parent;
          depth++;
        }
      }
      if (!hasStagedActorId) continue;

      if (typeof root.updateMatrixWorld === "function") root.updateMatrixWorld(true);
      const byName = collectBones(root);

      const head = boneWorld(byName, ["head", "Head"]);
      const neck = boneWorld(byName, ["neck", "Neck"]);
      const shoulderL = boneWorld(byName, ["upper_armL", "upper_arm.L", "clavicleL", "shoulderL"]);
      const shoulderR = boneWorld(byName, ["upper_armR", "upper_arm.R", "clavicleR", "shoulderR"]);
      const elbowL = boneWorld(byName, ["forearmL", "forearm.L", "lower_armL"]);
      const elbowR = boneWorld(byName, ["forearmR", "forearm.R", "lower_armR"]);
      const wristL = boneWorld(byName, ["handL", "hand.L", "wristL"]);
      const wristR = boneWorld(byName, ["handR", "hand.R", "wristR"]);
      const hipL = boneWorld(byName, ["thighL", "thigh.L", "upperlegL", "hipL"]);
      const hipR = boneWorld(byName, ["thighR", "thigh.R", "upperlegR", "hipR"]);
      const kneeL = boneWorld(byName, ["shinL", "shin.L", "lowerlegL", "kneeL"]);
      const kneeR = boneWorld(byName, ["shinR", "shin.R", "lowerlegR", "kneeR"]);
      const ankleL = boneWorld(byName, ["footL", "foot.L", "ankleL"]);
      const ankleR = boneWorld(byName, ["footR", "foot.R", "ankleR"]);
      const pelvis = boneWorld(byName, ["pelvis", "hips", "root"]);

      // Torso long axis: pelvis → head, normalised (supine ≈ ±X).
      let ax = head.x - pelvis.x;
      let ay = head.y - pelvis.y;
      let az = head.z - pelvis.z;
      const alen = Math.hypot(ax, ay, az) || 1;
      ax /= alen; ay /= alen; az /= alen;

      // Half-width at chest: half shoulder span in the deck plane (mostly Z for X-aligned body).
      const shoulderSpan = Math.hypot(shoulderL.x - shoulderR.x, shoulderL.z - shoulderR.z);
      const torsoHalfWidth = Math.max(0.08, shoulderSpan * 0.5);

      // Root-level neck source marker (written by applySupinePose when neck is mapped).
      let neckPoseSource = neckSource(byName);
      if (root.userData && typeof root.userData.openClinXrNeckPoseSource === "string") {
        neckPoseSource = root.userData.openClinXrNeckPoseSource;
      } else if (
        root.userData
        && Array.isArray(root.userData.openClinXrSupinePoseBones)
        && root.userData.openClinXrSupinePoseBones.indexOf("neck") >= 0
      ) {
        neckPoseSource = "supine_map";
      }

      actors.push({
        scenarioId: scenarioId,
        actorId: resolveActorId(root, r),
        posture: resolvePosture(root),
        head: head,
        neck: neck,
        shoulderL: shoulderL,
        shoulderR: shoulderR,
        elbowL: elbowL,
        elbowR: elbowR,
        wristL: wristL,
        wristR: wristR,
        hipL: hipL,
        hipR: hipR,
        kneeL: kneeL,
        kneeR: kneeR,
        ankleL: ankleL,
        ankleR: ankleR,
        deckTopY: deckTopY,
        torsoAxis: { x: ax, y: ay, z: az },
        torsoHalfWidth: torsoHalfWidth,
        railHalfWidth: railHalfWidth,
        pillowEnd: pillowEnd,
        neckPoseSource: neckPoseSource,
        framesAdvanced: framesAdvanced
      });
    }

    return { scenarioId: scenarioId, actors: actors };
  })()`) as Promise<{ scenarioId: string; actors: SupineLimbFacts[] }>;
}

// CLI: pnpm exec tsx tools/openclinxr/evidence/supine-limb-rest.ts [--pre-fix] [--scenario id]
const isMain =
  typeof process !== "undefined"
  && process.argv[1]
  && process.argv[1].replace(/\\/g, "/").endsWith("supine-limb-rest.ts");

if (isMain) {
  const preFix = process.argv.includes("--pre-fix");
  const scenarioIdx = process.argv.indexOf("--scenario");
  const scenarioIds =
    scenarioIdx >= 0 && process.argv[scenarioIdx + 1]
      ? [process.argv[scenarioIdx + 1]!]
      : [ED_SCENARIO];
  inspectSupineLimbRest({
    force: true,
    writePreFix: preFix,
    label: preFix ? "pre-fix" : "measure",
    scenarioIds,
  })
    .then((report) => {
      process.stdout.write(
        `supine-limb-rest: done scenarios=${report.scenarios.length} actors=${report.actors.length}\n`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
