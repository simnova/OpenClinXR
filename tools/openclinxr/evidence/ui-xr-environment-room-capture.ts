/**
 * #69 — station environment room capture from the live ui-xr scene.
 *
 * Proves a learner-facing room was rendered, and ties each image to shell facts
 * read back from the running page (not restated from environment-descriptors.ts).
 *
 * Capture mode: `scene-overview` (main.ts isGeneratedSceneOverviewCaptureMode) —
 * wider FOV, multi-actor framing, and does NOT take the clean-humanoid comparator
 * path that hides stationEnvironment + floor (main.ts:3318-3320).
 *
 * claimScope: parametric shell visibility + live shell fact readout.
 * notEvidenceFor: clinical realism, Quest readiness, kit-bashed room assets.
 */

import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { deriveDoorwayOverviewCameraForEnvironment } from "./doorway-overview-camera.js";
import { type PortlessDevServer, spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";

export const ROOM_CAPTURE_OUTPUT_DIR = ".openclinxr/evidence/ui-xr-environment-room/latest";
export const ROOM_CAPTURE_MANIFEST_NAME = "capture-manifest.json";

/** Modes known to hide the station shell / floor for clean humanoid grading. */
const HIDDEN_ENVIRONMENT_CAPTURE_MODES = [
  "clean-humanoid-source-comparator",
  "source-clean",
] as const;

export type LiveShell = {
  environmentId: string;
  floorColor?: unknown;
  roomDepthMeters?: unknown;
  roomWidthMeters?: unknown;
  roomHeightMeters?: unknown;
  shellVisible?: boolean;
  floorVisible?: boolean;
  encounterFloorTheme?: unknown;
  captureMode?: string;
  cameraFraming?: string;
  /**
   * #342 — the generated room, read from the LOADED SCENE.
   *
   * Every field above this point comes from `shell.userData`, i.e. the PARAMETRIC box
   * written by `buildStationEnvironment`. That is why the manifest reported
   * `roomWidthMeters 7 / roomDepthMeters 3.45` (the box) while the shipped Infinigen room
   * measures 6.38 x 6.25 m, and why `shellVisible: true` stayed true with a blank viewport:
   * no field in the old shape could observe the generated room at all, so none could fail.
   */
  infinigenRoom?: InfinigenRoomLiveFacts | null;
};

/** Measured facts about the generated room as it exists in the running scene. */
export type InfinigenRoomLiveFacts = {
  present: boolean;
  effectivelyVisible: boolean;
  meshCount: number;
  /** Interior extent (room meshes excluding the outer hull), world metres. */
  interiorSizeMeters: [number, number, number] | null;
  interiorMin: [number, number, number] | null;
  interiorMax: [number, number, number] | null;
  /** World Y of the generated floor's top surface; humanoids ground at y=0. */
  floorTopY: number | null;
  /** True when the rendering camera's world position lies inside the interior extent. */
  cameraInsideRoom: boolean;
  cameraWorldPosition: [number, number, number] | null;
  /** Procedural box meshes still drawing under/over the generated room. */
  proceduralShellMeshesStillVisible: string[];
};

export type RoomCaptureManifestEntry = {
  scenarioId: string;
  imagePath: string;
  liveShell: LiveShell;
  /** Always live_scene — never restated from the descriptor module. */
  source: "live_scene";
};

export type RoomCaptureManifest = {
  schemaVersion: "openclinxr.ui-xr-environment-room-capture.v1";
  kind: "ui_xr_environment_room_capture";
  generatedAt: string;
  captureMode: string;
  framingNote: string;
  claimScope: string[];
  notEvidenceFor: string[];
  entries: RoomCaptureManifestEntry[];
};

export type PageReading = {
  scenarioId: string;
  imagePath: string;
  liveShell: LiveShell;
};

/**
 * Build a capture manifest from page readings only.
 * Must not import or reconcile against environment-descriptors — that would restate
 * the inputs (the schematic failure this contract exists to prevent).
 */
export function buildRoomCaptureManifest(input: {
  pageReadings: ReadonlyArray<PageReading>;
}): RoomCaptureManifest {
  return {
    schemaVersion: "openclinxr.ui-xr-environment-room-capture.v1",
    kind: "ui_xr_environment_room_capture",
    generatedAt: new Date().toISOString(),
    captureMode: "scene-overview",
    framingNote:
      "scene-overview (isGeneratedSceneOverviewCaptureMode) keeps the station shell visible and uses room-scale FOV; not face-detail or clean-humanoid-source-comparator",
    claimScope: [
      "parametric_station_shell_rendered_in_ui_xr",
      "live_shell_facts_read_from_running_page",
    ],
    notEvidenceFor: [
      "clinical_room_realism",
      "quest_readiness",
      "kit_bashed_or_generated_room_assets",
      "exam_equivalence",
    ],
    entries: input.pageReadings.map((reading) => ({
      scenarioId: reading.scenarioId,
      imagePath: reading.imagePath,
      liveShell: { ...reading.liveShell },
      source: "live_scene" as const,
    })),
  };
}

/**
 * Refuse capture modes that hide the station environment (empty-stage trap).
 * scene-overview (and other room-visible modes) must not be refused.
 */
export function refusesHiddenEnvironmentCapture(input: { captureMode: string }): boolean {
  const mode = input.captureMode.trim().toLowerCase();
  if (mode.length === 0) return false;
  for (const blocked of HIDDEN_ENVIRONMENT_CAPTURE_MODES) {
    if (mode === blocked || mode.includes(blocked)) return true;
  }
  // Also refuse bare "source-clean" / humanoid-source-comparator clean paths.
  if (mode.includes("source-clean")) return true;
  if (mode.includes("clean-humanoid")) return true;
  return false;
}

/** Repo root — this module lives at tools/openclinxr/evidence, three levels down. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * The default station set is DERIVED from the shipped bundles (#101), never a frozen id list:
 * a station is a bundle directory that carries the learner runtime bundle. Deriving means a new
 * scenario joins the routine sweep the day it ships, and a pasted list cannot silently age.
 */
export function shippedStationIds(): string[] {
  const bundlesDir = path.join(REPO_ROOT, "apps/ui-xr/public/xr-assets/generated");
  if (!existsSync(bundlesDir)) return [];
  return readdirSync(bundlesDir)
    .filter((d) => existsSync(path.join(bundlesDir, d, "learner-runtime-bundle.v1.json")))
    .sort();
}

/** Exported for #83 posture measure (same probe, same scene-overview mode). */
export const ROOM_CAPTURE_MODE = "scene-overview";

/** Build the same capture URL the room CLI uses — shared with posture measure. */
export function buildRoomCaptureUrl(baseUrl: string, scenarioId: string, captureMode: string): string {
  const params = new URLSearchParams({
    openclinxrScenarioId: scenarioId,
    scenarioId,
    openclinxrCaptureMode: captureMode,
    capture: captureMode,
    openclinxrPortalStart: "encounter",
    openclinxrAcceleratedExam: "1",
  });
  const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${root}?${params.toString()}`;
}

/** @deprecated use buildRoomCaptureUrl */
function buildCaptureUrl(baseUrl: string, scenarioId: string, captureMode: string): string {
  return buildRoomCaptureUrl(baseUrl, scenarioId, captureMode);
}

/** One actor row for #83 live posture geometry (skinned mesh world bounds). */
export type LivePostureGeometry = {
  actorId: string;
  declaredPosture: "standing" | "seated" | "supine";
  meshHeightMeters: number;
  lowestVertexY: number;
  highestVertexY: number;
  framesAdvanced: number;
};

export type LivePostureGeometryReport = {
  scenarioId: string;
  actors: LivePostureGeometry[];
};

/**
 * #83 — measure SKINNED mesh world bounds after the render loop has advanced.
 * String IIFE (not a TS arrow) so tsx/esbuild cannot inject `__name` into the browser.
 * Does NOT read openClinXr* pose markers or applyPosturePose return values for the numbers.
 */
export async function readLivePostureGeometryFromPage(page: Page): Promise<LivePostureGeometryReport> {
  // NOTE: keep this body free of TypeScript-only syntax — it is serialized into the page.
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

    // Prefer the humanoid GLB root (has skinned mesh + posture) over the actor slot that also
    // carries openClinXrActorPosture for re-apply. Skip a tagged node if a tagged descendant exists.
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

    const actors = [];
    for (let r = 0; r < humanoidRoots.length; r++) {
      const root = humanoidRoots[r];
      const posture = root.userData.openClinXrActorPosture;
      // #145: #122 leaves unfilled slots in the scene graph (hidden, empty openClinXrActorId)
      // with primitive scaffold meshes at slot.y≈0.95. They never call loadGeneratedHumanoidIntoActorSlot,
      // so openClinXrEffectiveVerticalOffsetMeters is absent. Counting them as actors made the floor
      // contact gate report y0≈0.93 floaters while staged humanoids were already grounded.
      // Discriminator: non-empty openClinXrActorId on the root or an ancestor (not root.name fallback).
      const resolvedId = resolveActorId(root, r);
      const rawSlotId =
        root.userData && typeof root.userData.openClinXrActorId === "string"
          ? root.userData.openClinXrActorId
          : "";
      let hasStagedActorId = typeof rawSlotId === "string" && rawSlotId.length > 0;
      if (!hasStagedActorId) {
        let p = root.parent;
        let depth = 0;
        while (p && depth < 6) {
          if (
            p.userData
            && typeof p.userData.openClinXrActorId === "string"
            && p.userData.openClinXrActorId.length > 0
          ) {
            hasStagedActorId = true;
            break;
          }
          p = p.parent;
          depth++;
        }
      }
      if (!hasStagedActorId) continue;

      if (typeof root.updateMatrixWorld === "function") root.updateMatrixWorld(true);
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
        // Non-skinned fallback only for staged roots (failed-load primitives still surface as defects).
        // Unfilled placeholders are already excluded by the actorId gate above.
        if (!any) {
          root.traverse(function (object) {
            if (!object.geometry || !object.geometry.attributes || !object.geometry.attributes.position) return;
            const bounds = skinnedWorldBounds(object);
            if (!bounds) return;
            any = true;
            if (bounds.minY < minY) minY = bounds.minY;
            if (bounds.maxY > maxY) maxY = bounds.maxY;
          });
        }
      }
      if (!any || !Number.isFinite(minY) || !Number.isFinite(maxY)) continue;
      actors.push({
        actorId: resolvedId,
        declaredPosture: posture,
        meshHeightMeters: maxY - minY,
        lowestVertexY: minY,
        highestVertexY: maxY,
        framesAdvanced: framesAdvanced
      });
    }
    return { scenarioId: scenarioId, actors: actors };
  })()`) as Promise<LivePostureGeometryReport>;
}



