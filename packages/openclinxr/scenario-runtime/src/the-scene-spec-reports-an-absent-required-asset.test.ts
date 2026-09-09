import { describe, expect, it } from "vitest";

// A planted RED reads a dynamically imported module whose shape is exactly what the slice
// must define. Narrowing it here would encode the answer the card is supposed to produce.
// biome-ignore lint/suspicious/noExplicitAny: see the two lines above
type Loose = any;

/**
 * OBSERVABLE: No scene-readiness gate exists. Phases are `doorway | encounter | note | review`
 * (`packages/openclinxr/domain/src/station-state.ts:3`) and `transitionStation`
 * (`:62-102`) takes no readiness input. `recordBootPhase("station_scene_ready")`
 * (`apps/ui-xr/src/main.ts:4824`) is telemetry that gates nothing, and `main.ts:2351-2359` issues
 * `startEncounter` on the line after `startSession` with no intervening await.
 *
 * Two capabilities exist UNWIRED: `StationRunOptions.doorway`
 * (`packages/openclinxr/domain/src/station-state.ts:36-39,57`) is tested and never passed
 * (`packages/openclinxr/scenario-runtime/src/scenario-runtime.ts:101`), and
 * `MultiActorClinicalSession.spatialState.objectTransforms`
 * (`packages/openclinxr/session-state/src/session-core.ts:127`) is initialised `{}` and read
 * only by a cloner (`packages/openclinxr/session-state/src/durable-records.ts:61`).
 *
 * MEASURED 2026-09-09. Verified at HEAD 2026-09-09. There is NO scene-readiness gate, and that
 * is deliberate scope. Two capabilities exist UNWIRED, which is what makes this card landable
 * rather than speculative.
 *
 * known-good: The two unwired consumers above. A required state that names neither of them is a wish.
 *
 * CONTRACTED EXPORT (the honest slice adds exactly this):
 * CONTRACTED EXPORT (the honest slice adds exactly this):
 *   // shared-schemas/src/initial-scene-spec.ts, re-exported from shared-schemas/src/index.ts
 *   export type InitialSceneSpec = {
 *     schemaVersion: "openclinxr.initial-scene-spec.v1";
 *     scenarioId: string;
 *     requiredAssets: Array<{
 *       assetId: string;
 *       satisfied: boolean;
 *       consumer: "spatialState.objectTransforms" | "StationRunOptions.doorway";
 *     }>;
 *   };
 *
 *   // scenario-runtime/src/initial-scene-spec.ts, re-exported from scenario-runtime/src/index.ts
 *   export function buildInitialSceneSpec(input: {
 *     scenario: { scenarioId: string; assetNeeds?: Array<{ assetId: string }> };
 *     presentAssetIds: readonly string[];
 *   }): InitialSceneSpec;
 *
 * IN-SCOPE: shared-schemas/src/{initial-scene-spec.ts,index.ts}, scenario-runtime/src/{initial-scene-spec.ts,index.ts}
 * OUT-OF-SCOPE: Creating a scene-readiness phase, changing the phase machine, general room synthesis,
 * inventory systems, new physiology, placement solving.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED (<card>)
 * below. Never rewrite the diagnosis or the measured anchors. A rejection still
 * flips: the clause asserts the report, not the outcome. Never delete an
 * inverted guard.
 *
 * ## FIXED (fix/scene-spec)
 *
 * New modules: shared-schemas/src/initial-scene-spec.ts holds the contracted
 * InitialSceneSpec type, re-exported from shared-schemas/src/index.ts.
 * scenario-runtime/src/initial-scene-spec.ts holds buildInitialSceneSpec plus
 * REQUIRED_STATE_OUTCOMES and requiredStateOutcomePromotes, re-exported from
 * scenario-runtime/src/index.ts. Each required asset reports outcome
 * satisfied/unsatisfied with observed evidence (presence count phrasing, never
 * the outcome word) and names one of the two real unwired consumers,
 * alternating deterministically by need order. Creates no phase.
 */
