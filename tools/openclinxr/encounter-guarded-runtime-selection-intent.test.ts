import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEncounterGuardedRuntimeSelectionIntent,
  runEncounterGuardedRuntimeSelectionIntentCli,
  validateEncounterGuardedRuntimeSelectionIntent,
} from "./encounter-guarded-runtime-selection-intent.js";
import type { EncounterLocalFactoryHandoffPreflightReport } from "./encounter-local-factory-handoff-preflight.js";

const preflight = (): EncounterLocalFactoryHandoffPreflightReport => ({
  generatedAt: "2026-05-23T14:00:00.000Z",
  schemaVersion: "openclinxr.encounter-local-factory-handoff-preflight.v1",
  source: "encounter_local_factory_operation_manifest",
  selectedScenarioId: "ed_chest_pain_priority_v1",
  selectedEncounterId: "encounter_assets_ed_chest_pain_executable_v1",
  selectedStationId: "ed_chest_pain_station_v1",
  handoffMode: "local_filesystem_preflight_only",
  localArtifactChecks: [],
  internallyPaired: true,
  guardedRuntimeSelectorDecision: {
    schemaVersion: "openclinxr.guarded-runtime-selector-disabled-decision.v1",
    selectionStatus: "blocked_intent_bundle_missing",
    claimBoundary: "guarded_runtime_selector_seam_not_runtime_execution",
    selectedScenarioId: "ed_chest_pain_priority_v1",
    selectedStationId: "ed_chest_pain_station_v1",
    selectedRuntimeAssetBundleId: "ed_chest_pain_encounter_v1:learner-runtime-bundle:v1",
    selectedBundleId: null,
    selectedBundleIdForFutureRuntime: null,
    matchedBundleSummary: null,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    providerExecutionPerformed: false,
    uiLaunchPerformed: false,
    questEvidenceRefreshed: false,
    blockers: ["runtime_selector_disabled_guard_not_wired", "guarded_runtime_intent_bundle_missing"],
    nextAllowedStep: "wire_runtime_selector_behind_disabled_guard",
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
  },
  runtimeBridgeAllowed: false,
  learnerLaunchAllowed: false,
  blockers: ["runtime_realism_evidence_not_attached", "humanoid_visual_qa_evidence_not_attached", "quest_webxr_evidence_not_attached"],
  evidenceBoundaries: {
    uiLaunchPerformed: false,
    cloudOperationPerformed: false,
    providerExecutionPerformed: false,
    questEvidenceRefreshed: false,
    broadVerificationPerformed: false,
    learnerLaunchEnabled: false,
    productionReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
  },
  claimBoundary: "local_factory_handoff_preflight_not_runtime_execution",
});

const providerBenchmark = () => ({
  localModel: { status: "passed", metrics: { executionAttempted: false } },
  localVoice: { status: "passed", metrics: { executionAttempted: false } },
});

describe("encounter guarded runtime selection intent", () => {
  it("builds a disabled runtime selection intent from handoff and provider metadata", () => {
    const report = buildEncounterGuardedRuntimeSelectionIntent(preflight(), providerBenchmark(), "2026-05-23T14:30:00.000Z");
    expect(report).toMatchObject({
      generatedAt: "2026-05-23T14:30:00.000Z",
      schemaVersion: "openclinxr.encounter-guarded-runtime-selection-intent.v1",
      source: "encounter_local_factory_handoff_preflight",
      selectionMode: "guarded_runtime_selection_intent_only",
      selectedScenarioId: "ed_chest_pain_priority_v1",
      handoffArtifactsInternallyPaired: true,
      guardedRuntimeSelectorDecision: {
        selectionStatus: "blocked_intent_bundle_missing",
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        providerExecutionPerformed: false,
        uiLaunchPerformed: false,
        questEvidenceRefreshed: false,
      },
      modelRuntimeCandidate: "local_configured_not_executed",
      voiceRuntimeCandidate: "local_configured_not_executed",
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      providerExecutionPerformed: false,
      uiLaunchPerformed: false,
      questEvidenceRefreshed: false,
      broadVerificationPerformed: false,
      blockers: expect.arrayContaining([
        "runtime_selector_disabled_guard_not_wired",
        "provider_execution_disabled_by_policy",
        "learner_launch_disabled_until_evidence_gates_clear",
      ]),
      nextAllowedStep: "wire_runtime_selector_behind_disabled_guard",
      claimBoundary: "guarded_runtime_selection_intent_not_runtime_execution",
    });
    expect(validateEncounterGuardedRuntimeSelectionIntent(report)).toEqual({ ok: true });
  });

  it("falls back to mock candidates when provider metadata is not configured", () => {
    const report = buildEncounterGuardedRuntimeSelectionIntent(preflight(), {}, "2026-05-23T14:30:00.000Z");
    expect(report.modelRuntimeCandidate).toBe("mock");
    expect(report.voiceRuntimeCandidate).toBe("mock");
    expect(validateEncounterGuardedRuntimeSelectionIntent(report)).toEqual({ ok: true });
  });

  it("writes and validates selection intents from the CLI", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-runtime-selection-intent-"));
    try {
      const preflightPath = path.join(tempDir, "preflight.json");
      const benchmarkPath = path.join(tempDir, "provider.json");
      const outputPath = path.join(tempDir, "selection-intent.json");
      await writeFile(preflightPath, `${JSON.stringify(preflight(), null, 2)}\n`, "utf8");
      await writeFile(benchmarkPath, `${JSON.stringify(providerBenchmark(), null, 2)}\n`, "utf8");
      await runEncounterGuardedRuntimeSelectionIntentCli(["--handoff-preflight", preflightPath, "--provider-benchmark", benchmarkPath, "--output", outputPath]);
      await expect(runEncounterGuardedRuntimeSelectionIntentCli(["--validate", outputPath])).resolves.toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
