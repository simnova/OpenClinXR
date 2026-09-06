import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#72) — nothing in this project can see two objects at once.
 *
 * ALL THREE `it.fails` FLIP. This header is THE RECORD, not scratch — flip them, append a
 * `## FIXED (#72)` block below, and leave the measured tables intact.
 *
 * WHAT WAS SEEN. #69 produced the first screenshot of the assembled scene. In
 * `.openclinxr/evidence/ui-xr-environment-room/latest/telehealth_diabetes_health_literacy_v1-room.png`
 * a figure standing in open floor shows head, shoulders, torso and arms and NOTHING BELOW — the floor
 * plane crosses it at the hips, with nothing occluding it.
 *
 * EVERY PLACEMENT TABLE IN THE TREE SAYS THE FEET SHOULD BE ON THE FLOOR:
 *
 *   ED explicit       slot y=1.06, scale 1.1, verticalOffsetMeters=-0.98   main.ts:3598-3601
 *   generated actors  slot y=0.95, scale 1.0, verticalOffsetMeters=-0.95   runtime-bundles.ts:1409-1413
 *   floor             0.08 thick, centre y=-0.04  ->  top at y = 0.00      station-environment.ts:51-58
 *   GLB feet          y ~= 0.05 in the asset's own space                   humanoid-proportions-probe
 *
 *   ED         1.06 + (-0.98 * 1.1) = -0.018, feet at 0.055  ->  ~0.04, ON THE FLOOR
 *   generated  0.95 + (-0.95)       =  0.00,  feet at 0.05   ->  ~0.05, ON THE FLOOR
 *
 * THE CAUSE IS NOT KNOWN TO ME. I guessed #67's armature change had made the offsets stale and my own
 * arithmetic refutes it. Reading the constants again cannot answer this — I have done it twice. The
 * next measurement is LIVE: per actor, the slot world matrix, the humanoid child's world Y, the
 * lowest skinned-mesh vertex Y, the floor's world top Y, the loaded actorId, and bundleScenarioId
 * versus selectedScenarioId. Trace it; do not take a hypothesis of mine as fact.
 *
 * A CANDIDATE I HAVE NOT RULED OUT, offered unranked alongside the others rather than as a lead:
 * `encounterRuntimeAssetBundle` is initialised to the ED chest-pain bundle unconditionally
 * (`main.ts:571`), and `isSelectedScenarioRuntimeBundleMismatch()` (`:3236`) then gates actor and prop
 * visibility across the scene (`:3606`, `:3511`, `:3539`). Whether the telehealth capture ran on a
 * telehealth bundle or on the ED fallback is UNVERIFIED. Others not ruled out: the floor's Z moves
 * with descriptor depth while actors sit at fixed world Z; a mesh-origin difference between assets;
 * the wrong asset loaded into the slot. I have not distinguished between any of them.
 *
 * POSTURE IS THE TRAP IN THE THIRD CONTRACT'S NEIGHBOURHOOD. A check that asserts "feet touch the
 * floor" breaks the moment a patient is authored supine on a stretcher or seated — and the telehealth
 * descriptor already carries a `patient_chair` fixture, so a STANDING figure in a home visit may be
 * the wrong posture rather than the wrong height. There is no posture concept in the placement types
 * today. If posture turns out to be the answer, SAY SO AND RECORD IT; do not build a posture system
 * speculatively, and do not let the standing check silently assume every actor stands forever.
 *
 * THE THREE CONTRACTS PULL APART.
 *
 * The first demands a real measurement of an assembled scene — satisfiable by a stub that returns the
 * numbers it was given, so the second demands the check FAIL on a deliberately displaced actor. The
 * third is about a different failure entirely: a runtime that composes an ED roster into a telehealth
 * encounter must say so. Passing the first two by making the ED case work says nothing about it.
 *
 * MEASURE INDEPENDENTLY, NOT BY RE-READING WHAT YOU SET. A check that recomputes the placement
 * constants and compares them to themselves proves nothing — the numbers above already agree with
 * each other and the picture is still wrong. World bounds from a built scene are the evidence.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `assessActorFloorComposition({ actors, floorTopY })`
 * returning per-actor verdicts, and `describeRuntimeBundleScenarioMatch(...)`. Change the call sites
 * and say why if a different shape is better. What must not change: the measurement comes from an
 * assembled scene, a displaced actor is refused, and a bundle/scenario mismatch is reported.
 *
 * SCOPE: geometry of composition. Says nothing about whether the scene looks right — that verdict is
 * read off the re-captured images and recorded on #72.
 *
 * ## FIXED (#72)
 *
 * LIVE MEASUREMENT (scene-overview, portless ui-xr, 2026-08-06):
 *
 * | scenario   | selected matches bundle? | slotLocalY | humanoidLocalY | lowestSkinnedMeshWorldY |
 * |------------|--------------------------|------------|----------------|-------------------------|
 * | ED chest   | yes (static gen bundle)  | 0 (frame)  | ~+0.02         | ~-0.005 (on floor)      |
 * | telehealth | yes (static gen bundle)  | 0 (frame)  | ~-0.96         | ~-0.87 (BURIED)         |
 *
 * Bundle mismatch was NOT the sinking cause — telehealth loads its own bundle
 * (`local_exam_run:telehealth_diabetes_health_literacy_encounter_v1:…`). That bundle has no
 * `actorPlacements`, so main.ts falls back to ED-era `verticalOffsetMeters≈-0.95` designed for
 * slot y≈1.0. `applyCleanEncounterVisualReviewActorFraming` then rewrites slot y→0 while keeping
 * the offset, so feet-near-origin GLBs land ~0.85–0.97 m under the floor plane.
 *
 * Fix: `resolveEffectiveVerticalOffsetMeters` drops large negative offsets when the slot is already
 * floor-standing (|y|<0.2). Framing extracted to `encounter-actor-framing.ts`. Composition assess +
 * `describeRuntimeBundleScenarioMatch` (wired onto window + fallback reasons) so mismatch is reported.
 * Posture: standing check only; seated/supine skipped — no speculative posture system.
 *
 * ## FIXED (#105)
 *
 * Live full-bank measure: psych already in-band (y0≈0.01). Only floater was OB patient at 0.180
 * (elevated framing retained ED verticalOffset). resolveFloorBandPlantLocalY plants out-of-band only.
 */

