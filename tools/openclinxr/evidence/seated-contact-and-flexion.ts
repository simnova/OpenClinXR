/**
 * #87 — live seated contact + hip flexion from the running ui-xr scene.
 *
 * Extends the room-capture / posture probe path. Numbers come from posed WORLD
 * transforms (pelvis vs chair seat, thigh vs vertical) and skinned mesh bounds —
 * never from openClinXr* markers, applyPosturePose return values, or SEATED_BONE_EULERS.
 *
 * MEASURE ONCE: first call loads the page, writes the artifact, later asserts read it.
 *
 * claimScope: pelvis–seat contact + hip flexion range + seated mesh height vs standing.
 * notEvidenceFor: natural sit appearance, arm placement, clinical appropriateness, Quest readiness.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
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

export const SEATED_CONTACT_DIR = ".openclinxr/evidence/seated-posture";
export const SEATED_CONTACT_NAME = "seated-contact-measurements.json";

/** Telehealth: seated patient + standing family — both needed for the height counterweight. */
const DEFAULT_SCENARIO = "telehealth_diabetes_health_literacy_v1";

export type SeatedContact = {
  actorId: string;
  /** Vertical gap between the figure's pelvis and the chair's seat surface, both in world space. */
  pelvisToSeatGapMeters: number;
  /** Degrees, from posed world transforms — not read back from the authored Euler table. */
  hipFlexionDegrees: number;
  kneeFlexionDegrees: number;
  /** Skinned-mesh world height, so the counterweight can be checked from the same artifact. */
  meshHeightMeters: number;
  standingReferenceHeightMeters: number;
  framesAdvanced: number;
};

export type SeatedContactReport = {
  scenarioId: string;
  seated: SeatedContact[];
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.seated-contact-measurements.v1";
  kind: "seated_contact_and_flexion";
  label: string;
  generatedAt: string;
  /** #141 — refuse cache when HEAD or tracked worktree dirtiness moves. */
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  report: SeatedContactReport;
};

/** In-process cache so three vitest cases share one page load. */
let cachedReport: SeatedContactReport | null = null;
let measureInFlight: Promise<SeatedContactReport> | null = null;

function artifactPath(): string {
  return path.join(SEATED_CONTACT_DIR, SEATED_CONTACT_NAME);
}

/**
 * Load once, dump to `.openclinxr/evidence/seated-posture/seated-contact-measurements.json`,
 * return the report. Subsequent calls in the same process return the cache / re-read the file
 * without spawning another Vite server.
 */
export async function measureSeatedContact(input?: {
  scenarioId?: string;
  baseUrl?: string;
  /** Force a fresh page load (ignore cache + artifact). */
  force?: boolean;
  label?: string;
}): Promise<SeatedContactReport> {
  if (!input?.force && cachedReport) return cachedReport;
  if (!input?.force && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force) {
      const fromDisk = await tryReadArtifact();
      if (fromDisk) {
        cachedReport = fromDisk;
        return fromDisk;
      }
    }

    const report = await measureLiveSeatedContact({
      scenarioId: input?.scenarioId ?? DEFAULT_SCENARIO,
      baseUrl: input?.baseUrl,
    });
    await writeSeatedContactDump(report, { label: input?.label ?? "measure" });
    cachedReport = report;
    return report;
  })();

  try {
    return await measureInFlight;
  } finally {
    measureInFlight = null;
  }
}

async function tryReadArtifact(): Promise<SeatedContactReport | null> {
  // #141: refuse stale stamps (missing/mismatch → null → re-measure). Fresh stamps still serve.
  return tryReadStampedArtifact(artifactPath(), (parsed) => {
    const report = parsed.report as SeatedContactReport | undefined;
    if (report?.seated && Array.isArray(report.seated) && report.seated.length > 0) {
      return report;
    }
    return null;
  });
}

