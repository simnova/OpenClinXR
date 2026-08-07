import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#83) — the seated pose is written, then overwritten, and every gate so far has
 * measured the write rather than the result.
 *
 * TWO `it.fails` FLIP (1 and 2). THE THIRD IS NOT A RED — it is the counterweight that stops "fold
 * everyone" from satisfying the other two, and it must be GREEN THE MOMENT `measureLivePostureGeometry`
 * exists and stay green. It is red right now only because the module is absent; that is a missing
 * import, not missing behaviour, and standing actors measure ~1.66 m today. This header is THE RECORD,
 * not scratch: flip the two, append a `## FIXED (#83)` block below, and leave the measured tables
 * intact.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS CONTRACT LOOKS NOTHING LIKE THE LAST ONE
 *
 * Six gates in this repo have now passed on the defect they were written to catch. Five were
 * shoulder-coverage proxies; the sixth was mine, on #81 — it asserted a seated actor is "bound to a
 * seated clip" by reading `openClinXrPostureClipName`, a userData marker that `applyPosturePose`
 * writes BEFORE its bone loop and unconditionally (`apps/ui-xr/src/seated-pose.ts:71-75` then
 * `:96-114`). It passes with `bonesTouched: []`.
 *
 * THE COMMON SHAPE OF ALL SIX: the gate read a value the code under test had just set, or a scalar
 * proxy for an area/shape property. A marker written by the implementation is not evidence about the
 * implementation. DO NOT ASSERT ON `bonesTouched`, on any `openClinXr*` userData field, or on the
 * return value of `applyPosturePose`. All three are the same mistake a seventh time.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS ALREADY PROVEN — do not re-litigate these, they cost a peer round to establish
 *
 *   three.js strips dots from glTF node names (PropertyBinding.sanitizeNodeName), so file-side
 *   `thigh.L` is scene-side `thighL`. The map's undotted keys ARE the live ones.
 *       thigh.L -> thighL      upper_arm.L -> upper_armL      index_finger_base.R -> index_finger_baseR
 *
 *   The rotation map WORKS in isolation. Measured on `peds_patient_child.glb`: applying it moves the
 *   foot's world Y by ~1.47 m. The legs fold. This is not a bone-naming bug and an earlier version of
 *   this issue that said so was WRONG and has been withdrawn.
 *
 * So the pose is written correctly and the rendered figure still stands. Something downstream undoes
 * it.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE CAUSE IS NOT KNOWN TO ME BEYOND THE RENDER — trace it yourself; do not take a hypothesis of
 * mine as fact. My last confident diagnosis on this issue was wrong in a way that a worker would
 * have spent a turn disproving.
 *
 * Candidates, UNRANKED, one line each, and possibly ALL WRONG — the answer may be an interaction
 * between two of them rather than any single one:
 *   - an AnimationMixer replays clips carrying full leg quaternion tracks over the static write
 *   - the capture path samples a fixed pose time rather than the live scene
 *   - clip selection falls back to a standing clip when the named seated clip is absent from the GLB
 *   - the re-seat at main.ts:8238-8243 and the per-frame update race in an order nobody chose
 * Measure the running scene. Name the interaction you actually find even if it is not on this list.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * NAME THE PROBE — do not build a fourth measurement harness
 *
 * `tools/openclinxr/asset-pipeline/ui-xr-environment-room-capture.ts` already drives the real page
 * and already has a working `page.evaluate`. EXTEND IT. A previous slice lost roughly a third of its
 * session inventing a `page.evaluate` from scratch in a temp dir (playwright would not resolve; a
 * TS-transformed arrow died on `__name is not defined`; a string arrow returned undefined because it
 * was an expression rather than an invocation). That is a solved problem in this repo — reuse it.
 *
 * DUMP BEFORE YOU EDIT. Write the first full measurement pass to
 * `.openclinxr/evidence/seated-posture/posture-measurements.json` with fixed field names, one row per
 * actor, BEFORE any product change. Any later change to a threshold in this file must cite which rows
 * flipped and why. That turns "did you move the goalposts" from a question about your account of
 * yourself into a diff.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THESE THREE PULL APART
 *
 * (1) is measured on the SKINNED MESH, not on bones — bone transforms can be perfect while bad
 * weights leave the mesh standing, and this repo has shipped exactly that class before. (2) is the
 * relationship between two DIFFERENT actors in the same live scene, so a global scale or a camera
 * change cannot satisfy it. (3) forbids the cheap satisfaction of both — folding every figure — and
 * is GREEN TODAY, so if your change breaks it you have made the product worse, not better.
 *
 * Two instruments agreeing is not correctness (#59: a NodeIO AABB and a three.js AABB agreed to 1e-4
 * on six humanoids that were rendering head-down, because an inverted figure is exactly as tall as an
 * upright one). Mesh height is used here only as a RELATIVE measure between two postures of the same
 * asset in one scene, which is the comparison that metric can actually make. It still cannot see
 * whether the sit looks natural. That verdict is read off the pixels and recorded by the orchestrator
 * on #83.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `measureLivePostureGeometry()` returning one
 * entry per actor from a real page load. Change the call sites and say why if a different shape is
 * better. What must not change: the numbers come from the RUNNING SCENE after the frame loop has
 * advanced, they describe the SKINNED MESH, and no assertion reads a field the posture code sets.
 *
 * IF SATISFYING THIS CONTRACT WILL MAKE THE PRODUCT VISIBLY WORSE THAN BEFORE, say so in your report
 * — and then satisfy it anyway. Naming it is not disobedience and will not be read as refusing the
 * work.
 *
 * IN-SCOPE VISUAL VERDICT: your report must contain a line of the form "this looks like ___, which
 * is / is not what the contract was trying to produce." Also report, separately, any OUT-OF-SCOPE
 * wrongness you saw and are not fixing — name the body part or object and what it looks like, not
 * the word "deformed". That is not scope creep and will not be read as criticising the work.
 *
 * SCOPE: whether a figure declared seated is in a seated configuration in the running scene. Says
 * nothing about whether the sit looks natural, whether hands rest plausibly, or whether it is
 * clinically appropriate — that last needs a clinician and is not claimed.
 */

