import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Every shipped environment renders as an untextured, unlit hull. The reflex is to blame polygon
 * budget. MEASURED 2026-08-12, that is false by four orders of magnitude:
 *
 *   asset                                    tris        meshes  materials  textured  lights
 *   ---------------------------------------- ----------- ------  ---------  --------  ------
 *   parametric ed-exam-bay-shell.glb                 492      41         15    **0**       0
 *   infinigen-ed-exam-bay.glb (SHIPPED)              440       4          3    **0**   **0**
 *   infinigen dining-room (generator, raw)    15,650,564     159        175       13       6
 *
 * We ship **440 triangles of a 15,650,564-triangle generator output** — 1 in 35,570. The only
 * budget anywhere near this is the Quest ~180k target, never validated on hardware, and the standing
 * directive is explicit that NO generated output is gated on triangle count because meshoptimizer
 * runs later in the pipeline. So 440 is not a budget decision; it is what the hull extraction kept.
 *
 * The defect is three zeros: **zero textures, zero lights, three materials.** A 492-triangle room
 * with baked albedo and ambient occlusion reads as a room; a 50,000-triangle untextured one still
 * reads as a toy. Geometry is not what is missing.
 *
 * THE KNOWN-GOOD COLUMN IS IN THIS REPO, ON THE SAME EXPORTER: #340 put a 610,817 B iris texture on
 * every actor's eyes and #343 put a 738,178 B Cycles-baked skin texture on every body, both surviving
 * glTF export from Blender 5.1. The humanoid rail proves the texture path works end to end. The
 * environment rail has never used it.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-12 before planting:
 *
 *   treatment                                     | (1) textured | (2) not a fill | (3) geometry untouched | result
 *   ----------------------------------------------|--------------|----------------|------------------------|--------
 *   a) today — flat colours, no texture            |  **FAIL**    |   **FAIL**     |         pass           | REFUSED
 *   b) add another flat baseColorFactor material   |  **FAIL**    |   **FAIL**     |         pass           | REFUSED
 *   c) subdivide the room to "add detail"          |  **FAIL**    |   **FAIL**     |       **FAIL**         | REFUSED
 *   d) bake albedo + AO to a baseColorTexture      |    pass      |     pass       |         pass           | ALL PASS
 *
 * (b) is the #337/#338 flat-eye loop exactly: two slices in a row adjusted a uniform colour and the
 * subject got no closer to looking real, until #340 consumed a real texture. Clause (2) refuses a
 * third rehearsal of it — a fill has one colour and a baked room does not.
 *
 * (c) is the trap this whole header exists to close. Throwing triangles at a flat-lit box is the
 * expensive way to stay a toy, and it also violates the no-triangle-gating directive from the other
 * side. Clause (3) pins triangle count as NOT the axis under change.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail on every shipped
 * environment today. (3) PASSES today and is a regression net — it must keep passing, and a fix that
 * satisfies (1) by inflating geometry is not a fix.
 *
 * TWO MORE REDS, added 2026-08-12 by #347 (MADR 0055 items 4+5). They are separate assertions with
 * separate cheap-fix refusals (§8i — one green must not stand for both):
 *
 *   (4) TRIM: the PARAMETRIC shell (`ed-exam-bay-shell.glb`) carries skirting boards, chamfered
 *       corners and a door reveal frame. The chamfer nodes must be triangular prisms (8 tris), NOT
 *       renamed cubes (12 tris) — and the whole-room triangle net (3) refuses chamfering by
 *       subdividing the wall. The Infinigen room is a different lane (#346) and is not measured here.
 *   (5) SCALE-SETTING PROPS: the parametric shell carries recognisable multi-part props — outlet
 *       plate, light switch, hand-gel dispenser, whiteboard, curtain track — at real-world sizes
 *       (the eye calibrates room size from objects of known size). A flat-coloured box labelled
 *       "outlet_plate" sets no scale: every prop root must have >= 2 part meshes and known-size
 *       anchors (outlet < 0.2 m, track > 1.0 m, board > 0.5 m).
 *
 * NOT TESTED, and this is the scope statement:
 *   - No pixel is graded here. This asserts the MATERIAL CHANNEL only. A room can carry a texture and
 *     still look wrong — wrong palette, wrong scale, no trim, no contact shadows.
 *   - It does not assert LIGHTS or a lightmap. Baked AO in the albedo satisfies clause (1) without a
 *     single light node, and that is deliberate: glTF light extensions are a separate question and
 *     bundling them would make one proof stand for two mechanisms (§11c).
 *   - It says nothing about room DIMENSIONS (#342, the ED bay at 50.1 m²) or about which fixtures a
 *     clinical room should contain. Those are different defects that happen to share a subject.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ENV_DIR = "apps/ui-xr/public/xr-assets/environment";

/** A texture with one colour is a fill. The eyes contract (#340) uses the same discriminator. */
const MIN_DISTINCT_COLOURS = 2;

/** Measured ceiling of what ships today; a fix must not reach clause (1) by inflating geometry. */
const MAX_TRIANGLES = 250_000;

type Row = {
  file: string;
  tris: number;
  materials: number;
  texturedMaterials: number;
  distinctColours: number;
  textureBytes: number;
};

const io = new NodeIO();

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));
  const root = doc.getRoot();

  let tris = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? 0) / 3;
  }

  const materials = root.listMaterials();
  const textured = materials.filter((m) => m.getBaseColorTexture() !== null);

  // Coarse byte sample, enough to separate a real bake from a single-colour fill.
  let distinct = 1;
  let textureBytes = 0;
  for (const tex of root.listTextures()) textureBytes += tex.getImage()?.byteLength ?? 0;
  const first = textured[0]?.getBaseColorTexture()?.getImage();
  if (first && first.byteLength > 0) {
    const seen = new Set<string>();
    const stride = Math.max(3, Math.floor(first.byteLength / 4096) * 3);
    for (let i = 0; i + 2 < first.byteLength; i += stride) {
      seen.add(`${first[i]! >> 4},${first[i + 1]! >> 4},${first[i + 2]! >> 4}`);
      if (seen.size > 64) break;
    }
    distinct = seen.size;
  }

  return {
    file: rel.split("/").pop()!,
    tris,
    materials: materials.length,
    texturedMaterials: textured.length,
    distinctColours: distinct,
    textureBytes,
  };
}

