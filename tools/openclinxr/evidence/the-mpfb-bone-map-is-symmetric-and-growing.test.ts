import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **The only map that has ever driven a shipping actor is asymmetric, and it covers 23 of 137
 * joints.** Superagent-endorsed first slice from the `#546` review of the operator's Clinical Motion
 * Primitive brief: *"expand the 23-key MPFB2 map and measure the stop. Taxonomy without a driven rig
 * is schema-ahead-of-capability."*
 *
 * ## MEASURED, do not re-derive
 *
 * `tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mpfb2-default-no-toes.json`, 23 keys:
 *
 *   paired L/R          8   clavicle, foot, lowerarm01, lowerleg01, toe1-1, upperarm01,
 *                           upperleg01, wrist
 *   unsided             6   head, neck01, root, spine03, spine04, spine05
 *   **L WITHOUT R       1   upperleg02.L**   <- and `upperleg02.R` IS present on the subject
 *
 * `#545` (landed) drove **22 of 137** bones with this map on `mpfb-ob-patient-aisha` from
 * `cmu_07_01_walk.bvh`. mixamo.json is 0/52 on the same subject and `mixamo_unity` is a different
 * 64-bone rig we do not ship (`#546`).
 *
 * The subject's 137 joints group as: hand/fingers 30, head/face 25, arm 10, leg 10, spine/root 10,
 * toes 2, breast 2, other 48 (shoulder01, metacarpal1-5, ...).
 *
 * ## THE ASYMMETRY IS A BUG, NOT A BUDGET
 *
 * `upperleg02.R` exists on the subject and is simply absent from the map. **The left thigh gets a
 * second driven segment and the right does not**, which on any locomotion clip produces a visibly
 * lopsided figure. Every other sided entry is paired — that is the known-good column (§9h), inside
 * the same file.
 *
 * Also present on the subject and unmapped, and the obvious next segments of limbs already partly
 * mapped: `upperarm02.L/R`, `lowerarm02.L/R`, `shoulder01.L/R`.
 *
 * ## WHAT THIS SLICE IS NOT
 *
 * **Not a taxonomy.** Not a Schambra primitive set, not a physics overlay, not a clinical clip
 * corpus. `#546` ruled all three premature: 22/137 cannot express `reach`, `stabilize` or `guard`
 * because the map has no finger, face or fine-arm bones, and `#545` measured the ragdoll gap as
 * WRITEBACK — an overlay on a 22-bone subset measures the second thing first.
 *
 * **Not a Mixamo rebake.** Swapping 11 actors to the 64-bone rig is a full re-bake plus weights plus
 * idle maps. `#545` already chose to continue the MPFB2 map rather than adopt Mixamo as default.
 *
 * **Not a licence expansion.** CC0/CC-BY only. The clip is the CMU BVH already in the tree.
 *
 * ## NO TARGET COVERAGE NUMBER
 *
 * This contract does not name a bone count to reach. **The point is to find where expansion stops.**
 * A map that grows to 40 keys and drives 38 is a good outcome; so is one that grows to 60 keys and
 * still drives 38, because that names a binding limit rather than a coverage figure. Naming a target
 * would make it the design target for the thing being measured (§7a), and #171 showed a threshold
 * fitted to one observation is worth nothing.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                    | (1) symmetric | (2) grows | (3) real bones | (4) drives more | result
 *   ---------------------------------------------|---------------|-----------|----------------|-----------------|--------
 *   a) today — 23 keys, upperleg02.L orphan      |   **FAIL**    | **FAIL**  |     pass       |      n/a        | REFUSED
 *   b) delete upperleg02.L to "fix" the asymmetry|     pass      | **FAIL**  |     pass       |   **FAIL**      | REFUSED — symmetry by subtraction
 *   c) pad the map with plausible bone names     |     pass      |   pass    |   **FAIL**     |   **FAIL**      | REFUSED — names that do not bind
 *   d) add keys that bind nothing                |     pass      |   pass    |     pass       |   **FAIL**      | REFUSED — key count is not coverage
 *   e) add real paired bones, measure the driven |     pass      |   pass    |     pass       |     pass        | ALL PASS
 *
 * (b) is the one to watch: deleting the orphan satisfies symmetry in one keystroke and makes the rig
 * strictly worse. (d) is the subtler one — key count is trivially inflatable and only the DRIVEN
 * count is evidence.
 *
 * claimScope: symmetry and joint coverage of the MPFB2 bone map, and the driven-bone count it
 *   achieves on one subject from one CC0 clip.
 * notEvidenceFor: whether the motion LOOKS right (orchestrator grades any render); clinical
 *   primitives; physics or ragdoll; the other 10 actors; runtime wiring; promotion.
 */

