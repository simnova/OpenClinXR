import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **LANE C — the deliverable is a DECISION WITH EVIDENCE, not working code.** Operator asked for a
 * background cagematch exploring animation with physics and ragdoll, and questioned whether prior
 * runs were against Anny.
 *
 * ## MEASURED FIRST, AND IT INVERTS THE PREMISE
 *
 * Prior animation work WAS largely against Anny — `anny` 15x, `anny_full`/`anny_base` 8x across the
 * retarget and BVH contracts. But `retarget-drives-the-library-rig.test.ts` (3/3 green today)
 * records in its own header:
 *
 *   rail                    bones   mixamo map
 *   hm08 library bodies       64    52 / 52   <- COMPLETE, and nobody ships it
 *   mpfb-ob-patient-aisha    137     0 / 52   <- MPFB2 native naming
 *   peds_anxious_parent       23     0 / 52   <- Anny naming
 *
 * And the live cast, enumerated from `resolveScenarioActorCast` over `listShippedCastScenarioIds`:
 * **9 of 9 assets are MPFB, zero Anny.** Anny is already out of learner casting.
 *
 * So the revisit is warranted but not as "go back to Anny". **The entire shipping rail scores 0/52
 * and no clip can drive a learner-visible actor today.**
 *
 * ## PHYSICS PRIOR ART — two rejects, both props, ragdoll never attempted
 *
 *   #457  Rapier KINEMATIC character controller, standing actor grounding  -> reject_measured
 *   #489  Rapier DYNAMIC + applyImpulse, settle, freeze, room PROP placement -> reject_measured
 *
 * Neither tested an actor ragdoll. **Bone binding is upstream of physics** — a ragdoll needs a
 * hierarchy it can drive, so a ragdoll bake-off before the binding question measures the second
 * thing first.
 *
 * ## WHAT THIS CONTRACT DOES AND DOES NOT ASSERT
 *
 * It asserts the bake-off **RAN** and was **RECORDED**. It does **NOT** assert that any candidate
 * won, and `reject_measured` on all three closes the item **successfully** — "none of these can
 * drive the MPFB rig, here is the measured reason" is the outcome this lane exists to produce.
 * `PROTO_BOARD_LOOP`: *"A lane C item that can only close by adopting something will produce an
 * adoption whether or not one is warranted."*
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                      | (1) ran | (2) measured | (3) adopt | (4) escape | result
 *   -----------------------------------------------|---------|--------------|-----------|------------|--------
 *   a) today — no artifact                         | **FAIL**|   **FAIL**   |   pass    |    pass    | REFUSED
 *   b) three rows, no bone numbers                 |   pass  |   **FAIL**   |   pass    |    pass    | REFUSED — a verdict with no measurement
 *   c) adopt a candidate with no MADR              |   pass  |     pass     | **FAIL**  |    pass    | REFUSED — the Decision needs a home
 *   d) `other` / `inconclusive_blocked` bare       |   pass  |     pass     |   pass    |  **FAIL**  | REFUSED (SS7c) — the escape value is where the real finding hides
 *   e) three candidates measured, outcomes recorded|   pass  |     pass     |   pass    |    pass    | ALL PASS, whatever the verdicts are
 *
 * (c) is the one to watch. A slice that has run three candidates will feel finished, and adopting
 * the least-bad one is the natural ending. The Decision belongs in a MADR or it is not a decision.
 *
 * claimScope: whether a motion cagematch over the MPFB 137-bone rig ran and recorded per-candidate
 *   bone-binding measurements against the hm08 52/52 control.
 * notEvidenceFor: which candidate is best; whether any motion LOOKS right (orchestrator grades any
 *   visual); runtime wiring; Quest budgets; promotion; the other 10 actors.
 *
 * ## FIXED (#545)
 * Bake-off ran on `mpfb-ob-patient-aisha` (137 bones). Artifact:
 * `tools/openclinxr/evidence/mpfb-rig-motion-cagematch.json`.
 * Outcomes: mesh2motion `reject_measured` (0/53 map, no CLI); bvh_retarget_mpfb_bone_map `partial`
 * (22/137 via mpfb2-default-no-toes.json + mcp.load_and_retarget); rapier_joint_chain_ragdoll
 * `reject_measured` (22 proxy joints, 0 skinned bones). `adopted: null`. mixamo falsifier still
 * 0/52 — premise holds. Decision: continue BVH/MPFB2 map path; do not adopt a factory default.
 */

