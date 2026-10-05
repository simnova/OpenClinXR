/**
 * Ward-finish-chain multiview capture: 6 runtime frames matching the Imagine
 * multiview reference viewpoints (docs/openclinxr/room-realism/imagine-multiview/),
 * against the chained ward GLB (room_generate seed 205 + room_clinic_finish
 * ward_photo + lighting_design clinic_day) wired as the runtime environment
 * apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb.
 *
 * Ported verbatim from the proven sibling
 * tools/openclinxr/evidence/room-infinigen-stage2/stage2-multiview-capture.ts
 * (wt/infinigen-room) except the default OUTPUT_DIR. Mechanism unchanged:
 * poses are room-local and transformed by the room root's live world matrix
 * at capture time (no reseat); non-room meshes hide by ancestry under
 * `openclinxr.station-environment.infinigen-room`.
 *
 * With STAGE2_CAPTURE_GLB unset, the UI-XR dev server serves the shipped
 * runtime URL directly (the learner path). Set STAGE2_CAPTURE_GLB only for an
 * explicit local-file override used by pre-ship comparison work.
 * (Original stage-2 header follows.)
 *
 * 6 runtime frames matching the Imagine multiview
 * reference viewpoints (docs/openclinxr/room-realism/imagine-multiview/),
 * against the stage-2 Infinigen shell GLB (ported from the closed
 * wt/ward-finish branch's ward-multiview-capture.ts at 0e26cbf95).
 *
 * Mechanism (unchanged from the reference): load the runtime's UI-XR scene
 * via a portless dev server, OVERRIDE the environment GLB route (glob match
 * on the inpatient-ward environment asset path, served from a local file),
 * then query `globalThis.__openClinXrDebugScene` for the camera
 * and place the 6 POSES. Blender (x, y, z) maps to three (x, z, -y).
 * Stage-2 room shares the reference interior footprint (4.3 x 3.9), so the
 * same camera math applies; no scenario actors are needed for the shot, the
 * scene-closure route is reused only as the environment loader.
 *
 * Stage-2 deltas vs the reference script:
 * - GLB comes from the shipped UI-XR runtime URL by default. An optional
 *   STAGE2_CAPTURE_GLB overrides that URL for pre-ship comparison work.
 * - HIDE keeps by ANCESTRY, not by name (neither the reference keep-regex
 *   nor an adapted one): the Blender->glTF path renames the wall parts to
 *   bare primitive names (`bedroom_00wall/Circle002`, `Circle002_1` --
 *   measured in the room-subtree audit), so any wall/floor/ceiling/exterior
 *   name pattern silently drops the walls. Instead the script finds the
 *   override GLB root (`openclinxr.station-environment.infinigen-room`),
 *   keeps every mesh under it, and hides the rest. The extracted GLB
 *   carries no actors, furniture, skirting, door leaf, or casing, so the
 *   room subtree is exactly the 5 shell nodes; everything else staged by
 *   the scene-closure route (actors, beds, tables, signage, ED-bay shell,
 *   fixture door assembly) hides for the shot. Skipping hide entirely was
 *   rejected: the scene stages 321 meshes.
 * - STAGE2_POSES_FILE (optional): JSON file with posed entries
 *   `{ "image"|"id", "eye": [x,y,z], "look": [x,y,z],
 *   "verticalFovDeg"|"fov": N }` in the ROOM-LOCAL frame (GLB-centered:
 *   door-wall inner face z=-1.95, door center x=+0.25). Overrides the
 *   built-in POSES. Used by the hand-placed pose set
 *   (`stage2-camera-fit/hand-placed-poses.json`).
 * - STAGE2_POSE_DX (default 0) rigidly shifts runtime-01/-04 eye.x+look.x so
 *   the door framing matches the reference composition when the stage-2 door
 *   lands at a different x along the door wall (documented per run;
 *   obsolete since the door cutter pin, kept as a no-op default).
 * - STAGE2_DUMP_ONLY=1 prints every mesh name in the loaded scene and exits
 *   before hiding/capturing (used to confirm the keep-list, no frames).
 * - RUNTIME PLACEMENT (no capture-side reseat): the 6 POSES are expressed in
 *   the room-local (GLB-centered) frame and transformed by the room root's
 *   actual world matrix at capture time -- the same relative placement the
 *   runtime would use for a room-anchored camera. The loader's
 *   floorCenterZ offset stays in place; shared runtime code, poses, and the
 *   GLB are untouched; y kept (grounding).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CASE_FROZEN_SCENE_PLANS } from "@openclinxr/asset-registry/case-frozen-scene-plans";
import {
  ROOM_CHAIN_RECIPES,
} from "@openclinxr/factory-stations/room-chain";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import type { Browser, Page } from "playwright";
import {
  deriveRoomEvidencePoses,
  type RoomEvidencePoseArtifact,
} from "../../asset-pipeline/environment/derive-room-evidence-poses.js";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "../lib/evidence-page.js";
import {
  type PortlessDevServer,
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "../lib/portless-server.js";
import {
  buildSceneClosureBundleJson,
  buildSceneClosureUrl,
  SCENE_CLOSURE_BUNDLE_ROUTE,
  SCENE_CLOSURE_SCENARIO_ID,
} from "../scene-closure/proofs/sc-05/ui-xr-bedside-approach-capture.ts";

const OUTPUT_DIR =
  process.env["STAGE2_CAPTURE_OUT_DIR"] ?? "docs/openclinxr/room-realism/ward-finish-chain-2026-09-27/captures";
const VIEWPORT_WIDTH = Number(process.env["STAGE2_VIEWPORT_WIDTH"] ?? "1280");
const VIEWPORT_HEIGHT = Number(process.env["STAGE2_VIEWPORT_HEIGHT"] ?? "720");
const PUSH_FRAMES_DIR = process.env["STAGE2_PUSH_FRAMES_DIR"];
const PUSH_FPS = Number(process.env["STAGE2_PUSH_FPS"] ?? "15");
const PUSH_DURATION_SECONDS = Number(process.env["STAGE2_PUSH_DURATION_SECONDS"] ?? "10");
// STAGE2_AO_INTENSITY (optional, added 2026-09-29 for the ao-cycles-bake job):
// runtime aoMapIntensity override for every material carrying an aoMap ("1" =
// unchanged, "0" = AO-off floor renders for the dot-fraction metric). The GLB
// on disk is untouched; the override applies in-page before each capture.
const AO_INTENSITY =
  process.env["STAGE2_AO_INTENSITY"] === undefined ? null : Number(process.env["STAGE2_AO_INTENSITY"]);

const SET_AO_INTENSITY_SOURCE = `
((intensity) => {
  const scene = globalThis.__openClinXrDebugScene;
  if (!scene || typeof scene.traverse !== "function") return { ok: false, reason: "no-debug-scene" };
  let n = 0;
  scene.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (m && m.aoMap) { m.aoMapIntensity = intensity; if ("needsUpdate" in m) m.needsUpdate = true; n += 1; }
    }
  });
  return { ok: true, materials: n };
})
`;
const STAGE2_GLB = process.env["STAGE2_CAPTURE_GLB"];
const CAPTURE_ENVIRONMENT_ID = process.env["STAGE2_ENVIRONMENT_ID"] ?? "inpatient_ward_room_v1";
const ENVIRONMENT_URLS: Record<string, string> = {
  adult_ed_abdominal_bay_v1: "/xr-assets/environment/infinigen-adult-ed-abdominal-bay.glb",
  behavioral_health_private_room_v1: "/xr-assets/environment/infinigen-behavioral-health-private.glb",
  ed_exam_bay_v1: "/xr-assets/environment/infinigen-ed-exam-bay.glb",
  ed_stroke_bay_v1: "/xr-assets/environment/infinigen-ed-stroke-bay.glb",
  inpatient_ward_room_v1: "/xr-assets/environment/infinigen-inpatient-ward.glb",
  ob_triage_room_v1: "/xr-assets/environment/infinigen-ob-triage.glb",
  oncology_consult_room_v1: "/xr-assets/environment/infinigen-oncology-consult.glb",
  pediatric_fever_urgent_care_bay_v1: "/xr-assets/environment/infinigen-pediatric-fever-urgent-care.glb",
  pediatric_urgent_care_bay_v1: "/xr-assets/environment/infinigen-pediatric-urgent-care-bay.glb",
  primary_care_clinic_room_v1: "/xr-assets/environment/infinigen-primary-care-clinic.glb",
  stepdown_room_v1: "/xr-assets/environment/infinigen-stepdown.glb",
  surgical_ward_room_v1: "/xr-assets/environment/infinigen-surgical-ward.glb",
  telehealth_home_visit_v1: "/xr-assets/environment/infinigen-telehealth-home-visit.glb",
  urgent_care_clinic_room_v1: "/xr-assets/environment/infinigen-urgent-care-clinic.glb",
};
const SHIPPED_WARD_URL = ENVIRONMENT_URLS[CAPTURE_ENVIRONMENT_ID];
if (SHIPPED_WARD_URL === undefined) throw new Error(`no capture URL for ${CAPTURE_ENVIRONMENT_ID}`);
const FINISHED_WARD_GLB = STAGE2_GLB ? path.resolve(process.cwd(), STAGE2_GLB) : null;
const HAND_PLACED_POSES: Partial<Record<string, string>> = {
  // The ward remains the frozen known-good exception. Every other room-chain
  // room derives its poses from its own GLB and recipe below.
  inpatient_ward_room_v1: "tools/openclinxr/evidence/room-ward-finish-chain/hand-placed-poses.json",
};

// Rigid x-shift for the two door-framing poses (see header). 0 = verbatim POSES.
const POSE_DX = Number(process.env["STAGE2_POSE_DX"] ?? "0");

const PLACE_CAMERA_SOURCE = `
((pose) => {
  try {
    const scene = globalThis.__openClinXrDebugScene;
    if (!scene) return { ok: false, reason: "no-debug-scene" };
    let room = null;
    scene.traverse((o) => {
      if (!room && o.name === "openclinxr.station-environment.infinigen-room") room = o;
    });
    if (!room) return { ok: false, reason: "no-room-root" };
    let cam = null;
    scene.traverse((o) => {
      if (!cam && (o.isPerspectiveCamera || o.type === "PerspectiveCamera")) cam = o;
    });
    if (!cam) return { ok: false, reason: "no-camera" };
    if (typeof cam.fov === "number" && cam.fov !== pose.fov) {
      cam.fov = pose.fov;
      if (typeof cam.updateProjectionMatrix === "function") cam.updateProjectionMatrix();
    }
    // Runtime placement: the pose is room-local; transform by the room
    // root's actual world matrix at capture time (no reseat).
    if (typeof room.updateWorldMatrix === "function") room.updateWorldMatrix(true, false);
    const eyeW = { x: pose.eye.x, y: pose.eye.y, z: pose.eye.z };
    const lookW = { x: pose.look.x, y: pose.look.y, z: pose.look.z };
    const m = room.matrixWorld && room.matrixWorld.elements ? room.matrixWorld.elements : null;
    if (!m) return { ok: false, reason: "no-room-matrix" };
    const apply = (p) => ({
      x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
      y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
      z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
    });
    const ew = apply(eyeW);
    const lw = apply(lookW);
    const v = cam.position.clone();
    v.set(ew.x, ew.y, ew.z);
    if (cam.parent) {
      cam.parent.updateWorldMatrix(true, false);
      const inv = cam.parent.matrixWorld.clone().invert();
      v.applyMatrix4(inv);
    }
    cam.position.copy(v);
    if (cam.parent) cam.parent.updateWorldMatrix(true, false);
    if (typeof cam.lookAt === "function") cam.lookAt(lw.x, lw.y, lw.z);
    if (typeof cam.updateMatrixWorld === "function") cam.updateMatrixWorld(true);
    const e = cam.matrixWorld.elements;
    return { ok: true, world: [e[12], e[13], e[14]], near: cam.near };
  } catch (err) {
    return { ok: false, reason: "exception: " + (err?.message ?? String(err)) };
  }
})
`;

// Stage-2 keep-list: the 4 extracted shell parts only (slashes/dots are
// literal in three.js node names; confirmed with STAGE2_DUMP_ONLY=1 before
// capturing). The extracted GLB has no actors/furniture/door/casing, so
// anything else in the scene belongs to the scene-closure staging.
// Ancestry keep (NOT a name regex): the override GLB root keeps its loader
// name `openclinxr.station-environment.infinigen-room`; every mesh under it
// stays, everything else staged by the scene-closure route hides. Name
// matching is unusable here: the Blender->glTF path renames the wall parts
// to bare primitive names (`bedroom_00wall/Circle002`, `Circle002_1` --
// measured in the room-subtree audit), so a wall/floor/ceiling/exterior
// pattern would silently drop the walls.
const HIDE_NON_ROOM_SOURCE = `
(() => {
  const scene = globalThis.__openClinXrDebugScene;
  if (!scene) return { ok: false };
  let room = null;
  scene.traverse((o) => {
    if (!room && o.name === "openclinxr.station-environment.infinigen-room") room = o;
  });
  if (!room) return { ok: false, reason: "no-room-root" };
  const keepSet = new Set();
  room.traverse((o) => { if (o.isMesh) keepSet.add(o); });
  let kept = 0, hidden = 0;
  const hiddenNames = [];
  const keptNames = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.name || "";
    if (keepSet.has(o)) { kept += 1; if (keptNames.length < 12) keptNames.push(name); return; }
    o.visible = false;
    hidden += 1;
    if (hiddenNames.length < 24) hiddenNames.push(name);
  });
  return { ok: true, kept, hidden, keptNames, hiddenNames };
})()
`;

type CapturePose = {
  id: string;
  eye: { x: number; y: number; z: number };
  look: { x: number; y: number; z: number };
  fov: number;
};

async function loadPoses(): Promise<{
  poses: CapturePose[];
  source: { kind: "explicit" | "hand-placed" | "derived"; path?: string };
  derivation: RoomEvidencePoseArtifact | null;
}> {
  const explicit = process.env["STAGE2_POSES_FILE"];
  const handPlaced = HAND_PLACED_POSES[CAPTURE_ENVIRONMENT_ID];
  const posesFile = explicit ?? handPlaced;
  if (!posesFile) {
    const recipe = ROOM_CHAIN_RECIPES[CAPTURE_ENVIRONMENT_ID as keyof typeof ROOM_CHAIN_RECIPES];
    if (!recipe) throw new Error(`no room-chain recipe for capture ${CAPTURE_ENVIRONMENT_ID}`);
    const glbPath = FINISHED_WARD_GLB ?? path.resolve(process.cwd(), `apps/ui-xr/public${SHIPPED_WARD_URL}`);
    const derivation = await deriveRoomEvidencePoses(glbPath, recipe);
    return {
      poses: derivation.poses.map((entry) => ({
        id: entry.id,
        eye: { x: entry.eye[0], y: entry.eye[1], z: entry.eye[2] },
        look: { x: entry.look[0], y: entry.look[1], z: entry.look[2] },
        fov: entry.verticalFovDeg,
      })),
      source: { kind: "derived" },
      derivation,
    };
  }
  const parsed = JSON.parse(await readFile(path.resolve(process.cwd(), posesFile), "utf8")) as Array<{
    id?: string;
    image?: string;
    eye: [number, number, number] | { x: number; y: number; z: number };
    look: [number, number, number] | { x: number; y: number; z: number };
    fov?: number;
    verticalFovDeg?: number;
  }> | RoomEvidencePoseArtifact;
  const raw = Array.isArray(parsed) ? parsed : parsed.poses;
  const poses = raw.map((entry) => {
    const id =
      entry.id ?? `runtime-${(entry.image ?? "unknown").replace(/\.jpg$/, "")}`;
    const eye = Array.isArray(entry.eye)
      ? { x: entry.eye[0], y: entry.eye[1], z: entry.eye[2] }
      : entry.eye;
    const look = Array.isArray(entry.look)
      ? { x: entry.look[0], y: entry.look[1], z: entry.look[2] }
      : entry.look;
    const fov = ("fov" in entry ? entry.fov : undefined) ?? entry.verticalFovDeg;
    if (fov === undefined) throw new Error(`pose ${id} has no fov/verticalFovDeg`);
    return { id, eye, look, fov };
  });
  return {
    poses,
    source: { kind: explicit ? "explicit" : "hand-placed", path: posesFile },
    derivation: Array.isArray(parsed) ? null : parsed,
  };
}

const DUMP_MESHES_SOURCE = `
(() => {
  const scene = globalThis.__openClinXrDebugScene;
  if (!scene) return { ok: false };
  const names = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    names.push(o.name || "(unnamed)");
  });
  names.sort();
  // Room-subtree audit: the override GLB root keeps its loader name; list
  // every descendant (meshes AND groups) with visibility + vertex counts so
  // a missing wall part names itself instead of vanishing silently.
  let room = null;
  scene.traverse((o) => {
    if (!room && o.name === "openclinxr.station-environment.infinigen-room") room = o;
  });
  const roomTree = [];
  if (room) {
    room.traverse((o) => {
      const g = o.geometry;
      const pos = g && g.attributes && g.attributes.position;
      roomTree.push({
        name: o.name || "(unnamed)",
        type: o.type || "?",
        isMesh: !!o.isMesh,
        visible: !!o.visible,
        verts: pos ? pos.count : null,
      });
    });
  }
  return { ok: true, meshCount: names.length, names, roomFound: !!room, roomTree };
})()
`;

const HIDE_UI_SOURCE = `
((viewport) => {
  const canvas = document.querySelector("#station-canvas");
  if (!canvas) return "no-canvas";
  const keeps = new Set();
  let el = canvas;
  while (el) { keeps.add(el); el = el.parentElement; }
  document.querySelectorAll("body *").forEach((node) => {
    if (!keeps.has(node)) node.style.setProperty("display", "none", "important");
  });
  canvas.style.setProperty("position", "fixed", "important");
  canvas.style.setProperty("left", "0", "important");
  canvas.style.setProperty("top", "0", "important");
  canvas.style.setProperty("width", viewport.width + "px", "important");
  canvas.style.setProperty("height", viewport.height + "px", "important");
  canvas.style.setProperty("margin", "0", "important");
  document.body.style.setProperty("margin", "0", "important");
  document.body.style.setProperty("overflow", "hidden", "important");
  return "hidden";
})
`;

async function installEnvironmentOverrideRoute(page: Page, glbPath: string): Promise<void> {
  const bytes = await readFile(glbPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const pattern = `**${SHIPPED_WARD_URL}`;
  await page.route(pattern, async (route) => {
    process.stderr.write(
      `[environment] served ${glbPath} (sha256 ${sha256.slice(0, 12)}…, ${bytes.length} bytes)\n`,
    );
    await route.fulfill({ status: 200, contentType: "model/gltf-binary", body: bytes });
  });
}

async function main(): Promise<void> {
  const outputDir = path.resolve(process.cwd(), OUTPUT_DIR);
  await mkdir(outputDir, { recursive: true });

  const bundle = JSON.parse(buildSceneClosureBundleJson()) as {
    actors: Array<{ actorId: string; role: string }>;
    sceneManifest: { environmentId: string };
  };
  bundle.sceneManifest.environmentId = CAPTURE_ENVIRONMENT_ID;
  const bundleJson = `${JSON.stringify(bundle, null, 2)}\n`;
  const walkerRole = CASE_FROZEN_SCENE_PLANS[SCENE_CLOSURE_SCENARIO_ID]?.case.walkerRole;
  if (!walkerRole) throw new Error("no frozen walkerRole for scene-closure scenario");
  const walker = bundle.actors.find((actor) => actor.role === walkerRole);
  if (!walker) throw new Error("no walker actor in bundle cast");

  let server: PortlessDevServer | null = null;
  try {
    const runningServer = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
    server = runningServer;
    await createLocalComputeServices().sceneCapture.withBrowser("ward-finish-chain-capture", async (handle) => {
      const browser = handle as Browser;
        const page = await browser.newPage({ viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } });
    page.on("console", (message) => process.stderr.write(`[page:${message.type()}] ${message.text()}\n`));
    page.on("pageerror", (error) => process.stderr.write(`[page:error] ${error.stack ?? error.message}\n`));
    page.on("response", (response) => {
      if (response.status() >= 400) process.stderr.write(`[page:http] ${response.status()} ${response.url()}\n`);
    });
    await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
    await page.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
    });
    if (FINISHED_WARD_GLB) {
      await installEnvironmentOverrideRoute(page, FINISHED_WARD_GLB);
    } else {
      process.stderr.write(`[environment] loading shipped runtime URL ${SHIPPED_WARD_URL} (no route override)\n`);
    }

    await page.goto(buildSceneClosureUrl(runningServer.url), { waitUntil: "networkidle", timeout: 180_000 });
    try {
      await page.waitForFunction(
        () => {
          const g = globalThis as unknown as { __openClinXrDebugScene?: { traverse: (fn: (o: never) => void) => void } };
          const scene = g.__openClinXrDebugScene;
          if (!scene?.traverse) return false;
          let hull = false;
          scene.traverse((o: { userData?: Record<string, unknown> }) => {
            if (o.userData?.["openClinXrEnvironmentSource"] === "infinigen-generated-room") hull = true;
          });
          return hull;
        },
        undefined,
        { timeout: 180_000 },
      );
    } catch (error) {
      const diagnostic = await page.evaluate(() => {
        const browserGlobal = globalThis as unknown as {
          __openClinXrDebugScene?: unknown;
          document: { body: { innerText: string }; title: string };
          location: { href: string };
        };
        return {
          href: browserGlobal.location.href,
          title: browserGlobal.document.title,
          body: browserGlobal.document.body.innerText.slice(0, 2000),
          hasScene: Boolean(browserGlobal.__openClinXrDebugScene),
        };
      });
      throw new Error(`room scene did not load: ${JSON.stringify(diagnostic)}; ${error instanceof Error ? error.message : String(error)}`);
    }
    await page.waitForTimeout(3000);
    await page.evaluate(`${HIDE_UI_SOURCE}(${JSON.stringify({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT })})`);
    await page.waitForTimeout(300);

    if ((process.env["STAGE2_DUMP_ONLY"] ?? "0") === "1") {
      const dump = await page.evaluate(DUMP_MESHES_SOURCE);
      process.stdout.write(`[dump] ${JSON.stringify(dump)}\n`);
      process.stdout.write("[done] stage-2 mesh dump (no captures)\n");
      return;
    }

    const stripped = await page.evaluate(HIDE_NON_ROOM_SOURCE);
    process.stdout.write(`[strip] non-room meshes hidden: ${JSON.stringify(stripped)}\n`);
    if (AO_INTENSITY !== null) {
      if (!Number.isFinite(AO_INTENSITY)) throw new Error(`STAGE2_AO_INTENSITY must be a number (got ${process.env["STAGE2_AO_INTENSITY"]})`);
      const applied = (await page.evaluate(`${SET_AO_INTENSITY_SOURCE}(${AO_INTENSITY})`)) as {
        ok: boolean;
        reason?: string;
        materials?: number;
      };
      if (!applied.ok) throw new Error(`aoMapIntensity override failed: ${applied.reason}`);
      await page.waitForTimeout(400);
      process.stdout.write(`[ao] aoMapIntensity=${AO_INTENSITY} materials=${applied.materials}\n`);
    }

    const loadedPoses = await loadPoses();
    const poses = loadedPoses.poses;
    process.stdout.write(
      `[poses] ${poses.length} pose(s)` +
        (loadedPoses.source.path ? ` from ${loadedPoses.source.path}` : ` (${loadedPoses.source.kind})`) +
        "\n",
    );

    if (PUSH_FRAMES_DIR) {
      if (!Number.isInteger(PUSH_FPS) || PUSH_FPS <= 0) throw new Error(`STAGE2_PUSH_FPS must be a positive integer (got ${PUSH_FPS})`);
      if (!Number.isFinite(PUSH_DURATION_SECONDS) || PUSH_DURATION_SECONDS < 1) {
        throw new Error(`STAGE2_PUSH_DURATION_SECONDS must be at least 1 (got ${PUSH_DURATION_SECONDS})`);
      }
      const start = poses.find((pose) => pose.id === "runtime-01-toward-door");
      const end = poses.find((pose) => pose.id === "runtime-04-door-inside");
      if (!start || !end) throw new Error("push capture needs runtime-01-toward-door and runtime-04-door-inside poses");
      const frameCount = Math.round(PUSH_FPS * PUSH_DURATION_SECONDS);
      const framesDir = path.resolve(process.cwd(), PUSH_FRAMES_DIR);
      await mkdir(framesDir, { recursive: true });
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      for (let index = 0; index < frameCount; index += 1) {
        const linearT = frameCount === 1 ? 1 : index / (frameCount - 1);
        const t = linearT * linearT * (3 - 2 * linearT);
        const pose = {
          id: `door-push-${String(index).padStart(4, "0")}`,
          eye: {
            x: lerp(start.eye.x, end.eye.x, t),
            y: lerp(start.eye.y, end.eye.y, t),
            z: lerp(start.eye.z, end.eye.z, t),
          },
          look: {
            x: lerp(start.look.x, end.look.x, t),
            y: lerp(start.look.y, end.look.y, t),
            z: lerp(start.look.z, end.look.z, t),
          },
          fov: lerp(start.fov, end.fov, t),
        };
        const placed = (await page.evaluate(`${PLACE_CAMERA_SOURCE}(${JSON.stringify(pose)})`)) as {
          ok: boolean;
          reason?: string;
        };
        if (!placed.ok) throw new Error(`camera placement failed for ${pose.id}: ${placed.reason}`);
        if (index === 0) await page.waitForTimeout(400);
        await page.screenshot({
          path: path.join(framesDir, `frame-${String(index).padStart(4, "0")}.jpg`),
          type: "jpeg",
          quality: 92,
          fullPage: false,
        });
      }
      await writeFile(
        path.join(framesDir, "door-push.json"),
        `${JSON.stringify({
          schemaVersion: "openclinxr.ward-door-push.v1",
          glb: FINISHED_WARD_GLB ?? SHIPPED_WARD_URL,
          mechanism: FINISHED_WARD_GLB ? "playwright-route-override" : "ui-xr-runtime-url",
          start,
          end,
          interpolation: "smoothstep",
          fps: PUSH_FPS,
          durationSeconds: PUSH_DURATION_SECONDS,
          frameCount,
          viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
        }, null, 2)}\n`,
        "utf8",
      );
      process.stdout.write(`[done] ${frameCount}-frame door push captured to ${framesDir}\n`);
      return;
    }

    const manifest: Array<Record<string, unknown>> = [];
    const only = process.env["STAGE2_MULTIVIEW_ONLY"];
    const selected = only ? new Set(only.split(",").map((value) => value.trim()).filter(Boolean)) : null;
    for (const base of poses) {
      if (selected && !selected.has(base.id)) continue;
      const pose =
        base.id === "runtime-01-toward-door" || base.id === "runtime-04-door-inside"
          ? {
              ...base,
              eye: { ...base.eye, x: base.eye.x + POSE_DX },
              look: { ...base.look, x: base.look.x + POSE_DX },
            }
          : base;
      const placed = (await page.evaluate(`${PLACE_CAMERA_SOURCE}(${JSON.stringify(pose)})`)) as {
        ok: boolean;
        reason?: string;
        world?: number[];
        near?: number;
      };
      if (!placed.ok) throw new Error(`camera placement failed for ${pose.id}: ${placed.reason}`);
      await page.waitForTimeout(400);
      const png = path.join(outputDir, `${pose.id}.png`);
      await page.screenshot({ path: png, fullPage: false });
      const pngBytes = await readFile(png);
      const pngSha256 = createHash("sha256").update(pngBytes).digest("hex");
      process.stdout.write(`[capture] ${pose.id} (${pngBytes.length} bytes, sha256=${pngSha256.slice(0, 12)}…)\n`);
      const derivedClearance = loadedPoses.derivation?.clearanceM[pose.id as keyof RoomEvidencePoseArtifact["clearanceM"]];
      manifest.push({
        ...pose,
        poseDx: POSE_DX,
        png,
        pngBytes: pngBytes.length,
        pngSha256,
        nearPlaneM: placed.near ?? null,
        ...(derivedClearance === undefined ? {} : {
          wallClearanceM: derivedClearance,
          nearPlaneWallCheck: {
            passed: derivedClearance.minimum >= (placed.near ?? Number.POSITIVE_INFINITY),
            rule: "minimum x/z wall clearance must be at least the live PerspectiveCamera near plane",
          },
        }),
      });
    }
    await writeFile(
      path.join(outputDir, "stage2-multiview.json"),
      `${JSON.stringify({
        schemaVersion: "openclinxr.stage2-multiview.v1",
        environmentId: CAPTURE_ENVIRONMENT_ID,
        glb: FINISHED_WARD_GLB ?? SHIPPED_WARD_URL,
        mechanism: FINISHED_WARD_GLB ? "playwright-route-override" : "ui-xr-runtime-url",
        poseSource: loadedPoses.source,
        poseDerivation: loadedPoses.derivation,
        captures: manifest,
      }, null, 2)}\n`,
      "utf8",
    );
        process.stdout.write("[done] stage-2 multiview captured\n");
    });
  } finally {
    if (server) await stopPortlessDevServer(server.proc);
  }
}

const invokedAsMain = (process.argv[1] ?? "").endsWith("ward-finish-chain-capture.ts");
if (invokedAsMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
