import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#111) — a string match on the scenario id hijacks every actor in the ward
 * delirium station to one shared "older adult" model, bypassing the casting SSOT entirely.
 *
 * BOTH REDs FLIP. The third is a COUNTERWEIGHT — the stations that resolve correctly today must
 * keep doing so. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURE EVERY STATION FIRST, and write the artifact BEFORE any product edit
 *
 * Build `inspectHumanoidCastPathResolution()`, run it over every scenario `scenarioBank` declares,
 * and write `.openclinxr/evidence/humanoid-cast-path-resolution/pre-fix.json` with the offender list
 * before changing anything. This is a `done_when` proof, not a suggestion — three separate workers
 * have now told me that "measure first" in prose does not bind and only a gate does.
 *
 * Ward is the motivation. It is not necessarily the only offender: the regex below tests
 * `${scenarioId} ${actorId} ${role}`, so any future actor id or role containing one of those words
 * hits the same trap.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED — verified against the tree, do not re-derive
 *
 * `apps/ui-xr/src/main.ts:7543-7545`
 *
 *     if (/older|elder|geriatric|delirium/u.test(`${scenarioId} ${actorId} ${role}`)) {
 *       return '/xr-assets/humanoids/variants/older-adult-kyphotic-generated-human.glb';
 *     }
 *     return resolveHumanoidVariantOrCastPath({ scenarioId, actorId, role, fallbackPath });
 *
 * `ward_delirium_med_rec_v1` contains the substring `delirium`, so **all four of its actors** —
 * patient, daughter, ward nurse, senior resident — are forced to ONE shared model and the casting
 * SSOT on the next line is never reached.
 *
 * That is not a missing-asset problem. `resolveScenarioActorCast("ward_delirium_med_rec_v1")`
 * returns four real tracked GLBs today:
 *   ed_chest_pain_spouse_adult.glb, ed_chest_pain_adult_cast.glb,
 *   ed_chest_pain_nurse_adult.glb, peds_nurse_kevin.glb
 * Psych resolves to three of those same files and renders correctly. The cast resolution is right
 * and simply unused for ward.
 *
 * PIXELS, MY OWN GRADE: the ward room builds correctly (`env=inpatient_ward_room_v1`) and its actors
 * render as pale rectangular monoliths with dome caps and small stub protrusions — the variant's
 * `local_fixture_*` cube and sphere overlays, or a failed load falling back to the primitive capsule
 * (`primitive-actor-mesh.ts:13-26`, restored on failure at `main.ts:7051-7076`). I have NOT
 * distinguished which of those two produced the pixel and neither has anyone else. Determine it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A PEER ROUND KILLED MY FIRST CONTRACT AS VACUOUS ON ARRIVAL — this matters to how you read (1)
 *
 * I proposed asserting that every actor renders a SKINNED mesh, on the reasoning that a primitive
 * placeholder is not skinned. `older-adult-kyphotic-generated-human.glb` HAS a skin (1 skin, 20
 * meshes — I checked after being told). The contract would have been green the moment it was
 * written, against the exact defect it was aimed at. That is the sixth gate in this repo to pass on
 * the thing it was built to catch, and it did not survive its first review.
 *
 * So (1) asserts PATH IDENTITY against the casting SSOT instead. No geometry predicate, no triangle
 * floor, nothing a model can satisfy by being a plausible humanoid.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - Whether `:7543-7545` is deleted outright, or narrowed to a single genuinely geriatric PATIENT
 *    role rather than every actor in a matching station. Deleting loses an age cue that someone
 *    added deliberately; narrowing keeps it and is more code. I have not evaluated which is right.
 *  - Whether the kyphotic variant remains reachable at all, and by what route.
 *  - Whether any other blanket string-match overrides exist on the same resolution path. If you find
 *    more, say so — the regex form is the smell, not the specific words.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A SEPARATE, VERIFIED LIMIT — OUT OF SCOPE HERE, DO NOT FIX IT IN THIS SLICE
 *
 * The runtime creates exactly THREE humanoid slots — patient, nurse, spouse
 * (`main.ts:3649, 3681, 3719`). Ward's bank declares FOUR actors, and #107 just added the fourth to
 * the shipped bundle. A fourth actor therefore cannot render no matter what this slice does, and any
 * contract asserting "rendered count equals bank cast size" would fail on shell architecture rather
 * than on this defect. I am filing that separately. Contract (1) below counts only actors that HAVE
 * a slot, for exactly this reason.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands the resolved path come from the casting SSOT, and is satisfiable for ward alone by
 * hardcoding its four actors to specific files. (2) forbids that by requiring the resolved set to
 * equal `resolveScenarioActorCast`'s output for EVERY station — no per-scenario literal can fake
 * twelve. (3) is green today and forbids buying either by breaking the stations that already work.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectHumanoidCastPathResolution()`. What must
 * not change: stations are enumerated from what ships, and the resolved path is read from the same
 * function the running app calls — not a reimplementation written for the test.
 *
 * REQUIRED, and this is the observable half: re-capture ward with
 * `tsx tools/openclinxr/evidence/ui-xr-environment-room-capture.ts --scenario ward_delirium_med_rec_v1`
 * and state what the figures look like afterwards. A resolver nothing renders is the correct-and-inert
 * outcome this project has hit three times.
 *
 * IF ANY PROOF IN THIS BRIEF CANNOT PASS AS WRITTEN, SAY SO IN YOUR REPORT. Do not silently run a
 * corrected version — a broken proof is my defect and I need to see it.
 *
 * IN-SCOPE VISUAL VERDICT required: "in the ward room the figures are ___". Separately name any
 * out-of-scope wrongness — the object and what it looks like, not the word "deformed". If satisfying
 * these contracts makes the product visibly worse, say so and then satisfy them anyway.
 *
 * SCOPE: which model file each actor resolves to. Says NOTHING about whether the models look right —
 * they share wardrobe meshes and the open-gown defect is #73/#76/#82 — nor about the fourth actor.
 */

const load = async () =>
  import("./humanoid-cast-path-resolution.js") as Promise<Record<string, unknown>>;

type ActorResolution = {
  scenarioId: string;
  actorId: string;
  role: string;
  /** What the running app's resolver returns for this actor. */
  resolvedPath: string;
  /** What the casting SSOT says this actor should be. */
  castPath: string;
  /** True when the actor has a humanoid slot in the runtime shell. */
  hasSlot: boolean;
};
type Inspect = () => Promise<{ scenarios: string[]; actors: ActorResolution[] }>;

const WARD = "ward_delirium_med_rec_v1";
const BLANKET_OVERRIDE = "older-adult-kyphotic-generated-human.glb";
const sorted = (v: readonly string[]) => [...new Set(v)].sort();

describe("every actor resolves to the model the casting SSOT chose (#111)", () => {
  it.fails("no actor is diverted away from its cast by a scenario-id string match", async () => {
    // Ward's four actors all resolve to older-adult-kyphotic today because the scenario id contains
    // "delirium". Path identity, not a geometry predicate — a peer round killed the geometry version
    // as vacuous, since that variant is skinned.
    const mod = await load();
    const inspect = mod["inspectHumanoidCastPathResolution"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.scenarios.length, `only ${report.scenarios.length} stations enumerated`).toBeGreaterThan(8);

    const slotted = report.actors.filter((a) => a.hasSlot);
    expect(slotted.length, "no slotted actors were measured at all").toBeGreaterThan(0);

    const diverted = slotted.filter((a) => a.resolvedPath !== a.castPath);
    expect(
      diverted.map((a) => `${a.scenarioId}/${a.actorId} (${a.role}) -> ${a.resolvedPath} but cast says ${a.castPath}`),
      "actors resolving to a model their cast did not choose",
    ).toHaveLength(0);

    const blanketed = slotted.filter((a) => a.resolvedPath.includes(BLANKET_OVERRIDE));
    expect(
      blanketed.map((a) => `${a.scenarioId}/${a.actorId}`),
      "actors still forced onto the blanket older-adult override",
    ).toHaveLength(0);
  }, 600_000);

  it.fails("ward's slotted actors resolve to distinct models, as its cast declares", async () => {
    // Kills the cheap satisfaction of the first contract. Pointing ward's actors at one arbitrary
    // non-kyphotic file would clear (1)'s blanket check while every figure in the room stays
    // identical — which is what a learner actually sees.
    const mod = await load();
    const inspect = mod["inspectHumanoidCastPathResolution"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const ward = report.actors.filter((a) => a.scenarioId === WARD && a.hasSlot);
    expect(ward.length, "ward resolved no slotted actors").toBeGreaterThan(1);

    const paths = ward.map((a) => a.resolvedPath);
    expect(
      new Set(paths).size,
      `ward renders ${new Set(paths).size} distinct models across ${paths.length} slotted actors:\n${paths.join("\n")}`,
    ).toBe(paths.length);
  }, 600_000);

  it.fails("stations that resolve correctly today still do (COUNTERWEIGHT)", async () => {
    // ED and psych reach the casting SSOT because their ids match no override word. A fix that
    // reroutes resolution must not cost them what already works.
    const mod = await load();
    const inspect = mod["inspectHumanoidCastPathResolution"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    for (const scenarioId of ["ed_chest_pain_priority_v1", "psych_suicidal_ideation_safety_v1"]) {
      const actors = report.actors.filter((a) => a.scenarioId === scenarioId && a.hasSlot);
      expect(actors.length, `${scenarioId} resolved no slotted actors`).toBeGreaterThan(1);
      for (const a of actors) {
        expect(a.resolvedPath, `${scenarioId}/${a.actorId} left its cast path`).toBe(a.castPath);
      }
      expect(
        sorted(actors.map((a) => a.resolvedPath)).length,
        `${scenarioId} regressed to a shared model`,
      ).toBe(actors.length);
    }
  }, 600_000);
});
