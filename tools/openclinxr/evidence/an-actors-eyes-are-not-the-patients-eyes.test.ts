import { NodeIO } from "@gltf-transform/core";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: a nurse and a family member do not have the patient's eyes.
 *
 * MEASURED 2026-08-26 on the shipped bytes, do not re-derive. Every MPFB humanoid in
 * `apps/ui-xr/public/generated-humanoids` ships a `brown_eye` iris texture — eleven of eleven,
 * including four clinicians and two family members:
 *
 *   mpfb-clinical-nurse-adult      brown      <- role map says blue
 *   mpfb-clinical-physician-adult  brown      <- role map says blue
 *   mpfb-family-partner-adult      brown      <- role map says green
 *   mpfb-peds-nurse-kevin          brown      <- role map says blue
 *   mpfb-peds-parent-aisha         brown      <- role map says green
 *   ...and six patients/inspect assets, brown, which is correct for them
 *
 * `iris_palette.py:36-40` `_EYE_IRIS_BY_ROLE` = patient brown / family green / nurse blue, and
 * `:60-77` resolves `declared = phenotype.eye_color || ...` then `if declared:` returns it and the
 * role fallback below is never reached. #356 added that fallback specifically to "break the
 * one-iris-for-everyone monopoly so co-present actors do not share an iris texture by
 * construction". The monopoly is intact.
 *
 * THE RULING THIS ENCODES — inherited is NOT authored. `descriptor-phenotype-lookup.ts:21-27`
 * lists `eye_color` among the fields deliberately NOT derived, so a value arriving on a
 * non-authoring actor did not come from that actor's case definition. #664, #276 and #293 each
 * refused a non-authoring source supplying an identity field; this is the same refusal for eyes.
 *
 * PREMISE, CHECKED RATHER THAN ASSUMED: `ed-chest-pain.ts` contains exactly ONE `eye_color`, at
 * :132, inside `patient_robert_hayes_v1`. The nurse and the family partner author none. **If a
 * second authored `eye_color` exists on a clinician or family actor anywhere in the bank, this
 * contract's premise is wrong and the card closes as working-as-designed — say so and stop.**
 *
 * WRONG LAYER WARNING, paid for by the orchestrator. My first probe called
 * `derivePhenotypeFromDescriptors` at the scenario-fixture layer and reported
 * `nurse: declared=null, resolved=null` — no inheritance, premise apparently dead. That is the
 * wrong layer: the question is what reaches `iris_palette.resolve_iris` at BAKE time, not what the
 * fixture declares. **Assert on the shipped bytes, which are layer-independent.** Do not re-run
 * the fixture-layer probe and conclude anything from it.
 *
 * claimScope: which iris texture each shipped MPFB humanoid carries, and whether it matches the
 *   role fallback for actors that author no eye colour.
 * notEvidenceFor: whether brown is right for any particular patient; whether the role assignments
 *   are clinically or demographically appropriate (they are a staging judgement, see #356); the
 *   mechanism by which the value propagates, which is the implementer's to find.
 */

const DIR = "apps/ui-xr/public/generated-humanoids";

/** From `iris_palette.py:27-29`, the staged CC0 pack. Longest-first so `brownlight` wins over `brown`. */
const IRIS_PACK = [
  "bluegreen", "brownlight", "deepblue", "lightblue", "blue", "brown", "green", "grey", "ice",
] as const;

/**
 * From `iris_palette.py:36-40`. Not a threshold and not chosen here — the shipped role map, quoted.
 * Which colours are right is a phenotype question this contract deliberately does not answer.
 */
const ROLE_FALLBACK = { patient: "brown", family: "green", nurse: "blue" } as const;

/** Role read from the asset name, matching how the pipeline names its outputs. */
function roleOf(glb: string): keyof typeof ROLE_FALLBACK | null {
  if (/nurse|physician|clinical/.test(glb)) return "nurse";
  if (/family|parent|partner|spouse/.test(glb)) return "family";
  if (/patient|gown|street|viseme|inspect/.test(glb)) return "patient";
  return null;
}

async function irisOf(glb: string): Promise<string | null> {
  const doc = await new NodeIO().read(`${DIR}/${glb}`);
  for (const tex of doc.getRoot().listTextures()) {
    const name = (tex.getName() ?? tex.getURI() ?? "").toLowerCase();
    if (!/eye|iris/.test(name)) continue;
    for (const colour of IRIS_PACK) if (name.includes(colour)) return colour;
  }
  return null;
}

function mpfbAssets(): string[] {
  return readdirSync(DIR).filter((n) => n.startsWith("mpfb-") && n.endsWith(".glb")).sort();
}

describe("an actor's eyes are not the patient's eyes (#568)", () => {
  it.fails(
    "(1) every non-patient actor's iris matches its ROLE fallback, not the patient's brown",
    async () => {
      const wrong: string[] = [];
      for (const glb of mpfbAssets()) {
        const role = roleOf(glb);
        if (!role || role === "patient") continue;
        const iris = await irisOf(glb);
        const want = ROLE_FALLBACK[role];
        if (iris !== want) wrong.push(`${glb}: role=${role} wants ${want}, ships ${iris}`);
      }
      expect(
        wrong,
        "non-patient actors are wearing the patient's iris. #356 added the role fallback to break "
          + "exactly this monopoly, and `if declared:` in iris_palette.py returns an inherited "
          + "value before the fallback is ever reached.",
      ).toEqual([]);
    },
    600_000,
  );

  it(
    "(2) COUNTERWEIGHT: patients still ship brown — the fix must not simply recolour everyone",
    async () => {
      // Refuses the cheapest way to satisfy clause (1): change the pipeline default, or give the
      // whole cast a non-brown iris. Patients authoring brown must keep it.
      const wrong: string[] = [];
      for (const glb of mpfbAssets()) {
        if (roleOf(glb) !== "patient") continue;
        const iris = await irisOf(glb);
        if (iris !== "brown") wrong.push(`${glb}: patient ships ${iris}, expected brown`);
      }
      expect(wrong, "a patient's authored/served brown must survive the fix").toEqual([]);
    },
    600_000,
  );

  it(
    "(3) COUNTERWEIGHT: every shipped MPFB asset still carries an iris texture at all",
    async () => {
      // Refuses the other cheap fix: drop the iris texture so clause (1) has nothing to compare.
      // Derived from the input, not from an observation — every asset the directory ships.
      const missing: string[] = [];
      for (const glb of mpfbAssets()) if ((await irisOf(glb)) === null) missing.push(glb);
      expect(
        missing,
        "an asset lost its iris texture; removing the thing under test is not a fix",
      ).toEqual([]);
    },
    600_000,
  );
});
