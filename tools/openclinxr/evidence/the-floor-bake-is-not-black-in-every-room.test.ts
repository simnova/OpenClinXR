/**
 * #641 — every floor base-colour bake in the shipped bank is black.
 *
 * THE DEFECT, MEASURED BY THE CARD'S FILER — do not re-derive this. These are measurements; any
 * mechanism named below is labelled as NOT DETERMINED and must not be read as a diagnosis.
 *
 *   Instrument: tools/openclinxr/evidence/lib/png-region-luminance.ts — the same one the black-frame
 *   gate and issue-409-still-black.json use. Scope: `openclinxr_room_bake_*` BASE-COLOUR textures
 *   only (AO maps excluded), across all 14 `infinigen-*.glb` room assets, 42 textures.
 *
 *   | shader class                                  | rooms  | median  | non-black % |
 *   |-----------------------------------------------|--------|---------|-------------|
 *   | tile / dirt / bone / rug (FLOORS)              | all 14 | 0       | 0 – 7.4     |
 *   | shader_plaster (WALLS — the known-good column) | 9      | 191–242 | 100         |
 *
 *   Two wall exceptions, recorded because they say the defect is not purely material-keyed:
 *   urgent-care-clinic/shader_plaster is fully black, and adult-ed-abdominal-bay/shader_plaster is
 *   49.8% non-black. Both are OUT OF SCOPE here and this contract does not assert on walls.
 *
 *   The pediatric-fever-urgent-care floor texture is 32,626 bytes against wall bakes of 1,142,173
 *   and 899,608 in the same file — 35x, consistent with a near-uniform image. All four materials in
 *   that room carry baseColorFactor [1,1,1,1], so the black is IN THE TEXTURE, not the factor.
 *
 * THRESHOLD PROVENANCE. 50% non-black, taken from the EMPTY GAP in the table above: every floor
 * measures at most 7.4% and the wall known-good measures 100%. Nothing in the observed population
 * lies between. It is 6.8x above the worst floor, so it is derived from ambient variation rather
 * than fitted to clear an observation. It is deliberately NOT set near 7.4%, which would buy the
 * observation instead of the property.
 *
 * CAUSE: NOT DETERMINED. `room-albedo-ao-bake.py:357` bakes DIFFUSE with
 * pass_filter={"DIRECT","INDIRECT","COLOR"}, and the file's own header comment at :23 says the
 * COLOR pass exists so DIFFUSE does not multiply by lighting. Whether that filter, a UV/lightmap
 * problem, an AO map landing in the base-colour slot, or something else produces the black is
 * UNKNOWN TO ME. Trace it; do not take the line number above as a diagnosis. My last several
 * mechanism guesses in this area were withdrawn.
 *
 * FIRST MEASUREMENT, rather than a candidate list: bake ONE room's floor material twice, once as
 * shipped and once with a single variable changed, and put both non-black percentages in the
 * pre-fix artifact. A control/treatment pair on one subject settles more than a survey.
 *
 * ## FIXED (#641, 2026-08-27)
 *
 * CAUSE, MEASURED (not the same as the file's NOT DETERMINED above — that was the pre-trace state):
 * the floor meshes' ACTIVE UV layer (exported as TEXCOORD_0, the layer Cycles bake writes into and
 * the runtime samples) is a collapsed layout. `infinigen-pediatric-fever-urgent-care.glb` floor:
 * 32/56 vertices at a single point (0,1), 30/48 triangles with zero UV area. Cycles DIFFUSE bake
 * writes nothing to degenerate UV triangles, so the floor bake covered only the small
 * non-degenerate strip (u 0.125-0.375, v 0.361-0.389 — the bright band at image row ~640 in the
 * control bake) and shipped 99% black in every room. The mesh already carried a non-degenerate
 * full-square layer (TEXCOORD_1 -> UVMap.001) that the bake never used.
 *
 * CONTROL/TREATMENT on `infinigen-pediatric-fever-urgent-care.glb`, same rig, same code path:
 *   control (as shipped)          floor meanL 2.21   non-black 1.0%   21,874 B
 *   treatment (active UV -> UVMap.001)   meanL 246.55  non-black 96.8%  29,907 B (1024)
 *   fixed bake (UV repair + 2048)       meanL 245.70  non-black 96.2%  110,560 B (2048, sd 49.1)
 *
 * FIX in `tools/openclinxr/asset-pipeline/environment/room-albedo-ao-bake.py`: `ensure_uv` now
 * prefers an existing non-degenerate UV layer, REMOVES degenerate layers (the glTF exporter writes
 * layer ORDER, not active-first, so the collapsed layer would otherwise still ship as TEXCOORD_0
 * and the runtime would keep sampling the black corner), and smart-projects only when nothing
 * survives. Floor surfaces bake at 2048 (largest surface; the 1024 full-square bake compresses to
 * ~30 KB, below the bank's detail floor — measured 2048: 110,560 B / sd 49.1). The `live:` and
 * `run:` rules cover the whole bank; all 14 rooms were re-baked with the fixed script.
 *
 * THIS HEADER IS IMMUTABLE. Flip the assertion and append a `## FIXED (#641)` block below.
 */
