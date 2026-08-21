import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { isPantsName } from "./waistband-ring.ts";

/**
 * E5, 2026-08-21 — THE CUFF INSTRUMENT IS KEYED TO ONE GARMENT NAME, SO IT CANNOT SEE KEVIN.
 *
 * ## THE DEFECT, MEASURED — do not re-derive this
 *
 * `the-ankle-cuff-is-as-smooth-as-the-waistband.test.ts` is **4/4 RED on main**, and every clause
 * fails on the same enumeration guard, never on a geometry claim:
 *
 *     actors with both a cuff ring and a waistband ring:
 *       mpfb-ob-patient-aisha    cuff=y waist=y
 *       mpfb-peds-nurse-kevin    cuff=n waist=n
 *       mpfb-peds-patient-child  cuff=y waist=y
 *                                             expected 2 to be 3
 *
 * THE ASSET IS FINE. Kevin ships a trouser mesh and the SHARED predicate matches it:
 *
 *     mpfb-peds-nurse-kevin    5404v   mat_makeclothes_library_scrub_pants    isPantsName -> true
 *     mpfb-peds-patient-child  7892v   mat_makeclothes_library_cargo_pants    isPantsName -> true
 *     mpfb-ob-patient-aisha    8262v   mat_makeclothes_library_cargo_pants    isPantsName -> true
 *
 * THE INSTRUMENT IS THE DEFECT. That contract carries a PRIVATE mesh filter:
 *
 *     if (!/cargo_pants/i.test(prim.getMaterial()?.getName() ?? "")) continue;
 *
 * Kevin wears `scrub_pants`, so every one of his primitives is skipped and both rings come back
 * null. The sibling contract `the-waistband-is-as-smooth-as-the-hem` measures the same actor at
 * 4.0x on the same bytes, because it imports the shared `isPantsName` — which matches both
 * garments. Two implementations of one measurement, and the name-keyed one went blind.
 *
 * #389 ("shared slot-derived upper-garment predicate replaces the name-keyed hem matchers") did
 * exactly this for the UPPER garment and left the trouser matcher name-keyed in this one file.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                    | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today - /cargo_pants/i only                               |FAIL |FAIL |FAIL |pass | REFUSED
 *   b) widen the regex to /cargo_pants|scrub_pants/i             |pass |pass |FAIL |pass | REFUSED
 *   c) drop Kevin from ACTORS so the guard stops firing          |FAIL |FAIL |pass |pass | REFUSED
 *   d) import the shared predicate, then relax the 3x bound      |pass |pass |pass |FAIL | REFUSED
 *   e) import isPantsName, enumerate from disk, bound unchanged  |pass |pass |pass |pass | ALL PASS
 *
 * **(b) IS THE ONE TO WATCH AND IT IS THE WHOLE POINT.** Adding `scrub_pants` to the regex makes
 * the red go away and reproduces the identical defect the next time a wearer arrives in a garment
 * nobody listed. The bug is not the missing name; it is that a NAME is the key at all (§7j/§7k).
 * Clause (3) refuses it: the predicate must be the SHARED import, and no garment-name literal may
 * remain in the file's mesh selection.
 *
 * **(c) is the other trap.** Shrinking the population until the guard passes is how a coverage
 * check becomes decoration — the exact defect `#514` repaired one file over.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1)(2)(3) are RED today. (4) is a NET.
 *
 * KNOWN-GOOD COLUMN (§9h): `mpfb-ob-patient-aisha` and `mpfb-peds-patient-child` — the two actors
 * the instrument CAN currently see, on the same rail, measured by the same function in the same
 * run. They must stay measurable through any change.
 *
 * NO NEW THRESHOLD. `MAX_CUFF_TO_WAISTBAND_HF_RATIO = 3` is inherited from #374 and is not touched
 * here; clause (4) refuses a widening (§9s — its reference predates anything this slice changes).
 *
 * NOT TESTED:
 *   - Whether Kevin's cuff, once visible to the instrument, is WITHIN the 3x bound. It has never
 *     been measured. A red there is a real finding and is NOT this slice's failure — say so.
 *   - Whether any cuff LOOKS ragged. Angular-ordered HF residual; the pixel verdict is the
 *     orchestrator's.
 *   - Sleeve cuffs and collars, which that contract already records as unmeasured.
 *
 * ## FIXED (#516) — 2026-08-21
 *
 * The cuff contract now imports the shared isPantsName from waistband-ring.ts, selects trouser
 * meshes with it, and enumerates its population from the shipped directory — no garment-name
 * regex, no literal actor list, and the 3x bound is untouched. All four RED clauses above now
 * hold: kevin (scrub_pants) is visible to the cuff contract, the shared predicate is imported,
 * no garment-name literal gates mesh selection, and the population is disk-enumerated.
 *
 * The instrument now seeing kevin surfaces a geometry finding, not a failure of this slice:
 * kevin's scrub cover-shell cuff is 4.1x the 3x bound, and the two scrub-clad clinical adults
 * are 4.2x (recorded in the ankle-cuff contract's own FIXED block; the bound is not widened).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const CUFF_SRC = join(HERE, "the-ankle-cuff-is-as-smooth-as-the-waistband.test.ts");
const GENERATED = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");

/** §9h — the two actors the instrument can already see. They must not stop being measurable. */
const KNOWN_GOOD = ["mpfb-ob-patient-aisha", "mpfb-peds-patient-child"];
/** The actor the name-keyed filter cannot see today. */
const BLIND_SPOT = "mpfb-peds-nurse-kevin";