describe("One encounter produces a reviewable initial scene specification", () => {
  it("(1) An ABSENT required asset reports outcome \"unsatisfied\" and is NAMED", async () => {
    const mod = await import("@openclinxr/scenario-runtime");
    const buildInitialSceneSpec = (mod as Record<string, unknown>)["buildInitialSceneSpec"] as Loose;
    expect(typeof buildInitialSceneSpec).toBe("function");

    const result = buildInitialSceneSpec({
      scenario: {
        scenarioId: "test-scenario",
        assetNeeds: [{ assetId: "asset-absent" }],
      },
      presentAssetIds: ["asset-present"],
    });

    const absentAsset = result.requiredAssets.find((a: Loose) => a.assetId === "asset-absent");
    expect(absentAsset).toBeDefined();
    expect(absentAsset!.outcome).toBe("unsatisfied");
    expect(absentAsset!.assetId).toBe("asset-absent");
  });

  it("(2) A PRESENT required asset reports outcome \"satisfied\"", async () => {
    const mod = await import("@openclinxr/scenario-runtime");
    const buildInitialSceneSpec = (mod as Record<string, unknown>)["buildInitialSceneSpec"] as Loose;
    expect(typeof buildInitialSceneSpec).toBe("function");

    const result = buildInitialSceneSpec({
      scenario: {
        scenarioId: "test-scenario",
        assetNeeds: [{ assetId: "asset-present" }],
      },
      presentAssetIds: ["asset-present"],
    });

    const presentAsset = result.requiredAssets.find((a: Loose) => a.assetId === "asset-present");
    expect(presentAsset).toBeDefined();
    expect(presentAsset!.outcome).toBe("satisfied");
    expect(presentAsset!.assetId).toBe("asset-present");
  });

  it("(3) schemaVersion is present and asserted", async () => {
    const mod = await import("@openclinxr/scenario-runtime");
    const buildInitialSceneSpec = (mod as Record<string, unknown>)["buildInitialSceneSpec"] as Loose;
    expect(typeof buildInitialSceneSpec).toBe("function");

    const result = buildInitialSceneSpec({
      scenario: { scenarioId: "test-scenario", assetNeeds: [] },
      presentAssetIds: [],
    });

    expect(result.schemaVersion).toBe("openclinxr.initial-scene-spec.v1");
  });

  it("(4) The symbol is importable from BOTH entrypoints: @openclinxr/shared-schemas (the type) and the scenario-runtime package index (the builder)", async () => {
    const sharedSchemasMod = await import("@openclinxr/shared-schemas");
    const scenarioRuntimeMod = await import("@openclinxr/scenario-runtime");

    const InitialSceneSpec = (sharedSchemasMod as Record<string, unknown>)["InitialSceneSpec"];
    const buildInitialSceneSpec = (scenarioRuntimeMod as Record<string, unknown>)["buildInitialSceneSpec"];

    // Type import check - the type should be available as a named export
    expect(typeof InitialSceneSpec).not.toBe("undefined");

    // Function import check
    expect(typeof buildInitialSceneSpec).toBe("function");
  });

  it("(5) Every requiredAssets[].consumer names one of the two REAL unwired consumers", async () => {
    const mod = await import("@openclinxr/scenario-runtime");
    const buildInitialSceneSpec = (mod as Record<string, unknown>)["buildInitialSceneSpec"] as Loose;
    expect(typeof buildInitialSceneSpec).toBe("function");

    const result = buildInitialSceneSpec({
      scenario: {
        scenarioId: "test-scenario",
        assetNeeds: [
          { assetId: "asset-1" },
          { assetId: "asset-2" },
        ],
      },
      presentAssetIds: ["asset-1"],
    });

    for (const asset of result.requiredAssets) {
      expect(["spatialState.objectTransforms", "StationRunOptions.doorway"]).toContain(asset.consumer);
    }
  });

  it("(6) The outcome vocabulary is FOUR values, and pending and unknown neither satisfy nor promote", async () => {
    // The brief is explicit (§3, Complementary research): each required starting-state check
    // returns "satisfied, unsatisfied, pending or unknown with observed evidence. Pending means
    // an identified consumer is still loading; unknown means no adequate observation yet.
    // Neither permits required-state promotion. An unsupported required state is unsatisfied."
    //
    // A boolean collapses pending and unknown into false and loses exactly the distinction the
    // brief asks for: "still loading" and "never looked" are different facts, and only one of
    // them can become satisfied by waiting. This RED's first draft used a boolean.
    const mod = await import("@openclinxr/scenario-runtime");
    const outcomes = (mod as Record<string, unknown>)["REQUIRED_STATE_OUTCOMES"] as
      undefined | readonly string[];
    expect(Array.isArray(outcomes)).toBe(true);
    expect([...(outcomes ?? [])].sort()).toEqual(["pending", "satisfied", "unknown", "unsatisfied"]);

    const promotes = (mod as Record<string, unknown>)["requiredStateOutcomePromotes"] as
      undefined | ((outcome: string) => boolean);
    expect(typeof promotes).toBe("function");
    expect(promotes!("satisfied")).toBe(true);
    expect(promotes!("unsatisfied")).toBe(false);
    expect(promotes!("pending")).toBe(false);
    expect(promotes!("unknown")).toBe(false);
  });

  it("(7) Every requiredAssets entry carries observed EVIDENCE, not a restatement of its outcome", async () => {
    // "returning satisfied, unsatisfied, pending or unknown WITH OBSERVED EVIDENCE". An entry
    // whose evidence merely repeats the outcome word is not evidence, and is the cheapest way
    // to satisfy a field named `evidence`.
    const mod = await import("@openclinxr/scenario-runtime");
    const buildInitialSceneSpec = (mod as Record<string, unknown>)["buildInitialSceneSpec"] as
      undefined | ((input: unknown) => { requiredAssets: Array<{ outcome: string; evidence: string }> });
    expect(typeof buildInitialSceneSpec).toBe("function");
    const result = buildInitialSceneSpec!({
      scenario: { scenarioId: "test-scenario", assetNeeds: [{ assetId: "asset-absent" }, { assetId: "asset-present" }] },
      presentAssetIds: ["asset-present"],
    });
    for (const entry of result.requiredAssets) {
      expect(typeof entry.evidence).toBe("string");
      expect(entry.evidence.length).toBeGreaterThan(0);
      expect(entry.evidence.trim().toLowerCase()).not.toBe(entry.outcome.toLowerCase());
    }
  });
});