export async function writeSeatedContactDump(
  report: SeatedContactReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? artifactPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.seated-contact-measurements.v1" as const,
    kind: "seated_contact_and_flexion" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "pelvis_world_y_vs_chair_seat_surface",
      "hip_flexion_from_posed_world_bone_directions",
      "skinned_mesh_height_seated_vs_standing_reference",
    ],
    notEvidenceFor: [
      "natural_sit_appearance",
      "arm_placement",
      "clinical_posture_appropriateness",
      "quest_readiness",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`seated-contact: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLiveSeatedContact(input: {
  scenarioId: string;
  baseUrl?: string;
}): Promise<SeatedContactReport> {
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
        const url = buildRoomCaptureUrl(baseUrl, input.scenarioId, ROOM_CAPTURE_MODE);
        process.stdout.write(`seated-contact: goto ${input.scenarioId}\n`);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await waitForStationShell(page, 180_000);
        await waitForHumanoidsAndFrames(page, 8, 180_000);
        await page.waitForTimeout(900);
        const report = await readSeatedContactFromPage(page);
        if (report.seated.length === 0) {
          throw new Error("measureSeatedContact: no seated actors found in live scene");
        }
        for (const a of report.seated) {
          process.stdout.write(
            `  ${a.actorId} gap=${a.pelvisToSeatGapMeters.toFixed(3)} hip=${a.hipFlexionDegrees.toFixed(1)}° knee=${a.kneeFlexionDegrees.toFixed(1)}° h=${a.meshHeightMeters.toFixed(3)} standRef=${a.standingReferenceHeightMeters.toFixed(3)}\n`,
          );
        }
        return report;
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
          traverse?: (cb: (o: { userData?: Record<string, unknown>; isSkinnedMesh?: boolean }) => void) => void;
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
 * Pelvis vs seat from world Y; hip/knee flexion from bone chain directions in world space;
 * mesh height from skinned bounds (same approach as #83).
 */
export async function readSeatedContactFromPage(page: Page): Promise<SeatedContactReport> {
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
      return { scenarioId: scenarioId, seated: [] };
    }

    function isBone(object) {
      return object.isBone === true || object.type === "Bone";
    }

    function worldPos(object) {
      if (typeof object.updateWorldMatrix === "function") object.updateWorldMatrix(true, false);
      const e = object.matrixWorld && object.matrixWorld.elements;
      if (!e) return null;
      return { x: e[12], y: e[13], z: e[14] };
    }

    function findBone(root, patterns) {
      let found = null;
      root.traverse(function (object) {
        if (found || !isBone(object)) return;
        const name = (object.name || "").toLowerCase();
        for (let i = 0; i < patterns.length; i++) {
          if (name === patterns[i] || name.indexOf(patterns[i]) >= 0) {
            found = object;
            return;
          }
        }
      });
      return found;
    }

    function angleDegrees(ax, ay, az, bx, by, bz) {
      const al = Math.sqrt(ax * ax + ay * ay + az * az);
      const bl = Math.sqrt(bx * bx + by * by + bz * bz);
      if (al < 1e-8 || bl < 1e-8) return 0;
      let c = (ax * bx + ay * by + az * bz) / (al * bl);
      if (c > 1) c = 1;
      if (c < -1) c = -1;
      return Math.acos(c) * (180 / Math.PI);
    }

    // Hip flexion: angle of thigh direction (thigh→shin) from world down. Standing ~0°, sit ~90°.
    function hipFlexionFromChain(thigh, shin) {
      const t = worldPos(thigh);
      const s = worldPos(shin);
      if (!t || !s) return null;
      const dx = s.x - t.x;
      const dy = s.y - t.y;
      const dz = s.z - t.z;
      // world down = (0, -1, 0)
      return angleDegrees(dx, dy, dz, 0, -1, 0);
    }

    // Knee flexion: angle between thigh→shin and shin→foot, then 180 - interior.
    function kneeFlexionFromChain(thigh, shin, foot) {
      const t = worldPos(thigh);
      const s = worldPos(shin);
      const f = worldPos(foot);
      if (!t || !s || !f) return null;
      const ux = s.x - t.x, uy = s.y - t.y, uz = s.z - t.z;
      const vx = f.x - s.x, vy = f.y - s.y, vz = f.z - s.z;
      const interior = angleDegrees(ux, uy, uz, vx, vy, vz);
      return Math.max(0, 180 - interior);
    }

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
      return { minY: minY, maxY: maxY, height: maxY - minY };
    }

    function meshHeightForRoot(root) {
      if (typeof root.updateMatrixWorld === "function") root.updateMatrixWorld(true);
      let minY = Infinity;
      let maxY = -Infinity;
      let any = false;
      root.traverse(function (object) {
        if (!object.isSkinnedMesh) return;
        const bounds = skinnedWorldBounds(object);
        if (!bounds) return;
        any = true;
        if (bounds.minY < minY) minY = bounds.minY;
        if (bounds.maxY > maxY) maxY = bounds.maxY;
      });
      if (!any || !Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
      return maxY - minY;
    }

    function resolveActorId(root, index) {
      if (root.userData && typeof root.userData.openClinXrActorId === "string" && root.userData.openClinXrActorId.length > 0) {
        return root.userData.openClinXrActorId;
      }
      let p = root.parent;
      let depth = 0;
      while (p && depth < 6) {
        const name = p.name || "";
        if (name.indexOf("patient") >= 0 || name.indexOf("Patient") >= 0 || name.indexOf("robert") >= 0 || name.indexOf("Robert") >= 0) {
          return "patient_primary";
        }
        if (name.indexOf("nurse") >= 0 || name.indexOf("Nurse") >= 0 || name.indexOf("maria") >= 0 || name.indexOf("Maria") >= 0) {
          return "clinical_team";
        }
        if (name.indexOf("spouse") >= 0 || name.indexOf("Spouse") >= 0 || name.indexOf("family") >= 0 || name.indexOf("anna") >= 0 || name.indexOf("Anna") >= 0) {
          return "family_or_observer";
        }
        if (p.userData && typeof p.userData.openClinXrSlotKind === "string" && p.userData.openClinXrSlotKind.length > 0) {
          return p.userData.openClinXrSlotKind;
        }
        p = p.parent;
        depth++;
      }
      return (root.name && root.name.length > 0) ? root.name : ("actor_" + index);
    }

    // Seat surface world Y: prefer procedural chair seat mesh top, else seatHeightMeters userData.
    let seatTopY = null;
    scene.traverse(function (object) {
      if (seatTopY !== null) return;
      const name = object.name || "";
      const ud = object.userData || {};
      if (typeof ud.seatHeightMeters === "number" && (ud.openClinXrChairKind || name.indexOf("patient_chair") >= 0 || name.indexOf("fixture-slot") >= 0)) {
        // Group origin is floor; seat top is seatHeightMeters above group world Y.
        const gp = worldPos(object);
        if (gp) seatTopY = gp.y + ud.seatHeightMeters;
      }
    });
    if (seatTopY === null) {
      scene.traverse(function (object) {
        if (seatTopY !== null) return;
        const name = (object.name || "").toLowerCase();
        if (name.indexOf(".seat") < 0 && name.indexOf("chair-seat") < 0 && name.indexOf("chair_seat") < 0) return;
        if (!object.geometry || !object.matrixWorld) return;
        if (typeof object.updateMatrixWorld === "function") object.updateMatrixWorld(true);
        // Seat mesh center + half extent on Y ≈ top surface for axis-aligned box.
        const e = object.matrixWorld.elements;
        let halfY = 0.025;
        if (object.geometry.boundingBox) {
          const bb = object.geometry.boundingBox;
          halfY = Math.max(0.01, (bb.max.y - bb.min.y) / 2);
        } else if (typeof object.geometry.computeBoundingBox === "function") {
          object.geometry.computeBoundingBox();
          if (object.geometry.boundingBox) {
            const bb = object.geometry.boundingBox;
            halfY = Math.max(0.01, (bb.max.y - bb.min.y) / 2);
          }
        }
        seatTopY = e[13] + halfY * Math.abs(e[5] || 1);
      });
    }
    if (seatTopY === null) seatTopY = 0.45;

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

    // #138: silhouette Δh compares seated mesh height to standing stature. Elevated slot
    // actors (clinical_team / additional_cast at rootY≈0.95, feet mesh at y≈0.93) are not
    // floor-standing posture peers — their mesh height is still a stature number, but using
    // them as the standing reference answers "is the seated figure shorter than the shortest
    // elevated cast asset?" rather than "is the sit folded vs floor-standing adults in the
    // room?". Prefer floor-near standing meshes (minY < 0.25); fall back to all standing.
    let standingHeightsFloor = [];
    let standingHeightsAll = [];
    const seatedRoots = [];
    for (let r = 0; r < humanoidRoots.length; r++) {
      const root = humanoidRoots[r];
      const posture = root.userData.openClinXrActorPosture;
      if (posture === "standing") {
        // meshHeightForRoot returns height only; recompute bounds for minY peer filter.
        if (typeof root.updateMatrixWorld === "function") root.updateMatrixWorld(true);
        let minY = Infinity;
        let maxY = -Infinity;
        let any = false;
        root.traverse(function (object) {
          if (!object.isSkinnedMesh) return;
          const bounds = skinnedWorldBounds(object);
          if (!bounds) return;
          any = true;
          if (bounds.minY < minY) minY = bounds.minY;
          if (bounds.maxY > maxY) maxY = bounds.maxY;
        });
        if (any && Number.isFinite(minY) && Number.isFinite(maxY)) {
          const h = maxY - minY;
          standingHeightsAll.push(h);
          if (minY < 0.25) standingHeightsFloor.push(h);
        }
      }
      if (posture === "seated") {
        const h = meshHeightForRoot(root);
        seatedRoots.push({ root: root, index: r, height: h });
      }
    }
    const standingHeights = standingHeightsFloor.length > 0 ? standingHeightsFloor : standingHeightsAll;
    let standingReference = 0;
    if (standingHeights.length > 0) {
      standingReference = standingHeights.reduce(function (a, b) { return a + b; }, 0) / standingHeights.length;
    } else {
      standingReference = 1.66;
    }

    const seated = [];
    for (let i = 0; i < seatedRoots.length; i++) {
      const entry = seatedRoots[i];
      const root = entry.root;
      if (typeof root.updateMatrixWorld === "function") root.updateMatrixWorld(true);

      const pelvis = findBone(root, ["pelvis", "hips", "hip"]);
      const thighL = findBone(root, ["thighl", "thigh.l", "upleg.l", "upper_leg.l", "leftupleg", "upperleg01", "upperleg01l", "upperleg01.l"]);
      const thighR = findBone(root, ["thighr", "thigh.r", "upleg.r", "upper_leg.r", "rightupleg", "upperleg01r", "upperleg01.r"]);
      const shinL = findBone(root, ["shinl", "shin.l", "leg.l", "lower_leg.l", "leftleg", "lowerleg01", "lowerleg01l", "lowerleg01.l"]);
      const shinR = findBone(root, ["shinr", "shin.r", "leg.r", "lower_leg.r", "rightleg", "lowerleg01r", "lowerleg01.r"]);
      const footL = findBone(root, ["footl", "foot.l", "leftfoot", "foot01l", "foot01.l"]);
      const footR = findBone(root, ["footr", "foot.r", "rightfoot", "foot01r", "foot01.r"]);

      let pelvisY = null;
      if (pelvis) {
        const pp = worldPos(pelvis);
        if (pp) pelvisY = pp.y;
      }
      if (pelvisY === null) {
        // Fallback: root world Y is a weak proxy — still independent of Euler table.
        const rp = worldPos(root);
        pelvisY = rp ? rp.y : 0;
      }

      const hipL = (thighL && shinL) ? hipFlexionFromChain(thighL, shinL) : null;
      const hipR = (thighR && shinR) ? hipFlexionFromChain(thighR, shinR) : null;
      let hipFlex = 0;
      if (hipL !== null && hipR !== null) hipFlex = (hipL + hipR) / 2;
      else if (hipL !== null) hipFlex = hipL;
      else if (hipR !== null) hipFlex = hipR;

      const kneeL = (thighL && shinL && footL) ? kneeFlexionFromChain(thighL, shinL, footL) : null;
      const kneeR = (thighR && shinR && footR) ? kneeFlexionFromChain(thighR, shinR, footR) : null;
      let kneeFlex = 0;
      if (kneeL !== null && kneeR !== null) kneeFlex = (kneeL + kneeR) / 2;
      else if (kneeL !== null) kneeFlex = kneeL;
      else if (kneeR !== null) kneeFlex = kneeR;

      seated.push({
        actorId: resolveActorId(root, entry.index),
        pelvisToSeatGapMeters: pelvisY - seatTopY,
        hipFlexionDegrees: hipFlex,
        kneeFlexionDegrees: kneeFlex,
        meshHeightMeters: entry.height !== null ? entry.height : 0,
        standingReferenceHeightMeters: standingReference,
        framesAdvanced: framesAdvanced
      });
    }

    return { scenarioId: scenarioId, seated: seated };
  })()`) as Promise<SeatedContactReport>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let label = "cli";
  let scenarioId = DEFAULT_SCENARIO;
  let force = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--label" && args[i + 1]) label = args[++i]!;
    else if (arg === "--scenario" && args[i + 1]) scenarioId = args[++i]!;
    else if (arg === "--force") force = true;
  }
  const report = await measureSeatedContact({ scenarioId, force, label });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("seated-contact-and-flexion.ts")
    || process.argv[1].endsWith("seated-contact-and-flexion.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
