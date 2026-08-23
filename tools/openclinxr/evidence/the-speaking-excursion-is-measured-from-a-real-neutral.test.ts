import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the parent's speaking head excursion is attributable to a NAMED morph, measured
 * from a pose in which nothing is driven.
 *
 * MEASURED 2026-08-23 on `speaking-actor-head-rest-baseline.json` (landed by #474 for E2), do not
 * re-derive these numbers:
 *
 *   actor                     total mm   morph mm   bone mm   restMorphInfluence   speakingMorphInfluence
 *   ----------------------    --------   --------   -------   ------------------   ----------------------
 *   parent_tara_johnson_v1       9.338      9.338       0.0          1                     0.5117
 *   patient_maya_johnson_v1      3.401      3.401       0.0          1                     0.5473
 *
 * TWO defects, both readable off those two columns.
 *
 * (a) REST IS NOT REST. `restMorphInfluence` is 1 for BOTH actors — the idle state drives a morph at
 *     FULL weight. So every "rest -> speaking" excursion in that artifact is the distance between one
 *     driven pose and another driven pose, and the speaking weight (~0.51) is LOWER than the resting
 *     weight (1.0). The sibling contract already says this in clause (1b) — "the runtime has no
 *     'no-viseme' rest — idle drives a full-weight silence viseme" — and the number was then used as
 *     an excursion-from-rest anyway.
 *
 * (b) NO MORPH IS NAMED. `restMorphInfluence` / `speakingMorphInfluence` are SCALARS (a single max
 *     influence), not per-morph maps. `speaking-actor-head-local-probe.ts:211-217` computes named
 *     per-morph influences through `mesh.morphTargetDictionary` and never surfaces them into the
 *     actor row. So "the excursion is 100% morph-driven" is true and unactionable: nobody can say
 *     WHICH morph moves the parent 2.75x further than the child.
 *
 * The 2.75x ratio may be entirely explained by (a) — a different or stronger idle silence viseme on
 * the parent. THAT IS NOT DETERMINED and this contract does not assume it. It requires the
 * measurement that would settle it.
 *
 * KNOWN-GOOD COLUMN: `patient_maya_johnson_v1`. The child is driven through the SAME runtime path in
 * the SAME frame and comes back at 3.401 mm. Clause (3) pins it, so a fix cannot pass by changing how
 * the parent alone is sampled.
 *
 * claimScope: whether the speaking-excursion artifact names its morphs and measures from an
 * undriven neutral.
 * notEvidenceFor: whether 9.338 mm is too large; what the face LOOKS like; any clinical claim; the
 * cause of the 2.75x ratio.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, "speaking-actor-head-rest-baseline.json");

type ActorRow = {
  actor: string;
  restToSpeakingHeadAssemblyDeltaMm: number;
  morphDrivenHeadAssemblyDeltaMm: number;
  boneDrivenHeadAssemblyDeltaMm: number;
  restMorphInfluence: unknown;
  speakingMorphInfluence: unknown;
  /** Required by this contract: per-morph influence keyed by the runtime's own target name. */
  restMorphInfluenceByName?: Record<string, number>;
  speakingMorphInfluenceByName?: Record<string, number>;
  /** Required by this contract: the excursion from a pose with every influence at 0. */
  neutralToSpeakingHeadAssemblyDeltaMm?: number;
  neutralMaxMorphInfluence?: number;
};

const PARENT = "parent_tara_johnson_v1";
const CHILD = "patient_maya_johnson_v1";

function actors(): ActorRow[] {
  return (JSON.parse(readFileSync(BASELINE, "utf8")) as { actors: ActorRow[] }).actors;
}
function row(name: string): ActorRow {
  const found = actors().find((a) => a.actor === name);
  if (!found) throw new Error(`no row for ${name}`);
  return found;
}

describe("the speaking excursion is measured from a real neutral", () => {
  it.fails("(1) RED: the excursion is attributed to NAMED morphs, not a scalar max influence", () => {
    // Today `restMorphInfluence` is the number 1 and `speakingMorphInfluence` is 0.5117 — scalars.
    // The probe already reads mesh.morphTargetDictionary; this requires it to reach the artifact.
    for (const name of [PARENT, CHILD]) {
      const a = row(name);
      const speaking = a.speakingMorphInfluenceByName;
      expect(speaking, `${name} needs per-morph speaking influences keyed by target name`).toBeTypeOf("object");
      const driven = Object.entries(speaking ?? {}).filter(([, v]) => Math.abs(v) > 1e-6);
      expect(driven.length, `${name}: at least one named morph must be driven while speaking`).toBeGreaterThan(0);
      expect(a.restMorphInfluenceByName, `${name} needs per-morph REST influences too`).toBeTypeOf("object");
    }
  });

  it.fails("(2) RED: a genuinely undriven neutral exists and the excursion is measured from it", () => {
    // restMorphInfluence === 1 on BOTH actors: the "rest" pose drives a morph at full weight, and
    // the speaking weight (~0.51) is LOWER. An excursion measured between two driven poses cannot
    // say how far speech moves a face.
    for (const name of [PARENT, CHILD]) {
      const a = row(name);
      expect(a.neutralMaxMorphInfluence, `${name} needs a neutral sample with every influence at 0`)
        .toBeTypeOf("number");
      expect(a.neutralMaxMorphInfluence ?? 1, `${name}: neutral must drive NOTHING`).toBeLessThanOrEqual(1e-6);
      expect(a.neutralToSpeakingHeadAssemblyDeltaMm, `${name} needs a neutral->speaking excursion`)
        .toBeTypeOf("number");
    }
  });

  it("(3) KNOWN-GOOD COLUMN: the child is still measured through the same path", () => {
    // Pins the reference. A fix that re-samples only the parent, or drops the child, fails here.
    const child = row(CHILD);
    expect(child.restToSpeakingHeadAssemblyDeltaMm, "the child's landed excursion must survive").toBeCloseTo(3.401, 3);
    expect(child.boneDrivenHeadAssemblyDeltaMm, "the child's excursion stays entirely morph-driven").toBe(0);
  });

  it("(4) COUNTERWEIGHT: the parent's DRIVEN speaking weight is not turned down to shrink the number", () => {
    // Refuses the cheap fix. The excursion can always be reduced by driving the parent's mouth less.
    // The speaking-state weight is an INPUT here, not an output: it must stay where the timeline put
    // it. A fix that clamps or scales the parent's viseme weights fails this clause even if every
    // millimetre number improves.
    const parent = row(PARENT);
    const speakingScalar = typeof parent.speakingMorphInfluence === "number" ? parent.speakingMorphInfluence : NaN;
    expect(speakingScalar, "the parent's speaking influence must remain the timeline's value, not a clamped one")
      .toBeCloseTo(0.5117, 3);
  });
});
