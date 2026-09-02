/**
 * #445 — the telehealth station room: a HUD-free still plus an inspect JSON that names
 * every mesh in the room.
 *
 * ## WHY THIS INSTRUMENT EXISTS
 *
 * Every capture today routes through `ui-xr-environment-room-capture.ts` in `scene-overview`
 * mode, which renders the full exam app — Simulated EHR panel, Trace Actions, the WebXR bar.
 * Roughly 420 px of the 1440 px graded frame is DOM chrome, and `capture-manifest.json`
 * entries carry only `scenarioId | imagePath | liveShell | source`: the shell's `userData`
 * (room dimensions, floor colour, camera position). **No artifact can name a single mesh.**
 *
 * Measured 2026-08-19 (this slice's pre-fix read): the scene-overview camera for
 * `telehealth_diabetes_health_literacy_v1` sits at world z 3.73 while the generated room's
 * interior spans z -3.45..2.80 — the camera photographs the CLOSED room from outside its
 * +Z wall. The left 2/3 of the mid-band of that frame reads mean 142-146, sd 0.3-1.0: a
 * flat pale surface (the wall), which is why nothing in the room can be identified from the
 * capture. The left-of-centre chairs are at x -0.64..-0.16, z -0.44..0.04, inside the room.
 *
 * The still's camera is therefore derived INSIDE the room, aimed at the chair cluster
 * (doorway-side stand-off = interior max Z minus twice the measured wall thickness, the #342
 * rule; eye X/Y from the measured chair bounds), and the inspect JSON is the live scene-graph
 * dump (#342's walker) reduced to meshes. Both are measurements; what the pale bar IS stays
 * the orchestrator's pixel grade.
 *
 * ## WHAT IS REUSED (no third harness)
 *
 *  - `readLiveSceneGraph` from `ui-xr-live-scene-graph-dump.ts` (#342) — the WIRED scene
 *    walker. This module does not author a second walker; it reduces the dump's nodes to
 *    meshes and derives the camera from the dump's measured world bounds.
 *  - `spawnPortlessDevServer` / `stopPortlessDevServer(server.proc)` — the shared boot and
 *    teardown path (#397/#443).
 *  - `waitForStationShell` / `waitForHumanoidAssetsLoaded` / `buildRoomCaptureUrl` — the
 *    proven room-capture plumbing.
 *  - `regionLuminance` from `lib/png-region-luminance.ts` — the same reader the #431
 *    black-frame numbers came from.
 *
 * ## HOW THE HUD IS REMOVED
 *
 * Capture-time DOM removal only — the 3D scene is untouched. `.runtime-panel` and
 * `.status-strip` are REMOVED from the DOM (not display:none'd), so the page that produced
 * the still genuinely carries zero exam-HUD nodes; the count is re-measured after removal and
 * recorded as `hud.examHudNodeCount` (the pre-removal count is recorded alongside for the
 * record). All runtime HUD writes are null-guarded (`if (title)` etc. in main.ts), so removal
 * cannot throw. The station-shell grid still declares two columns, so capture-time CSS
 * collapses it to one for a full-frame canvas.
 *
 * claimScope: measured world-space mesh inventory + derived camera of the live telehealth
 * station scene, HUD-free still of that same scene.
 * notEvidenceFor: what the pale bar IS (pixel grade), clinical realism, Quest readiness,
 * whether the room LOOKS right.
 */

