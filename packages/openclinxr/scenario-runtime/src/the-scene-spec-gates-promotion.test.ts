import { describe, expect, it } from "vitest";
import { buildInitialSceneSpec, initialSceneSpecPermitsPromotion } from "./index.js";

/**
 * Brief §7 step 0: "Required contents and states must have ACTUAL CONSUMERS." And on the outcome
 * vocabulary: "Pending means an identified consumer is still loading; unknown means no adequate
 * observation yet. Neither permits required-state promotion."
 *
 * buildInitialSceneSpec reported and nothing read it — correct and inert, which is this repo's
 * characteristic defect. These clauses exercise the read.
 */
const SCENARIO = {
  scenarioId: "ed_chest_pain_priority_v2",
  assetNeeds: [{ assetId: "ecg_cart_equipment" }, { assetId: "iv_pole_equipment" }],
};

describe("the initial scene spec gates promotion", () => {
  it("(1) every required asset present: promotion is permitted, and the count proves it was not vacuous", () => {
    const report = buildInitialSceneSpec({
      scenario: SCENARIO,
      presentAssetIds: ["ecg_cart_equipment", "iv_pole_equipment"],
    });
    const decision = initialSceneSpecPermitsPromotion(report);
    expect(decision.promotes).toBe(true);
    expect(decision.blockedBy).toEqual([]);
    // Without this, a spec that required NOTHING would look identical to one that required two
    // things and got them. Those are different claims and only the second is evidence.
    expect(decision.requiredAssetCount).toBe(2);
  });

  it("(2) an ABSENT required asset blocks promotion and is NAMED with its evidence", () => {
    const report = buildInitialSceneSpec({
      scenario: SCENARIO,
      presentAssetIds: ["ecg_cart_equipment"],
    });
    const decision = initialSceneSpecPermitsPromotion(report);
    expect(decision.promotes).toBe(false);
    expect(decision.blockedBy.map((row) => row.assetId)).toEqual(["iv_pole_equipment"]);
    const [blocked] = decision.blockedBy;
    expect(blocked?.outcome).not.toBe("satisfied");
    // The consumer and the observed evidence travel with the refusal. A refusal that says only
    // "blocked" leaves the reader to go and find which consumer was waiting on what.
    expect(blocked?.consumer.length).toBeGreaterThan(0);
    expect(blocked?.evidence.length).toBeGreaterThan(0);
  });

  it("(3) COUNTERWEIGHT: pending and unknown do NOT promote, they are refusals", () => {
    // The brief is explicit that neither permits promotion. Treating "still loading" as good
    // enough is how a station promotes on assets that never arrived — and it is the reading a
    // caller reaches for when a check returns something falsy-but-not-false.
    for (const outcome of ["pending", "unknown", "unsatisfied"] as const) {
      const decision = initialSceneSpecPermitsPromotion({
        schemaVersion: "openclinxr.initial-scene-spec.v1",
        scenarioId: "probe",
        requiredAssets: [{
          assetId: "some_asset",
          satisfied: false,
          outcome,
          consumer: "spatialState.objectTransforms",
          evidence: `constructed for this clause: outcome ${outcome}`,
        }],
      });
      expect(decision.promotes, `${outcome} must not promote`).toBe(false);
    }
  });

  it("(4) an EMPTY spec promotes VACUOUSLY, and says so through the count", () => {
    // Recorded rather than special-cased: a scenario with no asset needs has nothing to block on,
    // and a caller that treats requiredAssetCount 0 as proof of readiness has misread it.
    const decision = initialSceneSpecPermitsPromotion(
      buildInitialSceneSpec({ scenario: { scenarioId: "empty" }, presentAssetIds: [] }),
    );
    expect(decision.promotes).toBe(true);
    expect(decision.requiredAssetCount).toBe(0);
  });

  it("(5) the gate reads OUTCOME, not the redundant `satisfied` boolean, when the two disagree", () => {
    // The row carries both `satisfied: boolean` and `outcome`, which are two representations of
    // one fact and can therefore disagree. The brief's vocabulary is the four outcomes, so the
    // outcome is authoritative; a gate reading the boolean would promote a `pending` row that
    // someone marked satisfied. This clause pins which one wins.
    const decision = initialSceneSpecPermitsPromotion({
      schemaVersion: "openclinxr.initial-scene-spec.v1",
      scenarioId: "disagreement",
      requiredAssets: [{
        assetId: "asset_marked_satisfied_but_pending",
        satisfied: true,
        outcome: "pending",
        consumer: "spatialState.objectTransforms",
        evidence: "the boolean and the outcome disagree; the outcome is authoritative",
      }],
    });
    expect(decision.promotes).toBe(false);
    expect(decision.blockedBy).toHaveLength(1);
  });
});
