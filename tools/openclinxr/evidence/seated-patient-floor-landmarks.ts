/**
 * #447 — pre-fix landmark measurement for the ONLY seated actor in the bank.
 *
 * The telehealth patient's feet do not reach the floor (measured 0.2998 m on
 * 5f3a9a77). This instrument records the table the issue's first measurement
 * demands, before any product edit:
 *
 *   hip world Y, knee world Y, lowestVertexY  vs  chair seat top (0.450)
 *
 * Hips at ~0.45 with feet at 0.30 means the legs are folded; hips at ~0.75 means
 * the whole figure is lifted. That one table separates the candidates.
 *
 * Sampling matches the floor-contact measure (#446): settle-wait + 900 ms, so the
 * numbers describe the loaded figure, not a mid-load scaffold. The artifact is
 * TRACKED (`tools/openclinxr/evidence/seated-patient-floor-landmarks.json`), the
 * pre-fix run is committed as the before-column — an `exists:` proof under the
 * gitignored `.openclinxr/evidence/**` has no land path (#396).
 *
 * claimScope: world-Y landmarks (pelvis/shin/foot bones + skinned mesh bounds) of
 * the seated telehealth patient vs the chair seat top, sampled after assets settle.
 * notEvidenceFor: what the sit LOOKS like, hip angle quality, clinical realism,
 * Quest readiness.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { computeMeasurementTreeStamp } from "./lib/measurement-tree-stamp.js";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  waitForHumanoidAssetsLoaded,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";
import { waitForSceneAssetsSettled } from "./declared-actors-rendered.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

export const SEATED_SCENARIO_ID = "telehealth_diabetes_health_literacy_v1";
export const SEATED_PATIENT_ID = "patient_luis_martinez_v1";
/** Tracked artifact path — the before-column for #447. */
export const SEATED_LANDMARKS_REL = "tools/openclinxr/evidence/seated-patient-floor-landmarks.json";
/** Chair seat top, from the station's static geometry (station-chair.ts PATIENT_CHAIR_SEAT_HEIGHT_METERS). */
export const CHAIR_SEAT_TOP_METERS = 0.45;

export type SeatedFloorLandmarks = {
  schemaVersion: "openclinxr.seated-patient-floor-landmarks.v1";
  phase: "pre-fix" | "post-fix";
  generatedAt: string;
  scenarioId: string;
  environmentId: string | null;
  measuredAgainstCommit: unknown;
  sampling: {
    settled: boolean;
    waitMs: number;
    framesAdvanced: number;
  };
  seatTopWorldY: number | null;
  seatTopSource: string;
  patient: {
    actorId: string;
    rootWorldY: number;
    rootScaleY: number;
    pelvisWorldY: number | null;
    pelvisBoneName: string | null;
    kneeWorldY: number | null;
    kneeBoneName: string | null;
    footWorldY: number | null;
    footBoneName: string | null;
    lowestVertexY: number | null;
    highestVertexY: number | null;
  } | null;
  claimScope: string[];
  notEvidenceFor: string[];
};

function readPhase(args: string[]): "pre-fix" | "post-fix" {
  const idx = args.indexOf("--phase");
  if (idx >= 0 && args[idx + 1] === "post-fix") return "post-fix";
  return "pre-fix";
}

/**
 * Live page read: bones + skinned bounds of the seated patient, seat top from the
 * chair's userData. String IIFE — no TS syntax so tsx cannot inject `__name`.
 */
