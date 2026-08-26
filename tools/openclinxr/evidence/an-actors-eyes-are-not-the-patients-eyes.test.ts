import { NodeIO } from "@gltf-transform/core";
import { readFileSync, readdirSync } from "node:fs";
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
 * TWO QUESTIONS, TWO SOURCES — corrected 2026-08-26 where it was first stated wrongly.
 *
 * This header previously called the scenario-fixture probe a "wrong layer" probe. That was half
 * wrong and would mislead the next reader in the opposite direction. There are two questions here
 * and each has its own correct source:
 *
 *   "what does the bake RESOLVE?"          -> the anny manifest (`input_params.phenotype`), which
 *                                             is what `phenotype_eye_colour`
 *                                             (materialize_mpfb_humanoid_candidate.py:238) reads
 *   "did this actor's CASE author one?"    -> the scenario bank, which is the authoring surface
 *
 * The manifest is a DERIVED artifact: a value sitting in it is the input the bake was handed, not
 * evidence the case authored it. Reading authorship from the manifest is exactly how an inherited
 * value disguises itself as an authored one — the orchestrator did that and briefly retracted this
 * whole card on it.
 *
 * So: authorship from the bank, resolution from the bytes. Neither source answers the other's
 * question, and the failure is not "used the wrong layer" — it is a SECOND question entering
 * without being noticed as a second question, which no layer rule catches.
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

/**
 * ## RE-SCOPED 2026-08-26 — clause (1) contradicted clause (2), and #568's worker proved it
 *
 * The first version of clause (1) asserted that EVERY non-patient actor's iris matches its role
 * fallback. #568's dispatch measured the bank before editing and stopped, because three of them
 * author `eye_color: brown` for themselves:
 *
 *   mpfb-clinical-physician-adult   authored brown    <- working as designed
 *   mpfb-peds-nurse-kevin           authored brown    <- working as designed
 *   mpfb-peds-parent-aisha          authored brown    <- working as designed
 *   mpfb-clinical-nurse-adult       authored NOTHING  <- the defect
 *   mpfb-family-partner-adult       authored NOTHING  <- the defect
 *
 * #519 records "parent and nurse keep case-driven brown_eye", so a case authoring against the role
 * map is a legitimate override — the map exists to be overridden. The original clause would have
 * demanded the pipeline OVERWRITE an authored value, which is exactly what clause (2) forbids: one
 * contract asking for two opposite things.
 *
 * The ruling is unchanged and applies to 2 of 11, not 6: **inherited is not authored**. An actor
 * that authors nothing must take its role fallback.
 *
 * Authorship is read from the anny manifest because that is the source `phenotype_eye_colour`
 * (`materialize_mpfb_humanoid_candidate.py:238`) actually reads at bake time. Reading the scenario
 * fixture instead would assert on a layer the pipeline does not consult — the wrong-layer error
 * this contract's header already records.
 */
const FIXTURES = "packages/openclinxr/scenario-fixtures/src";

/**
 * Every actor id whose CASE authors an `eye_color`, read from the authoring surface.
 * Measured 2026-08-26 — five, across three fixtures:
 *
 *   ed-chest-pain.ts:132      patient_robert_hayes_v1
 *   pediatric-asthma.ts:122   patient_maya_johnson_v1   (hazel — discarded, see #681)
 *   pediatric-asthma.ts:169   parent_tara_johnson_v1
 *   pediatric-asthma.ts:216   nurse_kevin_lee_v1
 *   ward-delirium.ts:111      senior_resident_ward_v1   (no adjacent actorId; nearest above at :87)
 */
function actorsAuthoringEyeColour(): Set<string> {
  const found = new Set<string>();
  for (const f of readdirSync(FIXTURES).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
    const src = readFileSync(`${FIXTURES}/${f}`, "utf8");
    let actor = "";
    let pending = false;
    for (const line of src.split("\n")) {
      // TWO declaration forms in this bank, and a regex that knows only one silently drops
      // every actor declared the other way (#107: enumerate the real shapes, do not assume one).
      //   object form   actorId: "nurse_maria_alvarez_v1"          ed-chest-pain, pediatric-asthma
      //   builder form  ...actor("senior_resident_ward_v1", ...)   ward-delirium:87
      const m = /actorId:\s*"([^"]+)"/.exec(line) ?? /\bactor\(\s*"([^"]+)"/.exec(line);
      if (m) { actor = m[1]!; pending = false; }
      else if (/\bactor\(\s*$/.test(line)) pending = true;
      else if (pending) {
        const q = /^\s*"([^"]+)"/.exec(line);
        if (q) { actor = q[1]!; pending = false; }
      }
      if (/\beye_color\s*:/.test(line) && actor) found.add(actor);
    }
  }
  return found;
}

/**
 * The two shipped assets whose actors author NO eye colour, so the role fallback must decide.
 * Not a chosen list: it is every non-patient MPFB asset left once the authoring actors above are
 * removed. Clause (1)'s guard re-derives the authoring set each run and fails if it drifts.
 */
const UNAUTHORED_NON_PATIENT = {
  "mpfb-clinical-nurse-adult.glb": "nurse_maria_alvarez_v1",
  "mpfb-family-partner-adult.glb": "spouse_anna_hayes_v1",
} as const;

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
    "(1) a non-patient actor that authors NO eye colour takes its role fallback",
    async () => {
      // GUARD: re-derive the authoring set from the bank every run. If it drifts, the pinned
      // UNAUTHORED_NON_PATIENT list below is stale and clause (1) is measuring the wrong actors.
      const authoring = actorsAuthoringEyeColour();
      expect(
        [...authoring].sort(),
        "the set of actors whose case authors eye_color has changed; re-derive "
          + "UNAUTHORED_NON_PATIENT before trusting this clause",
      ).toEqual([
        "nurse_kevin_lee_v1",
        "parent_tara_johnson_v1",
        "patient_maya_johnson_v1",
        "patient_robert_hayes_v1",
        "senior_resident_ward_v1",
      ]);

      const wrong: string[] = [];
      for (const [glb, actorId] of Object.entries(UNAUTHORED_NON_PATIENT)) {
        expect(authoring.has(actorId), `${actorId} now authors an eye colour; drop it from the list`)
          .toBe(false);
        const role = roleOf(glb);
        const want = ROLE_FALLBACK[role!];
        const iris = await irisOf(glb);
        if (iris !== want) {
          wrong.push(`${glb} (${actorId}) authors nothing, role=${role} wants ${want}, ships ${iris}`);
        }
      }
      expect(
        wrong,
        "an actor whose case authors no eye colour is wearing one anyway. #356 added the role "
          + "fallback to break this monopoly; an inherited value reaches `if declared:` in "
          + "iris_palette.py:60 and returns before the fallback is ever considered.",
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
