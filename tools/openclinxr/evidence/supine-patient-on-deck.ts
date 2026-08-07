/**
 * #150 — live supine ED patient vs stretcher deck measurements.
 *
 * Numbers come from the RUNNING scene graph after the shell builds — not from
 * descriptors, not from openClinXr* pose markers as the source of truth for AABB.
 * Stations are enumerated from listShippedCastScenarioIds().
 *
 * claimScope: where the ED patient's body is and how it is posed.
 * notEvidenceFor: clinical realism of the pose, Quest readiness, any other station's posture.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { listShippedCastScenarioIds } from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
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

export const SUPINE_DECK_DIR = ".openclinxr/evidence/supine-patient-on-deck";
export const SUPINE_DECK_NAME = "supine-patient-on-deck.json";
export const ISSUE_150_PRE_FIX = ".openclinxr/evidence/issue-150/pre-fix.json";

export type ActorPlacementFacts = {
  scenarioId: string;
  actorId: string;
  slotKind: string;
  posture: string;
  bodyMin: { x: number; y: number; z: number };
  bodyMax: { x: number; y: number; z: number };
  longestAxis: string;
  deckPenetrationMeters: number;
  deckTopY: number | null;
  clearanceAboveDeckMeters: number | null;
};

export type SupinePatientOnDeckReport = {
  scenarios: string[];
  actors: ActorPlacementFacts[];
  /** Stretcher geometry axis read from the live shell (head end). */
  stretcherAxis?: {
    lengthAxis: string;
    headEnd: string;
    deckTopY: number | null;
    position: { x: number; y: number; z: number } | null;
  };
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.supine-patient-on-deck.v1";
  kind: "supine_patient_on_deck";
  label: string;
  generatedAt: string;
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  report: SupinePatientOnDeckReport;
};

let cachedReport: SupinePatientOnDeckReport | null = null;
let measureInFlight: Promise<SupinePatientOnDeckReport> | null = null;

function artifactPath(): string {
  return path.join(SUPINE_DECK_DIR, SUPINE_DECK_NAME);
}

/**
 * Contract entry: measure once (or re-read stamped cache) and return actors[].
 */