type LiveShellFromPage = LiveShell & { ready: boolean; reason?: string };

/**
 * #342 — measure the generated room from the live scene graph.
 *
 * String IIFE (no TypeScript syntax) so tsx/esbuild cannot inject `__name` into the page,
 * and no `THREE` namespace is required on `window`: world AABBs come from transforming the
 * 8 corners of each geometry's local bounding box by its `matrixWorld`.
 */
export async function readInfinigenRoomLiveFacts(page: Page): Promise<InfinigenRoomLiveFacts> {
  return page.evaluate(`(() => {
    const absent = {
      present: false, effectivelyVisible: false, meshCount: 0,
      interiorSizeMeters: null, interiorMin: null, interiorMax: null, floorTopY: null,
      cameraInsideRoom: false, cameraWorldPosition: null, proceduralShellMeshesStillVisible: []
    };
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return absent;
    scene.updateMatrixWorld(true);

    const worldBoxOf = function (obj) {
      const geom = obj.geometry;
      if (!geom) return null;
      if (!geom.boundingBox && typeof geom.computeBoundingBox === "function") geom.computeBoundingBox();
      const bb = geom.boundingBox;
      const e = obj.matrixWorld && obj.matrixWorld.elements;
      if (!bb || !e) return null;
      const xs = [bb.min.x, bb.max.x], ys = [bb.min.y, bb.max.y], zs = [bb.min.z, bb.max.z];
      const a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
        const x = xs[i], y = ys[j], z = zs[k];
        const p = [
          e[0] * x + e[4] * y + e[8] * z + e[12],
          e[1] * x + e[5] * y + e[9] * z + e[13],
          e[2] * x + e[6] * y + e[10] * z + e[14]
        ];
        for (let c = 0; c < 3; c++) { if (p[c] < a[c]) a[c] = p[c]; if (p[c] > b[c]) b[c] = p[c]; }
      }
      return isFinite(a[0]) ? { min: a, max: b } : null;
    };
    const grow = function (acc, box) {
      if (!box) return acc;
      if (!acc) return { min: box.min.slice(), max: box.max.slice() };
      for (let c = 0; c < 3; c++) {
        if (box.min[c] < acc.min[c]) acc.min[c] = box.min[c];
        if (box.max[c] > acc.max[c]) acc.max[c] = box.max[c];
      }
      return acc;
    };
    const effectivelyVisible = function (obj) {
      let cur = obj;
      while (cur && cur !== scene) { if (cur.visible === false) return false; cur = cur.parent; }
      return true;
    };

    let roomRoot = null;
    const stillVisible = [];
    scene.traverse(function (o) {
      if (!roomRoot && o.name === "openclinxr.station-environment.infinigen-room") roomRoot = o;
    });
    if (!roomRoot) return absent;

    // Procedural box surfaces that should have been hidden once the room loaded.
    scene.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      const n = o.name || "";
      const isShellSurface =
        /^openclinxr\\.station-environment\\.(floor|back-wall|left-wall|right-wall|ceiling|wall-trim)$/.test(n)
        || (/\\.floor$/.test(n) && !!(o.userData && o.userData.openClinXrEncounterSpecificRuntimeTheme));
      if (isShellSurface && effectivelyVisible(o)) stillVisible.push(n);
    });

    let interior = null, meshCount = 0, floorTopY = null;
    roomRoot.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      meshCount += 1;
      const box = worldBoxOf(o);
      if (/exterior/i.test(o.name || "")) return;
      interior = grow(interior, box);
      if (box && /floor$/.test((o.name || "").toLowerCase())) {
        floorTopY = floorTopY === null ? box.max[1] : Math.max(floorTopY, box.max[1]);
      }
    });

    let camera = null;
    scene.traverse(function (o) {
      if (!camera && (o.isPerspectiveCamera || o.type === "PerspectiveCamera")) camera = o;
    });
    let camPos = null;
    if (camera && camera.matrixWorld) {
      const e = camera.matrixWorld.elements;
      camPos = [e[12], e[13], e[14]];
    }
    let inside = false;
    if (camPos && interior) {
      inside = camPos[0] >= interior.min[0] && camPos[0] <= interior.max[0]
        && camPos[1] >= interior.min[1] && camPos[1] <= interior.max[1]
        && camPos[2] >= interior.min[2] && camPos[2] <= interior.max[2];
    }

    return {
      present: true,
      effectivelyVisible: effectivelyVisible(roomRoot),
      meshCount: meshCount,
      interiorSizeMeters: interior
        ? [interior.max[0] - interior.min[0], interior.max[1] - interior.min[1], interior.max[2] - interior.min[2]]
        : null,
      interiorMin: interior ? interior.min : null,
      interiorMax: interior ? interior.max : null,
      floorTopY: floorTopY,
      cameraInsideRoom: inside,
      cameraWorldPosition: camPos,
      proceduralShellMeshesStillVisible: stillVisible
    };
  })()`) as Promise<InfinigenRoomLiveFacts>;
}

