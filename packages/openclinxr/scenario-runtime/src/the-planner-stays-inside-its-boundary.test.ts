import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildInitialSceneSpec, initialSceneSpecPermitsPromotion } from "./index.js";

/**
 * Brief §3, "Output and boundary" — three refusals about what the planner must NOT do:
 *
 *   "The planner must not create a phase, reset the clock or issue a second `START_ENCOUNTER`."
 *   "Scheduled-event dispatch, including second-zero events, must remain runtime-owned; the
 *    specification defines initial conditions and never pre-applies events."
 *   "If connecting equipment is a learner task, do not pre-complete it."
 *
 * THE FIRST TWO ARE ABSENCES, and an absence assertion over a report is nearly vacuous on its own —
 * a spec that emitted nothing at all would satisfy it. Clause (3) reads the MODULE SOURCE instead:
 * the specification cannot dispatch what it never imports, and a future edit that reaches for the
 * phase machine or the clock fails here rather than in an exam.
 */

const SPEC_SOURCE = new URL("./initial-scene-spec.ts", import.meta.url);

const SCENARIO = {
  scenarioId: "ed_chest_pain_priority_v2",
  assetNeeds: [{ assetId: "ecg_cart_equipment" }],
};

describe("the planner stays inside its boundary", () => {
  it("(1) a learner-owned state reported SATISFIED at start blocks promotion and names why", () => {
    const decision = initialSceneSpecPermitsPromotion(
      buildInitialSceneSpec({ scenario: SCENARIO, presentAssetIds: ["ecg_cart_equipment"] }),
      [
        {
          stateId: "monitor_leads_connected",
          ownedBy: "learner",
          outcome: "satisfied",
          evidence: "constructed for this clause: the spec claims the leads are already on",
        },
      ],
    );
    expect(decision.promotes).toBe(false);
    expect(decision.refusedPreCompletions).toHaveLength(1);
    expect(decision.refusedPreCompletions[0]?.reason).toMatch(/learner-owned/u);
    // The asset list is clean, so this failure is invisible without the state check.
    expect(decision.blockedBy).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the same state UNSATISFIED at start promotes, and a runtime-owned one may be satisfied", () => {
    // Refusing every declared state would satisfy clause (1) and make the field unusable. A
    // learner task that starts incomplete is the correct scene; a runtime-owned state that the
    // runtime really did apply is a legitimate satisfied requirement.
    const decision = initialSceneSpecPermitsPromotion(
      buildInitialSceneSpec({ scenario: SCENARIO, presentAssetIds: ["ecg_cart_equipment"] }),
      [
        { stateId: "monitor_leads_connected", ownedBy: "learner", outcome: "unsatisfied", evidence: "starts incomplete, as authored" },
        { stateId: "bed_incline_30deg", ownedBy: "runtime", outcome: "satisfied", evidence: "applied by the support consumer" },
      ],
    );
    expect(decision.promotes).toBe(true);
    expect(decision.refusedPreCompletions).toEqual([]);
  });

  it("(3) the specification module reaches NO phase, clock, or encounter-start API", () => {
    // "must not create a phase, reset the clock or issue a second START_ENCOUNTER", and
    // "Scheduled-event dispatch ... must remain runtime-owned". The module cannot dispatch what it
    // does not import, so the import list is the durable half of this refusal.
    const source = readFileSync(SPEC_SOURCE, "utf8");
    // Anchored at an import STATEMENT: a bare /from "…"/ also matches prose inside a comment,
    // which is how the first run of this clause reported a phantom second import.
    const imports = [...source.matchAll(/^\s*import[^"']*from\s+"([^"]+)"/gmu)].map((match) => match[1]!);
    expect(imports, "the spec should import types only").toEqual(["@openclinxr/shared-schemas"]);
    // COMMENTS STRIPPED FIRST. The module's own header explains that it does not gate
    // `startEncounter`, and a bare substring search read that sentence as a call — the same
    // mistake as the import regex above, one line further down.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/u, ""))
      .join("\n");
    for (const forbidden of [
      "START_ENCOUNTER",
      "startEncounter",
      "advancePhase",
      "resetClock",
      "dueEvents",
      "dispatchScheduledEvent",
      "session-state",
      "assembled-station-clock",
    ]) {
      expect(code, `the specification must not reach ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("(4) COUNTERWEIGHT: the module is not empty, so clause (3) is not green about nothing", () => {
    const source = readFileSync(SPEC_SOURCE, "utf8");
    expect(source.length).toBeGreaterThan(2_000);
    expect(source).toContain("export function buildInitialSceneSpec");
    expect(source).toContain("export function initialSceneSpecPermitsPromotion");
  });

  it("(5) the decision still distinguishes an EMPTY spec from a passing one", () => {
    const decision = initialSceneSpecPermitsPromotion(
      buildInitialSceneSpec({ scenario: { scenarioId: "empty" }, presentAssetIds: [] }),
    );
    expect(decision.promotes).toBe(true);
    expect(decision.requiredAssetCount).toBe(0);
    expect(decision.refusedPreCompletions).toEqual([]);
  });
});
