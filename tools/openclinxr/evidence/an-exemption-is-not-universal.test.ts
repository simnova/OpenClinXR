import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Portfolio effort **E5** — "no vacuous evidence test on main".
 *
 * ## HOW THE POPULATION WAS FOUND, AND THE FIRST INSTRUMENT THAT FAILED
 *
 * A grep for `.every(` / `.forEach(` / `for (const … of …)` without a length assertion returned
 * ~30 of the 354 evidence tests. That is a NAME MATCH — it counted helper loops, not assertions,
 * and it is the exact trap SS7k names. Discarded.
 *
 * The instrument that worked is a destructive probe: rewrite every conditional early-return inside
 * an `it()` body as `throw new Error("VACUITY_GUARD_TAKEN")`, run, and see which ones actually fire.
 * Five sites in three files. Measured 2026-08-20:
 *
 *   file                                            site                       fires today?
 *   ------------------------------------------------|---------------------------|------------
 *   head-focus-derivation.test.ts:194                 hair.length === 0           **YES x2**
 *   dispatch-binds-the-role-charter.test.ts:142,155   composer === null           no
 *   the-hair-pack-…-licence-inventory.test.ts:223,235 rows.length === 0           no
 *
 * ## THE DEFECT, MEASURED — IMMUTABLE
 *
 * `head-focus-derivation.test.ts:191` is titled *"the head box CONTAINS the fitted hair on **every
 * face** (#394)"* and exempts any figure with no hair. Its three subjects:
 *
 *   mpfb-ob-patient-aisha.glb     HAIR: makeclothes_library_hair_toigo_blunt_bob_with_bangs_…
 *   peds_nurse_kevin.glb          NO HAIR MESH
 *   ed_chest_pain_adult_cast.glb  NO HAIR MESH
 *
 * So the #394 obligation runs on **1 of 3** subjects. The exemption is correct per-subject — a bald
 * figure cannot cut hair it does not have. What is missing is a FLOOR: nothing asserts the
 * obligation is live for anyone. Drop aisha's hair mesh, or repoint that constant, and all three
 * exempt while the clause still reports green. The contract is one regression from fully dormant
 * and would not say so.
 *
 * The other three sites are dormant-but-covered today and are the KNOWN-GOOD COLUMN (SS9h): a
 * conditional exemption that does not fire is exactly what a healthy one looks like, and their
 * existence proves the probe distinguishes the two states rather than flagging every guard.
 *
 * NOTE, out of scope and not fixed here: `dispatch-binds-the-role-charter.test.ts:85` still reads
 * *"(1) and (2) are RED — the composer does not exist"*, but its `composer === null` guard does not
 * fire, so the composer DOES exist and that header sentence is stale.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) floor | (2) exemption kept | (3) not brittle | result
 *   -------------------------------------------------|-----------|--------------------|-----------------|--------
 *   a) today — exemption with no floor                | **FAIL**  |       pass         |      pass       | REFUSED
 *   b) delete the exemption, require hair everywhere  |   pass    |     **FAIL**       |      pass       | REFUSED
 *   c) hardcode "exactly 1 subject has hair"          |   pass    |       pass         |    **FAIL**     | REFUSED
 *   d) assert AT LEAST ONE subject carries the duty   |   pass    |       pass         |      pass       | ALL PASS
 *
 * **(b) is the one to watch.** Requiring hair on every subject is the obvious way to make the clause
 * unconditional, and it reds two figures that are correctly bald — `ed_chest_pain_adult_cast` has no
 * hair mesh at all. Clause (2) requires the per-subject exemption to survive.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED** — no floor exists. (2) and (3)
 * pass today and exist so (1) cannot be satisfied by deleting the exemption or by pinning a count.
 * (4) is a NET on the probe's own discrimination.
 *
 * NOT TESTED:
 *   - The other 349 evidence tests. The probe was run over the five sites a conditional-early-return
 *     scan found; a contract can be vacuous in ways that scan cannot see (an `it.fails` satisfied by
 *     the wrong failure, a threshold nothing can cross). Bounded on purpose, and stated.
 *   - `garment-bake-matrix.test.ts:134` — `describe.skipIf(!garmentBakesEnabled())`. That block
 *     never runs here because `OPENCLINXR_RUN_GARMENT_BAKES=1` is a standing prohibition on this
 *     machine. Deliberately dormant, not a defect, and NOT in scope.
 *   - Whether `peds_nurse_kevin.glb` SHOULD have hair. `mpfb-peds-nurse-kevin.glb` carries
 *     `mhair02`; the Anny-rail file of a similar name does not. Different asset, different question.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const HEAD_FOCUS = join(HERE, "head-focus-derivation.test.ts");

