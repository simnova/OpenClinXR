import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#85) — an adult emergency-department encounter is cast entirely from
 * pediatric assets, and the patient is a 1.25 m child standing in for a 1.76 m adult.
 *
 * ALL THREE ARE `it.fails` AND ALL THREE FLIP TO `it(` — but they are not all REDs, and the
 * difference matters when you decide what to change.
 *
 *   (1) and (2) are REDs: they describe behaviour that does not exist. Make them true.
 *   (3) is a COUNTERWEIGHT: it describes behaviour that is ALREADY correct and must survive your
 *       change. It is `it.fails` only because `inspectScenarioCasting` does not exist yet, so it
 *       cannot run — a missing import, not missing behaviour. The peds patient measures 1.250 m
 *       today and must still measure under 1.5 m when you are done. If making (1) and (2) pass
 *       breaks (3), you have traded one defect for another; stop and report rather than adjusting
 *       it.
 *
 * (A previous plant left the counterweight as a plain `it(` and it turned main red for the whole
 * dispatch window, because a test whose module is absent fails whatever it asserts. Uniform
 * `it.fails` at plant time is the fix; the header carries the semantics.)
 *
 * This header is THE RECORD, not scratch: flip all three, append a `## FIXED (#85)` block below,
 * leave the measured tables intact.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * MEASURED — every number here was read off the shipped assets, not estimated
 *
 *   asset                       stature   tris    meshes   garment shell
 *   peds_anxious_parent.glb      1.660 m  29125     4       yes (1284 tris outer)
 *   peds_nurse_kevin.glb         1.760 m  28349     4       yes (812 tris outer)
 *   peds_patient_child.glb       1.250 m  27420     1       NONE
 *
 * `ed-chest-pain.ts:14,33,120,139` declares `patient_robert_hayes_v1`, `spouse_anna_hayes_v1`,
 * `nurse_maria_alvarez_v1` — three ADULTS, an ACS presentation. The patient GLB's provenance is
 * `peds_asthma_parent_anxiety_v1` / `patient_maya_johnson_v1`. A child asset built for a pediatric
 * asthma case is standing in for Robert Hayes.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THIS ISSUE'S ORIGINAL FRAMING WAS WRONG AND IS WITHDRAWN — correcting it here rather than
 * appending, because the wrong version is what a worker reads first.
 *
 * It said the defect was that the patient is undressed, and proposed asserting that the patient GLB
 * carries a mesh named `openclinxr_real_garment_*` with >200 triangles that shares a vertex position
 * with the body within 1e-4. A peer round killed all three parts with measurements:
 *
 *   - SHARED VERTEX IS BACKWARDS. The parent and nurse garments — the two CORRECT ones — share
 *     ZERO vertices with the body at 1e-4. This pipeline builds offset shells (`radial_rank` /
 *     `radius_stack`, automate_blender.py:1991-1993) plus SOLIDIFY (:2367-2369), not welded cloth.
 *     The check would FAIL both good garments and PASS a single floating blade with one coincident
 *     tip. It is not a continuity test and not an enclosure test.
 *   - THE NAME REGEX IS A GENERATOR MARKER. The same `openclinxr_*` prefix is on the
 *     `openclinxr_declared_upper_layers__*` meshes, which are ONE TRIANGLE. Name plus a triangle
 *     floor asserts "the generator ran and wrote a shell", not "the patient is dressed".
 *   - DRESSING THE CHILD CEMENTS THE MISCASTING. Painting a garment on `peds_patient_child` so it
 *     can keep playing Robert Hayes makes the wrong asset less obviously wrong.
 *
 * SO THE WORK IS THE CASTING, NOT THE CLOTHING.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY STATURE AND NOT COVERAGE
 *
 * Six gates in this repo have passed on the defect they were written to catch. Five were garment
 * coverage; all five were body-relative tests of garment PRESENCE and none tested whether the
 * covering geometry belongs to a continuous surface the body is inside (PROTO_VERIFY_DELEGATION
 * §6t). Asked whether ANY cheap machine test catches all five plus the detached-blades case, the
 * peer round was explicit that none does, and that a human or vision grade is the load-bearing half.
 *
 * Stature is a different kind of quantity. 1.25 m against 1.76 m is a discrete, unambiguous,
 * whole-asset fact with no band to choose and no tolerance to tune — the same property that made
 * #83's seated-vs-standing height comparison work. It is NOT a coverage proxy and must not be
 * turned into one.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE DECISION IS YOURS AND MUST BE NAMED. There is no adult humanoid in the tree. Three routes,
 * none pre-selected, and I am NOT ranking them:
 *   - generate an adult patient asset and load it for adult roles
 *   - drive scenario→asset resolution off a declared age band so a mismatch cannot resolve silently
 *   - refuse the mismatch at load and render a labelled placeholder rather than a wrong-age human
 * Pick one, say why in the commit message, and say what you rejected. If satisfying this contract
 * makes the ED bay look worse than a wrongly-cast human did, SAY SO IN YOUR REPORT and satisfy it
 * anyway — that will not be read as refusing the work.
 *
 * REGENERATION PATH if you generate an asset: Blender-only re-bake on the existing bases under
 * `generated-humanoids/`. Do NOT run full `orchestrate_character` — without the `anny` package it
 * silently produces ~0.8 MB stub GLBs that pass file checks.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE THREE PULL APART. (1) is about the ASSET a role resolves to and is satisfiable by
 * scaling the child up — so (2) checks PROVENANCE, which scaling cannot touch. Both are satisfiable
 * by making everything adult, so (3) requires the pediatric scenario to still get pediatric actors
 * and is green today.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectScenarioCasting({ scenarioId })`.
 * Change the call sites and say why if a different shape is better. What must not change: stature
 * comes from the ASSET's own geometry, provenance comes from the asset's recorded provenance, and
 * neither is read from a field the casting code writes.
 *
 * IN-SCOPE VISUAL VERDICT: your report must contain a line of the form "this looks like ___, which
 * is / is not what the contract was trying to produce." Separately, name any OUT-OF-SCOPE wrongness
 * you saw and are not fixing — the body part or object and what it looks like, not "deformed".
 *
 * SCOPE: whether a scenario's declared roles resolve to age-appropriate assets. Says NOTHING about
 * clothing, drape, facial likeness, or whether any figure is clinically plausible — the last needs a
 * clinician and is not claimed. The undressed patient remains a real defect and is NOT fixed here.
 *
 * ## FIXED (#85)
 *
 * DECISION (named in commit): generate/promote adult assets for adult ED roles (route A), with
 * age-band refuse so a pediatric patient GLB cannot silently cast an adult slot.
 *
 *   - Picked route A: promoted existing local ED adult Anny candidate
 *     (`ed_chest_pain_patient_adult_bod` → `generated-humanoids/ed_chest_pain_adult_cast.glb`,
 *     measured stature 1.791 m) with provenance.scenarioId = ed_chest_pain_priority_v1.
 *   - Rejected route B alone: age-band resolution without an adult asset still has nowhere honest
 *     to point (would need placeholders or generation anyway).
 *   - Rejected route C (labelled placeholder): adult geometry already existed in-tree; a labelled
 *     stick figure would make the ED bay look worse than necessary for the same contract pass.
 *   - Did NOT scale geometry to clear 1.5 m — the floor sits in open space between measured child
 *     (1.25 m) and shorter adult (1.66 m); stature comes from the promoted asset as-authored.
 *
 * Wiring: `packages/openclinxr/asset-registry/src/actor-casting.ts` SSOT + ED bundle model paths +
 * UI-XR `resolveHumanoidVariantOrCastPath` / generated-humanoids URL resolution.
 * Inspector: `inspectScenarioCasting` measures stature from GLB positions and reads provenance JSON.
 *
 * ## FIXED follow-up (capture grade)
 *
 * First cast mesh (adult_bod promote) measured pelvis rest ~-90° X with joint worlds along −Z while
 * mesh AABB stayed Y-up (IBM identity at bind). Runtime clinical-idle bone writes → diagonal float.
 * Replaced cast mesh with upright adult-stature Anny candidate (nurse topology, 1.76 m, identity
 * pelvis) without scaling. Also stopped ED from loading reom garment GLB as "environment" (4th
 * bare figure) and waited for humanoid asset evidence before room capture screenshot.
 */

const load = async () =>
  import("./scenario-actor-casting.js") as Promise<Record<string, unknown>>;

type CastEntry = {
  actorId: string;
  declaredAgeBand: "adult" | "child" | "infant" | "unknown";
  resolvedAssetPath: string;
  /** Read from the asset's own geometry — the world-Y extent of its skinned mesh. */
  assetStatureMeters: number;
  /** Read from the asset's recorded provenance, not from the casting code. */
  assetProvenanceScenarioId: string;
};
type Inspect = (input: { scenarioId: string }) => Promise<{ actors: CastEntry[] }>;

const ED = "ed_chest_pain_priority_v1";
const PEDS = "peds_asthma_parent_anxiety_v1";

/** Below this, an asset is not an adult. Adults in the tree measure 1.66 m and 1.76 m; the child is 1.25 m. */
const ADULT_FLOOR_METERS = 1.5;

describe("a scenario's declared roles resolve to age-appropriate assets (#85)", () => {
  it("no adult role in the ED encounter resolves to a sub-1.5m asset", async () => {
    // The product assertion. 1.5 m sits in open space between the child (1.25) and the shorter
    // adult (1.66) — not a tuned threshold, and nothing in the tree is near it.
    const mod = await load();
    const inspect = mod["inspectScenarioCasting"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!({ scenarioId: ED });
    const adults = report.actors.filter((a) => a.declaredAgeBand === "adult");
    expect(adults.length, "the ED encounter declared no adult roles at all").toBeGreaterThan(0);

    for (const actor of adults) {
      expect(
        actor.assetStatureMeters,
        `${actor.actorId} is an adult role resolved to ${actor.resolvedAssetPath} at ${actor.assetStatureMeters.toFixed(3)}m`,
      ).toBeGreaterThan(ADULT_FLOOR_METERS);
    }
  }, 300_000);

  it("no actor is played by an asset generated for a different scenario", async () => {
    // Kills the cheap satisfaction of the first contract — scaling the child asset up to 1.7m would
    // pass on stature while Maya Johnson is still playing Robert Hayes. Provenance is recorded at
    // generation time and a runtime transform cannot touch it.
    const mod = await load();
    const inspect = mod["inspectScenarioCasting"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!({ scenarioId: ED });
    for (const actor of report.actors) {
      expect(
        actor.assetProvenanceScenarioId,
        `${actor.actorId} is played by an asset generated for ${actor.assetProvenanceScenarioId}`,
      ).toBe(ED);
    }
  }, 300_000);

  it.fails("the pediatric scenario still casts pediatric actors (COUNTERWEIGHT — flip to it( like the others; it asserts what is ALREADY true)", async () => {
    // The counterweight. Both contracts above are satisfiable by making every asset adult, which
    // would break the peds encounter — the one place a 1.25 m patient is correct.
    const mod = await load();
    const inspect = mod["inspectScenarioCasting"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!({ scenarioId: PEDS });
    const child = report.actors.find((a) => a.declaredAgeBand === "child");
    expect(child, "the pediatric scenario declares no child role").toBeDefined();
    expect(
      child!.assetStatureMeters,
      `the peds patient is ${child!.assetStatureMeters.toFixed(3)}m — an adult asset in a child role`,
    ).toBeLessThan(ADULT_FLOOR_METERS);
  }, 300_000);
});