export async function readSeatedPatientLandmarksFromPage(
  page: Page,
): Promise<{
  environmentId: string | null;
  framesAdvanced: number;
  settled: boolean;
  seatTopWorldY: number | null;
  seatTopSource: string;
  patient: SeatedFloorLandmarks["patient"];
}> {
  return page.evaluate(`(() => {
    const win = window;
    const framesAdvanced = (win.__openClinXrFrameStats && win.__openClinXrFrameStats.framesObserved) || 0;
    const settled = (win.__openClinXrSceneAssetEvidence && win.__openClinXrSceneAssetEvidence.pendingCount === 0) || false;
    const scene = win.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") {
      return { environmentId: null, framesAdvanced: 0, settled: settled, seatTopWorldY: null, seatTopSource: "no-scene", patient: null };
    }
    const environmentId = (scene.userData && scene.userData.openClinXrStationEnvironment && scene.userData.openClinXrStationEnvironment.environmentId) || null;

    function isBone(object) {
      return object.isBone === true || object.type === "Bone";
    }
    function worldY(object) {
      if (typeof object.updateWorldMatrix === "function") object.updateWorldMatrix(true, false);
      const e = object.matrixWorld && object.matrixWorld.elements;
      return e ? e[13] : null;
    }

    // Seat top: prefer the procedural chair group's seatHeightMeters userData (static geometry).
    let seatTopWorldY = null;
    let seatTopSource = "none";
    scene.traverse(function (object) {
      if (seatTopWorldY !== null) return;
      const ud = object.userData || {};
      if (typeof ud.seatHeightMeters === "number" && (ud.openClinXrChairKind || /patient_chair|patient-chair/i.test(object.name || ""))) {
        const gy = worldY(object);
        if (gy !== null) {
          seatTopWorldY = gy + ud.seatHeightMeters;
          seatTopSource = "chair-userData-seatHeightMeters";
        }
      }
    });

    // Posture-tagged roots: the seated patient's humanoid root (not its slot).
    const tagged = [];
    scene.traverse(function (object) {
      const posture = object.userData && object.userData.openClinXrActorPosture;
      if (posture === "standing" || posture === "seated" || posture === "supine") tagged.push(object);
    });
    const roots = tagged.filter(function (root) {
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

    let patient = null;
    for (let r = 0; r < roots.length; r++) {
      const root = roots[r];
      if (root.userData && root.userData.openClinXrActorPosture !== "seated") continue;
      const actorId = (root.userData && root.userData.openClinXrActorId) || "";
      if (typeof actorId !== "string" || actorId.length === 0) continue;

      if (typeof root.updateMatrixWorld === "function") root.updateMatrixWorld(true);
      const rootY = root.matrixWorld ? worldY(root) : null;

      // Bone landmark collection: first bone whose name matches the canonical pattern.
      const bonePatterns = [
        { key: "pelvis", patterns: ["pelvis", "hips", "hip"] },
        { key: "knee", patterns: ["lowerleg01", "shin", "calf", "lower_leg", "lowerleg", "leg.l", "leg.r", "shinl", "shinr"] },
        { key: "foot", patterns: ["foot01", "footl", "foot.l", "foot", "ankle"] },
      ];
      const found = { pelvis: null, knee: null, foot: null };
      const foundNames = { pelvis: null, knee: null, foot: null };
      root.traverse(function (object) {
        if (!isBone(object)) return;
        const name = (object.name || "").toLowerCase();
        for (let b = 0; b < bonePatterns.length; b++) {
          const key = bonePatterns[b].key;
          if (found[key] !== null) continue;
          const pats = bonePatterns[b].patterns;
          for (let i = 0; i < pats.length; i++) {
            const p = pats[i];
            if (name === p || name.indexOf(p) >= 0) {
              found[key] = worldY(object);
              foundNames[key] = object.name;
              break;
            }
          }
        }
      });

      // Skinned mesh bounds, same skinned path the floor-contact measure uses.
      function mulMat4Vec3(e, x, y, z) {
        const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
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
      function skinnedWorldBounds(mesh) {
        if (typeof mesh.updateMatrixWorld === "function") mesh.updateMatrixWorld(true);
        if (mesh.skeleton && typeof mesh.skeleton.update === "function") mesh.skeleton.update();
        const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
        if (!pos || pos.count === 0) return null;
        const skinIndex = mesh.geometry.attributes.skinIndex;
        const skinWeight = mesh.geometry.attributes.skinWeight;
        const skeleton = mesh.skeleton;
        const bindMatrix = mesh.bindMatrix && mesh.bindMatrix.elements;
        const bindMatrixInverse = mesh.bindMatrixInverse && mesh.bindMatrixInverse.elements;
        let minY = Infinity;
        let maxY = -Infinity;
        const stride = Math.max(1, Math.floor(pos.count / 4000));
        if (skinIndex && skinWeight && skeleton && skeleton.bones && skeleton.bones.length && bindMatrix && bindMatrixInverse) {
          const bones = skeleton.bones;
          const inverses = skeleton.boneInverses;
          for (let i = 0; i < pos.count; i += stride) {
            const vx = pos.getX(i);
            const vy = pos.getY(i);
            const vz = pos.getZ(i);
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
              sx += p[0] * weight;
              sy += p[1] * weight;
              sz += p[2] * weight;
            }
            const invP = mulMat4Vec3(bindMatrixInverse, sx, sy, sz);
            const weightSum = skinWeight.getX(i) + skinWeight.getY(i) + skinWeight.getZ(i) + (skinWeight.getW ? skinWeight.getW(i) : 0);
            let finalY;
            if (weightSum > 1e-6) {
              finalY = mesh.matrixWorld && mesh.matrixWorld.elements
                ? mulMat4Vec3(mesh.matrixWorld.elements, invP[0], invP[1], invP[2])[1]
                : invP[1];
            } else {
              finalY = mesh.matrixWorld && mesh.matrixWorld.elements
                ? mulMat4Vec3(mesh.matrixWorld.elements, vx, vy, vz)[1]
                : vy;
            }
            if (finalY < minY) minY = finalY;
            if (finalY > maxY) maxY = finalY;
          }
        } else {
          for (let i = 0; i < pos.count; i += stride) {
            const vx = pos.getX(i);
            const vy = pos.getY(i);
            const vz = pos.getZ(i);
            const y = mesh.matrixWorld && mesh.matrixWorld.elements
              ? mulMat4Vec3(mesh.matrixWorld.elements, vx, vy, vz)[1]
              : vy;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
        return { minY: minY, maxY: maxY };
      }

      let minY = Infinity;
      let maxY = -Infinity;
      let any = false;
      if (typeof root.traverse === "function") {
        root.traverse(function (object) {
          if (!object.isSkinnedMesh) return;
          const bounds = skinnedWorldBounds(object);
          if (!bounds) return;
          any = true;
          if (bounds.minY < minY) minY = bounds.minY;
          if (bounds.maxY > maxY) maxY = bounds.maxY;
        });
      }
      patient = {
        actorId: actorId,
        rootWorldY: rootY,
        rootScaleY: (root.scale && root.scale.y) || 1,
        pelvisWorldY: found.pelvis,
        pelvisBoneName: foundNames.pelvis,
        kneeWorldY: found.knee,
        kneeBoneName: foundNames.knee,
        footWorldY: found.foot,
        footBoneName: foundNames.foot,
        lowestVertexY: any ? minY : null,
        highestVertexY: any ? maxY : null
      };
      break;
    }

    return {
      environmentId: environmentId,
      framesAdvanced: framesAdvanced,
      settled: settled,
      seatTopWorldY: seatTopWorldY,
      seatTopSource: seatTopSource,
      patient: patient
    };
  })()`) as Promise<{
    environmentId: string | null;
    framesAdvanced: number;
    settled: boolean;
    seatTopWorldY: number | null;
    seatTopSource: string;
    patient: SeatedFloorLandmarks["patient"];
  }>;
}