async function readLiveShellFromPage(page: Page): Promise<LiveShellFromPage> {
  return page.evaluate(() => {
    type Obj = {
      name?: string;
      visible?: boolean;
      userData?: Record<string, unknown>;
      children?: Obj[];
      traverse?: (cb: (o: Obj) => void) => void;
    };
    type SceneLike = Obj & {
      userData?: Record<string, unknown>;
    };
    const win = window as unknown as {
      __openClinXrDebugScene?: SceneLike;
      __openClinXrBootEvidence?: { events?: Array<{ phase?: string }> };
    };
    const scene = win.__openClinXrDebugScene;
    if (!scene) {
      return { ready: false, reason: "no __openClinXrDebugScene", environmentId: "" };
    }

    const stationMeta = scene.userData?.openClinXrStationEnvironment as
      | { environmentId?: string; floorColor?: unknown; roomDepthMeters?: unknown; environmentFallbackActive?: boolean }
      | undefined;

    let shell: Obj | undefined;
    let floor: Obj | undefined;
    if (typeof scene.traverse === "function") {
      scene.traverse((object) => {
        const name = object.name ?? "";
        if (name === "openclinxr.station-environment-shell") shell = object;
        if (name === "openclinxr.station-environment.floor" || name.endsWith(".floor")) {
          if (object.userData?.openClinXrEncounterSpecificRuntimeTheme || name.includes("station-environment")) {
            floor = object;
          }
        }
      });
    }

    // Prefer shell.userData (written by buildStationEnvironment) — page truth.
    const shellUd = shell?.userData ?? {};
    const environmentId =
      (typeof shellUd.environmentId === "string" && shellUd.environmentId)
      || stationMeta?.environmentId
      || "";
    if (!environmentId) {
      return { ready: false, reason: "station shell not resolved yet", environmentId: "" };
    }

    // Camera framing note from locomotion child if present.
    let cameraFraming = "";
    if (typeof scene.traverse === "function") {
      scene.traverse((object) => {
        const framing = object.userData?.openClinXrCameraFraming;
        if (typeof framing === "string" && framing.length > 0 && !cameraFraming) {
          cameraFraming = framing;
        }
      });
    }

    return {
      ready: true,
      environmentId,
      floorColor: shellUd.floorColor ?? stationMeta?.floorColor,
      roomDepthMeters: shellUd.roomDepthMeters ?? stationMeta?.roomDepthMeters,
      roomWidthMeters: shellUd.roomWidthMeters,
      roomHeightMeters: shellUd.roomHeightMeters,
      shellVisible: shell?.visible !== false,
      floorVisible: floor?.visible !== false,
      encounterFloorTheme: floor?.userData?.openClinXrEncounterSpecificRuntimeTheme
        ?? "floor_color_derived_from_environmentId_descriptor",
      cameraFraming,
    };
  });
}