/**
 * Node graph of ONE shell GLB (#347 clauses (4)+(5)). The Infinigen room is a
 * different lane (#346) and must not be measured here, so these clauses read the
 * parametric shell by name, never the aggregate.
 */
type ShellNode = {
  name: string;
  triangles: number;
  vertices: number;
  subtreeMeshes: number;
  /** Axis-aligned size of the subtree's geometry, local space (m). */
  size: { x: number; y: number; z: number };
};

function countSubtreeMeshes(node: import("@gltf-transform/core").Node): number {
  let count = node.getMesh() ? 1 : 0;
  for (const child of node.listChildren()) count += countSubtreeMeshes(child);
  return count;
}

/** Union of primitive AABBs across a node's subtree, in the node's local space. */
function subtreeBounds(
  node: import("@gltf-transform/core").Node,
  min: [number, number, number],
  max: [number, number, number],
): void {
  const mesh = node.getMesh();
  if (mesh) {
    // Mesh vertex positions are local to the MESH; the node's own translation moves
    // them relative to its parent. Every part under a prop root is a plain
    // translation (no rotation/scale), so adding the local translation suffices.
    // Mesh vertex positions are local to the MESH; the node's TRS moves them relative to
    // its parent. Every part under a prop root is a plain axis-aligned translation +
    // uniform-per-axis scale (no rotation), so translation + scale suffice for the extent.
    const translation = node.getTranslation();
    const tx = translation?.[0] ?? 0;
    const ty = translation?.[1] ?? 0;
    const tz = translation?.[2] ?? 0;
    const scale = node.getScale();
    const sx = scale?.[0] ?? 1;
    const sy = scale?.[1] ?? 1;
    const sz = scale?.[2] ?? 1;
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute("POSITION");
      if (!position) continue;
      const array = position.getArray();
      if (!array) continue;
      const count = position.getCount();
      for (let index = 0; index < count; index += 1) {
        min[0] = Math.min(min[0], array[index * 3]! * sx + tx);
        min[1] = Math.min(min[1], array[index * 3 + 1]! * sy + ty);
        min[2] = Math.min(min[2], array[index * 3 + 2]! * sz + tz);
        max[0] = Math.max(max[0], array[index * 3]! * sx + tx);
        max[1] = Math.max(max[1], array[index * 3 + 1]! * sy + ty);
        max[2] = Math.max(max[2], array[index * 3 + 2]! * sz + tz);
      }
    }
  }
  for (const child of node.listChildren()) subtreeBounds(child, min, max);
}

