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
 * STAGE2_CAPTURE_GLB points at the WIRED shipped file so the capture serves
 * the exact bytes a learner loads; placement is the runtime's own.
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
 * - GLB comes from STAGE2_CAPTURE_GLB (required); no baked-finish default.
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
import { chromium, type Page } from "playwright";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "../lib/evidence-page.js";
import {
  type PortlessDevServer,
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "../lib/portless-server.js";
import { CASE_FROZEN_SCENE_PLANS } from "@openclinxr/asset-registry/case-frozen-scene-plans";
import {
  buildSceneClosureBundleJson,
  buildSceneClosureUrl,
  SCENE_CLOSURE_SCENARIO_ID,
  SCENE_CLOSURE_BUNDLE_ROUTE,
} from "../scene-closure/proofs/sc-05/ui-xr-bedside-approach-capture.ts";

const OUTPUT_DIR =
  process.env["STAGE2_CAPTURE_OUT_DIR"] ?? "docs/openclinxr/room-realism/ward-finish-chain-2026-09-27/captures";
const STAGE2_GLB = process.env["STAGE2_CAPTURE_GLB"];
if (!STAGE2_GLB) {
  throw new Error("STAGE2_CAPTURE_GLB is required (stage-2 room GLB path)");
}
const FINISHED_WARD_GLB = path.resolve(process.cwd(), STAGE2_GLB);

// Rigid x-shift for the two door-framing poses (see header). 0 = verbatim POSES.
const POSE_DX = Number(process.env["STAGE2_POSE_DX"] ?? "0");

const POSES = [
  {
    id: "runtime-01-toward-door",
    eye: { x: -0.45, y: 1.6, z: -1.35 },
    look: { x: 0.3, y: 1.35, z: -2.0 },
    fov: 52,
  },
  {
    id: "runtime-02-toward-bed-wall",
    eye: { x: 0.25, y: 1.6, z: -1.5 },
    look: { x: -0.15, y: 1.3, z: 1.95 },
    fov: 55,
  },
  {
    id: "runtime-03-ceiling-corner",
    eye: { x: -1.75, y: 0.6, z: 1.5 },
    look: { x: 0.25, y: 2.3, z: -0.25 },
    fov: 62,
  },
  {
    id: "runtime-04-door-inside",
    eye: { x: 0.25, y: 1.5, z: -0.75 },
    look: { x: 0.25, y: 1.4, z: -1.95 },
    fov: 50,
  },
  {
    id: "runtime-05-troffer-junction",
    eye: { x: 0.6, y: 1.9, z: -0.5 },
    look: { x: 0.0, y: 2.3, z: 0.0 },
    fov: 45,
  },
  {
    id: "runtime-06-floor-base",
    eye: { x: 0.3, y: 0.55, z: 0.6 },
    look: { x: -0.15, y: 0.1, z: 1.95 },
    fov: 60,
  },
];

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
    return { ok: true, world: [e[12], e[13], e[14]] };
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

async function loadPoses(): Promise<Array<{
  id: string;
  eye: { x: number; y: number; z: number };
  look: { x: number; y: number; z: number };
  fov: number;
}>> {
  const posesFile = process.env["STAGE2_POSES_FILE"];
  if (!posesFile) return POSES;
  const raw = JSON.parse(await readFile(path.resolve(process.cwd(), posesFile), "utf8")) as Array<{
    id?: string;
    image?: string;
    eye: [number, number, number] | { x: number; y: number; z: number };
    look: [number, number, number] | { x: number; y: number; z: number };
    fov?: number;
    verticalFovDeg?: number;
  }>;
  return raw.map((entry) => {
    const id =
      entry.id ?? `runtime-${(entry.image ?? "unknown").replace(/\.jpg$/, "")}`;
    const eye = Array.isArray(entry.eye)
      ? { x: entry.eye[0], y: entry.eye[1], z: entry.eye[2] }
      : entry.eye;
    const look = Array.isArray(entry.look)
      ? { x: entry.look[0], y: entry.look[1], z: entry.look[2] }
      : entry.look;
    const fov = entry.fov ?? entry.verticalFovDeg;
    if (fov === undefined) throw new Error(`pose ${id} has no fov/verticalFovDeg`);
    return { id, eye, look, fov };
  });
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
(() => {
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
  canvas.style.setProperty("width", "1280px", "important");
  canvas.style.setProperty("height", "720px", "important");
  canvas.style.setProperty("margin", "0", "important");
  document.body.style.setProperty("margin", "0", "important");
  document.body.style.setProperty("overflow", "hidden", "important");
  return "hidden";
})()
`;

async function installEnvironmentOverrideRoute(page: Page, glbPath: string): Promise<void> {
  const bytes = await readFile(glbPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const pattern = `**/xr-assets/environment/infinigen-inpatient-ward.glb`;
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

  const bundleJson = buildSceneClosureBundleJson();
  const bundle = JSON.parse(bundleJson) as { actors: Array<{ actorId: string; role: string }> };
  const walkerRole = CASE_FROZEN_SCENE_PLANS[SCENE_CLOSURE_SCENARIO_ID]?.case.walkerRole;
  if (!walkerRole) throw new Error("no frozen walkerRole for scene-closure scenario");
  const walker = bundle.actors.find((actor) => actor.role === walkerRole);
  if (!walker) throw new Error("no walker actor in bundle cast");

  let server: PortlessDevServer | null = null;
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-gpu-vsync",
        "--disable-frame-rate-limit",
        "--use-angle=metal",
        "--enable-gpu-rasterization",
        "--ignore-gpu-blocklist",
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
    await page.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
    });
    await installEnvironmentOverrideRoute(page, FINISHED_WARD_GLB);

    await page.goto(buildSceneClosureUrl(server.url), { waitUntil: "networkidle", timeout: 180_000 });
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
    await page.waitForTimeout(3000);
    await page.evaluate(HIDE_UI_SOURCE);
    await page.waitForTimeout(300);

    if ((process.env["STAGE2_DUMP_ONLY"] ?? "0") === "1") {
      const dump = await page.evaluate(DUMP_MESHES_SOURCE);
      process.stdout.write(`[dump] ${JSON.stringify(dump)}\n`);
      await browser.close();
      process.stdout.write("[done] stage-2 mesh dump (no captures)\n");
      return;
    }

    const stripped = await page.evaluate(HIDE_NON_ROOM_SOURCE);
    process.stdout.write(`[strip] non-room meshes hidden: ${JSON.stringify(stripped)}\n`);

    const poses = await loadPoses();
    process.stdout.write(
      `[poses] ${poses.length} pose(s)` +
        (process.env["STAGE2_POSES_FILE"] ? ` from ${process.env["STAGE2_POSES_FILE"]}` : " (built-in)") +
        "\n",
    );

    const manifest: Array<Record<string, unknown>> = [];
    const only = process.env["STAGE2_MULTIVIEW_ONLY"];
    for (const base of poses) {
      if (only && base.id !== only) continue;
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
      };
      if (!placed.ok) throw new Error(`camera placement failed for ${pose.id}: ${placed.reason}`);
      await page.waitForTimeout(400);
      const png = path.join(outputDir, `${pose.id}.png`);
      await page.screenshot({ path: png, fullPage: false });
      const pngBytes = await readFile(png);
      const pngSha256 = createHash("sha256").update(pngBytes).digest("hex");
      process.stdout.write(`[capture] ${pose.id} (${pngBytes.length} bytes, sha256=${pngSha256.slice(0, 12)}…)\n`);
      manifest.push({ ...pose, poseDx: POSE_DX, png, pngBytes: pngBytes.length, pngSha256 });
    }
    await writeFile(
      path.join(outputDir, "stage2-multiview.json"),
      `${JSON.stringify({ schemaVersion: "openclinxr.stage2-multiview.v1", glb: FINISHED_WARD_GLB, captures: manifest }, null, 2)}\n`,
      "utf8",
    );
    await browser.close();
    process.stdout.write("[done] stage-2 multiview captured\n");
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