const load = async () =>
  import("./seated-posture-survives-mixer.js") as Promise<Record<string, unknown>>;

/**
 * One row per actor, measured from the live page AFTER the render loop has advanced.
 * `meshHeightMeters` / `lowestVertexY` describe the SKINNED mesh's world bounds, not bone nodes.
 */
type PostureGeometry = {
  actorId: string;
  declaredPosture: "standing" | "seated" | "supine";
  meshHeightMeters: number;
  lowestVertexY: number;
  highestVertexY: number;
  framesAdvanced: number;
};
type Measure = () => Promise<{ scenarioId: string; actors: PostureGeometry[] }>;

const seatedActors = (actors: PostureGeometry[]) => actors.filter((a) => a.declaredPosture === "seated");
const standingActors = (actors: PostureGeometry[]) => actors.filter((a) => a.declaredPosture === "standing");

describe("a figure declared seated is seated in the running scene (#83)", () => {
  it.fails("a seated actor's skinned mesh is materially shorter than a standing one in the same scene", async () => {
    // THE PRODUCT ASSERTION. A seated adult's silhouette is roughly 0.35-0.45 m shorter than the same
    // adult standing. 0.25 m is deliberately below any plausible sit so this is not a threshold
    // search — the current defect measures ZERO difference, and a real sit clears this by a wide
    // margin. If a genuine sit lands close to 0.25 m, say so and cite the calibration artifact
    // rather than moving the number.
    const mod = await load();
    const measure = mod["measureLivePostureGeometry"] as Measure | undefined;
    expect(measure).toBeTypeOf("function");

    const report = await measure!();
    const seated = seatedActors(report.actors);
    const standing = standingActors(report.actors);
    expect(seated.length, "the scene declared no seated actor").toBeGreaterThan(0);
    expect(standing.length, "no standing actor to compare against").toBeGreaterThan(0);

    // Measured after the loop has run, or the mixer has not had a chance to clobber anything and the
    // test proves nothing about the failure mode.
    for (const actor of report.actors) {
      expect(actor.framesAdvanced, `${actor.actorId} was measured before the render loop advanced`).toBeGreaterThan(0);
    }

    const tallestSeated = Math.max(...seated.map((a) => a.meshHeightMeters));
    const shortestStanding = Math.min(...standing.map((a) => a.meshHeightMeters));
    expect(
      shortestStanding - tallestSeated,
      `seated ${tallestSeated.toFixed(3)}m vs standing ${shortestStanding.toFixed(3)}m — the seated figure is not folded`,
    ).toBeGreaterThan(0.25);
  }, 600_000);

  it.fails("a seated actor is supported by the chair rather than hovering above it or sunk into the floor", async () => {
    // Kills the cheap satisfaction of the first contract: scaling a figure down, or dropping it
    // through the floor, both shorten the mesh. A seated figure's feet still reach the ground and its
    // silhouette still starts at the floor.
    const mod = await load();
    const measure = mod["measureLivePostureGeometry"] as Measure | undefined;
    expect(measure).toBeTypeOf("function");

    const report = await measure!();
    for (const actor of seatedActors(report.actors)) {
      expect(
        actor.lowestVertexY,
        `${actor.actorId} sinks below the floor at y=${actor.lowestVertexY.toFixed(3)}`,
      ).toBeGreaterThan(-0.05);
      expect(
        actor.lowestVertexY,
        `${actor.actorId} hovers with its lowest point at y=${actor.lowestVertexY.toFixed(3)}`,
      ).toBeLessThan(0.2);
      // And it is a folded human, not a crushed one.
      expect(
        actor.meshHeightMeters,
        `${actor.actorId} is ${actor.meshHeightMeters.toFixed(3)}m tall seated — that is not a person`,
      ).toBeGreaterThan(0.8);
    }
  }, 600_000);

  it("standing actors are not folded (NOT A RED — green today, must stay green)", async () => {
    // The counterweight. Both contracts above are satisfiable by folding every figure in the scene;
    // this one is not, and it passes right now. If your change turns this red you have traded one
    // visible defect for another.
    const mod = await load();
    const measure = mod["measureLivePostureGeometry"] as Measure | undefined;
    expect(measure).toBeTypeOf("function");

    const report = await measure!();
    for (const actor of standingActors(report.actors)) {
      expect(
        actor.meshHeightMeters,
        `${actor.actorId} declares standing but measures ${actor.meshHeightMeters.toFixed(3)}m`,
      ).toBeGreaterThan(1.2);
    }
  }, 600_000);
});
