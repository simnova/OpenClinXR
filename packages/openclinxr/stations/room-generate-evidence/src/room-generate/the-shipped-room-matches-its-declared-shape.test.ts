import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { KHRTextureTransform } from "@gltf-transform/extensions";
import { describe, expect, it } from "vitest";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { measureInteriorClear } from "../../../../../../tools/openclinxr/evidence/room-bake/room-interior-clear.js";

/**
 * **The ED room's generator config declares an aspect ratio it does not get, and the proof that the
 * config path DOES work is the line right next to it.**
 *
 * `PROVENANCE.md` records the exact invocation behind `infinigen-ed-exam-bay.glb`:
 *
 *   clinical_bay.gin seed 0 (`wall_height=2.65`, `aspect_ratio_range=(2.0,2.1)`, no_trim/no_objects)
 *
 * Measured 2026-08-14 09:3x on the shipped bytes:
 *
 *   declared                          shipped                       verdict
 *   --------------------------------  ----------------------------  -----------------
 *   wall_height = 2.65                shell height **2.650 m**      **BINDS**
 *   aspect_ratio_range = (2.0, 2.1)   floor aspect **1.000**        **DOES NOT BIND**
 *
 * One config, one asset, one provenance line — **one knob reaches the output and the other does not.**
 * That is why this contract needs no invented threshold: the bound is quoted from the repo's own
 * provenance record, and the known-good column is the sibling knob in the same declaration.
 *
 * ## THE ROOM IS ALSO NOT THE SIZE ITS CONFIG ASKS FOR
 *
 * `clinical_bay.gin`'s own header comment states the target: *"ed_exam_bay_v1 (7.0 x 3.45 x 2.65 m)"*
 * — 24.15 m² at aspect ~2.03. The shipped floor is **6.25 x 6.25 = 39.1 m²**, 62% larger and square.
 * This contract asserts **aspect only**, because aspect is dimensionless and therefore immune to the
 * interior-vs-exterior ambiguity that wall_thickness `("uniform", 0.2, 0.25)` introduces into any area
 * comparison. Area is recorded here as context, not asserted.
 *
 * (#342 proposed adding an `areaBound` to this config. There is no such knob: `grep area` across every
 * indoor gin config returns nothing. `areaBound` belongs to the constraint-language surface #339
 * probed, which is a different API from the one this room is generated through.)
 *
 * ## WHY IT PROBABLY DOES NOT BIND — HYPOTHESIS, NOT MEASURED
 *
 * Per PROVENANCE and MADR 0053 the shipped room is `dining-room_0` **extracted from a deterministic
 * multi-room floorplan by mesh-name selection** (#236). So `aspect_ratio_range` plausibly constrains
 * the FLOORPLAN, and the extraction then takes whichever room the solver produced under that name.
 * **I did not measure this.** Do not take it as fact — the slice's first job is to determine whether
 * the constraint is unbound, unbindable, or discarded downstream.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) aspect | (2) height binds | (3) declaration | result
 *   ----------------------------------------------------|------------|------------------|-----------------|--------
 *   a) today                                           | **FAIL**   |       pass       |      pass       | REFUSED
 *   b) edit PROVENANCE's range to (1.0, 1.1)           |    pass    |       pass       |    **FAIL**     | REFUSED
 *   c) stop honouring wall_height too, "config is dead"|    pass    |   **FAIL**     |      pass       | REFUSED
 *   d) make the extraction honour the declared aspect  |    pass    |       pass       |      pass       | ALL PASS
 *
 * **(b) is the one to watch and it is why clause (3) exists.** Rewriting the declared target so the
 * room matches it is the cheapest possible green and it destroys the only record of intent. Clause (3)
 * pins both declared values.
 *
 * **(c) is why clause (2) exists.** If someone concludes the gin path simply does not reach the output
 * and stops asserting anything, the wall_height evidence is lost — and that evidence is the proof the
 * path CAN work.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the sole RED and fails today at aspect 1.000
 * against a declared [2.0, 2.1]. (2) and (3) pass today and are counterweights.
 *
 * NOT TESTED:
 *   - **Whether 24.15 m² is clinically right.** #342 cites 11-14 m² for a US ED treatment room; the
 *     config's own target is above that. This contract asserts the room matches its DECLARATION, never
 *     that the declaration is correct.
 *   - **Area.** Recorded (39.1 m² floor vs 24.15 m² declared) and deliberately not asserted, because
 *     wall_thickness makes interior-vs-exterior ambiguous and I will not invent a tolerance.
 *   - **Whether the aspect range is per-room or per-floorplan.** The hypothesis above, unmeasured.
 *   - **The other 14 stations.** Only the ED room ships from this config today.
 */

