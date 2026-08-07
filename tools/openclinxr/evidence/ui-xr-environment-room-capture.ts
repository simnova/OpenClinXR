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

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { spawnPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";

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

const DEFAULT_SCENARIOS = [
  "ed_chest_pain_priority_v1",
  "telehealth_diabetes_health_literacy_v1",
] as const;

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
 * Pull camera back / elevate slightly so walls + floor of the parametric shell
 * read as a room rather than an actor close-up. scene-overview already starts
 * wider than face-detail; this nudges toward a learner standing at the doorway.
 */
async function reframeCameraForRoom(page: Page): Promise<string> {
  return page.evaluate(() => {
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
    camera.position.set(1.35, 2.05, 3.15);
    camera.lookAt(0, 1.0, -1.35);
    if (typeof camera.fov === "number") {
      camera.fov = 62;
      camera.updateProjectionMatrix?.();
    }
    if (camera.userData) {
      camera.userData.openClinXrCameraFraming = "environment_room_capture_doorway_elevated_overview_#69";
    }
    return `roomCam=${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)}`;
  });
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
  /** Scenario ids to load (default: ED chest pain + telehealth diabetes). */
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

  const scenarioIds = input.scenarioIds ?? [...DEFAULT_SCENARIOS];
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
          if (live.shellVisible === false || live.floorVisible === false) {
            throw new Error(
              `environment shell hidden for ${scenarioId} (shellVisible=${String(live.shellVisible)} floorVisible=${String(live.floorVisible)}); refuse empty-stage photograph`,
            );
          }

          // #85: shell-ready ≠ humanoids loaded; wait for GLB cast rows before screenshot.
          await waitForHumanoidAssetsLoaded(page, 180_000);

          const frameNote = await reframeCameraForRoom(page);
          process.stdout.write(`room-capture: ${scenarioId} live env=${live.environmentId} depth=${String(live.roomDepthMeters)} floor=${String(live.floorColor)} cam=${frameNote}\n`);

          // Extra frames after reframe + loads so skinned materials bind before screenshot.
          await page.waitForTimeout(1500);

          const imageName = `${scenarioId}-room.png`;
          const imagePath = path.join(outputDir, imageName);
          await page.screenshot({ path: imagePath, fullPage: false });

          // Re-read after screenshot so facts match the drawn frame.
          const liveAfter = await readLiveShellFromPage(page);
          pageReadings.push({
            scenarioId,
            imagePath: imageName,
            liveShell: {
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
        server.proc.kill("SIGTERM");
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
