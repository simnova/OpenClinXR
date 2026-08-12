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
 * NOT TESTED, and this is the scope statement:
 *   - No pixel is graded here. This asserts the MATERIAL CHANNEL only. A room can carry a texture and
 *     still look wrong — wrong palette, wrong scale, no trim, no contact shadows.
 *   - It does not assert LIGHTS or a lightmap. Baked AO in the albedo satisfies clause (1) without a
 *     single light node, and that is deliberate: glTF light extensions are a separate question and
 *     bundling them would make one proof stand for two mechanisms (§11c).
 *   - It says nothing about room DIMENSIONS (#342, the ED bay at 50.1 m²) or about which fixtures a
 *     clinical room should contain. Those are different defects that happen to share a subject.
 *
 * ## FIXED (#345, 2026-08-12)
 * Both REDs flipped to green by wiring the proven Cycles bake (MADR 0055 item 1):
 *   - `tools/openclinxr/asset-pipeline/environment/room-albedo-ao-bake.py` — deterministic
 *     Cycles DIFFUSE bake (interior area light + world 0.12, samples 32, #343 mechanism) to a
 *     packed baseColorTexture per material; bake light deleted before export. Measured:
 *     `infinigen-ed-exam-bay.glb` 440->440 tris, textured 0->3, distinctColours 1->65;
 *     `ed-exam-bay-shell.glb` 492->492 tris, textured 0->15, distinctColours 1->65.
 *   - `environment-artifacts.ts` — materials now use node Principled BSDF Base Color (flat
 *     `diffuse_color` was exporting as 0.8 gray, so the intended palette never shipped) and the
 *     emitter runs the bake as its final stage.
 * Geometry untouched; no light nodes shipped; no triangle budget changed.
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
  it("(1) RED: every shipped environment carries at least one textured material", () => {
    requireRows();
    expect(
      rows.filter((r) => r.texturedMaterials === 0).map(show),
      "environments whose every material is a flat colour",
    ).toEqual([]);
  });

  it("(2) RED COUNTERWEIGHT: the texture is not a single-colour fill", () => {
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
});