/**
 * Frame the room from a learner viewpoint.
 *
 * #342 — when a generated Infinigen room is loaded, the camera position is DERIVED from that
 * room's own measured interior bounds and the live actor bounds; nothing is hardcoded. The
 * previous fixed `(1.35, 2.05, 3.15)` was tuned for the PARAMETRIC shell, which is open at +Z
 * (its walls and ceiling stop at z=0.95, there is no front wall), so a camera at z=3.15 looked
 * in from outside and that worked. The Infinigen room is a CLOSED shell spanning z -4.03..2.47
 * with an untextured exterior hull, so the same camera stood outside it and photographed the
 * hull: a flat grey viewport, while every probe field reported success.
 *
 * Derivation, all inputs measured live, no constants:
 *   eyeZ  = interior max Z - 2×wall thickness,  where wall thickness = exteriorMaxZ - interiorMaxZ
 *   eyeY  = top Y of the actor bounds (standing eye height)
 *   look  = centre of the actor bounds
 *   eyeX  = one of five doorway-side candidate Xs (interior corners + edge midpoints, each inset
 *           by 2×wall thickness) whose eye→look ray is NOT blocked by a room surface or door leaf,
 *           chosen to MAXIMISE the distance to the NEAREST actor box in the XZ plane; candidates
 *           scoring within one 0.05 m tie band (2× the measured near-tie gap, #638) resolve to
 *           the first in candidate order so the choice never depends on actor settle
 * i.e. stand inside the room, backed against the doorway-side interior wall — the furthest
 * in-room viewpoint the geometry allows — and look at the encounter.
 *
 * With no Infinigen room the parametric fallback is used; its camera x derives from the
 * environment's shell width and the door constants (#398) instead of the old literal.
 */