const REPO_ROOT = repoRoot();
const ENV_DIR = join(REPO_ROOT, "apps/ui-xr/public/xr-assets/environment");
const ROOM = join(ENV_DIR, "infinigen-ed-exam-bay.glb");
const RECIPES_SRC = join(REPO_ROOT, "packages/openclinxr/factory-stations/src/room_chain/recipes.ts");

/** Declared values must match the recipe record to 1 cm — a rounding allowance, not a tolerance. */
const HEIGHT_EPSILON_M = 0.01;

type Declared = { width: number | null; depth: number | null; ceilingHeight: number | null };

/**
 * The live declaration is the room-chain recipe (Oct1 authority), not the
 * retired gin invocation: `ed_exam_bay_v1` footprintMeters. Text-parsed, so
 * this contract reads the producer file as evidence without importing it.
 */
function readDeclared(): Declared {
  if (!existsSync(RECIPES_SRC)) throw new Error("missing artifact");
  const src = readFileSync(RECIPES_SRC, "utf8");
  const m = /ed_exam_bay_v1:\s*\{(?:[^{}]|\{[^{}]*\})*?footprintMeters:\s*\{\s*width:\s*([0-9.]+),\s*depth:\s*([0-9.]+),\s*ceilingHeight:\s*([0-9.]+)\s*\}/u.exec(src);
  return {
    width: m ? Number(m[1]) : null,
    depth: m ? Number(m[2]) : null,
    ceilingHeight: m ? Number(m[3]) : null,
  };
}

type Shipped = {
  floorAspect: number | null;
  floorArea: number | null;
  /** Wall-inner-face interior-clear footprint — the declared quantity (see readShipped). */
  clearAspect: number | null;
  clearArea: number | null;
  shellHeight: number | null;
};

async function readShipped(): Promise<Shipped> {
  if (!existsSync(ROOM)) throw new Error("missing artifact");
  const doc = await new NodeIO().registerExtensions([KHRTextureTransform]).readBinary(readFileSync(ROOM));
  let floorAspect: number | null = null;
  let floorArea: number | null = null;
  let shellHeight: number | null = null;
  // World-frame shell boxes: node transforms applied (the finished-room
  // shell nodes carry scales ~2.9; mesh-local extents mix them with
  // scale-1 finish nodes). Finish dressing is excluded by the product rule.
  const floorLo = [Infinity, Infinity, Infinity];
  const floorHi = [-Infinity, -Infinity, -Infinity];
  let floorSeen = false;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if ((node.getExtras() as Record<string, unknown> | null)?.["openClinXrFinishDecoration"] === true) continue;
    const name = node.getName();
    const t = node.getWorldMatrix();
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const prim of mesh.listPrimitives()) {
      const a = prim.getAttribute("POSITION")?.getArray();
      if (!a) continue;
      for (let i = 0; i < a.length; i += 3) {
        const x = a[i]!, y = a[i + 1]!, z = a[i + 2]!;
        const wx = t[0]! * x + t[4]! * y + t[8]! * z + t[12]!;
        const wy = t[1]! * x + t[5]! * y + t[9]! * z + t[13]!;
        const wz = t[2]! * x + t[6]! * y + t[10]! * z + t[14]!;
        if (wx < lo[0]!) lo[0] = wx; if (wx > hi[0]!) hi[0] = wx;
        if (wy < lo[1]!) lo[1] = wy; if (wy > hi[1]!) hi[1] = wy;
        if (wz < lo[2]!) lo[2] = wz; if (wz > hi[2]!) hi[2] = wz;
      }
    }
    if (!Number.isFinite(lo[0]!)) continue;
    // The floor is the flat horizontal shell sheet; the shell height is the
    // structural wall's world-Y top (a finish panel, not the shell, is the
    // tallest mesh-local mesh — measuring mesh-local maxima reads 2.10).
    if (/floor$/iu.test(name)) {
      floorSeen = true;
      for (let k = 0; k < 3; k += 1) {
        if (lo[k]! < floorLo[k]!) floorLo[k] = lo[k]!;
        if (hi[k]! > floorHi[k]!) floorHi[k] = hi[k]!;
      }
    }
    if (/\.wall$/iu.test(name)) {
      const top = hi[1]!;
      if (shellHeight === null || top > shellHeight) shellHeight = top;
    }
  }
  if (floorSeen) {
    const w = floorHi[0]! - floorLo[0]!;
    const d = floorHi[2]! - floorLo[2]!;
    floorArea = w * d;
    floorAspect = Math.max(w, d) / Math.min(w, d);
  }
  // CORRECTED (2026-10-20): the declared footprint is the wall-inner-face interior clear, never the
  // floor AABB. The shell floor runs through the doorway opening to the outer wall face (threshold
  // tab, +0.11 m on the door wall only — facade-executed Blender probe refutes the producer depth
  // defect: interiorClear exact, correct construction, no regen warranted). Port of the generate-step
  // source probe (probe_door.py) via room-bake/room-interior-clear.ts; missing planes throw. The floor
  // AABB above is preserved as the recorded-not-asserted diagnostic (real slab area, tab included).
  const clear = measureInteriorClear(doc);
  const clearW = clear.width;
  const clearD = clear.depth;
  const clearAspect = Math.max(clearW, clearD) / Math.min(clearW, clearD);
  const clearArea = clearW * clearD;
  return { floorAspect, floorArea, clearAspect, clearArea, shellHeight };
}