async function readShellNodeIndex(rel: string): Promise<ShellNode[]> {
  const doc = await io.read(join(REPO_ROOT, rel));
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  if (!scene) return [];
  const out: ShellNode[] = [];
  const visit = (node: import("@gltf-transform/core").Node): void => {
    const mesh = node.getMesh();
    let triangles = 0;
    let vertices = 0;
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        triangles += (prim.getIndices()?.getCount() ?? 0) / 3;
        vertices += prim.getAttribute("POSITION")?.getCount() ?? 0;
      }
    }
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    subtreeBounds(node, min, max);
    out.push({
      name: node.getName(),
      triangles,
      vertices,
      subtreeMeshes: countSubtreeMeshes(node),
      size: {
        x: Number.isFinite(min[0]) ? max[0] - min[0] : 0,
        y: Number.isFinite(min[1]) ? max[1] - min[1] : 0,
        z: Number.isFinite(min[2]) ? max[2] - min[2] : 0,
      },
    });
    for (const child of node.listChildren()) visit(child);
  };
  for (const node of scene.listChildren()) visit(node);
  return out;
}

const files = existsSync(join(REPO_ROOT, ENV_DIR))
  ? readdirSync(join(REPO_ROOT, ENV_DIR))
      .filter((n: string) => n.endsWith(".glb"))
      .map((n: string) => `${ENV_DIR}/${n}`)
  : [];