import { NodeIO } from "@gltf-transform/core";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { regionLuminance } from "./lib/png-region-luminance.js";

const REPO = resolve(import.meta.dirname, "../../..");
const BANK = resolve(REPO, "apps/ui-xr/public/xr-assets/environment");

/** Materials whose bake covers a floor. Derived from the shader classes named in the card. */
const FLOOR_SHADER = /tile|dirt|bone|rug|floor/i;
/** The known-good column. Asserted on only to prove the instrument can see a good bake. */
const WALL_SHADER = /plaster/i;
/** From the empty gap between the floor population (<=7.4%) and the wall known-good (100%). */
const MIN_NON_BLACK_PCT = 50;

function roomAssets(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) roomAssets(p, out);
    else if (/^infinigen-.*\.glb$/u.test(entry.name)) out.push(p);
  }
  return out;
}

type Bake = { room: string; material: string; pct: number; bytes: number };

async function measureBakes(): Promise<{ floors: Bake[]; walls: Bake[] }> {
  const io = new NodeIO();
  const floors: Bake[] = [];
  const walls: Bake[] = [];
  for (const path of roomAssets(BANK)) {
    const room = path.split("/").pop() ?? path;
    const doc = await io.read(path);
    for (const material of doc.getRoot().listMaterials()) {
      const name = material.getName();
      const texture = material.getBaseColorTexture();
      const image = texture?.getImage();
      if (!image) continue;
      // BASE-COLOUR bakes only. An AO map is a different artifact and the card excludes it.
      const lum = regionLuminance(image, {}, { step: 8 });
      if (!lum) continue;
      const row: Bake = { room, material: name, pct: lum.nonBlackPct, bytes: image.byteLength };
      if (FLOOR_SHADER.test(name)) floors.push(row);
      else if (WALL_SHADER.test(name)) walls.push(row);
    }
  }
  return { floors, walls };
}

describe("#641 the floor base-colour bake is not black", () => {
  it("(1) RED: every floor bake in the bank clears the non-black floor", async () => {
    const { floors } = await measureBakes();
    // Guards against a vacuous pass on an empty set: the card measured floors in all 14 rooms, so
    // finding none at all means the extraction is wrong, not that the bank is clean.
    expect(floors.length).toBeGreaterThanOrEqual(14);
    const black = floors
      .filter((f) => f.pct < MIN_NON_BLACK_PCT)
      .map((f) => `${f.room} / ${f.material}: ${f.pct.toFixed(1)}% non-black`);
    expect(black).toEqual([]);
  });

  it("(2) the known-good column: wall plaster bakes are visible to this instrument", async () => {
    const { walls } = await measureBakes();
    // If this ever fails, the instrument or the extraction is broken and clause (1) is measuring
    // nothing — not that the walls regressed. Two known-black walls are excluded by name because
    // the card records them as separate defects, out of this card's scope.
    const good = walls.filter(
      (w) => !/urgent-care-clinic|adult-ed-abdominal-bay/u.test(w.room),
    );
    expect(good.length).toBeGreaterThanOrEqual(5);
    expect(good.every((w) => w.pct >= MIN_NON_BLACK_PCT)).toBe(true);
  });

  it("(3) COUNTERWEIGHT: the fix is not a flat colour written over the bake", async () => {
    // The cheapest way to clear clause (1) is to paint every floor a uniform mid-grey. That would
    // be non-black and would destroy the tile pattern the bake exists to carry. A real bake varies
    // across the surface; a flat fill does not.
    const { floors } = await measureBakes();
    const passing = floors.filter((f) => f.pct >= MIN_NON_BLACK_PCT);
    for (const f of passing) {
      // 32,626 bytes was the card's tell for a near-uniform image, against ~1.1 MB for a real wall
      // bake. A floor that clears clause (1) must carry comparable detail, not a flat fill.
      expect(f.bytes).toBeGreaterThan(100_000);
    }
  });

  it("(4) COUNTERWEIGHT: baseColorFactor is not used to fake brightness", async () => {
    // The card measured baseColorFactor [1,1,1,1] on all four materials of the peds room, so the
    // black is in the texture. Raising the factor would brighten the render without fixing the bake
    // and would also brighten anything else using that material.
    const io = new NodeIO();
    for (const path of roomAssets(BANK)) {
      const doc = await io.read(path);
      for (const material of doc.getRoot().listMaterials()) {
        if (!FLOOR_SHADER.test(material.getName())) continue;
        const factor = material.getBaseColorFactor();
        expect(factor.slice(0, 3).every((c) => c <= 1.0001)).toBe(true);
      }
    }
  });

  it("(5) COUNTERWEIGHT: the room assets are not deleted or emptied to pass", async () => {
    // 14 rooms shipped when this card was filed. Clause (1) passes trivially on a bank with no
    // floors in it.
    expect(roomAssets(BANK).length).toBeGreaterThanOrEqual(14);
  });
});