const load = async () => import("./actor-floor-composition.js") as Promise<Record<string, unknown>>;

type ActorSample = {
  actorId: string;
  lowestMeshWorldY: number;
  posture?: string;
};
type Assess = (input: {
  actors: readonly ActorSample[];
  floorTopY: number;
  toleranceMeters?: number;
}) => { ok: boolean; violations: string[] };

type DescribeMatch = (input: {
  selectedScenarioId: string;
  bundleScenarioId: string;
}) => { matches: boolean; reason?: string };

describe("actors stand on the floor of the room they are in (#72)", () => {
  it("a standing actor's lowest mesh vertex sits within tolerance of the station floor top", async () => {
    const mod = await load();
    const assess = mod["assessActorFloorComposition"] as Assess | undefined;
    expect(assess).toBeTypeOf("function");

    // The numbers every placement table in the tree predicts: feet a few centimetres above y=0.
    const onTheFloor = assess!({
      floorTopY: 0,
      actors: [
        { actorId: "patient_robert_hayes_v1", lowestMeshWorldY: 0.04 },
        { actorId: "nurse_maria_alvarez_v1", lowestMeshWorldY: 0.05 },
      ],
    });
    expect(onTheFloor.ok).toBe(true);
    expect(onTheFloor.violations).toEqual([]);
  });

  it("the composition check fails when an actor is pushed half a metre off the floor", async () => {
    // Kills a stub that echoes back whatever it was handed. Both directions, because a figure buried
    // to the hips and one hovering in the air are the same defect with opposite signs — and the
    // buried case is the one actually observed.
    const mod = await load();
    const assess = mod["assessActorFloorComposition"] as Assess | undefined;
    expect(assess).toBeTypeOf("function");

    const sunk = assess!({
      floorTopY: 0,
      actors: [{ actorId: "patient_luis_martinez_v1", lowestMeshWorldY: -0.5 }],
    });
    expect(sunk.ok).toBe(false);
    expect(sunk.violations.join(" ")).toContain("patient_luis_martinez_v1");

    const floating = assess!({
      floorTopY: 0,
      actors: [{ actorId: "patient_luis_martinez_v1", lowestMeshWorldY: 0.5 }],
    });
    expect(floating.ok).toBe(false);
  });

  it("elevated sub-unity-scale slots re-solve ED vertical offsets onto the floor (#105)", async () => {
    const mod = await load();
    const resolve = mod["resolveEffectiveVerticalOffsetMeters"] as
      | ((input: {
          slotLocalY: number;
          verticalOffsetMeters: number;
          slotScaleY?: number;
        }) => number)
      | undefined;
    expect(resolve).toBeTypeOf("function");

    // #72 still holds: floor-standing slot zeros large negative offset.
    expect(resolve!({ slotLocalY: 0, verticalOffsetMeters: -0.95 })).toBe(0);

    // OB patient: slot y=0.58, scale 0.42, ED offset -0.98 → re-solve to land origin at ~0.
    const ob = resolve!({
      slotLocalY: 0.58,
      verticalOffsetMeters: -0.98,
      slotScaleY: 0.42,
    });
    expect(ob).toBeCloseTo(-0.58 / 0.42, 5);
    expect(0.58 + ob * 0.42).toBeCloseTo(0, 5);

    // Unscaled elevated slot keeps the authored offset (not the #105 scale path).
    expect(
      resolve!({ slotLocalY: 1.06, verticalOffsetMeters: -0.98, slotScaleY: 1.1 }),
    ).toBe(-0.98);
  });

  it("a scenario whose runtime bundle does not match it is reported rather than silently composed", async () => {
    // A different defect from the two above, and it survives whatever the sinking turns out to be:
    // `encounterRuntimeAssetBundle` is the ED chest-pain bundle unconditionally (main.ts:571), so a
    // telehealth encounter can be assembled from an ED roster. That is #57's silence one layer down.
    const mod = await load();
    const describe_ = mod["describeRuntimeBundleScenarioMatch"] as DescribeMatch | undefined;
    expect(describe_).toBeTypeOf("function");

    const mismatched = describe_!({
      selectedScenarioId: "telehealth_diabetes_health_literacy_v1",
      bundleScenarioId: "ed_chest_pain_priority_v1",
    });
    expect(mismatched.matches).toBe(false);
    expect(String(mismatched.reason ?? ""), "a mismatch nobody can read is not a report").not.toHaveLength(0);

    // And the matching case must NOT be flagged, or "always mismatched" satisfies the above.
    const matched = describe_!({
      selectedScenarioId: "ed_chest_pain_priority_v1",
      bundleScenarioId: "ed_chest_pain_priority_v1",
    });
    expect(matched.matches).toBe(true);
  });
});