/**
 * Measure the seated patient's landmarks on the live telehealth station.
 * Same sampling as the floor-contact measure (#446): settle-wait + 900 ms.
 */
export async function measureSeatedPatientFloorLandmarks(input: {
  phase?: "pre-fix" | "post-fix";
  label?: string;
}): Promise<SeatedFloorLandmarks> {
  const phase = input.phase ?? "pre-fix";
  let server: PortlessDevServer | undefined;
  let ownedServer = false;
  try {
    const baseUrl = await (async () => {
      ownedServer = true;
      server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
      return server.url;
    })();

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        const url = buildRoomCaptureUrl(baseUrl, SEATED_SCENARIO_ID, ROOM_CAPTURE_MODE);
        process.stdout.write(`seated-landmarks: goto ${SEATED_SCENARIO_ID}\n`);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await waitForStationShell(page, 180_000);
        await waitForHumanoidAssetsLoaded(page, 180_000);
        await waitForSceneAssetsSettled(page, 60_000);
        await page.waitForTimeout(900);

        const live = await readSeatedPatientLandmarksFromPage(page);
        const landmark = live.patient;
        if (!landmark || landmark.actorId !== SEATED_PATIENT_ID) {
          throw new Error(
            `seated patient ${SEATED_PATIENT_ID} not found in live scene (got ${landmark?.actorId ?? "none"})`,
          );
        }
        process.stdout.write(
          `  ${landmark.actorId} rootY=${landmark.rootWorldY?.toFixed(3)} pelvis=${landmark.pelvisWorldY?.toFixed(3)} knee=${landmark.kneeWorldY?.toFixed(3)} foot=${landmark.footWorldY?.toFixed(3)} y0=${landmark.lowestVertexY?.toFixed(3)} seatTop=${live.seatTopWorldY?.toFixed(3)}\n`,
        );

        const artifact: SeatedFloorLandmarks = {
          schemaVersion: "openclinxr.seated-patient-floor-landmarks.v1",
          phase,
          generatedAt: new Date().toISOString(),
          scenarioId: SEATED_SCENARIO_ID,
          environmentId: live.environmentId,
          measuredAgainstCommit: computeMeasurementTreeStamp(REPO_ROOT),
          sampling: {
            settled: live.settled,
            waitMs: 900,
            framesAdvanced: live.framesAdvanced,
          },
          seatTopWorldY: live.seatTopWorldY,
          seatTopSource: live.seatTopSource,
          patient: landmark,
          claimScope: [
            "world_y_landmarks_of_the_seated_telehealth_patient_sampled_after_assets_settle",
            "hip_knee_foot_bones_and_skinned_mesh_bounds_vs_static_chair_seat_top",
          ],
          notEvidenceFor: [
            "what the sit looks like",
            "hip_angle_quality",
            "clinical_plausibility",
            "quest_readiness",
          ],
        };

        const outputAbs = path.join(REPO_ROOT, SEATED_LANDMARKS_REL);
        await writeFile(outputAbs, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
        process.stdout.write(`seated-landmarks: wrote ${SEATED_LANDMARKS_REL} phase=${phase}\n`);
        return artifact;
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (ownedServer && server) {
      await stopPortlessDevServer(server.proc);
    }
  }
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("seated-patient-floor-landmarks.ts")
    || process.argv[1].endsWith("seated-patient-floor-landmarks.js"));

if (isDirectRun) {
  measureSeatedPatientFloorLandmarks({ phase: readPhase(process.argv.slice(2)) }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
