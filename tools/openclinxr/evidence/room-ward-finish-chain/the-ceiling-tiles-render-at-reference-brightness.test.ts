/**
 * OBSERVABLE: the ceiling tiles render at the v2 reference brightness when
 * viewed through the real ui-xr three.js runtime (ACESFilmicToneMapping),
 * not just as albedo bytes on disk.
 *
 * Defect (graded 2026-09-28 on real chain seed-205 runtime captures,
 * poses 03/05 at native resolution): pinning the tile albedo to the
 * lit-photo mean (159.8, 159.8, 153.8) rendered as dark mid-grey -- clean
 * tile-interior box (600,95,655,145) on the pose-03 runtime capture
 * measured mean (134.1, 129.4, 124.8), deltas (-25.6, -30.4, -29.2)
 * against the reference, with speckle minified away to stddev ~0.8.
 * Albedo and a lit photo are not the same thing: runtime lighting plus
 * ACES pull a flat albedo down by ~0.81x, so the albedo must sit ~1.21x
 * ABOVE the lit target (calibrated baseline 192.9, 192.9, 185.5).
 *
 * Mechanism (no new convention): this test reuses the capture tooling's own
 * route -- portless ui-xr dev server, environment-GLB override served from
 * a locally composed file, HIDE_NON_ROOM_SOURCE + PLACE_CAMERA_SOURCE copied
 * verbatim from ward-finish-chain-capture.ts (cited below), camera at pose
 * 03's exact eye/look/fov from hand-placed-poses.json -- against a fixture
 * shell that mirrors the measured real shell (ward footprint 4.3 x 3.9 m,
 * down-facing ceiling plane at 2.4 m, exterior cap to 2.51 m, kept door
 * leaf), composed by the REAL compose.py with the REAL repo tile texture
 * (raw Blender spawn, same pattern as the ceiling-facing test -- zero
 * package-internal imports). The finished pixels are measured on the
 * screenshot (PIL/numpy box stats on temp files), never on the texture
 * bytes: an albedo-only assertion is exactly what shipped this defect.
 *
 * TILE_BOX provenance: pinned from the test's own fixture screenshot
 * (.openclinxr/evidence/ceiling-tile-calibration/fixture-pose03.png,
 * saved by every run): a clean tile-interior patch with no grid line, no
 * troffer, no wall. The grid is real strip geometry from deterministic
 * compose output, so the box is stable across texture-byte changes.
 *
 * RED (albedo 159.8, verified by byte-swap run): this test's own fixture
 * screenshot measures box mean R 133.7 (delta -26.0, outside +/-8) and box
 * stddev R 0.76 (below the >= 2 floor) -- both cases fail. The real chain
 * agrees: clean tile-interior box (600,95,655,145) on the seed-205 pose-03
 * runtime capture measures mean (134.1, 129.4, 124.8), deltas
 * (-25.6, -30.4, -29.2), stddev ~0.8.
 * GREEN (albedo 192.9): box mean inside +/-8 per channel of the reference
 * (fixture box (164.4,160.1,155.8); chain box (165.0,160.5,156.1));
 * box stddev >= 2 per channel (fixture (2.83,2.84,2.98); chain
 * (3.20,3.25,3.39)).
 *
 * Live Blender + vite dev server + headless chromium in this test; one
 * compose run, one server, one page, and one screenshot shared via
 * beforeAll; timeout 10 min.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { withComputeSlot } from "@openclinxr/compute-slots";
import { Document, NodeIO } from "@gltf-transform/core";
import { type Browser, chromium, type Page } from "../lib/slotted-playwright.js";
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
} from "../scene-closure/proofs/sc-05/ui-xr-bedside-approach-capture.ts";

const execFileAsync = promisify(execFile);

// Reader correction 2026-09-29: the historical camera above predates the
// hand-placed pose refit. Same renderer/ACES/exposure/rig; change camera and
// matched surface box, NOT albedo. Both boxes now match ceiling-measurements.py.
// Re-derived from ceiling-measurements.py's exact pose-03 reference box.
const REF_MEAN = [166.25190476190477, 165.92238095238096, 160.54857142857142] as const;
const MEAN_TOLERANCE = 8;
const STDDEV_FLOOR = 2;
const WARM_GAP_MIN = -2;
const WARM_GAP_MAX = 14;

// Exact accepted runtime/reference pose-03 tile patch, no grid/troffer pixels.
const TILE_BOX = { x0: 275, y0: 330, x1: 335, y1: 365 };

// Measured real shell (seed-205 room-dimensions-fix chain GLB): ceiling plane
// 2.4 m, exterior top cap 2.51 m. Mirrors the ceiling-facing test fixture.
const CEILING_PLANE = 2.4;
const EXTERIOR_TOP = 2.51;
const HX = 2.15;
const HZ = 1.95;
// Pose 03 verbatim from hand-placed-poses.json (three.js room-local coords,
// the same interpretation loadPoses gives the capture tooling).
const POSE_03 = { eye: { x: -0.5, y: 0.4, z: 0.9 }, look: { x: 0, y: 2.25, z: -0.5 }, fov: 50 };

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
  0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
  0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
  2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
]);

async function writeFixtureGlb(outputPath: string): Promise<void> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  // Match the chain's authored materials; bare fixture slabs trigger the
  // runtime's legacy missing-wall repair before a ceiling can be measured.
  const shellMaterial = doc.createMaterial("fixture_shell_dielectric").setMetallicFactor(0).setRoughnessFactor(0.9);
  const addBox = (name: string, min: [number, number, number], max: [number, number, number]): void => {
    const pos = doc.createAccessor().setType("VEC3").setArray(boxPositions(min, max)).setBuffer(buffer);
    const idx = doc.createAccessor().setType("SCALAR").setArray(BOX_INDICES).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute("POSITION", pos).setIndices(idx).setMaterial(shellMaterial);
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
  const cprim = doc.createPrimitive().setAttribute("POSITION", cpos).setIndices(cidx).setMaterial(shellMaterial);
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
    return { ok: true };
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

// Box stats measured on the RUNTIME screenshot (PIL/numpy on temp files):
// the rendered tile interior mean/stddev, never the texture bytes.
const BOX_STATS_DRIVER = `
import sys
import numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert("RGB"), dtype=np.float64)
x0, y0, x1, y1 = (int(sys.argv[i]) for i in (2, 3, 4, 5))
crop = a[y0:y1, x0:x1]
mean = crop.mean(axis=(0, 1))
std = crop.std(axis=(0, 1))
print("mean=%.4f,%.4f,%.4f std=%.4f,%.4f,%.4f" % (
    float(mean[0]), float(mean[1]), float(mean[2]),
    float(std[0]), float(std[1]), float(std[2])))
`;

type Shot = { pngPath: string; mean: [number, number, number]; std: [number, number, number] };
let shot: Shot | null = null;
let server: PortlessDevServer | null = null;
let browser: Browser | null = null;

async function boxStats(pngPath: string, work: string): Promise<Pick<Shot, "mean" | "std">> {
  const driverPath = path.join(work, "box-stats.py");
  await writeFile(driverPath, BOX_STATS_DRIVER, "utf8");
  const result = await execFileAsync(
    "python3",
    [driverPath, pngPath, String(TILE_BOX.x0), String(TILE_BOX.y0), String(TILE_BOX.x1), String(TILE_BOX.y1)],
    { timeout: 120_000 },
  );
  const match = /mean=([0-9.]+),([0-9.]+),([0-9.]+) std=([0-9.]+),([0-9.]+),([0-9.]+)/.exec(result.stdout);
  expect(match, `box-stats driver printed measurements (stdout: ${result.stdout.slice(-500)})`).not.toBeNull();
  return {
    mean: [Number(match![1]), Number(match![2]), Number(match![3])],
    std: [Number(match![4]), Number(match![5]), Number(match![6])],
  };
}

describe("the ceiling tiles render at the reference brightness", () => {
  beforeAll(async () => {
    const root = repoRoot();
    const work = path.join(tmpdir(), `ceiling-brightness-${process.pid}`);
    await mkdir(work, { recursive: true });
    const fixture = path.join(work, "fixture.glb");
    const workGlb = path.join(work, "work.glb");
    const recipePath = path.join(work, "recipe.json");
    const reportPath = path.join(work, "report.json");
    await writeFixtureGlb(fixture);
    await writeFile(workGlb, await readFile(fixture));
    await writeFile(recipePath, recipeJson(), "utf8");
    await withComputeSlot("blender", { label: "test:ward-ceiling-brightness" }, () => execFileAsync(
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
    ));
    // Optional reader input: retain the rendered-pixel assertions for a completed chain GLB.
    const bytes = await readFile(process.env.WARD_PROPERTY_GLB ?? workGlb);
    const bundleJson = buildSceneClosureBundleJson();

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
    page.on("pageerror", (error) => process.stderr.write(`[ceiling-runtime] ${error.message}\n`));
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
    // Verbatim from ward-finish-chain-capture.ts (HIDE_UI_SOURCE): hide the
    // station UI so the canvas fills the full 1280x720 frame, matching the
    // chain captures the reference numbers are measured against.
    await page.evaluate(`
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
`);
    await page.waitForTimeout(300);
    const stripped = (await page.evaluate(HIDE_NON_ROOM_SOURCE)) as { ok: boolean; kept?: number };
    if (!stripped.ok) throw new Error(`room hide failed: ${JSON.stringify(stripped)}`);
    const placed = (await page.evaluate(`${PLACE_CAMERA_SOURCE}(${JSON.stringify(POSE_03)})`)) as {
      ok: boolean;
      reason?: string;
    };
    if (!placed.ok) throw new Error(`camera placement failed: ${placed.reason}`);
    await page.waitForTimeout(400);
    const pngPath = path.join(root, ".openclinxr/evidence/ceiling-tile-calibration/fixture-pose03.png");
    await page.screenshot({ path: pngPath, fullPage: false });
    const { mean, std } = await boxStats(pngPath, work);
    shot = { pngPath, mean, std };
  }, 600_000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await stopPortlessDevServer(server.proc);
    browser = null;
    server = null;
  });

  it("the rendered tile interior lands within tolerance of the v2 reference mean", async () => {
    expect(shot, "beforeAll screenshot produced measurements").not.toBeNull();
    process.stdout.write(
      `fixture pose-03 tile box mean=(${shot!.mean.map((v) => v.toFixed(1)).join(",")}) ` +
        `std=(${shot!.std.map((v) => v.toFixed(2)).join(",")})\n`,
    );
    for (const [index, channel] of ["R", "G", "B"].entries()) {
      expect(
        Math.abs(shot!.mean[index]! - REF_MEAN[index]!),
        `rendered tile ${channel} mean ${shot!.mean[index]!.toFixed(1)} is outside +/-${MEAN_TOLERANCE} of reference ${REF_MEAN[index]!.toFixed(1)} (albedo-vs-lit mismatch: the albedo must sit above the lit target)`,
      ).toBeLessThanOrEqual(MEAN_TOLERANCE);
    }
    for (const [label, gap] of [
      ["R-B", shot!.mean[0]! - shot!.mean[2]!],
      ["G-B", shot!.mean[1]! - shot!.mean[2]!],
    ] as const) {
      expect(
        gap,
        `rendered tile warm gap ${label}=${gap.toFixed(1)} is outside [${WARM_GAP_MIN},${WARM_GAP_MAX}] (tinted albedo, not neutral warm-white)`,
      ).toBeGreaterThanOrEqual(WARM_GAP_MIN);
      expect(
        gap,
        `rendered tile warm gap ${label}=${gap.toFixed(1)} is outside [${WARM_GAP_MIN},${WARM_GAP_MAX}] (tinted albedo, not neutral warm-white)`,
      ).toBeLessThanOrEqual(WARM_GAP_MAX);
    }
  }, 120_000);

  it("the rendered tile interior carries visible speckle", async () => {
    expect(shot, "beforeAll screenshot produced measurements").not.toBeNull();
    for (const [index, channel] of ["R", "G", "B"].entries()) {
      expect(
        shot!.std[index]!,
        `rendered tile ${channel} stddev is below the ${STDDEV_FLOOR} floor (speckle minified away: size the albedo noise to survive runtime filtering)`,
      ).toBeGreaterThanOrEqual(STDDEV_FLOOR);
    }
  }, 120_000);
});

// NOT TESTED: raw albedo PNG bytes in isolation (an albedo-only assertion
// shipped this defect); the full-chain seed-205 captures live under
// .openclinxr/evidence/ceiling-tile-calibration/ as the chain-level proof.
