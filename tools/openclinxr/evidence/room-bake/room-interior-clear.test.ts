import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { KHRTextureTransform } from "@gltf-transform/extensions";
import { describe, expect, it } from "vitest";
import {
  floorSlabExtents,
  interiorClearFromWorldTriangles,
  measureInteriorClear,
  type Tri,
  type V3,
  wallWorldTriangles,
} from "./room-interior-clear.js";

/**
 * **The interior-clear instrument reads wall inner faces, never the floor AABB.**
 *
 * The finished-room shell floor runs through the doorway opening to the outer wall face (the threshold
 * tab, +0.11 m on the door wall only). The wall inner faces land the `configure()` interior-clear contract
 * (interior clear floor W x D centred on origin) exactly on both axes, fleet-wide — verified by the
 * facade-executed Blender probe on the real chain bytes (inpatient interiorClear 4.300 x 3.900 exact; only
 * in-door-band floor verts reach the outer face) and re-measured here in the shipped GLB world frame.
 *
 * This suite pins that behaviour: real rooms measure their recipe footprint from wall geometry alone (no
 * recipe import in the instrument, no wall-thickness subtraction), the tab is confined to the door band by
 * a structural assertion (no fitted constant), and expanded/malformed walls fail instead of passing.
 *
 * claimScope: wall-inner-face measurement on shipped finished-room GLBs + synthetic plane fixtures.
 * notEvidenceFor: extract-time gating, pixel grade, clinical adequacy.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const ENV_DIR = join(REPO_ROOT, "apps/ui-xr/public/xr-assets/environment");
const RECIPES_SRC = join(REPO_ROOT, "packages/openclinxr/factory-stations/src/room_chain/recipes.ts");

/** Recipe declaration, text-parsed as evidence (never imported, never used AS the measurement). */
function recipeFootprint(env: string): { width: number; depth: number } {
  const src = readFileSync(RECIPES_SRC, "utf8");
  const m = new RegExp(
    `${env}:\\s*\\{(?:[^{}]|\\{[^{}]*\\})*?footprintMeters:\\s*\\{\\s*width:\\s*([0-9.]+),\\s*depth:\\s*([0-9.]+),`,
    "u",
  ).exec(src);
  expect(m, `recipe footprint present for ${env}`).not.toBeNull();
  return { width: Number(m![1]), depth: Number(m![2]) };
}

const GLBS: Record<string, string> = {
  ed_exam_bay_v1: join(ENV_DIR, "infinigen-ed-exam-bay.glb"),
  pediatric_urgent_care_bay_v1: join(ENV_DIR, "infinigen-pediatric-urgent-care-bay.glb"),
  inpatient_ward_room_v1: join(ENV_DIR, "infinigen-inpatient-ward.glb"),
  stepdown_room_v1: join(ENV_DIR, "infinigen-stepdown.glb"),
};

// --- synthetic wall-plane fixtures (world frame, metres) -------------------------------------

function quad(a: V3, b: V3, c: V3, d: V3): Tri[] {
  return [
    [a, b, c],
    [a, c, d],
  ];
}

/** Rectangle in plane z=z0, x in [x0,x1], y in [y0,y1]; normal +/-Z. */
function rectZ(z0: number, x0: number, x1: number, y0: number, y1: number, normal: "+z" | "-z"): Tri[] {
  const a: V3 = [x0, y0, z0];
  const b: V3 = [x1, y0, z0];
  const c: V3 = [x1, y1, z0];
  const d: V3 = [x0, y1, z0];
  return normal === "+z" ? quad(a, b, c, d) : [[a, c, b], [a, d, c]];
}

/** Rectangle in plane x=x0, y in [y0,y1], z in [z0,z1]; normal +/-X. */
function rectX(x0: number, y0: number, y1: number, z0: number, z1: number, normal: "+x" | "-x"): Tri[] {
  const a: V3 = [x0, y0, z0];
  const b: V3 = [x0, y0, z1];
  const c: V3 = [x0, y1, z1];
  const d: V3 = [x0, y1, z0];
  return normal === "-x" ? quad(a, b, c, d) : [[a, c, b], [a, d, c]];
}

/** Four upright walls of a w x d room, height h, outward normals (normal direction is not read). */
function boxWalls(w: number, d: number, h: number): Tri[] {
  return [
    ...rectZ(d / 2, -w / 2, w / 2, 0, h, "+z"),
    ...rectZ(-d / 2, -w / 2, w / 2, 0, h, "-z"),
    ...rectX(w / 2, 0, h, -d / 2, d / 2, "+x"),
    ...rectX(-w / 2, 0, h, -d / 2, d / 2, "-x"),
  ];
}