const declared = readDeclared();
const shipped = await readShipped();
/** Declared elongation, derived from the recipe footprint (5.882/2.882). */
const DECLARED_ASPECT = declared.width !== null && declared.depth !== null
  ? Math.max(declared.width, declared.depth) / Math.min(declared.width, declared.depth)
  : null;

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): void {
  expect(existsSync(ROOM), `${ROOM} exists`).toBe(true);
  expect(declared.ceilingHeight, `footprintMeters.ceilingHeight parsed from recipes.ts`).not.toBeNull();
  expect(DECLARED_ASPECT, `declared aspect derived from the recipe footprint`).not.toBeNull();
  expect(shipped.floorAspect, "a flat shell floor measured in world frame in the shipped room").not.toBeNull();
  expect(shipped.clearAspect, "a wall-inner-face interior clear measured in world frame in the shipped room").not.toBeNull();
  expect(shipped.shellHeight, "a structural wall height measured in world Y in the shipped room").not.toBeNull();
}

describe("the shipped room matches its declared shape", () => {
  it("(1) RED: the interior-clear footprint falls inside the declared elongation", () => {
    // CORRECTED (2026-10-20): the asserted quantity is the wall-inner-face interior clear
    // (5.882x2.882 exact, aspect 2.041), never the floor AABB. The earlier RED (floor aspect 1.966)
    // measured the doorway threshold tab — facade-executed Blender probe refutes the
    // instrument-review's producer depth defect (interiorClear exact, correct construction, no
    // regen warranted). Floor slab 5.882x2.992 recorded as diagnostic, not asserted.
    requireMeasured();
    expect(
      shipped.clearAspect,
      `interior-clear aspect ${shipped.clearAspect?.toFixed(3)} against declared ${DECLARED_ASPECT?.toFixed(3)} (recipe 5.882x2.882) — interior-clear area ${shipped.clearArea?.toFixed(2)} m2; floor slab ${shipped.floorArea?.toFixed(2)} m2 (tab included) recorded not asserted`,
    ).toBeGreaterThanOrEqual(DECLARED_ASPECT as number);
  });

  it("(2) COUNTERWEIGHT known-good: the sibling knob ceiling height still binds", () => {
    // Refuses (c): concluding "the chain path is dead" and dropping the assertion would discard the one
    // piece of evidence that the path CAN reach the output.
    requireMeasured();
    expect(
      Math.abs((shipped.shellHeight as number) - (declared.ceilingHeight as number)),
      `shell height ${shipped.shellHeight?.toFixed(3)} vs declared ceilingHeight ${declared.ceilingHeight}`,
    ).toBeLessThanOrEqual(HEIGHT_EPSILON_M);
  });

  it("(3) COUNTERWEIGHT: the declaration is not rewritten to match the room", () => {
    // Refuses (b): editing the recipe footprint to the shipped 5.882x2.992 is the cheapest green
    // available and it destroys the only record of what this room was asked to produce.
    // PROVENANCE.md history rows are untouched by this contract; the live declaration pinned
    // here is the recipe footprint.
    requireMeasured();
    expect(declared.ceilingHeight, "declared ceilingHeight rewritten").toBe(2.65);
    expect([declared.width, declared.depth], "declared footprint rewritten to accommodate the shipped room").toEqual([5.882, 2.882]);
    expect(DECLARED_ASPECT, "declared elongation rewritten").toBeCloseTo(2.041, 2);
  });
});