async function trouserMaterials(actor: string): Promise<string[]> {
  const doc = await new NodeIO().read(join(GENERATED, `${actor}.glb`));
  const out: string[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      if (isPantsName(name)) out.push(name);
    }
  }
  return out;
}

describe("the cuff instrument is not keyed to one garment name", () => {
  it("(1) RED: every actor the shared predicate calls trousered is visible to the cuff contract", async () => {
    // Kevin ships scrub_pants and the shared predicate matches it. The cuff contract must see him.
    const kevin = await trouserMaterials(BLIND_SPOT);
    expect(kevin.length, `${BLIND_SPOT} must carry a trouser mesh the shared predicate matches`)
      .toBeGreaterThan(0);
    const src = readFileSync(CUFF_SRC, "utf8");
    expect(
      /cargo_pants/i.test(src) === false || /isPantsName/.test(src),
      "the cuff contract must not select meshes by a garment-name literal",
    ).toBe(true);
    for (const kg of KNOWN_GOOD) {
      expect((await trouserMaterials(kg)).length, `${kg} known-good must stay trousered`).toBeGreaterThan(0);
    }
  });

  it("(2) RED: the cuff contract imports the SHARED predicate rather than re-implementing it", () => {
    // Refuses (a). Two implementations of one measurement is how this went blind (D1).
    const src = readFileSync(CUFF_SRC, "utf8");
    expect(/from "\.\/waistband-ring\.ts"/.test(src), "must import from the shared instrument").toBe(true);
    expect(/isPantsName/.test(src), "must use the shared isPantsName").toBe(true);
  });

  it("(3) RED: no garment-name literal remains in the cuff contract's mesh selection", () => {
    // Refuses (b) AND (c). A widened regex is the same defect one name later; a shrunk population
    // is a coverage check turned into decoration.
    const src = readFileSync(CUFF_SRC, "utf8");
    const selection = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    expect(
      /\/[^\n/]*(?:cargo_pants|scrub_pants)[^\n/]*\/[gimsuy]*\.test\(/.test(selection),
      "no regex over a garment NAME may gate mesh selection — key on the shared predicate",
    ).toBe(false);
  });

  it("(3b) RED: the cuff contract's population is not a literal list of actor names", () => {
    // Refuses (c) with its OWN fail line (§8i): bundled into (3) it would never run, because
    // vitest stops at the first failing expect and the regex check fails first. A cause without
    // its own proof is how a two-cause slice gets half-fixed.
    const src = readFileSync(CUFF_SRC, "utf8");
    const selection = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    expect(
      /const ACTORS\s*=\s*\[\s*"/.test(selection),
      "the population must not be a literal list of actor names (§7j, as #514 fixed next door)",
    ).toBe(false);
  });

  it("(4) NET: #374's 3x cuff bound is inherited, not widened", () => {
    // Refuses (d). §7a: a threshold in a contract becomes a design target. This one predates the
    // slice, so widening it to buy a green is always the wrong move.
    const src = readFileSync(CUFF_SRC, "utf8");
    expect(src, "MAX_CUFF_TO_WAISTBAND_HF_RATIO must remain 3")
      .toMatch(/MAX_CUFF_TO_WAISTBAND_HF_RATIO\s*=\s*3\b/);
  });
});