describe("room interior clear from wall inner faces", () => {
  it("measures the recipe footprint from wall geometry alone (ED, peds, inpatient, stepdown)", async () => {
    for (const [env] of Object.entries(GLBS)) {
      const glb = GLBS[env]!;
      expect(existsSync(glb), `${glb} exists`).toBe(true);
      const doc = await new NodeIO().registerExtensions([KHRTextureTransform]).readBinary(readFileSync(glb));
      const clear = measureInteriorClear(doc);
      const recipe = recipeFootprint(env);
      // 0.02 band is the probe's own --expect-tol default (the footprint-test band), not fitted here.
      expect(clear.width, `${env} interior-clear width vs recipe ${recipe.width}`).toBeCloseTo(recipe.width, 2);
      expect(clear.depth, `${env} interior-clear depth vs recipe ${recipe.depth}`).toBeCloseTo(recipe.depth, 2);
    }
  });

  it("keeps the raw floor slab as a diagnostic: the tab is confined to the door band (ED, inpatient)", async () => {
    for (const env of ["ed_exam_bay_v1", "inpatient_ward_room_v1"] as const) {
      const doc = await new NodeIO()
        .registerExtensions([KHRTextureTransform])
        .readBinary(readFileSync(GLBS[env]!));
      const clear = measureInteriorClear(doc);
      const slab = floorSlabExtents(doc);
      expect(slab, `${env} shell floor present`).not.toBeNull();
      // Floor width is exact everywhere; only the door-wall depth carries the tab.
      expect(slab!.width, `${env} slab width == clear width`).toBeCloseTo(clear.width, 2);
      expect(slab!.depth, `${env} slab depth exceeds clear depth (the tab)`).toBeGreaterThan(clear.depth);

      // Door band derived from the measured door-casing centroid + span — no pinned offset.
      let casingMinX = Infinity;
      let casingMaxX = -Infinity;
      let casingCX = 0;
      let casingCZ = 0;
      let casingCount = 0;
      for (const node of doc.getRoot().listNodes()) {
        if (!/door_casing$/iu.test(node.getName())) continue;
        const mesh = node.getMesh();
        if (!mesh) continue;
        const t = node.getWorldMatrix();
        for (const prim of mesh.listPrimitives()) {
          const arr = prim.getAttribute("POSITION")?.getArray();
          if (!arr) continue;
          for (let i = 0; i < arr.length; i += 3) {
            const wx = t[0]! * arr[i]! + t[4]! * arr[i + 1]! + t[8]! * arr[i + 2]! + t[12]!;
            const wz = t[2]! * arr[i]! + t[6]! * arr[i + 1]! + t[10]! * arr[i + 2]! + t[14]!;
            if (wx < casingMinX) casingMinX = wx;
            if (wx > casingMaxX) casingMaxX = wx;
            casingCX += wx;
            casingCZ += wz;
            casingCount += 1;
          }
        }
      }
      expect(casingCount, `${env} door casing measured`).toBeGreaterThan(0);
      casingCX /= casingCount;
      casingCZ /= casingCount;
      const halfBand = (casingMaxX - casingMinX) / 2;
      const centreZ = (clear.faces["+z"] + clear.faces["-z"]) / 2;
      const doorSide: "+z" | "-z" = casingCZ >= centreZ ? "+z" : "-z";
      const otherSide: "+z" | "-z" = doorSide === "+z" ? "-z" : "+z";

      // Structural confinement: outside the casing band the floor peaks exactly at the inner faces;
      // inside the band it reaches past the door-side face (the tab) and never past the far face.
      const outside: number[] = [];
      const inside: number[] = [];
      for (const tri of wallWorldTriangles(doc, (name) => /floor$/iu.test(name))) {
        for (const v of tri) {
          (Math.abs(v[0] - casingCX) > halfBand ? outside : inside).push(v[2]);
        }
      }
      expect(outside.length, `${env} floor verts outside the door band`).toBeGreaterThan(0);
      expect(inside.length, `${env} floor verts inside the door band`).toBeGreaterThan(0);
      const doorExtreme = doorSide === "+z" ? Math.max(...outside) : Math.min(...outside);
      const farExtreme = doorSide === "+z" ? Math.min(...outside) : Math.max(...outside);
      expect(doorExtreme, `${env} floor outside band == ${doorSide} (door-side) inner face`).toBeCloseTo(
        clear.faces[doorSide],
        2,
      );
      expect(farExtreme, `${env} floor outside band == ${otherSide} (far) inner face`).toBeCloseTo(
        clear.faces[otherSide],
        2,
      );
      const tabReach = doorSide === "+z" ? Math.max(...inside) - clear.faces[doorSide] : clear.faces[doorSide] - Math.min(...inside);
      expect(tabReach, `${env} in-band tab reaches past the door-side inner face`).toBeGreaterThan(0.05);
      const farOver =
        otherSide === "+z" ? Math.max(...inside) - clear.faces[otherSide] : clear.faces[otherSide] - Math.min(...inside);
      expect(farOver, `${env} in-band floor never passes the far inner face`).toBeLessThanOrEqual(0.002);
    }
  });

  it("RED: an actually expanded wall fails the recipe comparison (no silent pass)", () => {
    const recipe = recipeFootprint("inpatient_ward_room_v1");
    const expanded = boxWalls(recipe.width, recipe.depth + 0.3, 2.4);
    const clear = interiorClearFromWorldTriangles(expanded);
    expect(clear.depth, "expanded wall measures its true (larger) depth").toBeCloseTo(recipe.depth + 0.3, 2);
    expect(clear.depth, "expanded wall must NOT match the recipe").not.toBeCloseTo(recipe.depth, 2);
  });

  it("RED: a missing wall plane errors fail-closed (never defaults from the declaration)", () => {
    const withoutMinusX = boxWalls(5, 4, 2.4).filter((tri) => {
      const xs = tri.map((v) => v[0]);
      return !(Math.max(...xs) < 0 && Math.min(...xs) < 0 && Math.abs(Math.min(...xs) + 2.5) < 0.001);
    });
    expect(() => interiorClearFromWorldTriangles(withoutMinusX)).toThrow(/missing large-area wall face/);
  });

  it("RED: sub-threshold planes error (doorway trim alone names no wall)", () => {
    expect(() => interiorClearFromWorldTriangles(boxWalls(0.5, 0.5, 0.5))).toThrow(/missing large-area wall face/);
  });

  it("measures geometry, not the declaration: a non-recipe box returns its own dims", () => {
    const clear = interiorClearFromWorldTriangles(boxWalls(5, 4, 2.4));
    expect(clear.width).toBeCloseTo(5, 3);
    expect(clear.depth).toBeCloseTo(4, 3);
  });
});