const ARTIFACT = "tools/openclinxr/evidence/mpfb-rig-motion-cagematch.json";

/** The control, measured and landed in `retarget-drives-the-library-rig.test.ts`. Not re-derived. */
const CONTROL = { rail: "hm08-library", bones: 64, mapped: 52, of: 52 } as const;
/** The subject. 137 bones, currently 0/52 mapped. */
const SUBJECT_BONES = 137;

const OUTCOMES = ["drives_rig", "partial", "reject_measured", "inconclusive_blocked", "other"] as const;
type Outcome = (typeof OUTCOMES)[number];
type Cand = {
  id?: string; outcome?: Outcome; reason?: string;
  bonesDriven?: number; bonesTotal?: number; madr?: string;
};
type Report = { subject?: string; control?: { mapped?: number; of?: number }; candidates?: Cand[]; adopted?: string | null };

const rep = (): Report => (existsSync(ARTIFACT) ? JSON.parse(readFileSync(ARTIFACT, "utf8")) as Report : {});

describe("the MPFB rig motion cagematch ran", () => {
  it("(1) RED: the bake-off ran with at least three candidates, each carrying a valid outcome", () => {
    const c = rep().candidates ?? [];
    expect(c.length, `${ARTIFACT} missing or thin — the cagematch has not run`).toBeGreaterThanOrEqual(3);
    const bad = c.filter((x) => !x.outcome || !(OUTCOMES as readonly string[]).includes(x.outcome))
      .map((x) => `${x.id}: ${x.outcome}`);
    expect(bad, `outcome must be one of ${OUTCOMES.join(" | ")}`).toEqual([]);
  });

  it("(2) RED: every candidate that RAN records how many of the 137 bones it drove", () => {
    // A verdict with no measurement is an opinion. Candidates that never ran are exempt — that is
    // what `inconclusive_blocked` is for, and (4) makes them justify it.
    const ran = (rep().candidates ?? []).filter((x) => x.outcome !== "inconclusive_blocked");
    expect(ran.length, "no candidate actually ran").toBeGreaterThanOrEqual(1);
    const unmeasured = ran.filter((x) => typeof x.bonesDriven !== "number").map((x) => String(x.id));
    expect(unmeasured, "candidates that ran but recorded no bone count").toEqual([]);
    const wrongTotal = ran.filter((x) => x.bonesTotal !== SUBJECT_BONES).map((x) => `${x.id}:${x.bonesTotal}`);
    expect(wrongTotal, `bonesTotal must be the subject's ${SUBJECT_BONES}`).toEqual([]);
  });

  it("(3) COUNTERWEIGHT: nothing is adopted without a MADR — the Decision needs a home", () => {
    // A slice that ran three candidates will feel finished, and adopting the least-bad one is the
    // natural ending. reject_measured on all three is a SUCCESSFUL close for this lane.
    const r = rep();
    if (!r.adopted) return; // no adoption is a valid, and expected, outcome
    const c = (r.candidates ?? []).find((x) => x.id === r.adopted);
    expect(c, `adopted "${r.adopted}" is not among the candidates`).toBeTruthy();
    expect(typeof c?.madr, "an adopted candidate must name the MADR carrying its Decision").toBe("string");
    expect(c?.outcome, "only a candidate that drives the rig may be adopted").toBe("drives_rig");
  });

  it("(4) COUNTERWEIGHT: escape values carry a reason — that is where the real finding hides", () => {
    // SS7c: a closed vocabulary with no room for the truth gets satisfied by the nearest available
    // lie. `other` and `inconclusive_blocked` exist so the honest answer is sayable, and they are
    // the FIRST rows to read, so they must say something.
    const c = rep().candidates ?? [];
    const bare = c.filter((x) => (x.outcome === "other" || x.outcome === "inconclusive_blocked")
      && !(typeof x.reason === "string" && x.reason.trim().length >= 20))
      .map((x) => String(x.id));
    expect(bare, "escape-value candidates with no substantive reason").toEqual([]);
  });

  it("(5) VACUITY: the hm08 control is recorded so the comparison is anchored", () => {
    // Without the 52/52 control a 0/137 result reads as "motion is impossible here" rather than
    // "motion works on a rail we do not ship". SS9h — the known-good column.
    const r = rep();
    expect(r.subject, "the artifact must name the subject it measured").toBeTypeOf("string");
    expect(r.control?.mapped, "control mapped count").toBe(CONTROL.mapped);
    expect(r.control?.of, "control total").toBe(CONTROL.of);
  });
});