export async function inspectSupinePatientOnDeck(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  writePreFix?: boolean;
}): Promise<SupinePatientOnDeckReport> {
  if (!input?.force && cachedReport) return cachedReport;
  if (!input?.force && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.scenarioIds && !input?.writePreFix) {
      const fromDisk = await tryReadArtifact();
      if (fromDisk) {
        cachedReport = fromDisk;
        return fromDisk;
      }
    }

    const report = await measureLive({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
    });
    await writeDump(report, { label: input?.label ?? "measure" });
    if (input?.writePreFix) {
      await writePreFixArtifact(report);
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

async function tryReadArtifact(): Promise<SupinePatientOnDeckReport | null> {
  return tryReadStampedArtifact(artifactPath(), (parsed) => {
    const report = parsed.report as SupinePatientOnDeckReport | undefined;
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
  report: SupinePatientOnDeckReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? artifactPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.supine-patient-on-deck.v1" as const,
    kind: "supine_patient_on_deck" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "ed_primary_patient_body_world_aabb_vs_stretcher_deck",
      "posture_string_from_live_userData",
      "deck_penetration_from_mesh_aabb_intersection",
    ],
    notEvidenceFor: [
      "clinical_pose_realism",
      "quest_readiness",
      "other_station_posture_appropriateness",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`supine-on-deck: wrote ${outputPath}\n`);
  return outputPath;
}

export async function writePreFixArtifact(report: SupinePatientOnDeckReport): Promise<string> {
  const outputPath = ISSUE_150_PRE_FIX;
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.supine-patient-on-deck.v1" as const,
    kind: "supine_patient_on_deck" as const,
    label: "pre-fix",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "pre_fix_live_scene_graph_measurement",
      "ed_patient_still_standing_through_deck_expected",
    ],
    notEvidenceFor: [
      "clinical_pose_realism",
      "quest_readiness",
      "product_fix",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`supine-on-deck: pre-fix wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLive(input: {
  baseUrl?: string;
  scenarioIds?: string[];
}): Promise<SupinePatientOnDeckReport> {
  // Prefer a diverse bank sample: ED (defect), telehealth (seated counterweight),
  // plus every other cast station so the counterweight can count standing actors.
  const all = listShippedCastScenarioIds();
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : all;

  if (scenarios.length === 0) {
    throw new Error("inspectSupinePatientOnDeck: listShippedCastScenarioIds returned empty");
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
        const actors: ActorPlacementFacts[] = [];
        let stretcherAxis: SupinePatientOnDeckReport["stretcherAxis"];

        for (const scenarioId of scenarios) {
          process.stdout.write(`supine-on-deck: goto ${scenarioId}\n`);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForHumanoidsAndFrames(page, 8, 180_000);
          await page.waitForTimeout(1000);

          const live = await readLivePlacementFromPage(page);
          const sid = live.scenarioId || scenarioId;
          if (scenarioId.includes("ed_chest_pain") && live.stretcher) {
            stretcherAxis = live.stretcher;
          }
          for (const a of live.actors) {
            const row: ActorPlacementFacts = {
              scenarioId: sid,
              actorId: a.actorId,
              slotKind: a.slotKind,
              posture: a.posture,
              bodyMin: a.bodyMin,
              bodyMax: a.bodyMax,
              longestAxis: a.longestAxis,
              deckPenetrationMeters: a.deckPenetrationMeters,
              deckTopY: a.deckTopY,
              clearanceAboveDeckMeters: a.clearanceAboveDeckMeters,
            };
            actors.push(row);
            process.stdout.write(
              `  ${row.scenarioId}/${row.actorId} slot=${row.slotKind} posture=${row.posture} `
              + `long=${row.longestAxis} y=[${row.bodyMin.y.toFixed(3)},${row.bodyMax.y.toFixed(3)}] `
              + `pen=${row.deckPenetrationMeters.toFixed(3)} clear=${
                row.clearanceAboveDeckMeters === null
                  ? "null"
                  : row.clearanceAboveDeckMeters.toFixed(3)
              }\n`,
            );
          }
          if (live.actors.length === 0) {
            process.stdout.write(`  WARN: no actors measured for ${scenarioId}\n`);
          }
        }
        return { scenarios: [...scenarios], actors, ...(stretcherAxis ? { stretcherAxis } : {}) };
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
          traverse?: (cb: (o: {
            userData?: Record<string, unknown>;
            isSkinnedMesh?: boolean;
          }) => void) => void;
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

type LivePageReport = {
  scenarioId: string;
  actors: ActorPlacementFacts[];
  stretcher: SupinePatientOnDeckReport["stretcherAxis"];
};

/**
 * Full-AABB + deck probe. String IIFE so tsx cannot inject __name.
 */
async function readLivePlacementFromPage(page: Page): Promise<LivePageReport> {
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
      return { scenarioId: scenarioId, actors: [], stretcher: null };
    }

    function mulMat4Vec3(e, x, y, z) {
      const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15] || 1);
      return [
        (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
        (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
        (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
      ];
    }

    function mulMat4(ae, be) {
      const te = new Float64Array(16);
      const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
      const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
      const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
      const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
      const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
      const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
      const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
      const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
      te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
      te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
      te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
      te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
      te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
      te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
      te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
      te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
      te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
      te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
      te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
      te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
      te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
      te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
      te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
      te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
      return te;
    }

    function skinnedWorldAabb(mesh) {
      if (typeof mesh.updateMatrixWorld === "function") mesh.updateMatrixWorld(true);
      if (mesh.skeleton && typeof mesh.skeleton.update === "function") mesh.skeleton.update();
      const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
      if (!pos || pos.count === 0) return null;
      const skinIndex = mesh.geometry.attributes.skinIndex;
      const skinWeight = mesh.geometry.attributes.skinWeight;
      const skeleton = mesh.skeleton;
      const bindMatrix = mesh.bindMatrix && mesh.bindMatrix.elements;
      const bindMatrixInverse = mesh.bindMatrixInverse && mesh.bindMatrixInverse.elements;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      const stride = Math.max(1, Math.floor(pos.count / 4000));

      function acc(x, y, z) {
        if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
      }

      if (skinIndex && skinWeight && skeleton && skeleton.bones && skeleton.bones.length && bindMatrix && bindMatrixInverse) {
        const bones = skeleton.bones;
        const inverses = skeleton.boneInverses;
        for (let i = 0; i < pos.count; i += stride) {
          const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
          const bound = mulMat4Vec3(bindMatrix, vx, vy, vz);
          let sx = 0, sy = 0, sz = 0;
          for (let k = 0; k < 4; k++) {
            const weight = k === 0 ? skinWeight.getX(i) : k === 1 ? skinWeight.getY(i) : k === 2 ? skinWeight.getZ(i) : (skinWeight.getW ? skinWeight.getW(i) : 0);
            if (weight === 0) continue;
            const boneIdx = k === 0 ? skinIndex.getX(i) : k === 1 ? skinIndex.getY(i) : k === 2 ? skinIndex.getZ(i) : (skinIndex.getW ? skinIndex.getW(i) : 0);
            const bone = bones[boneIdx];
            const inv = inverses[boneIdx];
            if (!bone || !bone.matrixWorld || !bone.matrixWorld.elements || !inv || !inv.elements) continue;
            const boneMat = mulMat4(bone.matrixWorld.elements, inv.elements);
            const p = mulMat4Vec3(boneMat, bound[0], bound[1], bound[2]);
            sx += p[0] * weight; sy += p[1] * weight; sz += p[2] * weight;
          }
          const invP = mulMat4Vec3(bindMatrixInverse, sx, sy, sz);
          const weightSum = skinWeight.getX(i) + skinWeight.getY(i) + skinWeight.getZ(i) + (skinWeight.getW ? skinWeight.getW(i) : 0);
          let fx, fy, fz;
          if (weightSum > 1e-6) {
            const w = mesh.matrixWorld && mesh.matrixWorld.elements
              ? mulMat4Vec3(mesh.matrixWorld.elements, invP[0], invP[1], invP[2])
              : invP;
            fx = w[0]; fy = w[1]; fz = w[2];
          } else {
            const w = mesh.matrixWorld && mesh.matrixWorld.elements
              ? mulMat4Vec3(mesh.matrixWorld.elements, vx, vy, vz)
              : [vx, vy, vz];
            fx = w[0]; fy = w[1]; fz = w[2];
          }
          acc(fx, fy, fz);
        }
      } else {
        for (let i = 0; i < pos.count; i += stride) {
          const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
          const w = mesh.matrixWorld && mesh.matrixWorld.elements
            ? mulMat4Vec3(mesh.matrixWorld.elements, vx, vy, vz)
            : [vx, vy, vz];
          acc(w[0], w[1], w[2]);
        }
      }
      if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
      return {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ }
      };
    }

    // Find stretcher / deck support surface.
    let stretcherRoot = null;
    let deckTopY = null;
    let deckAabb = null;
    let pillowLocalX = null;
    scene.traverse(function (obj) {
      const ud = obj.userData || {};
      if (ud.openClinXrStretcherKind === "procedural_patient_stretcher" || ud.fixtureSlotId === "stretcher") {
        if (!stretcherRoot) stretcherRoot = obj;
        if (typeof ud.deckTopYMeters === "number") deckTopY = ud.deckTopYMeters;
      }
      const name = (obj.name || "").toLowerCase();
      if (name.indexOf(".mattress") >= 0 || name.indexOf("mattress") >= 0) {
        if (obj.geometry && typeof obj.updateMatrixWorld === "function") {
          obj.updateMatrixWorld(true);
          const b = skinnedWorldAabb(obj);
          if (b) deckAabb = b;
        }
      }
      if (name.indexOf(".pillow") >= 0 && obj.position) {
        pillowLocalX = obj.position.x;
      }
    });

    // Build deck AABB from mattress or synthetic from constants.
    if (!deckAabb && stretcherRoot && typeof stretcherRoot.updateMatrixWorld === "function") {
      stretcherRoot.updateMatrixWorld(true);
      // Procedural: length 2.2 on X, width 0.9 on Z, deck 0.55.
      const sx = stretcherRoot.position ? stretcherRoot.position.x : 0;
      const sz = stretcherRoot.position ? stretcherRoot.position.z : 0;
      const top = deckTopY !== null ? deckTopY : 0.55;
      deckAabb = {
        min: { x: sx - 1.1, y: top - 0.14, z: sz - 0.45 },
        max: { x: sx + 1.1, y: top, z: sz + 0.45 }
      };
    }
    if (deckTopY === null && deckAabb) deckTopY = deckAabb.max.y;

    const stretcher = stretcherRoot ? {
      lengthAxis: "x",
      headEnd: (pillowLocalX !== null && pillowLocalX < 0) ? "negative_x" : "unknown",
      deckTopY: deckTopY,
      position: stretcherRoot.position
        ? { x: stretcherRoot.position.x, y: stretcherRoot.position.y, z: stretcherRoot.position.z }
        : null
    } : null;

    // Collect humanoid roots (same staging discriminator as floor-contact #145).
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

    function resolveSlotKind(root) {
      if (root.userData && typeof root.userData.openClinXrSlotKind === "string" && root.userData.openClinXrSlotKind.length > 0) {
        return root.userData.openClinXrSlotKind;
      }
      let p = root.parent;
      let d = 0;
      while (p && d < 6) {
        if (p.userData && typeof p.userData.openClinXrSlotKind === "string" && p.userData.openClinXrSlotKind.length > 0) {
          return p.userData.openClinXrSlotKind;
        }
        p = p.parent;
        d++;
      }
      return "unknown";
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

    function aabbPenetrationY(bodyMin, bodyMax, deck) {
      if (!deck) return 0;
      // Overlap in XZ required for "inside deck" volume.
      const ox = Math.min(bodyMax.x, deck.max.x) - Math.max(bodyMin.x, deck.min.x);
      const oz = Math.min(bodyMax.z, deck.max.z) - Math.max(bodyMin.z, deck.min.z);
      if (ox <= 0 || oz <= 0) return 0;
      const oy = Math.min(bodyMax.y, deck.max.y) - Math.max(bodyMin.y, deck.min.y);
      return oy > 0 ? oy : 0;
    }

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
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let any = false;
      if (typeof root.traverse === "function") {
        root.traverse(function (object) {
          if (!object.isSkinnedMesh) return;
          const b = skinnedWorldAabb(object);
          if (!b) return;
          any = true;
          if (b.min.x < minX) minX = b.min.x;
          if (b.min.y < minY) minY = b.min.y;
          if (b.min.z < minZ) minZ = b.min.z;
          if (b.max.x > maxX) maxX = b.max.x;
          if (b.max.y > maxY) maxY = b.max.y;
          if (b.max.z > maxZ) maxZ = b.max.z;
        });
      }
      if (!any || !Number.isFinite(minY)) continue;

      const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
      let longestAxis = "y";
      if (dx >= dy && dx >= dz) longestAxis = "x";
      else if (dz >= dy && dz >= dx) longestAxis = "z";
      else longestAxis = "y";

      const bodyMin = { x: minX, y: minY, z: minZ };
      const bodyMax = { x: maxX, y: maxY, z: maxZ };
      // Deck metrics only for primary_patient when a real stretcher exists in this scene.
      const slotKind = resolveSlotKind(root);
      const useDeck = Boolean(deckAabb && stretcherRoot && slotKind === "primary_patient");
      const pen = useDeck ? aabbPenetrationY(bodyMin, bodyMax, deckAabb) : 0;
      const top = useDeck ? deckTopY : null;
      const clearance = (useDeck && top !== null) ? (minY - top) : null;

      actors.push({
        scenarioId: scenarioId,
        actorId: resolveActorId(root, r),
        slotKind: slotKind,
        posture: resolvePosture(root),
        bodyMin: bodyMin,
        bodyMax: bodyMax,
        longestAxis: longestAxis,
        deckPenetrationMeters: pen,
        deckTopY: top,
        clearanceAboveDeckMeters: clearance,
        framesAdvanced: framesAdvanced
      });
    }

    return { scenarioId: scenarioId, actors: actors, stretcher: stretcher };
  })()`) as Promise<LivePageReport>;
}

// CLI: pnpm exec tsx tools/openclinxr/evidence/supine-patient-on-deck.ts [--pre-fix]
const isMain =
  typeof process !== "undefined"
  && process.argv[1]
  && process.argv[1].replace(/\\/g, "/").endsWith("supine-patient-on-deck.ts");

if (isMain) {
  const preFix = process.argv.includes("--pre-fix");
  inspectSupinePatientOnDeck({ force: true, writePreFix: preFix, label: preFix ? "pre-fix" : "measure" })
    .then((report) => {
      process.stdout.write(
        `supine-on-deck: done scenarios=${report.scenarios.length} actors=${report.actors.length}\n`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
