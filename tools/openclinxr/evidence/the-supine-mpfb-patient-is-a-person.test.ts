import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #492 INTERIM — stop four learner stations rendering a wad. Superagent-directed after `#495`.
 *
 * ## WHAT `#495` PROVED — GRADED, IMMUTABLE
 *
 * One ablation sheet, one gowned MPFB body, three cells through the product path:
 *
 *   standing    no supine call          ->  a recognisable gowned woman, upright
 *   root_only   root basis, NO eulers   ->  A RECOGNISABLE PERSON LYING FLAT ON HER BACK
 *   full        root + all 17 eulers    ->  THE CRUMPLED WAD
 *
 * The 17 `SUPINE_BONE_EULERS` were tuned against the 23-bone Anny rest pose. On the MPFB rig they
 * are the crumple. `root_only` is stiff — arms slightly out, no elbow or knee flex — but it is a
 * person, and four learner stations currently show refuse.
 *
 * ## THE MEASUREMENT THAT MUST SHAPE THIS CONTRACT
 *
 *   root_only   height 446 mm   minY 0.570
 *   full        height 446 mm   minY 0.570
 *
 * **One is a person, one is refuse, and every AABB-derived number matches to three decimals.** No
 * mesh-bounds assertion can separate them. `#495`'s own vacuity guard — "cell heights must differ" —
 * passed on `standing`'s 1687 mm while the two cells that mattered were identical.
 *
 * **So this contract does not assert appearance and does not pretend to.** It asserts the SWITCH:
 * that MPFB-rail bodies skip the Anny-tuned eulers while the Anny rail keeps them. Whether the
 * result is a person is the orchestrator's pixel grade on a re-captured ED station, and that grade
 * is the gate — a green contract here is worth nothing on its own. `#491` and `#494` both landed
 * green over a broken figure.
 *
 * ## THIS IS AN INTERIM, AND SAYING SO IS PART OF THE CONTRACT
 *
 * The durable fix is a real recumbent pose. A CC0 **hm08-native** BVH exists —
 * `Laying on Back 0001/0002.bvh`, *"arms to the sides, head & neck tilted up to rest on pillow"* —
 * recorded in the licence ledger, **not acquired**, and being measured in a parallel slice.
 * **Caveat carried from the superagent:** hm08-native is proven for the LIBRARY rail, not
 * automatically for MPFB — `retarget-drives-the-library-rig.test.ts` measured the Mixamo target map
 * at 52/52 on hm08 and **0/52 on the MPFB 137-bone rig**.
 *
 * Incline follow and HOB articulation stay with the deck plant (`#494`), NOT with these eulers.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                      | (1) skip | (2) anny keeps | (3) map intact | result
 *   -----------------------------------------------|----------|----------------|----------------|--------
 *   a) today — MPFB gets the Anny eulers            | **FAIL** |     pass       |     pass       | REFUSED
 *   b) delete SUPINE_BONE_EULERS outright           |   pass   |   **FAIL**     |   **FAIL**     | REFUSED
 *   c) skip eulers for EVERY rig                    |   pass   |   **FAIL**     |     pass       | REFUSED
 *   d) skip on the MPFB rail only, map preserved    |   pass   |     pass       |     pass       | ALL PASS
 *
 * **(c) is the one to watch.** Skipping everywhere is one line and it un-poses the Anny body, which
 * is the known-good control every supine measurement calibrates against and the reason L7 is parked.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED.** (2) and (3) pass today and stop
 * (1) being satisfied by deletion or a blanket skip. (4) is a vacuity guard.
 *
 * NOT TESTED: that the result LOOKS right — the orchestrator's re-captured ED grade decides that,
 * and it is the gate. `seated`. Whether the stiff arms read acceptably to a clinician. Whether the
 * BVH supersedes this entirely, which is the parallel slice's question.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const SUPINE_SRC = join(REPO_ROOT, "apps/ui-xr/src/supine-pose.ts");
const REPORT = join(HERE, "supine-rail-euler-switch.json");

/** The 17 authored keys — clause (3) pins every one. */
const MAP_BONES = [
  "pelvis", "spine", "chest", "thighL", "thighR", "shinL", "shinR", "footL", "footR",
  "upper_armL", "upper_armR", "forearmL", "forearmR", "handL", "handR", "neck", "head",
] as const;

type Rail = { bodyGlb: string; rail: "mpfb" | "anny"; jointCount: number; appliedJointEulers: boolean };
type Report = { schemaVersion: string; obtainedBy: string; rails: Rail[] };

function requireReport(): Report {
  expect(existsSync(REPORT), `${REPORT} must exist — measured through the runtime pose call`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}
const railOf = (r: Report, rail: "mpfb" | "anny"): Rail => {
  const row = r.rails.find((x) => x.rail === rail);
  expect(row, `the report must carry the ${rail} rail`).toBeDefined();
  return row!;
};

describe("a supine MPFB patient is posed by the rail that fits it", () => {
  it.fails("(1) RED: the MPFB rail skips the Anny-tuned joint eulers", () => {
    const r = requireReport();
    // SS6v: the numbers must come from CALLING applySupinePose on a loaded graph, never from a
    // static read. Two of my diagnoses on this defect died by measuring a proxy.
    expect(
      /applySupinePose|applyAndPlantSupineOnDeck|isolated-subject-lab/.test(r.obtainedBy ?? ""),
      `obtainedBy must name the runtime pose path; got ${JSON.stringify(r.obtainedBy)}`,
    ).toBe(true);
    expect(/NodeIO|gltf-transform/i.test(r.obtainedBy ?? ""), "a static glTF read is not the path").toBe(false);
    const mpfb = railOf(r, "mpfb");
    expect(mpfb.jointCount, "the MPFB rail is >100 joints").toBeGreaterThan(100);
    expect(mpfb.appliedJointEulers, `${mpfb.bodyGlb} must NOT receive the 23-bone Anny euler table`).toBe(false);
  });

  it("(2) COUNTERWEIGHT: the Anny rail still receives them", () => {
    // Refuses (b) and (c). The Anny body is the known-good control every supine measurement
    // calibrates against — it is why L7 is parked — and a blanket skip un-poses it.
    if (!existsSync(REPORT)) return;
    const anny = railOf(requireReport(), "anny");
    expect(anny.jointCount, "the Anny rail is 23 joints").toBeLessThan(30);
    expect(anny.appliedJointEulers, `${anny.bodyGlb} keeps the table it was tuned for`).toBe(true);
  });

  it("(3) COUNTERWEIGHT: all 17 authored eulers survive in source", () => {
    // Refuses (b). Skipping is a rail decision, not a deletion.
    const src = readFileSync(SUPINE_SRC, "utf8");
    for (const b of MAP_BONES) {
      expect(src.includes(`["${b}"`), `SUPINE_BONE_EULERS must still author "${b}"`).toBe(true);
    }
  });

  it("(4) VACUITY GUARD: the report distinguishes two rails, not one row twice", () => {
    if (!existsSync(REPORT)) return;
    const r = requireReport();
    expect(new Set(r.rails.map((x) => x.rail)).size, "both rails must be measured").toBe(2);
    expect(new Set(r.rails.map((x) => x.bodyGlb)).size, "two distinct bodies").toBe(2);
    expect(statSync(SUPINE_SRC).size, "the source is readable").toBeGreaterThan(0);
  });
});