export async function reframeCameraForRoom(page: Page, environmentId: string): Promise<string> {
  // NOTE: string IIFE — keep free of TypeScript syntax so tsx/esbuild cannot inject `__name`.
  const derived = (await page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return null;
    scene.updateMatrixWorld(true);

    const worldBoxOf = function (obj) {
      const geom = obj.geometry;
      if (!geom) return null;
      if (!geom.boundingBox && typeof geom.computeBoundingBox === "function") geom.computeBoundingBox();
      const bb = geom.boundingBox;
      const e = obj.matrixWorld && obj.matrixWorld.elements;
      if (!bb || !e) return null;
      const xs = [bb.min.x, bb.max.x], ys = [bb.min.y, bb.max.y], zs = [bb.min.z, bb.max.z];
      let a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
        const x = xs[i], y = ys[j], z = zs[k];
        const p = [
          e[0] * x + e[4] * y + e[8] * z + e[12],
          e[1] * x + e[5] * y + e[9] * z + e[13],
          e[2] * x + e[6] * y + e[10] * z + e[14]
        ];
        for (let c = 0; c < 3; c++) { if (p[c] < a[c]) a[c] = p[c]; if (p[c] > b[c]) b[c] = p[c]; }
      }
      return isFinite(a[0]) ? { min: a, max: b } : null;
    };
    const grow = function (acc, box) {
      if (!box) return acc;
      if (!acc) return { min: box.min.slice(), max: box.max.slice() };
      for (let c = 0; c < 3; c++) {
        if (box.min[c] < acc.min[c]) acc.min[c] = box.min[c];
        if (box.max[c] > acc.max[c]) acc.max[c] = box.max[c];
      }
      return acc;
    };

    let roomRoot = null;
    scene.traverse(function (o) {
      if (!roomRoot && o.name === "openclinxr.station-environment.infinigen-room") roomRoot = o;
    });
    if (!roomRoot) return null;

    // Interior = the room's own meshes EXCLUDING the outer hull; hull = the "exterior" mesh.
    let interior = null, exterior = null;
    roomRoot.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      const box = worldBoxOf(o);
      if (/exterior/i.test(o.name || "")) exterior = grow(exterior, box);
      else interior = grow(interior, box);
    });
    if (!interior) return null;

    // Encounter focus = union of the live skinned actor meshes.
    let actors = null;
    scene.traverse(function (o) {
      if (!o.isSkinnedMesh) return;
      actors = grow(actors, worldBoxOf(o));
    });
    if (!actors) return null;

    // Per-actor bounds, so a viewpoint can be scored on its distance to the NEAREST actor.
    const actorBoxes = [];
    scene.traverse(function (o) {
      if (!o.isSkinnedMesh) return;
      const box = worldBoxOf(o);
      if (box) actorBoxes.push(box);
    });

    const wallThickness = exterior ? Math.max(0, exterior.max[2] - interior.max[2]) : 0;
    const look = [
      (actors.min[0] + actors.max[0]) / 2,
      (actors.min[1] + actors.max[1]) / 2,
      (actors.min[2] + actors.max[2]) / 2
    ];

    // Candidate viewpoints: the interior corners and edge midpoints on the DOORWAY side
    // (+Z, the side a learner enters from), inset by TWICE the measured wall thickness.
    // The interior AABB's face is the wall's OUTER surface, so one thickness only reaches the
    // inner surface and leaves the camera coplanar with it — measured at attempt 2, that
    // grazed the west wall and exposed a fixture standing outside the room. Two clears both
    // faces. The multiplier is the wall's own two surfaces, not a tuned stand-off.
    const zEye = interior.max[2] - 2 * wallThickness;
    const xLeft = interior.min[0] + 2 * wallThickness;
    const xRight = interior.max[0] - 2 * wallThickness;
    const candidates = [
      [xLeft, zEye], [xRight, zEye], [(xLeft + xRight) / 2, zEye],
      [(xLeft + (xLeft + xRight) / 2) / 2, zEye], [((xLeft + xRight) / 2 + xRight) / 2, zEye]
    ];

    // Score = distance to the CLOSEST actor box in the XZ plane. Maximising it is exactly
    // "no single actor dominates the frame"; it is a selection rule over measured geometry,
    // not a tuned camera position. Backing straight out along the encounter's own axis put
    // the camera 1.54 m from the nurse and she filled the viewport.
    const nearestActorDistance = function (x, z) {
      let best = Infinity;
      for (let i = 0; i < actorBoxes.length; i++) {
        const b = actorBoxes[i];
        const dx = Math.max(b.min[0] - x, 0, x - b.max[0]);
        const dz = Math.max(b.min[2] - z, 0, z - b.max[2]);
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < best) best = d;
      }
      return best;
    };
    // Look-ray occlusion test (issue-black-frame + door-leaf): reject a candidate whose
    // eye→look ray crosses a room wall/floor/ceiling/exterior OR a door-leaf AABB before
    // the look point. Walls and door leaves are tested as WORLD BOXES (a wall is a solid
    // partition — looking through a doorway still photographs wall, not cast); floor,
    // ceiling and exterior are tested per-triangle because the camera stands inside the
    // room and only a ray that actually reaches them matters. Door leaves live as
    // fixture-slot siblings of the room, so they are collected from the scene by node
    // name (door_leaf | fixture-slot.door), never by coordinates.
    const worldOfLocal = function (e, x, y, z) {
      return [
        e[0] * x + e[4] * y + e[8] * z + e[12],
        e[1] * x + e[5] * y + e[9] * z + e[13],
        e[2] * x + e[6] * y + e[10] * z + e[14]
      ];
    };
    // A room-surface mesh may carry the wall/floor/ceiling/exterior name itself
    // (single-primitive GLB node), or inherit it from the Group a multi-primitive
    // GLB mesh is wrapped in: the Group carries e.g. bedroom_0/1.wall while the
    // primitive meshes are named Circle022 / Circle022_1. Classify by the mesh or its
    // nearest ancestor up to roomRoot so both shapes resolve. Props/actors are never
    // under roomRoot, so they still cannot reject.
    const roomSurfaceKind = function (mesh) {
      let p = mesh;
      while (p && p !== roomRoot) {
        const m = /(wall|floor|ceiling|exterior)/i.exec(p.name || "");
        if (m) return m[1].toLowerCase();
        p = p.parent;
      }
      return null;
    };
    const wallPartitionBoxes = [];
    const surfaceTris = [];
    roomRoot.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      if (o.visible === false) return;
      const kind = roomSurfaceKind(o);
      if (!kind) return;
      if (kind === "wall") {
        const box = worldBoxOf(o);
        if (!box) return;
        // A wall the capture camera stands OUTSIDE of is a partition: the eye→look
        // ray must not cross it, even through a doorway, because the cast would then
        // be photographed through a hole in a wall (and a dark wall still fills the
        // frame). A wall that CONTAINS the candidate viewpoints is the room's own
        // perimeter shell, so it stays per-triangle and real openings stay passable.
        let containsCandidate = false;
        for (let ci = 0; ci < candidates.length; ci++) {
          const cx = candidates[ci][0], cy = actors.max[1], cz = candidates[ci][1];
          if (cx >= box.min[0] && cx <= box.max[0]
            && cy >= box.min[1] && cy <= box.max[1]
            && cz >= box.min[2] && cz <= box.max[2]) {
            containsCandidate = true;
            break;
          }
        }
        if (!containsCandidate) {
          wallPartitionBoxes.push(box);
          return;
        }
        // perimeter wall — fall through to per-triangle collection below
      }
      const geom = o.geometry;
      const pos = geom && geom.attributes && geom.attributes.position;
      const e = o.matrixWorld && o.matrixWorld.elements;
      if (!pos || !e) return;
      const arr = pos.array;
      const index = geom.index ? geom.index.array : null;
      const triCount = index ? Math.floor(index.length / 3) : Math.floor(pos.count / 3);
      for (let t = 0; t < triCount; t++) {
        const i0 = index ? index[t * 3] : t * 3;
        const i1 = index ? index[t * 3 + 1] : t * 3 + 1;
        const i2 = index ? index[t * 3 + 2] : t * 3 + 2;
        surfaceTris.push([
          worldOfLocal(e, arr[i0 * 3], arr[i0 * 3 + 1], arr[i0 * 3 + 2]),
          worldOfLocal(e, arr[i1 * 3], arr[i1 * 3 + 1], arr[i1 * 3 + 2]),
          worldOfLocal(e, arr[i2 * 3], arr[i2 * 3 + 1], arr[i2 * 3 + 2])
        ]);
      }
    });
    const doorBoxes = [];
    scene.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      if (o.visible === false) return;
      if (!/door_leaf|fixture-slot.door/i.test(o.name || "")) return;
      const box = worldBoxOf(o);
      if (box) doorBoxes.push(box);
    });
    const lookRayHitsBoxes = function (ox, oy, oz, dx, dy, dz, boxes) {
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        let tmin = 0, tmax = 1;
        let miss = false;
        for (let c = 0; c < 3 && !miss; c++) {
          const o = c === 0 ? ox : c === 1 ? oy : oz;
          const d = c === 0 ? dx : c === 1 ? dy : dz;
          const mn = b.min[c], mx = b.max[c];
          if (d > -1e-12 && d < 1e-12) {
            if (o < mn || o > mx) miss = true;
            continue;
          }
          let t1 = (mn - o) / d, t2 = (mx - o) / d;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmax < tmin) miss = true;
        }
        if (!miss && tmax > 1e-6 && tmin < 1) return true;
      }
      return false;
    };
    const lookRayHitsWall = function (x, z) {
      const ox = x, oy = actors.max[1], oz = z;
      let dx = look[0] - ox, dy = look[1] - oy, dz = look[2] - oz;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-6) return false;
      if (lookRayHitsBoxes(ox, oy, oz, dx, dy, dz, doorBoxes)) return true;
      if (lookRayHitsBoxes(ox, oy, oz, dx, dy, dz, wallPartitionBoxes)) return true;
      dx /= len; dy /= len; dz /= len;
      for (let i = 0; i < surfaceTris.length; i++) {
        const a = surfaceTris[i][0], b = surfaceTris[i][1], c = surfaceTris[i][2];
        const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
        const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-12 && det < 1e-12) continue;
        const invDet = 1.0 / det;
        const tx = ox - a[0], ty = oy - a[1], tz = oz - a[2];
        const u = (tx * px + ty * py + tz * pz) * invDet;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * invDet;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
        if (t > 1e-6 && t < len) return true;
      }
      return false;
    };
    const accepted = [];
    const rejectedCandidates = [];
    for (let i = 0; i < candidates.length; i++) {
      if (lookRayHitsWall(candidates[i][0], candidates[i][1])) rejectedCandidates.push(candidates[i]);
      else accepted.push(candidates[i]);
    }
    // Fall back to the full set if the ray test rejects everything — selection must never
    // produce no camera, and a scene with no open view is better photographed than refused.
    const pool = accepted.length > 0 ? accepted : candidates;
    // The score is a LIVE measurement of actor boxes, so a strict argmax is settle-order
    // sensitive: sub-centimetre load-to-load actor jitter made two near-symmetric viewpoints
    // swap the winner run to run (#638 — primary_care's two extremes tie within ~0.7%, and
    // the derived eye flipped side 1-in-5 then 1-in-6). Treat scores within one tie band as
    // equal and keep the FIRST candidate in pool order — the pool order is deterministic (the
    // interior-corner list), so the eye is a pure function of the room geometry again.
    // The band is 2x the widest measured inter-candidate gap (#638: 3.1295..3.1368 vs
    // 3.1523..3.1546), large enough to absorb actor settle and far below any standoff
    // difference that would change the frame.
    const scoreTieBandMeters = 0.05;
    let eyeXZ = pool[0], bestScore = -1;
    for (let i = 0; i < pool.length; i++) {
      const s = nearestActorDistance(pool[i][0], pool[i][1]);
      if (s > bestScore + scoreTieBandMeters) { bestScore = s; eyeXZ = pool[i]; }
    }

    const eye = [eyeXZ[0], actors.max[1], eyeXZ[1]];
    return {
      eye: eye, look: look, wallThickness: wallThickness,
      nearestActorMeters: bestScore,
      rejectedCandidates: rejectedCandidates,
      interiorMin: interior.min, interiorMax: interior.max,
      actorMin: actors.min, actorMax: actors.max
    };
  })()`)) as {
    eye: [number, number, number];
    look: [number, number, number];
    wallThickness: number;
    nearestActorMeters: number;
    rejectedCandidates: Array<[number, number]>;
    interiorMin: [number, number, number];
    interiorMax: [number, number, number];
  } | null;

  if (derived) {
    return page.evaluate((d) => {
      type Vec3 = { set: (x: number, y: number, z: number) => void; x: number; y: number; z: number };
      type Cam = {
        position: Vec3;
        lookAt: (x: number, y: number, z: number) => void;
        fov?: number;
        updateProjectionMatrix?: () => void;
        userData?: Record<string, unknown>;
        parent?: { worldToLocal?: (v: Vec3) => unknown; updateMatrixWorld?: (force?: boolean) => void };
      };
      type Obj = { isPerspectiveCamera?: boolean; type?: string } & Partial<Cam>;
      const scene = (window as unknown as {
        __openClinXrDebugScene?: { traverse?: (cb: (o: Obj) => void) => void };
      }).__openClinXrDebugScene;
      if (!scene?.traverse) return "no-scene";
      let camera: Cam | undefined;
      scene.traverse((object) => {
        if (camera) return;
        if (object.isPerspectiveCamera || object.type === "PerspectiveCamera") {
          camera = object as unknown as Cam;
        }
      });
      if (!camera) return "no-camera";
      // `eye` is a WORLD point derived from world-space room bounds, but `camera.position` is
      // LOCAL to the locomotion rig the camera is parented to. Setting it directly landed the
      // camera at world z 1.48 instead of the intended 2.10 — still inside the room, but 0.62 m
      // off what the derivation claims. Convert through the parent so the two agree.
      // `lookAt` already takes a world point and accounts for the parent, so it is unchanged.
      // `camera.position` IS a THREE.Vector3, so it can be passed to `worldToLocal` (which
      // calls `applyMatrix4` and rejects a plain object). Write the world point into it, then
      // convert in place against the rig's matrix.
      camera.position.set(d.eye[0], d.eye[1], d.eye[2]);
      const parent = camera.parent;
      if (parent && typeof parent.worldToLocal === "function") {
        parent.updateMatrixWorld?.(true);
        parent.worldToLocal(camera.position);
      }
      camera.lookAt(d.look[0], d.look[1], d.look[2]);
      if (typeof camera.fov === "number") {
        camera.fov = 62;
        camera.updateProjectionMatrix?.();
      }
      if (camera.userData) {
        camera.userData["openClinXrCameraFraming"] =
          "environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342";
        // #503 — surface the occlusion verdict so a framing report can assert on it
        // instead of re-deriving it. Same "x/z" rendering as the returned framing note.
        camera.userData["openClinXrRejectedViewpoints"] = d.rejectedCandidates.map(
          (p) => `${p[0].toFixed(1)}/${p[1].toFixed(1)}`,
        );
      }
      return `roomCam(derived)=${d.eye.map((v) => v.toFixed(2)).join(",")} look=${d.look.map((v) => v.toFixed(2)).join(",")} nearestActor=${d.nearestActorMeters.toFixed(2)}m rejected=${d.rejectedCandidates.map((p) => p[0].toFixed(1) + "/" + p[1].toFixed(1)).join(" ")} interiorMaxZ=${d.interiorMax[2].toFixed(2)} wallThickness=${d.wallThickness.toFixed(3)}`;
    }, derived);
  }

  // #398 — the camera derives from the shell width and the door constants, not a literal.
  // Unmapped ids have no DOOR_LEAF (FALLBACK_ENVIRONMENT_SHELL fixtureSlots), so for them the
  // legacy framing is kept unchanged — a doorless shell cannot put the camera behind its door.
  const verdict = deriveDoorwayOverviewCameraForEnvironment(environmentId);
  const camera = verdict?.camera ?? { x: 1.35, y: 2.05, z: 3.15 };
  return page.evaluate((cam) => {
    type Cam = {
      position: { set: (x: number, y: number, z: number) => void; x: number; y: number; z: number };
      lookAt: (x: number, y: number, z: number) => void;
      fov?: number;
      updateProjectionMatrix?: () => void;
      userData?: Record<string, unknown>;
      parent?: { worldToLocal?: (v: { set: (x: number, y: number, z: number) => unknown; x: number; y: number; z: number }) => unknown };
    };
    type Obj = {
      isPerspectiveCamera?: boolean;
      type?: string;
      name?: string;
      traverse?: (cb: (o: Obj) => void) => void;
    } & Partial<Cam>;

    const scene = (window as unknown as { __openClinXrDebugScene?: Obj }).__openClinXrDebugScene;
    if (!scene?.traverse) return "no-scene";

    let camera: Cam | undefined;
    scene.traverse((object) => {
      if (camera) return;
      if (object.isPerspectiveCamera || object.type === "PerspectiveCamera") {
        camera = object as unknown as Cam;
      }
    });
    if (!camera) return "no-camera";

    // Doorway-side elevated overview looking into the encounter (negative Z).
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(0, 1.0, -1.35);
    if (typeof camera.fov === "number") {
      camera.fov = 62;
      camera.updateProjectionMatrix?.();
    }
    if (camera.userData) {
      camera.userData.openClinXrCameraFraming = "environment_room_capture_doorway_elevated_overview_#398";
    }
    return `roomCam=${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)}`;
  }, camera);
}

/** Wait until station shell is present (exported for #83 measure). */
export async function waitForStationShell(page: Page, timeoutMs = 180_000): Promise<LiveShellFromPage> {
  // Playwright signature is (fn, arg, options) — options must be the third argument.
  await page.waitForFunction(
    () => {
      const scene = (window as unknown as {
        __openClinXrDebugScene?: {
          userData?: { openClinXrStationEnvironment?: { environmentId?: string } };
          traverse?: (cb: (o: { name?: string }) => void) => void;
        };
      }).__openClinXrDebugScene;
      if (!scene) return false;
      if (scene.userData?.openClinXrStationEnvironment?.environmentId) return true;
      let found = false;
      scene.traverse?.((object) => {
        if (object.name === "openclinxr.station-environment-shell") found = true;
      });
      return found;
    },
    undefined,
    { timeout: timeoutMs },
  );
  const reading = await readLiveShellFromPage(page);
  if (!reading.ready) {
    throw new Error(`station shell not ready: ${reading.reason ?? "unknown"}`);
  }
  return reading;
}

/**
 * Wait until generated humanoid GLBs report loaded (not primitive fallbacks).
 * #85: 700ms settle after shell was too short — capture froze bare mannequins mid-load.
 */
export async function waitForHumanoidAssetsLoaded(page: Page, timeoutMs = 180_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const evidence = (window as unknown as {
        __openClinXrSceneAssetEvidence?: {
          pendingCount?: number;
          loadedCount?: number;
          assets?: Array<{ assetId?: string; assetPath?: string; status?: string; fallbackActive?: boolean }>;
        };
      }).__openClinXrSceneAssetEvidence;
      if (!evidence?.assets?.length) return false;
      const humanoids = evidence.assets.filter((a) =>
        (a.assetPath ?? "").includes("humanoid")
        || (a.assetPath ?? "").includes("generated-humanoids")
        || (a.assetId ?? "").includes("cast")
        || (a.assetId ?? "").includes("humanoid")
        || (a.assetId ?? "").includes("patient")
        || (a.assetId ?? "").includes("nurse")
        || (a.assetId ?? "").includes("spouse"),
      );
      // Prefer explicit humanoid rows; fall back to any loaded row count.
      const rows = humanoids.length > 0 ? humanoids : evidence.assets;
      const loaded = rows.filter((a) => a.status === "loaded" && a.fallbackActive !== true);
      const pending = rows.filter((a) => a.status === "pending");
      // ED/peds encounters load 3 humanoids; require all pending cleared and ≥2 loaded
      // (equipment may share the evidence map).
      return pending.length === 0 && loaded.length >= 2;
    },
    undefined,
    { timeout: timeoutMs },
  );
}

export type CaptureStationEnvironmentRoomsInput = {
  /** Absolute or repo-relative output directory. */
  outputDir?: string;
  /** Scenario ids to load (default: every shipped station under xr-assets/generated). */
  scenarioIds?: readonly string[];
  captureMode?: string;
  /** Injected base URL skips spawning a dev server (tests / resume). */
  baseUrl?: string;
};

/**
 * Capture room screenshots for each scenario and write a live_scene manifest.
 * Throws if the capture mode would hide the station environment.
 */
export async function captureStationEnvironmentRooms(
  input: CaptureStationEnvironmentRoomsInput = {},
): Promise<RoomCaptureManifest> {
  const captureMode = input.captureMode ?? ROOM_CAPTURE_MODE;
  if (refusesHiddenEnvironmentCapture({ captureMode })) {
    throw new Error(
      `refusesHiddenEnvironmentCapture: mode "${captureMode}" hides the station environment (main.ts clean humanoid comparator path). Use scene-overview / generated-scene / dynamic-only.`,
    );
  }

  const scenarioIds = input.scenarioIds ?? shippedStationIds();
  if (scenarioIds.length === 0) {
    throw new Error(
      "no scenarioIds provided and no shipped stations found under apps/ui-xr/public/xr-assets/generated; pass --scenario explicitly",
    );
  }
  const outputDir = input.outputDir ?? ROOM_CAPTURE_OUTPUT_DIR;
  await mkdir(outputDir, { recursive: true });

  let server: PortlessDevServer | undefined;
  let ownedServer = false;
  try {
    const baseUrl = input.baseUrl
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
      const pageReadings: PageReading[] = [];

      for (const scenarioId of scenarioIds) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        try {
          const url = buildCaptureUrl(baseUrl, scenarioId, captureMode);
          process.stdout.write(`room-capture: goto ${scenarioId} mode=${captureMode}\n`);
          // Prefer "load" over networkidle — WebGL/XR pages often never go fully idle.
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });

          const live = await waitForStationShell(page, 180_000);
          // #342 — the empty-stage guard requires A STANDING SURFACE, not specifically the
          // PROCEDURAL one. When a generated room loads it now hides the procedural floor
          // (that floor is renamed by main.ts, so the loader's name match never reached it and
          // two floors drew at once). The generated room's own floor plane is the replacement,
          // so it satisfies this guard; with no generated room the original condition stands.
          const earlyRoom = await readInfinigenRoomLiveFacts(page);
          const generatedFloorPresent =
            earlyRoom.present && earlyRoom.effectivelyVisible && earlyRoom.floorTopY !== null;
          if (live.shellVisible === false || (live.floorVisible === false && !generatedFloorPresent)) {
            throw new Error(
              `environment shell hidden for ${scenarioId} (shellVisible=${String(live.shellVisible)} floorVisible=${String(live.floorVisible)} generatedFloor=${String(generatedFloorPresent)}); refuse empty-stage photograph`,
            );
          }

          // #85: shell-ready ≠ humanoids loaded; wait for GLB cast rows before screenshot.
          await waitForHumanoidAssetsLoaded(page, 180_000);

          const frameNote = await reframeCameraForRoom(page, live.environmentId);
          process.stdout.write(`room-capture: ${scenarioId} live env=${live.environmentId} depth=${String(live.roomDepthMeters)} floor=${String(live.floorColor)} cam=${frameNote}\n`);

          // Extra frames after reframe + loads so skinned materials bind before screenshot.
          await page.waitForTimeout(1500);

          const imageName = `${scenarioId}-room.png`;
          const imagePath = path.join(outputDir, imageName);
          await page.screenshot({ path: imagePath, fullPage: false });

          // Re-read after screenshot so facts match the drawn frame.
          const liveAfter = await readLiveShellFromPage(page);
          const roomFacts = await readInfinigenRoomLiveFacts(page);

          // #342 — fail closed on the two states that previously photographed as a blank
          // viewport while every legacy field reported success. Only applies where a
          // generated room is actually mapped; unmapped ids keep the parametric fallback.
          if (roomFacts.present) {
            if (!roomFacts.effectivelyVisible) {
              throw new Error(
                `generated room loaded but not effectively visible for ${scenarioId}; refuse blank-room photograph`,
              );
            }
            if (!roomFacts.cameraInsideRoom) {
              throw new Error(
                `camera ${JSON.stringify(roomFacts.cameraWorldPosition)} is OUTSIDE the generated room interior `
                + `${JSON.stringify(roomFacts.interiorMin)}..${JSON.stringify(roomFacts.interiorMax)} for ${scenarioId}; `
                + `the room is a closed shell, so an outside camera photographs its untextured exterior hull`,
              );
            }
            if (roomFacts.proceduralShellMeshesStillVisible.length > 0) {
              throw new Error(
                `procedural shell surfaces still visible under the generated room for ${scenarioId}: `
                + `${roomFacts.proceduralShellMeshesStillVisible.join(", ")}`,
              );
            }
          }

          pageReadings.push({
            scenarioId,
            imagePath: imageName,
            liveShell: {
              infinigenRoom: roomFacts.present ? roomFacts : null,
              environmentId: liveAfter.environmentId || live.environmentId,
              floorColor: liveAfter.floorColor ?? live.floorColor,
              roomDepthMeters: liveAfter.roomDepthMeters ?? live.roomDepthMeters,
              roomWidthMeters: liveAfter.roomWidthMeters ?? live.roomWidthMeters,
              roomHeightMeters: liveAfter.roomHeightMeters ?? live.roomHeightMeters,
              shellVisible: liveAfter.shellVisible,
              floorVisible: liveAfter.floorVisible,
              encounterFloorTheme: liveAfter.encounterFloorTheme,
              captureMode,
              cameraFraming: liveAfter.cameraFraming || frameNote,
            },
          });
        } finally {
          await page.close().catch(() => undefined);
        }
      }

      const manifest = buildRoomCaptureManifest({ pageReadings });
      const manifestPath = path.join(outputDir, ROOM_CAPTURE_MANIFEST_NAME);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      process.stdout.write(`room-capture: wrote ${manifestPath} (${manifest.entries.length} entries)\n`);
      return manifest;
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let outputDir = ROOM_CAPTURE_OUTPUT_DIR;
  let captureMode = ROOM_CAPTURE_MODE;
  const scenarioIds: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--output-dir" && args[i + 1]) {
      outputDir = args[++i]!;
    } else if (arg === "--capture-mode" && args[i + 1]) {
      captureMode = args[++i]!;
    } else if (arg === "--scenario" && args[i + 1]) {
      scenarioIds.push(args[++i]!);
    }
  }

  const manifest = await captureStationEnvironmentRooms({
    outputDir,
    captureMode,
    scenarioIds: scenarioIds.length > 0 ? scenarioIds : undefined,
  });

  // Fail closed if the two primary settings did not differ live (second contract).
  const ed = manifest.entries.find((e) => e.scenarioId.includes("ed_chest_pain") || e.liveShell.environmentId.includes("ed_exam"));
  const home = manifest.entries.find(
    (e) => e.scenarioId.includes("telehealth") || e.liveShell.environmentId.includes("telehealth"),
  );
  if (ed && home) {
    if (ed.liveShell.environmentId === home.liveShell.environmentId) {
      throw new Error("ED and telehealth reported the same live environmentId");
    }
    if (ed.liveShell.floorColor === home.liveShell.floorColor) {
      throw new Error("ED and telehealth reported the same live floorColor");
    }
    if (ed.liveShell.roomDepthMeters === home.liveShell.roomDepthMeters) {
      throw new Error("ED and telehealth reported the same live roomDepthMeters");
    }
  }
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("ui-xr-environment-room-capture.ts")
    || process.argv[1].endsWith("ui-xr-environment-room-capture.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
