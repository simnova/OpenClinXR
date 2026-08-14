import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

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
 *   c) stop honouring wall_height too, "config is dead"|    pass    |     **FAIL**     |      pass       | REFUSED
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

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ENV_DIR = join(REPO_ROOT, "apps/ui-xr/public/xr-assets/environment");
const ROOM = join(ENV_DIR, "infinigen-ed-exam-bay.glb");
const PROVENANCE = join(ENV_DIR, "PROVENANCE.md");

/** Declared values must match the provenance record to 1 cm — a rounding allowance, not a tolerance. */
const HEIGHT_EPSILON_M = 0.01;

type Declared = { wallHeight: number | null; aspectLo: number | null; aspectHi: number | null };

function readDeclared(): Declared {
  if (!existsSync(PROVENANCE)) return { wallHeight: null, aspectLo: null, aspectHi: null };
  const src = readFileSync(PROVENANCE, "utf8");
  const h = /wall_height=([0-9.]+)/u.exec(src);
  const a = /aspect_ratio_range=\(([0-9.]+),\s*([0-9.]+)\)/u.exec(src);
  return {
    wallHeight: h ? Number(h[1]) : null,
    aspectLo: a ? Number(a[1]) : null,
    aspectHi: a ? Number(a[2]) : null,
  };
}

type Shipped = { floorAspect: number | null; floorArea: number | null; shellHeight: number | null };

async function readShipped(): Promise<Shipped> {
  if (!existsSync(ROOM)) return { floorAspect: null, floorArea: null, shellHeight: null };
  const doc = await new NodeIO().readBinary(readFileSync(ROOM));
  let floorAspect: number | null = null;
  let floorArea: number | null = null;
  let shellHeight: number | null = null;
  let widestFloor = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    for (const prim of mesh.listPrimitives()) {
      const a = prim.getAttribute("POSITION")?.getArray();
      if (!a) continue;
      for (let i = 0; i < a.length; i += 3) {
        for (let k = 0; k < 3; k += 1) {
          const v = a[i + k]!;
          if (v < lo[k]!) lo[k] = v;
          if (v > hi[k]!) hi[k] = v;
        }
      }
    }
    const w = hi[0]! - lo[0]!;
    const h = hi[1]! - lo[1]!;
    const d = hi[2]! - lo[2]!;
    if (!Number.isFinite(w) || !Number.isFinite(d)) continue;
    // A floor is a flat horizontal sheet; the shell is the tallest volume.
    if (h < 0.01 && w * d > widestFloor) {
      widestFloor = w * d;
      floorArea = w * d;
      floorAspect = Math.max(w, d) / Math.min(w, d);
    }
    if (h > (shellHeight ?? 0)) shellHeight = h;
  }
  return { floorAspect, floorArea, shellHeight };
}

const declared = readDeclared();
const shipped = await readShipped();

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): void {
  expect(existsSync(ROOM), `${ROOM} exists`).toBe(true);
  expect(declared.wallHeight, `wall_height parsed from ${PROVENANCE}`).not.toBeNull();
  expect(declared.aspectLo, `aspect_ratio_range parsed from ${PROVENANCE}`).not.toBeNull();
  expect(shipped.floorAspect, "a flat floor mesh measured in the shipped room").not.toBeNull();
  expect(shipped.shellHeight, "a shell height measured in the shipped room").not.toBeNull();
}

describe("the shipped room matches its declared shape", () => {
  it.fails("(1) RED: the floor aspect falls inside the declared aspect_ratio_range", () => {
    requireMeasured();
    expect(
      shipped.floorAspect,
      `floor aspect ${shipped.floorAspect?.toFixed(3)} against declared [${declared.aspectLo}, ${declared.aspectHi}] — the sibling knob wall_height DOES bind, so the config path reaches the output (floor area ${shipped.floorArea?.toFixed(1)} m² against the config's stated 24.15 m² target, recorded not asserted)`,
    ).toBeGreaterThanOrEqual(declared.aspectLo as number);
  });

  it("(2) COUNTERWEIGHT known-good: the sibling knob wall_height still binds", () => {
    // Refuses (c): concluding "the gin path is dead" and dropping the assertion would discard the one
    // piece of evidence that the path CAN reach the output.
    requireMeasured();
    expect(
      Math.abs((shipped.shellHeight as number) - (declared.wallHeight as number)),
      `shell height ${shipped.shellHeight?.toFixed(3)} vs declared wall_height ${declared.wallHeight}`,
    ).toBeLessThanOrEqual(HEIGHT_EPSILON_M);
  });

  it("(3) COUNTERWEIGHT: the declaration is not rewritten to match the room", () => {
    // Refuses (b): editing PROVENANCE's range to (1.0, 1.1) is the cheapest green available and it
    // destroys the only record of what this config was asked to produce.
    requireMeasured();
    expect(declared.wallHeight, "declared wall_height rewritten").toBe(2.65);
    expect(
      [declared.aspectLo, declared.aspectHi],
      "declared aspect_ratio_range rewritten to accommodate the shipped room",
    ).toEqual([2.0, 2.1]);
  });
});
