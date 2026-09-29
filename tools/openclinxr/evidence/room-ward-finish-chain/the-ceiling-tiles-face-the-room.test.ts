/**
 * OBSERVABLE: the room-clinic-finish ceiling tile field faces the room at the
 * pose-03 camera, not the flat-painted shell ceiling behind it.
 *
 * Defect (measured 2026-09-28 on the real chain, seed 205, before any fix):
 * compose.py hung the tile field off the POOLED cross-shell maxz (2.5298 m,
 * contributed by the exterior mesh's top cap), 11 cm above the shell ceiling
 * mesh's own plane -- bedroom_0/0.ceiling, a zero-thickness down-facing plane
 * at 2.42 m. The exported tiles (underside 2.4698 m) and troffer sat ~5 cm
 * ABOVE the visible plane, so a viewer inside the room saw the flat
 * wall-painted shell: the pose-03 center-pixel ray first-hit bedroom_00ceiling
 * at t=4.6627 with openclinxr_ceiling_tiles 12 cm behind it (t=4.7869) and
 * bedroom_00exterior third -- "built but not connected/visible". The material
 * audit stayed green throughout (both photo textures wired); only the
 * in-page raycast names the defect.
 *
 * Mechanism (no new convention): this test reuses the capture tooling's own
 * route -- portless ui-xr dev server, environment-GLB override served from a
 * locally built file, HIDE_NON_ROOM_SOURCE + PLACE_CAMERA_SOURCE copied
 * verbatim from ward-finish-chain-capture.ts (cited below), camera at pose
 * 03's exact eye/look/fov from hand-placed-poses.json, ray through the frame
 * center where the shipped captures read flat grey. The finished GLB is built
 * by the REAL compose.py (raw Blender spawn, same pattern as the S6
 * ceiling-troffer test -- zero package-internal imports) against a fixture
 * shell that mirrors the measured real shell: ward footprint 4.3 x 3.9 m,
 * down-facing ceiling plane at 2.4 m, exterior cap to 2.51 m, kept door leaf.
 * The page exposes no THREE namespace, so the in-page intersect is a manual
 * Moeller-Trumbore loop honoring material.side exactly as three.js
 * Mesh.raycast culls it; the loop was cross-validated against a real
 * three.js Raycaster on the real chain GLB (first/second/third hits agree to
 * 4 decimals: ceiling t=4.6627, tiles t=4.7869, exterior t=4.9365).
 *
 * RED (pre-fix): first hit is the shell ceiling mesh, not the tiles.
 * GREEN (post-fix): first hit is openclinxr_ceiling_tiles.
 *
 * Live Blender + vite dev server + headless chromium in this test; one
 * compose run and one page shared via beforeAll; timeout 10 min.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Document, NodeIO } from "@gltf-transform/core";
import { CASE_FROZEN_SCENE_PLANS } from "@openclinxr/asset-registry/case-frozen-scene-plans";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const execFileAsync = promisify(execFile);

// Measured real shell (seed-205 room-dimensions-fix chain GLB): ceiling plane
// 2.4 m, exterior top cap 2.51 m. The fixture mirrors both so the
// pooled-maxz defect replicates exactly: pre-fix tiles land at 2.45 m
// (hidden), post-fix at 2.34 m (visible).
const CEILING_PLANE = 2.4;
const EXTERIOR_TOP = 2.51;
const HX = 2.15;
const HZ = 1.95;
// Pose 03 verbatim from hand-placed-poses.json (three.js room-local coords,
// the same interpretation loadPoses gives the capture tooling).
const POSE_03 = { eye: { x: -0.2, y: 0.55, z: 0.3 }, look: { x: 0.8, y: 2.3, z: -1.6 }, fov: 62 };

function repoRoot(): string {
  let dir = path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

function boxPositions(min: [number, number, number], max: [number, number, number]): Float32Array {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return new Float32Array([
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ]);
}

const BOX_INDICES = new Uint16Array([
  0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
  0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
  2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
]);

async function writeFixtureGlb(outputPath: string): Promise<void> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const addBox = (name: string, min: [number, number, number], max: [number, number, number]): void => {
    const pos = doc.createAccessor().setType("VEC3").setArray(boxPositions(min, max)).setBuffer(buffer);
    const idx = doc.createAccessor().setType("SCALAR").setArray(BOX_INDICES).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute("POSITION", pos).setIndices(idx);
    const mesh = doc.createMesh(name).addPrimitive(prim);
    doc.createNode(name).setMesh(mesh);
  };
  // Floor slab, four walls, exterior cap, kept door leaf (compose.py fails
  // closed without a *.door_leaf object).
  addBox("bedroom_0/0.floor", [-HX, -0.05, -HZ], [HX, 0, HZ]);
  addBox("bedroom_0/0.wall", [-HX - 0.05, 0, -HZ - 0.05], [-HX + 0.05, CEILING_PLANE, HZ + 0.05]);
  addBox("bedroom_0/0.wall.001", [HX - 0.05, 0, -HZ - 0.05], [HX + 0.05, CEILING_PLANE, HZ + 0.05]);
  addBox("bedroom_0/0.wall.002", [-HX, 0, HZ - 0.05], [HX, CEILING_PLANE, HZ + 0.05]);
  addBox("bedroom_0/0.wall.003", [-HX, 0, -HZ - 0.05], [HX, CEILING_PLANE, -HZ + 0.05]);
  addBox("bedroom_0/0.exterior", [-HX - 0.065, -0.11, -HZ - 0.065], [HX + 0.065, EXTERIOR_TOP, HZ + 0.065]);
  addBox("bedroom_0/0.door_leaf", [-0.225, 0, -HZ - 0.045], [0.725, 2.1, -HZ + 0.045]);
  // The shell ceiling: a down-facing plane at the measured plane height, the
  // real shell's zero-thickness Circle.004. Winding [0,2,1 / 0,3,2] faces -Y.
  const cpos = doc.createAccessor().setType("VEC3").setArray(new Float32Array([
    -HX, CEILING_PLANE, -HZ, -HX, CEILING_PLANE, HZ,
    HX, CEILING_PLANE, HZ, HX, CEILING_PLANE, -HZ,
  ])).setBuffer(buffer);
  const cidx = doc.createAccessor().setType("SCALAR").setArray(new Uint16Array([0, 2, 1, 0, 3, 2])).setBuffer(buffer);
  const cprim = doc.createPrimitive().setAttribute("POSITION", cpos).setIndices(cidx);
  const cmesh = doc.createMesh("bedroom_0/0.ceiling").addPrimitive(cprim);
  doc.createNode("bedroom_0/0.ceiling").setMesh(cmesh);
  await new NodeIO().write(outputPath, doc);
}

function recipeJson(): string {
  return `${JSON.stringify(
    {
      schemaVersion: "openclinxr.room-clinic-finish.v1",
      environmentId: "inpatient_ward_room_v1",
      preset: "ward_photo",
      seed: 7,
      palette: {
        wallAlbedo: [0.9, 0.9, 0.88],
        trimAlbedo: [0.96, 0.96, 0.94],
        accentAlbedo: [0.25, 0.5, 0.68],
        roughness: 0.8,
        signageAnchors: ["door_header", "bed_wall"],
      },
      modules: [
        { module: "ceiling", version: "clinic-finish-ceiling-v1" },
        { module: "floor", version: "clinic-finish-floor-v1" },
        { module: "door", version: "clinic-finish-door-v1" },
        { module: "corridor_cues", version: "clinic-finish-corridor-cues-v1" },
        { module: "geometry", version: "clinic-finish-geometry-v1" },
      ],
      light: { exposure: "xr", floorResponse: "xt_matte" },
      options: { crashRail: false },
      finishPassLlm: false,
    },
    null,
    2,
  )}\n`;
}

// Verbatim from ward-finish-chain-capture.ts (PLACE_CAMERA_SOURCE): room-local
// pose transformed by the room root's live world matrix, no capture-side reseat.
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

// Verbatim from ward-finish-chain-capture.ts (HIDE_NON_ROOM_SOURCE): ancestry
// keep under the override GLB root, everything else hides.
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
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (keepSet.has(o)) { kept += 1; return; }
    o.visible = false;
    hidden += 1;
  });
  return { ok: true, kept, hidden };
})()
`;

// In-page center-pixel intersect. The page exposes no THREE namespace, so this
// is a manual Moeller-Trumbore loop over the room subtree honoring
// material.side (0 FrontSide / 1 BackSide / 2 DoubleSide) exactly as three.js
// Mesh.raycast culls it, using only instance methods (clone/unproject) so no
// constructor access is needed. Cross-validated against a real three.js
// Raycaster on the real chain GLB (ceiling t=4.6627, tiles t=4.7869,
// exterior t=4.9365 -- agreement to 4 decimals).
const RAYCAST_SOURCE = `
((ndc) => {
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
    scene.updateMatrixWorld(true);
    const eye = cam.getWorldPosition(cam.position.clone());
    const p = cam.position.clone();
    p.set(ndc.x, ndc.y, 0.5);
    p.unproject(cam);
    const dir = p.sub(eye).normalize();
    const ox = eye.x, oy = eye.y, oz = eye.z;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    const hits = [];
    const EPS = 1e-9;
    room.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const g = o.geometry;
      if (!g || !g.attributes || !g.attributes.position) return;
      const pos = g.attributes.position;
      const idx = g.index ? g.index.array : null;
      const e = o.matrixWorld.elements;
      const tx = (x, y, z) => [e[0]*x + e[4]*y + e[8]*z + e[12], e[1]*x + e[5]*y + e[9]*z + e[13], e[2]*x + e[6]*y + e[10]*z + e[14]];
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const side = (mats[0] && typeof mats[0].side === "number") ? mats[0].side : 0;
      const triCount = idx ? idx.length / 3 : pos.count / 3;
      for (let t = 0; t < triCount; t++) {
        const vi = idx ? [idx[t*3], idx[t*3+1], idx[t*3+2]] : [t*3, t*3+1, t*3+2];
        const a = tx(pos.getX(vi[0]), pos.getY(vi[0]), pos.getZ(vi[0]));
        const b = tx(pos.getX(vi[1]), pos.getY(vi[1]), pos.getZ(vi[1]));
        const c = tx(pos.getX(vi[2]), pos.getY(vi[2]), pos.getZ(vi[2]));
        const e1x = b[0]-a[0], e1y = b[1]-a[1], e1z = b[2]-a[2];
        const e2x = c[0]-a[0], e2y = c[1]-a[1], e2z = c[2]-a[2];
        const px = dy*e2z - dz*e2y, py = dz*e2x - dx*e2z, pz = dx*e2y - dy*e2x;
        const det = e1x*px + e1y*py + e1z*pz;
        if (side === 0 && det < EPS) continue;
        if (side === 1 && det > -EPS) continue;
        if (Math.abs(det) < EPS) continue;
        const inv = 1 / det;
        const txv = ox-a[0], tyv = oy-a[1], tzv = oz-a[2];
        const u = (txv*px + tyv*py + tzv*pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = tyv*e1z - tzv*e1y, qy = tzv*e1x - txv*e1z, qz = txv*e1y - tyv*e1x;
        const v = (dx*qx + dy*qy + dz*qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const tt = (e2x*qx + e2y*qy + e2z*qz) * inv;
        if (tt < 0.001) continue;
        hits.push({ name: o.name || "(unnamed)", t: tt,
          point: [ox + dx*tt, oy + dy*tt, oz + dz*tt] });
      }
    });
    hits.sort((h1, h2) => h1.t - h2.t);
    const ordered = [];
    for (const h of hits) {
      if (ordered.length >= 12) break;
      if (ordered.length === 0 || ordered[ordered.length-1].name !== h.name) {
        ordered.push({ name: h.name, t: h.t, point: h.point });
      }
    }
    return { ok: true, first: hits[0] ?? null, hitCount: hits.length, ordered };
  } catch (err) {
    return { ok: false, reason: "exception: " + (err?.message ?? String(err)) };
  }
})
`;

type RayHit = { name: string; t: number; point: [number, number, number] };
type RayResult =
  | { ok: true; first: RayHit | null; hitCount: number; ordered: RayHit[] }
  | { ok: false; reason: string };

let ray: RayResult | null = null;
let server: PortlessDevServer | null = null;
let browser: Browser | null = null;

async function composeFixture(): Promise<{ workGlb: string; report: Record<string, unknown> }> {
  const root = repoRoot();
  const work = path.join(tmpdir(), `ceiling-facing-${process.pid}`);
  await mkdir(work, { recursive: true });
  const fixture = path.join(work, "fixture.glb");
  const workGlb = path.join(work, "work.glb");
  const recipePath = path.join(work, "recipe.json");
  const reportPath = path.join(work, "report.json");
  await writeFixtureGlb(fixture);
  await writeFile(workGlb, await readFile(fixture));
  await writeFile(recipePath, recipeJson(), "utf8");
  await execFileAsync(
    "blender",
    [
      "--background",
      "--python",
      path.join(root, "packages/openclinxr/factory-stations/src/room_clinic_finish/compose.py"),
      "--",
      "--input",
      workGlb,
      "--output",
      workGlb,
      "--recipe-json",
      recipePath,
      "--report",
      reportPath,
    ],
    { timeout: 300_000 },
  );
  const report = JSON.parse(await readFile(reportPath, "utf8")) as Record<string, unknown>;
  return { workGlb, report };
}

describe("the ceiling tiles face the room at the pose-03 camera", () => {
  beforeAll(async () => {
    const { workGlb } = await composeFixture();
    const bytes = await readFile(workGlb);
    const bundleJson = buildSceneClosureBundleJson();
    const bundle = JSON.parse(bundleJson) as { actors: Array<{ actorId: string; role: string }> };
    const walkerRole = CASE_FROZEN_SCENE_PLANS[SCENE_CLOSURE_SCENARIO_ID]?.case.walkerRole;
    if (!walkerRole) throw new Error("no frozen walkerRole for scene-closure scenario");
    const walker = bundle.actors.find((actor) => actor.role === walkerRole);
    if (!walker) throw new Error("no walker actor in bundle cast");

    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-gpu-vsync",
        "--disable-frame-rate-limit",
        "--use-angle=metal",
        "--enable-gpu-rasterization",
        "--ignore-gpu-blocklist",
      ],
    });
    const page: Page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
    await page.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
    });
    await page.route("**/xr-assets/environment/infinigen-inpatient-ward.glb", async (route) => {
      await route.fulfill({ status: 200, contentType: "model/gltf-binary", body: bytes });
    });
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
    const stripped = (await page.evaluate(HIDE_NON_ROOM_SOURCE)) as { ok: boolean; kept?: number };
    if (!stripped.ok) throw new Error(`room hide failed: ${JSON.stringify(stripped)}`);
    const placed = (await page.evaluate(`${PLACE_CAMERA_SOURCE}(${JSON.stringify(POSE_03)})`)) as {
      ok: boolean;
      reason?: string;
    };
    if (!placed.ok) throw new Error(`camera placement failed: ${placed.reason}`);
    await page.waitForTimeout(400);
    ray = (await page.evaluate(`${RAYCAST_SOURCE}(${JSON.stringify({ x: 0, y: 0 })})`)) as RayResult;
  }, 600_000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await stopPortlessDevServer(server.proc);
    browser = null;
    server = null;
  });

  it("the frame-center ray first hits the tile field, not the shell ceiling", async () => {
    expect(ray, "beforeAll raycast produced a result").not.toBeNull();
    if (ray === null || !ray.ok) throw new Error(`in-page raycast failed: ${JSON.stringify(ray)}`);
    expect(
      ray.first,
      `expected at least one room hit along the pose-03 center ray (ordered: ${JSON.stringify(ray.ordered)})`,
    ).not.toBeNull();
    expect(
      ray.first!.name,
      `pose-03 center ray first hits ${ray.first!.name} at ${JSON.stringify(ray.first!.point)} ` +
        `(ordered: ${JSON.stringify(ray.ordered)}); the tile field is built but hidden behind the shell`,
    ).toBe("openclinxr_ceiling_tiles");
  }, 120_000);
});

// NOT TESTED: runtime tone-mapped appearance (covered by the pose captures);
// the troffer at this pixel (the lens sits near the room center, off this ray).