const rows = (await Promise.all(files.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  expect(rows.length, `shipped environment GLBs under ${ENV_DIR}`).toBeGreaterThanOrEqual(2);
}

const show = (r: Row): string =>
  `${r.file}: tris=${r.tris} materials=${r.materials} textured=${r.texturedMaterials} textureBytes=${r.textureBytes}`;

describe("a shipped room is textured, not a flat-lit hull", () => {
  it.fails("(1) RED: every shipped environment carries at least one textured material", () => {
    requireRows();
    expect(
      rows.filter((r) => r.texturedMaterials === 0).map(show),
      "environments whose every material is a flat colour",
    ).toEqual([]);
  });

  it.fails("(2) RED COUNTERWEIGHT: the texture is not a single-colour fill", () => {
    requireRows();
    // #337/#338 adjusted a uniform eye colour twice and produced no eye. A fill has one colour.
    expect(
      rows.filter((r) => r.distinctColours < MIN_DISTINCT_COLOURS).map(show),
      "environment textures that are a single flat colour",
    ).toEqual([]);
  });

  it("(3) NET known-good: triangle count is NOT the axis under change", () => {
    // Standing directive: no generated output is gated on triangle count — meshoptimizer runs later.
    // This net exists so a fix cannot satisfy (1) by subdividing a flat box into a detailed one.
    requireRows();
    const inflated = rows.filter((r) => r.tris > MAX_TRIANGLES).map(show);
    expect(inflated, `environments above ${MAX_TRIANGLES.toLocaleString()} triangles`).toEqual([]);
  });

  it("(4) RED: the parametric shell carries trim — skirting, chamfered corners, door reveals", async () => {
    // #347 MADR 0055 item 4. The Infinigen room is another lane (#346); this asserts the
    // parametric shell only. Each sub-assertion fails on the pre-fix shell (0 trim nodes).
    const shell = await readShellNodeIndex(`${ENV_DIR}/ed-exam-bay-shell.glb`);
    expect(shell.length, "parametric shell node graph").toBeGreaterThan(0);

    const skirting = shell.filter((n) => n.name.includes("skirting"));
    expect(skirting.length, "skirting nodes along the wall bases").toBeGreaterThanOrEqual(1);

    // Chamfers must be triangular prisms (tens of triangles), not renamed cubes (12 tris) —
    // and clause (3) refuses chamfering by subdividing the whole wall.
    const chamfer = shell.filter((n) => n.name.includes("chamfer"));
    expect(chamfer.length, "chamfer nodes").toBeGreaterThanOrEqual(1);
    const chamferPrism = chamfer.filter((n) => n.triangles > 0 && n.triangles < 12);
    expect(chamferPrism.length, "chamfer nodes whose topology is a prism, not a box").toBeGreaterThanOrEqual(1);

    // Door reveal frame is more than one part (header lintel + jambs).
    const doorReveal = shell.filter((n) => n.name.includes("door_reveal"));
    expect(doorReveal.length, "door reveal nodes (header + jambs)").toBeGreaterThanOrEqual(2);
  });

  it("(5) RED: the parametric shell carries recognisable scale-setting props, not flat boxes", async () => {
    // #347 MADR 0055 item 5. A flat-coloured box sets no scale; every prop root must be
    // multi-part and carry a known-size anchor. Pre-fix every shell node is a single
    // 12-triangle cube, so each sub-assertion fails.
    const shell = await readShellNodeIndex(`${ENV_DIR}/ed-exam-bay-shell.glb`);
    expect(shell.length, "parametric shell node graph").toBeGreaterThan(0);

    const rootByName = (name: string) => shell.find((n) => n.name === `ed_exam_bay_${name}`);

    const props = [
      { root: "outlet_plate", minParts: 2, reason: "plate + sockets" },
      { root: "light_switch", minParts: 2, reason: "plate + toggle" },
      { root: "hand_gel_dispenser", minParts: 2, reason: "bracket + bottle + pump" },
      { root: "handoff_whiteboard", minParts: 2, reason: "frame + surface + tray" },
      { root: "curtain_track", minParts: 2, reason: "rail + rings" },
    ] as const;
    for (const prop of props) {
      const root = rootByName(prop.root);
      expect(root, `${prop.root} root node in the parametric shell`).toBeDefined();
      expect(root!.subtreeMeshes, `${prop.root} part meshes (${prop.reason}); a flat box = 1`).toBeGreaterThanOrEqual(prop.minParts);
    }

    // Known-size anchors — the eye calibrates room size from objects of known size.
    const sizeOf = (name: string): { x: number; y: number; z: number } => {
      const root = rootByName(name);
      expect(root, `${name} root node for size anchor`).toBeDefined();
      return root!.size;
    };

    // Outlet plate is a small wall reference (< 0.2 m on its widest axis).
    const outletSize = sizeOf("outlet_plate");
    expect(Math.max(outletSize.x, outletSize.y, outletSize.z), "outlet plate max dimension").toBeLessThan(0.2);
    // Curtain track is a room-length reference (> 1.0 m along the rail).
    const trackSize = sizeOf("curtain_track");
    expect(Math.max(trackSize.x, trackSize.y, trackSize.z), "curtain track length").toBeGreaterThan(1.0);
    // Whiteboard is a mid-size wall reference (> 0.5 m wide).
    const boardSize = sizeOf("handoff_whiteboard");
    expect(Math.max(boardSize.x, boardSize.y, boardSize.z), "whiteboard width").toBeGreaterThan(0.5);
  });
});