const MAP = "tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mpfb2-default-no-toes.json";
const REPORT = "tools/openclinxr/evidence/mpfb-bone-map-coverage.json";

/** Landed in #545 with the 23-key map. The floor this slice must beat. */
const CONTROL = { mapKeys: 23, bonesDriven: 22, subjectJoints: 137 } as const;

const mapKeys = (): string[] => {
  if (!existsSync(MAP)) return [];
  const d = JSON.parse(readFileSync(MAP, "utf8")) as Record<string, unknown>;
  const b = (d.bones ?? d) as Record<string, unknown>;
  return Object.keys(b);
};
type Report = { subject?: string; subjectJoints?: string[]; mapKeys?: number; bonesDriven?: number; clip?: string; unbound?: string[] };
const report = (): Report => (existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, "utf8")) as Report : {});

describe("the MPFB bone map is symmetric and growing", () => {
  it.fails("(1) RED: no sided key exists without its mirror", () => {
    // upperleg02.L has no .R, and upperleg02.R IS present on the subject. Every other sided entry
    // is paired — the known-good column is inside this same file.
    const k = mapKeys();
    const L = new Set(k.filter((x) => x.endsWith(".L")).map((x) => x.slice(0, -2)));
    const R = new Set(k.filter((x) => x.endsWith(".R")).map((x) => x.slice(0, -2)));
    const orphanL = [...L].filter((x) => !R.has(x)).sort();
    const orphanR = [...R].filter((x) => !L.has(x)).sort();
    expect([...orphanL, ...orphanR], "sided map keys with no mirror").toEqual([]);
  });

  it.fails("(2) RED: the map covers more of the 137 joints than the #545 control", () => {
    // No target number — see the header. Only "more than 23", so the slice must actually expand.
    expect(mapKeys().length, `map keys vs the ${CONTROL.mapKeys}-key control`)
      .toBeGreaterThan(CONTROL.mapKeys);
  });

  it("(3) COUNTERWEIGHT: every map key names a bone that exists on the subject", () => {
    // Refuses (c). A map padded with plausible-looking MPFB2 names inflates coverage and binds
    // nothing. The report must enumerate the subject's joints so this is checkable.
    const r = report();
    if (!r.subjectJoints) return; // clause (4) owns the missing-report failure
    const joints = new Set(r.subjectJoints);
    const missing = mapKeys().filter((k) => !joints.has(k)).sort();
    expect(missing, "map keys naming bones absent from the subject").toEqual([]);
  });

  it.fails("(4) RED: MORE bones are actually driven, not merely mapped", () => {
    // Refuses (b) and (d). Key count is trivially inflatable; only the driven count is evidence,
    // and deleting the orphan would satisfy symmetry while driving one bone FEWER.
    const r = report();
    expect(r.bonesDriven, `${REPORT} missing — no coverage measurement`).toBeTypeOf("number");
    expect(r.subjectJoints?.length, "the report must enumerate the subject's joints")
      .toBe(CONTROL.subjectJoints);
    expect(typeof r.clip, "the report must name the CC0 clip it retargeted").toBe("string");
    expect(r.bonesDriven!, `bones driven vs the ${CONTROL.bonesDriven} control`)
      .toBeGreaterThan(CONTROL.bonesDriven);
  });

  it("(5) VACUITY: the report records what did NOT bind — the stop is the finding", () => {
    // The slice's purpose is to find where expansion stops. A report that lists only successes
    // hides exactly the result worth having.
    const r = report();
    if (r.bonesDriven === undefined) return; // clause (4) owns it
    expect(Array.isArray(r.unbound), "the report must list map keys that bound nothing").toBe(true);
  });
});
