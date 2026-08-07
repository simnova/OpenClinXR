import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#87) — the figure clears the height contract by folding harder, not by
 * sitting down.
 *
 * ALL THREE ARE `it.fails` AND ALL THREE FLIP TO `it(`. They are not all REDs:
 *   (1) and (2) are REDs — behaviour that does not exist.
 *   (3) is a COUNTERWEIGHT — behaviour that is ALREADY TRUE (#83 measured Δh = 0.33 m) and must
 *       survive your change. It is `it.fails` only because the module does not exist yet.
 * A counterweight planted as a plain `it(` reddens main for the whole dispatch window; uniform
 * `it.fails` at plant time is the fix and the header carries the semantics.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG, AND IT WAS THE CONTRACT'S FAULT
 *
 * #83 required a seated figure's skinned mesh to be ≥0.25 m shorter than a standing one, and its
 * header claimed 0.25 was generous and "not a threshold search". `seated-pose.ts:37-49` now reads:
 *
 *     HIP_FLEX = 105°, KNEE_FLEX = 115°, pelvis +18°, spine +12°, chest +4°
 *
 * with a comment saying the deepening exists for the 0.25 m margin. Δh came out 0.33 m, the contract
 * went green, and the rendered figure sits with its chin on its chest, arms splayed, and a spike
 * through the torso. The worker's own retro: *"threshold-shaped, not garment-measured."*
 *
 * A threshold over a quantity the implementation AUTHORS is a design target. Codified §7a.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT I PROPOSED FOR THIS ISSUE AND WHY IT IS NOT HERE
 *
 * I proposed bounding the other direction: trunk-vs-up under 25°, head-forward within 30° of
 * horizontal, and no garment vertex more than 2 cm inside the body. A peer round refused all three
 * and produced a pose that passes every one while still looking broken — trunk near-vertical, head
 * barely nodded, arms left at the map's own `upper_arm ±30°/±12°` defaults giving a T-pose splay,
 * and the torso spike unverified as poke-through so the penetration check stays silent. It also
 * pointed out that pelvis/spine/head world angles are computed from `SEATED_BONE_EULERS`
 * (`seated-pose.ts:40-61`) — the very table under test. That is §7a again, one level down.
 *
 * On prior art it was unambiguous: games and VR use seat IK with contact targets, authored sit
 * clips, and joint limits as soft IK constraints, and **animators eyeball the result**. Nobody
 * ships "looks like a sit" as a unit test.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * SO THIS CONTRACT IS A FLOOR AND SAYS SO. It is NECESSARY AND NOT SUFFICIENT. Passing it does not
 * mean the figure looks like a person sitting; the orchestrator reads the render and records the
 * verdict on #87, and that grade is what closes the issue. Do not treat green here as done.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY (1) AND (2) PULL AGAINST EACH OTHER, WHICH IS THE POINT
 *
 * (2) caps hip flexion at 95°, which is ordinary seated anatomy and is BELOW the 105° currently
 * shipped. (3) still demands Δh ≥ 0.25 m. You cannot satisfy both by folding harder — the cap
 * forbids it. The height has to come from somewhere else, and the only place it can come from is
 * the pelvis actually descending onto the seat, which is (1).
 *
 * That is the whole design: make the cheap way out unavailable so the real one is the only one
 * left. An upper bound cannot be gamed by exceeding it.
 *
 * (1) is also the one measurement here that is INDEPENDENT of the pose table — it is a relationship
 * between the figure's pelvis and the CHAIR's seat surface, two separately-authored objects. Angles
 * derived from `SEATED_BONE_EULERS` are the code grading itself.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * FORBIDDEN ASSERTIONS, from six gates that passed on their own defect:
 *   - any `openClinXr*` userData field
 *   - `applyPosturePose`'s return value or `bonesTouched`
 *   - equality against the authored Euler table itself
 * If your check reads a value the posture code just wrote, it is the seventh.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE CAUSE OF THE ARMS AND THE SPIKE IS NOT KNOWN TO ME — trace it; do not take a hypothesis of
 * mine as fact. My last hypothesis on this figure was refuted by the worker. Candidates, UNRANKED,
 * possibly all wrong, possibly an interaction:
 *   - arms sit at the map's own defaults and were never authored for a seated figure
 *   - the spike is garment poke-through from the deep fold
 *   - the spike is a skinning weight blowout on the body itself, not garment at all
 *   - seated actors get no mixer, so nothing drives the upper body between pose writes
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `measureSeatedContact()` returning one entry per
 * seated actor from a real page load. Change the call sites and say why if a different shape is
 * better. What must not change: seat contact is measured between the figure and the chair geometry,
 * flexion is measured from posed world transforms, and nothing reads a field the posture code sets.
 *
 * MEASURE ONCE. `measureLivePostureGeometry` spawns its own dev server per call and three tests cost
 * three cold Vite boots and 542 s (#83). Measure once into an artifact under
 * `.openclinxr/evidence/seated-posture/`, then assert against the artifact.
 *
 * IN-SCOPE VISUAL VERDICT is required in your report, and must NAME THE BODY REGION and what it
 * looks like — "the head sits upright facing forward" or "the head still hangs toward the chest",
 * not "improved". #83's report said "not a natural clinical sit" for a figure with its chin on its
 * chest and a spike through it, and that cost a cycle.
 *
 * If satisfying this makes the figure look worse than the current fold does, say so in your report
 * and satisfy it anyway. That will not be read as refusing the work.
 *
 * SCOPE: whether a seated figure rests on the chair within ordinary seated joint range. Says NOTHING
 * about arm placement, gaze, facial expression, or clinical appropriateness — the last needs a
 * clinician and is not claimed. The arms and the torso spike are NOT fixed by this contract and
 * remain open on #87.
 */

const load = async () =>
  import("./seated-contact-and-flexion.js") as Promise<Record<string, unknown>>;

type SeatedContact = {
  actorId: string;
  /** Vertical gap between the figure's pelvis and the chair's seat surface, both in world space. */
  pelvisToSeatGapMeters: number;
  /** Degrees, from posed world transforms — not read back from the authored Euler table. */
  hipFlexionDegrees: number;
  kneeFlexionDegrees: number;
  /** Skinned-mesh world height, so the counterweight can be checked from the same artifact. */
  meshHeightMeters: number;
  standingReferenceHeightMeters: number;
  framesAdvanced: number;
};
type Measure = () => Promise<{ scenarioId: string; seated: SeatedContact[] }>;

/** Ordinary seated hip flexion. The shipped pose is 105°, chosen to clear a height threshold. */
const HIP_FLEXION_CEILING_DEGREES = 95;

describe("a seated figure rests on the chair within ordinary joint range (#87)", () => {
  it.fails("the pelvis rests on the seat rather than hovering above it", async () => {
    // The independent measurement: figure against CHAIR, two separately-authored objects. Nothing
    // in the pose table can satisfy this by itself.
    const mod = await load();
    const measure = mod["measureSeatedContact"] as Measure | undefined;
    expect(measure).toBeTypeOf("function");

    const report = await measure!();
    expect(report.seated.length, "no seated actor in the scene").toBeGreaterThan(0);
    for (const actor of report.seated) {
      expect(actor.framesAdvanced, `${actor.actorId} measured before the loop advanced`).toBeGreaterThan(0);
      expect(
        actor.pelvisToSeatGapMeters,
        `${actor.actorId} pelvis floats ${actor.pelvisToSeatGapMeters.toFixed(3)}m above the seat`,
      ).toBeLessThan(0.12);
      expect(
        actor.pelvisToSeatGapMeters,
        `${actor.actorId} pelvis is ${Math.abs(actor.pelvisToSeatGapMeters).toFixed(3)}m INSIDE the seat`,
      ).toBeGreaterThan(-0.06);
    }
  }, 600_000);

  it.fails("hip flexion stays within ordinary seated range", async () => {
    // An UPPER bound cannot be gamed by exceeding it, and it directly forbids the move that made
    // #83 green: deepening the fold to buy mesh height. 95° is ordinary sitting; the shipped pose
    // is 105° and says in its own comment that the extra exists for the 0.25m margin.
    const mod = await load();
    const measure = mod["measureSeatedContact"] as Measure | undefined;
    expect(measure).toBeTypeOf("function");

    const report = await measure!();
    for (const actor of report.seated) {
      expect(
        actor.hipFlexionDegrees,
        `${actor.actorId} hip is folded to ${actor.hipFlexionDegrees.toFixed(1)}° — past sitting, toward curling up`,
      ).toBeLessThanOrEqual(HIP_FLEXION_CEILING_DEGREES);
      // And still actually seated, or "standing" trivially satisfies the ceiling.
      expect(
        actor.hipFlexionDegrees,
        `${actor.actorId} hip is only ${actor.hipFlexionDegrees.toFixed(1)}° — that is standing`,
      ).toBeGreaterThan(60);
    }
  }, 600_000);

  it.fails("the seated silhouette is still materially shorter than standing (COUNTERWEIGHT — already true at 0.33m)", async () => {
    // #83's guarantee, which must survive the flexion cap. Satisfying the cap by straightening the
    // legs would break this — that tension is the design.
    const mod = await load();
    const measure = mod["measureSeatedContact"] as Measure | undefined;
    expect(measure).toBeTypeOf("function");

    const report = await measure!();
    for (const actor of report.seated) {
      expect(
        actor.standingReferenceHeightMeters - actor.meshHeightMeters,
        `${actor.actorId} seated ${actor.meshHeightMeters.toFixed(3)}m vs standing ${actor.standingReferenceHeightMeters.toFixed(3)}m`,
      ).toBeGreaterThan(0.25);
    }
  }, 600_000);
});