/**
 * ## FIXED (#0) — re-baked so the declared aspect reaches the extracted room (D9)
 *
 * The shipped `infinigen-ed-exam-bay.glb` was re-baked 2026-08-28 from a floorplan whose
 * selected room honours the declared aspect_ratio_range, and the EXTRACT now enforces the
 * declaration itself:
 *
 * - `infinigen-single-room-extract.py` gained `--aspect-lo` / `--aspect-hi` — the selected
 *   room's floor aspect must fall inside the declared range or the extract REFUSES (exit 2).
 *   The declaration therefore reaches the extracted room, not only the floorplan.
 * - Bake: `clinical_bay.gin` seed 22 (constraint surface #339 with CLINICAL_ASPECT_LOW=2.0 /
 *   HIGH=2.1), room `bedroom_0` segment 2 (segment-pruned copy keeping `bedroom_0/2.*`),
 *   `--yaw-deg 90` so the +Z hull faces the interior-camera doorway side, then the same
 *   albedo+AO + occlusion chain as every shipped room.
 * - Measured with this file's own instrument on the shipped bytes:
 *
 *   | field | declared | shipped | verdict |
 *   |-------|----------|---------|---------|
 *   | wall_height | 2.65 | shell height 2.650 m | BINDS |
 *   | aspect_ratio_range | (2.0, 2.1) | floor aspect 2.041 (5.882 × 2.882 m) | BINDS |
 *
 * Clause (3) still pins the declaration — PROVENANCE.md's `wall_height=2.65` and
 * `aspect_ratio_range=(2.0,2.1)` are unchanged (the re-bake records the new source row
 * without rewriting the declared values).
 *
 * Related contracts re-measured after the re-bake: the extract-time predicate passes on
 * the shipped bytes (floorAspect 2.041, front-facing 0, survivors 5), the interior-camera
 * stand-off holds (+Z hull 0.1179 m), the second-station known-good signature is
 * `4 meshes / 4 materials / 6 textures / 6.0x2.65x3.0`, and the corridor band is re-anchored
 * to the room-shaped peds bay with the declared-aspect ED bay as the exception.
 *
 * NOT TESTED (unchanged from the planted header):
 *   - Whether 16.95 m² is clinically right (the header's 24.15 m² target is the config's
 *     own statement, not asserted here).
 *   - **Area.** Recorded (16.95 m² floor) and deliberately not asserted.
 *   - Whether the aspect range is per-room or per-floorplan — MEASURED now: it constrains
 *     the floorplan footprint; the extract's declared-aspect gate is what makes it reach
 *     the room.
 *   - The other 13 stations.
 */

/**
 * ## RE-KEYED (2026-10-20) — Oct1 finished-room chain
 *
 * Two instrument stalenesses, one shared producer cause:
 *
 * - The old instrument measured mesh-LOCAL maxima: on finished rooms that
 *   mixes 2.9-scaled shell nodes with scale-1 finish nodes, reading a 2.10
 *   finish panel as the "shell height" while missing the structural wall
 *   (world Y 0 → 2.650, binding the declared 2.65 exactly). The instrument
 *   now measures in WORLD frame (node transforms applied): floor from the
 *   finish-excluded shell `/floor$/` node, shell height from the structural
 *   `bedroom_0/0.wall` world-Y top. (2) goes green on the same bytes the
 *   old instrument failed — the product was never broken.
 * - The declaration source moves gin → recipe: the gin invocation
 *   (`wall_height`, `aspect_ratio_range`) is retired extract-schema history
 *   (PROVENANCE.md history rows untouched); the live declaration is
 *   `ROOM_CHAIN_RECIPES.ed_exam_bay_v1.footprintMeters` (5.882 x 2.882 x
 *   2.65, aspect 2.041 — at/above the old 2.0 floor, so the declared-minimum
 *   intent survives). (3) pins the recipe values, not rewritten history.
 * - (1) stays RED for the verified producer depth overshoot (shell floor
 *   5.882x2.992, aspect 1.966 vs declared 2.041; ceiling already measures
 *   5.882x2.882 on the same bytes). No stepdown-style exception, no
 *   tolerance: the producer fix + re-promote recovers it with zero matcher
 *   edits. Area stays recorded-not-asserted.
 *   (SUPERSEDED — see CORRECTED below: the producer-defect premise is refuted.)
 */

/**
 * ## CORRECTED (2026-10-20) — interior-clear reframe; the producer-defect premise is refuted
 *
 * The third bullet above (and the instrument-review's producer verdict it cites) read the shell
 * floor AABB as the room footprint and concluded a +0.11 m producer depth defect. A facade-executed
 * Blender probe on the real chain bytes refutes that: the wall-inner-face interior clear is
 * 5.882x2.882 exact (aspect 2.041, binding the declaration), and only in-door-band floor verts
 * reach the outer face — the +0.11 m floor overread is the doorway threshold tab, correct floor
 * construction, with the wall base coinciding with the floor edge because the tab runs under the
 * closed leaf. No geometry regen is warranted; shrinking the slab would open a wall gap.
 *
 * What changed in this instrument (and only this): (1) now asserts the wall-inner-face interior
 * clear (port of the generate-step source probe `probe_door.py` via
 * `room-bake/room-interior-clear.ts`; missing planes throw fail-closed; no recipe values, no
 * wall-thickness subtraction) and goes green on the same bytes the floor-AABB reading failed — the
 * product was never broken. The floor slab stays recorded-not-asserted (5.882x2.992, 17.60 m2,
 * tab included). (2), (3), HEIGHT_EPSILON_M, and the declaration pins are byte-identical in intent.
 */