/** The three subjects `head-focus-derivation` runs its head-box contract over. */
const SUBJECTS = ["mpfb-ob-patient-aisha.glb", "peds_nurse_kevin.glb", "ed_chest_pain_adult_cast.glb"] as const;

async function hasFittedHair(file: string): Promise<boolean> {
  const doc = await new NodeIO().read(join(GENERATED, file));
  return doc.getRoot().listMeshes().some((m) => /hair/i.test(m.getName() ?? ""));
}

/** Subjects that carry the #394 containment obligation, measured off the shipped GLBs. */
async function subjectsWithHair(): Promise<string[]> {
  const out: string[] = [];
  for (const file of SUBJECTS) if (await hasFittedHair(file)) out.push(file);
  return out;
}

const headFocusSource = readFileSync(HEAD_FOCUS, "utf8");

describe("a conditional exemption in an evidence contract is not universal", () => {
  it.fails("(1) RED: head-focus asserts its #394 obligation is live for at least one subject", () => {
    // The floor. `head-focus-derivation` exempts hairless figures and never asserts that ANY figure
    // carries the duty, so the clause can go fully dormant while reporting green.
    const hasFloor =
      /subjectsWithHair|withHair\.length\).toBeGreaterThan|HAIR_SUBJECT_FLOOR|at least one .*hair/i.test(
        headFocusSource,
      );
    expect(
      hasFloor,
      `head-focus-derivation.test.ts exempts hairless subjects at :194 and asserts no floor — today\n`
        + `  1 of 3 subjects carries the obligation; at 0 the clause is dormant and still green`,
    ).toBe(true);
  });

  it("(2) COUNTERWEIGHT: the per-subject exemption still exists", async () => {
    // Refuses (b). Two of the three subjects have no hair mesh at all — requiring hair everywhere
    // would red figures that are correctly bald. The exemption is right; only the floor is missing.
    expect(
      /if \(hair\.length === 0\) return;/.test(headFocusSource),
      "the hairless-subject exemption at :194 must survive — a bald figure cannot cut hair it lacks",
    ).toBe(true);
    const bald = (await Promise.all(SUBJECTS.map(async (f) => ((await hasFittedHair(f)) ? null : f)))).filter(
      Boolean,
    );
    expect(bald.length, `subjects legitimately without hair: ${bald.join(", ")}`).toBeGreaterThan(0);
  });

  it("(3) COUNTERWEIGHT: the floor is not a pinned count", () => {
    // Refuses (c). "exactly 1 subject has hair" goes red the day a second figure gains a hairstyle,
    // which is a change everyone wants. A floor is a lower bound, never an equality.
    expect(
      /withHair\.length\).toBe\(\d+\)|=== 1, ["'`]exactly/.test(headFocusSource),
      "the floor must be a lower bound, not an equality on today's subject count",
    ).toBe(false);
  });

  it("(4) NET: the probe discriminates — a live obligation and a dormant one look different", async () => {
    // KNOWN-GOOD COLUMN. If EVERY subject were bald the probe could not tell a healthy exemption
    // from a dormant contract, and clause (1) would be unachievable rather than merely red.
    const withHair = await subjectsWithHair();
    expect(
      withHair.length,
      `no subject carries fitted hair — the #394 obligation is ALREADY dormant, which is worse than\n`
        + `  this contract assumes; subjects checked: ${SUBJECTS.join(", ")}`,
    ).toBeGreaterThan(0);
    expect(withHair.length, `and not all of them, or the exemption would be dead code`).toBeLessThan(
      SUBJECTS.length,
    );
  });
});