import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { regionLuminance } from "./lib/png-region-luminance.js";
import { computeMeasurementTreeStamp } from "./lib/measurement-tree-stamp.js";
import {
  type PortlessDevServer,
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "./lib/portless-server.js";
import {
  buildRoomCaptureUrl,
  ROOM_CAPTURE_MODE,
  waitForHumanoidAssetsLoaded,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";
import { readLiveSceneGraph, type LiveSceneGraphDump } from "./ui-xr-live-scene-graph-dump.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

/** Scenario that stages the telehealth room (telehealth_diabetes_health_literacy_v1). */
export const TELEHEALTH_SCENARIO_ID = "telehealth_diabetes_health_literacy_v1";
/** Shipped Infinigen room the scenario maps to (apps/ui-xr/src/infinigen-environment-assets.ts). */
export const TELEHEALTH_ENVIRONMENT_ID = "telehealth_home_visit_v1";

/** Tracked artifact paths — an `exists:` proof under a gitignored path has no land path (#396). */
export const TELEHEALTH_STILL_REL = "tools/openclinxr/evidence/stills/telehealth-room-isolated.png";
export const TELEHEALTH_INSPECT_REL = "tools/openclinxr/evidence/telehealth-room-inspect.json";

/** Triangle floor for meshes[] — 0 means no filter, the full inventory is recorded. */
export const MESH_TRIANGLE_FLOOR = 0;

export type InspectCamera = {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  derivation: string;
};

export type TelehealthRoomInspect = {
  schemaVersion: "openclinxr.telehealth-room-inspect.v1";
  generatedAt: string;
  scenarioId: string;
  environmentId: string;
  captureMode: string;
  measuredAgainstCommit: unknown;
  camera: InspectCamera;
  still: {
    path: string;
    bytes: number;
    luminance: { mean: number; sd: number; nonBlackPct: number } | null;
  };
  hud: {
    examHudNodeCount: number;
    examHudNodeCountBeforeRemoval: number;
    removedVia: string;
  };
  meshes: Array<{
    name: string;
    path: string;
    worldMin: [number, number, number] | null;
    worldMax: [number, number, number] | null;
    visible: boolean;
    triangles: number;
  }>;
  triangleFloor: number;
  visibleDefinition: string;
  source: string;
  claimScope: string[];
  notEvidenceFor: string[];
};

/** Union AABB of a set of nodes that already carry worldMin/worldMax. */
function unionBounds(
  rows: ReadonlyArray<{ worldMin: [number, number, number] | null; worldMax: [number, number, number] | null }>,
): { min: [number, number, number]; max: [number, number, number] } | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const row of rows) {
    if (!row.worldMin || !row.worldMax) continue;
    any = true;
    for (let c = 0; c < 3; c++) {
      if (row.worldMin[c] < min[c]) min[c] = row.worldMin[c];
      if (row.worldMax[c] > max[c]) max[c] = row.worldMax[c];
    }
  }
  return any ? { min, max } : null;
}

/**
 * Derive the still's camera from the LIVE SCENE DUMP — no hardcoded position.
 *
 *  - Subject: the chair cluster — every mesh whose path matches `/chair/i` (the parametric
 *    shell's `patient_chair` seat/back/legs). Its union AABB is the target.
 *  - Room: the generated room's interior (meshes under the infinigen-room root excluding the
 *    `/exterior/i` hull); the doorway-side stand-off is `interior max Z - 2 x wall thickness`,
 *    the #342 rule (one thickness leaves the eye coplanar with the inner surface, two clears
 *    both faces).
 *  - Eye: X aligned with the chair cluster centre, Y = chair cluster centre + cluster height
 *    (min 1.0 m standing eye), Z = the doorway-side stand-off. Look = chair cluster centre.
 */
export function deriveChairFocusedCamera(dump: LiveSceneGraphDump): InspectCamera {
  const chairRows = dump.nodes.filter(
    (n) => n.isMesh && n.worldMin !== null && n.worldMax !== null && /chair/i.test(n.path),
  );
  const chairBounds = unionBounds(chairRows);
  if (!chairBounds) {
    throw new Error(
      "no chair meshes found in the live scene dump — cannot derive the chair-focused camera",
    );
  }

  const roomRows = dump.nodes.filter(
    (n) => n.isMesh && n.worldMin !== null && n.worldMax !== null && n.path.includes("infinigen-room"),
  );
  const interior = unionBounds(roomRows.filter((n) => !/exterior/i.test(n.path)));
  const exterior = unionBounds(roomRows.filter((n) => /exterior/i.test(n.path)));
  if (!interior) {
    throw new Error("no generated-room interior meshes found in the live scene dump");
  }

  const chairCentre: [number, number, number] = [
    (chairBounds.min[0] + chairBounds.max[0]) / 2,
    (chairBounds.min[1] + chairBounds.max[1]) / 2,
    (chairBounds.min[2] + chairBounds.max[2]) / 2,
  ];
  const chairHeight = chairBounds.max[1] - chairBounds.min[1];
  const wallThickness = exterior ? Math.max(0, exterior.max[2] - interior.max[2]) : 0;

  const eye: [number, number, number] = [
    chairCentre[0],
    Math.max(1.0, chairCentre[1] + chairHeight),
    interior.max[2] - 2 * wallThickness,
  ];
  const derivation =
    "chair-focused, all inputs measured from the live scene-graph dump (#342 walker): " +
    `eyeX = chair cluster centre X (${chairCentre[0].toFixed(3)}, union of ${chairRows.length} meshes matching /chair/i); ` +
    `eyeY = chair cluster centre Y + cluster height (${chairCentre[1].toFixed(3)} + ${chairHeight.toFixed(3)}, min 1.0 m standing eye); ` +
    `eyeZ = interior max Z - 2 x wall thickness (${interior.max[2].toFixed(3)} - 2 x ${wallThickness.toFixed(3)} = ${eye[2].toFixed(3)}); ` +
    "look = chair cluster centre; wall thickness = exterior hull max Z - interior max Z, the #342 stand-off rule";
  return {
    position: eye,
    target: chairCentre,
    fov: 60,
    derivation,
  };
}

