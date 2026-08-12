/**
 * #342 — live three.js scene-graph dump for the ui-xr station environment.
 *
 * Written because every probe on the Infinigen composite room reported success while the
 * learner's viewport was blank. `readLiveShellFromPage` in ui-xr-environment-room-capture.ts
 * reads `shell.userData` — the PROCEDURAL box's fields — so `roomWidthMeters` / `shellVisible`
 * cannot see the Infinigen room at all, and cannot fail when it is absent, mispositioned, or
 * occluding the camera. This dump reads the LOADED SCENE: world bounds, visibility, material
 * presence, and the camera's position relative to every mesh's world AABB.
 *
 * Reuses the proven capture plumbing (spawnPortlessDevServer + buildRoomCaptureUrl +
 * waitForStationShell) rather than inventing a fourth harness.
 *
 * claimScope: measured world-space geometry of the live ui-xr scene graph for one scenario.
 * notEvidenceFor: appearance, clinical realism, Quest readiness, whether the room LOOKS right
 * (that is a pixel grade, not a dump).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { type PortlessDevServer, spawnPortlessDevServer } from "./lib/portless-server.js";
import {
  buildRoomCaptureUrl,
  ROOM_CAPTURE_MODE,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

export const SCENE_DUMP_OUTPUT_DIR = ".openclinxr/evidence/ui-xr-live-scene-graph/latest";

export type LiveNodeRow = {
  path: string;
  type: string;
  visible: boolean;
  /** false when the node itself or any ancestor is invisible. */
  effectivelyVisible: boolean;
  isMesh: boolean;
  hasMaterial: boolean;
  materialName: string;
  materialSide: number | null;
  triangles: number;
  worldMin: [number, number, number] | null;
  worldMax: [number, number, number] | null;
  worldSize: [number, number, number] | null;
};

export type LiveSceneGraphDump = {
  schemaVersion: "openclinxr.ui-xr-live-scene-graph.v1";
  scenarioId: string;
  environmentId: string;
  framesAdvanced: number;
  camera: {
    worldPosition: [number, number, number];
    fov: number | null;
    framing: string;
  } | null;
  infinigenStatus: unknown;
  infinigenPlacement: unknown;
  /** Meshes whose world AABB contains the camera position — occlusion suspects. */
  meshesContainingCamera: string[];
  nodes: LiveNodeRow[];
};

/**
 * Read the live scene graph. String IIFE (not a TS arrow) so tsx/esbuild cannot inject
 * `__name` into the browser — the failure mode recorded in readLivePostureGeometryFromPage.
 */