/** Apply the derived framing to the live camera (the #342 reframe pattern: world eye -> local via the parent rig). */
async function applyFramingToPage(page: Page, framing: InspectCamera, tag: string): Promise<string> {
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
  return page.evaluate((d) => {
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
    camera.position.set(d.eye[0], d.eye[1], d.eye[2]);
    const parent = camera.parent;
    if (parent && typeof parent.worldToLocal === "function") {
      parent.updateMatrixWorld?.(true);
      parent.worldToLocal(camera.position);
    }
    camera.lookAt(d.look[0], d.look[1], d.look[2]);
    if (typeof camera.fov === "number") {
      camera.fov = d.fov;
      camera.updateProjectionMatrix?.();
    }
    if (camera.userData) {
      camera.userData["openClinXrCameraFraming"] = d.tag;
    }
    return "ok";
  }, { eye: framing.position, look: framing.target, fov: framing.fov, tag });
}

/** Read the live camera's world position + fov after reframing (measured, not restated). */
async function readCameraFromPage(page: Page): Promise<{ position: [number, number, number]; fov: number | null } | null> {
  return page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return null;
    let camera = null;
    scene.traverse(function (o) {
      if (camera) return;
      if (o.isPerspectiveCamera || o.type === "PerspectiveCamera") camera = o;
    });
    if (!camera || !camera.matrixWorld || !camera.matrixWorld.elements) return null;
    const e = camera.matrixWorld.elements;
    return {
      position: [e[12], e[13], e[14]],
      fov: typeof camera.fov === "number" ? camera.fov : null
    };
  })()`) as Promise<{ position: [number, number, number]; fov: number | null } | null>;
}

/** Count exam-HUD DOM nodes (`.runtime-panel` + `.status-strip` and their descendants). */
async function readExamHudNodeCount(page: Page): Promise<number> {
  return page.evaluate(`(() => {
    const roots = document.querySelectorAll(".runtime-panel, .status-strip");
    let count = 0;
    for (let i = 0; i < roots.length; i++) {
      count += 1 + roots[i].querySelectorAll("*").length;
    }
    return count;
  })()`) as Promise<number>;
}

/**
 * REMOVE the exam HUD from the DOM and re-measure. The still-producing page must carry zero
 * exam-HUD nodes (the planted contract's clause (3)); hiding via CSS would leave the nodes
 * present. main.ts guards every post-mount HUD write with `if (el)` / optional chaining, so
 * removal cannot throw.
 */
async function removeExamHudFromDom(page: Page): Promise<number> {
  const postRemoval = await (page.evaluate(`(() => {
    const roots = document.querySelectorAll(".runtime-panel, .status-strip");
    for (let i = 0; i < roots.length; i++) roots[i].remove();
    const after = document.querySelectorAll(".runtime-panel, .status-strip");
    let count = 0;
    for (let i = 0; i < after.length; i++) {
      count += 1 + after[i].querySelectorAll("*").length;
    }
    return count;
  })()`) as Promise<number>);
  if (postRemoval !== 0) {
    throw new Error(`exam HUD removal left ${postRemoval} nodes in the DOM — refusing to label the still HUD-free`);
  }
  return postRemoval;
}

/** Capture-time CSS: collapse the station-shell grid to one column after the HUD is removed. */
function hudRemovedCss(): string {
  return ".station-shell { grid-template-columns: minmax(0, 1fr) !important; }";
}

/**
 * Produce the HUD-free still + inspect JSON for the telehealth station.
 *
 * Writes the two TRACKED artifacts and returns the inspect object. Throws on any step;
 * the dev server is always torn down through `stopPortlessDevServer(server.proc)` (#443).
 */
export async function produceTelehealthRoomInspect(): Promise<TelehealthRoomInspect> {
  const stillRel = TELEHEALTH_STILL_REL;
  const inspectRel = TELEHEALTH_INSPECT_REL;
  const stillAbs = path.join(REPO_ROOT, stillRel);
  const inspectAbs = path.join(REPO_ROOT, inspectRel);
  await mkdir(path.dirname(stillAbs), { recursive: true });

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
        const url = buildRoomCaptureUrl(baseUrl, TELEHEALTH_SCENARIO_ID, ROOM_CAPTURE_MODE);
        process.stdout.write(`telehealth-inspect: goto ${TELEHEALTH_SCENARIO_ID} mode=${ROOM_CAPTURE_MODE}\n`);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await waitForStationShell(page, 180_000);
        await waitForHumanoidAssetsLoaded(page, 180_000);

        const examHudNodeCountBeforeRemoval = await readExamHudNodeCount(page);
        const examHudNodeCount = await removeExamHudFromDom(page);
        await page.addStyleTag({ content: hudRemovedCss() });

        // The WIRED #342 walker: full live scene graph, measured in-page.
        const dump = await readLiveSceneGraph(page);
        if (dump.environmentId !== TELEHEALTH_ENVIRONMENT_ID) {
          throw new Error(
            `live environmentId ${dump.environmentId} != expected ${TELEHEALTH_ENVIRONMENT_ID} — refusing to label the artifact with a room that did not load`,
          );
        }

        const framing = deriveChairFocusedCamera(dump);
        const applyNote = await applyFramingToPage(
          page,
          framing,
          "telehealth_room_inspect_chair_focused_interior_derived_#445",
        );
        if (applyNote !== "ok") {
          throw new Error(`camera reframe failed: ${applyNote}`);
        }
        await page.waitForTimeout(1500);

        const liveCamera = await readCameraFromPage(page);
        await page.screenshot({ path: stillAbs, type: "png" });
        process.stdout.write(
          `telehealth-inspect: still ${stillRel} camera=${JSON.stringify(liveCamera?.position)} env=${dump.environmentId}\n`,
        );

        const stillBytes = readFileSync(stillAbs);
        const luminance = regionLuminance(stillBytes, {}, { step: 6 });
        if (!luminance) {
          throw new Error("still is not a readable PNG (regionLuminance returned null)");
        }

        const meshes = dump.nodes
          .filter((n) => n.isMesh && n.triangles >= MESH_TRIANGLE_FLOOR)
          .map((n) => ({
            name: n.path.split(" / ").pop() ?? "",
            path: n.path,
            worldMin: n.worldMin,
            worldMax: n.worldMax,
            visible: n.effectivelyVisible,
            triangles: n.triangles,
          }));

        const artifact: TelehealthRoomInspect = {
          schemaVersion: "openclinxr.telehealth-room-inspect.v1",
          generatedAt: new Date().toISOString(),
          scenarioId: dump.scenarioId || TELEHEALTH_SCENARIO_ID,
          environmentId: dump.environmentId,
          captureMode: ROOM_CAPTURE_MODE,
          measuredAgainstCommit: computeMeasurementTreeStamp(REPO_ROOT),
          camera: {
            position: liveCamera?.position ?? framing.position,
            target: framing.target,
            fov: liveCamera?.fov ?? framing.fov,
            derivation: framing.derivation,
          },
          still: {
            path: stillRel,
            bytes: stillBytes.length,
            luminance: {
              mean: Number(luminance.mean.toFixed(2)),
              sd: Number(luminance.sd.toFixed(2)),
              nonBlackPct: Number(luminance.nonBlackPct.toFixed(1)),
            },
          },
          hud: {
            examHudNodeCount,
            examHudNodeCountBeforeRemoval,
            removedVia: "exam HUD DOM nodes removed at capture time (measured 0 after removal)",
          },
          meshes,
          triangleFloor: MESH_TRIANGLE_FLOOR,
          visibleDefinition: "visible = effectivelyVisible (the mesh and every ancestor are visible)",
          source:
            "live ui-xr scene (scene-overview capture mode) via playwright headless chromium against the " +
            "portless dev server; scene read by the #342 ui-xr-live-scene-graph-dump walker; camera derived " +
            "from measured chair + room bounds, never hardcoded; exam HUD DOM nodes removed at capture time " +
            "(measured 0 after removal), grid collapsed by capture-time CSS",
          claimScope: [
            "measured_world_space_mesh_inventory_of_the_live_telehealth_station_scene",
            "hud_free_still_of_that_same_scene_with_derived_camera",
          ],
          notEvidenceFor: [
            "what the pale bar at left-of-centre IS (orchestrator pixel grade)",
            "clinical_room_realism",
            "quest_readiness",
            "exam_equivalence",
          ],
        };

        await writeFile(inspectAbs, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
        process.stdout.write(`telehealth-inspect: wrote ${inspectRel} (${meshes.length} meshes, hud=${examHudNodeCount})\n`);
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
  && (process.argv[1].endsWith("telehealth-room-inspect.ts")
    || process.argv[1].endsWith("telehealth-room-inspect.js"));

if (isDirectRun) {
  produceTelehealthRoomInspect().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