export async function readLiveSceneGraph(page: Page): Promise<LiveSceneGraphDump> {
  return page.evaluate(`(() => {
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const params = new URLSearchParams(window.location.search);
    const scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";
    const framesAdvanced = (win.__openClinXrFrameStats && win.__openClinXrFrameStats.framesObserved) || 0;
    const empty = {
      schemaVersion: "openclinxr.ui-xr-live-scene-graph.v1",
      scenarioId: scenarioId,
      environmentId: "",
      framesAdvanced: framesAdvanced,
      camera: null,
      infinigenStatus: null,
      infinigenPlacement: null,
      meshesContainingCamera: [],
      nodes: []
    };
    if (!scene || typeof scene.traverse !== "function") return empty;

    scene.updateMatrixWorld(true);

    // World AABB without a THREE namespace on window: transform the 8 corners of the
    // geometry's local bounding box by matrixWorld. Exact for axis-aligned room geometry,
    // conservative otherwise. Skinned meshes report BIND-pose bounds (noted in the schema).
    const worldBoxOf = function (obj) {
      const geom = obj.geometry;
      if (!geom) return null;
      if (!geom.boundingBox && typeof geom.computeBoundingBox === "function") {
        geom.computeBoundingBox();
      }
      const bb = geom.boundingBox;
      if (!bb) return null;
      const e = obj.matrixWorld && obj.matrixWorld.elements;
      if (!e) return null;
      const xs = [bb.min.x, bb.max.x];
      const ys = [bb.min.y, bb.max.y];
      const zs = [bb.min.z, bb.max.z];
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
        const x = xs[i], y = ys[j], z = zs[k];
        const w = e[3] * x + e[7] * y + e[11] * z + e[15] || 1;
        const wx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
        const wy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
        const wz = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
        if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
        if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
        if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
      }
      if (!isFinite(minX) || !isFinite(maxX)) return null;
      return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
    };

    const worldPositionOf = function (obj) {
      const e = obj.matrixWorld && obj.matrixWorld.elements;
      if (!e) return null;
      return [e[12], e[13], e[14]];
    };

    const pathOf = function (obj) {
      const parts = [];
      let cur = obj;
      while (cur && cur !== scene) {
        parts.unshift(cur.name || ("<" + cur.type + ">"));
        cur = cur.parent;
      }
      return parts.join(" / ");
    };

    // Camera: prefer the capture camera actually rendering.
    let camera = null;
    scene.traverse(function (o) {
      if (camera) return;
      if (o.isPerspectiveCamera || o.type === "PerspectiveCamera") camera = o;
    });
    const camWorld = camera ? worldPositionOf(camera) : null;

    let environmentId = "";
    if (scene.userData && scene.userData.openClinXrStationEnvironment) {
      environmentId = scene.userData.openClinXrStationEnvironment.environmentId || "";
    }

    let infinigenStatus = null;
    let infinigenPlacement = null;
    const nodes = [];
    const meshesContainingCamera = [];

    scene.traverse(function (obj) {
      if (obj === scene) return;
      const ud = obj.userData || {};
      if (ud.openClinXrInfinigenEnvironmentStatus) infinigenStatus = ud.openClinXrInfinigenEnvironmentStatus;
      if (ud.openClinXrInfinigenPlacement) infinigenPlacement = ud.openClinXrInfinigenPlacement;

      // Effective visibility: self + every ancestor.
      let effective = true;
      let cur = obj;
      while (cur && cur !== scene) {
        if (cur.visible === false) { effective = false; break; }
        cur = cur.parent;
      }

      const isMesh = !!(obj.isMesh || obj.isSkinnedMesh);
      let tris = 0;
      let hasMaterial = false;
      let materialName = "";
      let materialSide = null;
      let worldMin = null;
      let worldMax = null;
      let worldSize = null;

      if (isMesh) {
        const mat = obj.material;
        const m = Array.isArray(mat) ? mat[0] : mat;
        hasMaterial = !!m;
        if (m) {
          materialName = m.name || m.type || "";
          materialSide = typeof m.side === "number" ? m.side : null;
        }
        const geom = obj.geometry;
        if (geom) {
          if (geom.index) tris = Math.floor(geom.index.count / 3);
          else if (geom.attributes && geom.attributes.position) tris = Math.floor(geom.attributes.position.count / 3);
        }
        const box = worldBoxOf(obj);
        if (box) {
          worldMin = box.min;
          worldMax = box.max;
          worldSize = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
          if (camWorld
            && camWorld[0] >= box.min[0] && camWorld[0] <= box.max[0]
            && camWorld[1] >= box.min[1] && camWorld[1] <= box.max[1]
            && camWorld[2] >= box.min[2] && camWorld[2] <= box.max[2]) {
            meshesContainingCamera.push(pathOf(obj));
          }
        }
      }

      nodes.push({
        path: pathOf(obj),
        type: obj.type || "",
        visible: obj.visible !== false,
        effectivelyVisible: effective,
        isMesh: isMesh,
        hasMaterial: hasMaterial,
        materialName: materialName,
        materialSide: materialSide,
        triangles: tris,
        worldMin: worldMin,
        worldMax: worldMax,
        worldSize: worldSize
      });
    });

    return {
      schemaVersion: "openclinxr.ui-xr-live-scene-graph.v1",
      scenarioId: scenarioId,
      environmentId: environmentId,
      framesAdvanced: framesAdvanced,
      camera: camera && camWorld ? {
        worldPosition: camWorld,
        fov: typeof camera.fov === "number" ? camera.fov : null,
        framing: (camera.userData && camera.userData.openClinXrCameraFraming) || ""
      } : null,
      infinigenStatus: infinigenStatus,
      infinigenPlacement: infinigenPlacement,
      meshesContainingCamera: meshesContainingCamera,
      nodes: nodes
    };
  })()`) as Promise<LiveSceneGraphDump>;
}

export async function dumpLiveSceneGraph(input: {
  scenarioId: string;
  outputDir?: string;
  baseUrl?: string;
  settleMs?: number;
}): Promise<LiveSceneGraphDump> {
  const outputDir = input.outputDir ?? SCENE_DUMP_OUTPUT_DIR;
  await mkdir(outputDir, { recursive: true });

  let server: PortlessDevServer | undefined;
  let ownedServer = false;
  try {
    const baseUrl =
      input.baseUrl
      ?? (await (async () => {
        ownedServer = true;
        server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
        return server.url;
      })());

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const url = buildRoomCaptureUrl(baseUrl, input.scenarioId, ROOM_CAPTURE_MODE);
      process.stdout.write(`scene-dump: goto ${input.scenarioId}\n`);
      await page.goto(url, { waitUntil: "load", timeout: 180_000 });
      await waitForStationShell(page, 180_000);
      await page.waitForTimeout(input.settleMs ?? 6000);

      const dump = await readLiveSceneGraph(page);
      const outPath = path.join(outputDir, `${input.scenarioId}-scene-graph.json`);
      await writeFile(outPath, `${JSON.stringify(dump, null, 2)}\n`, "utf8");
      process.stdout.write(`scene-dump: wrote ${outPath} (${dump.nodes.length} nodes)\n`);
      return dump;
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
  let scenarioId = "ed_chest_pain_priority_v1";
  let outputDir = SCENE_DUMP_OUTPUT_DIR;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--scenario" && next !== undefined) {
      scenarioId = next;
      i += 1;
    } else if (arg === "--output-dir" && next !== undefined) {
      outputDir = next;
      i += 1;
    }
  }
  const dump = await dumpLiveSceneGraph({ scenarioId, outputDir });
  process.stdout.write(
    `scene-dump: env=${dump.environmentId} frames=${dump.framesAdvanced} camera=${JSON.stringify(dump.camera?.worldPosition)} containingCamera=${dump.meshesContainingCamera.length}\n`,
  );
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("ui-xr-live-scene-graph-dump.ts")
    || process.argv[1].endsWith("ui-xr-live-scene-graph-dump.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
