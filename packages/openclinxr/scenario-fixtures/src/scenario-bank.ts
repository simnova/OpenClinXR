import type {
  DynamicEncounterFactoryProjectionArtifact,
  Scenario,
} from "@openclinxr/shared-schemas";
import {
  adultAbdominalPainDialogueSeeds,
  adultAbdominalPainScenario,
} from "./adult-abdominal-pain.js";
import {
  type DialogueFixtureSeed,
  edChestPainDialogueSeeds,
  edChestPainScenario,
  edChestPainScenarioV2,
  edChestPainScenarioV3,
} from "./ed-chest-pain.js";
import {
  pedsFeverDialogueSeeds,
  pedsFeverScenario,
} from "./peds-fever.js";
import {
  pediatricAsthmaScenario, pediatricAsthmaDialogueSeeds,
} from "./pediatric-asthma.js";
import {
  psychiatricSafetyScenario, psychiatricSafetyDialogueSeeds,
} from "./psychiatric-safety.js";
import {
  telehealthDiabetesScenario, telehealthDiabetesDialogueSeeds,
} from "./telehealth-diabetes.js";
import {
  wardDeliriumScenario, wardDeliriumDialogueSeeds,
} from "./ward-delirium.js";
import {
  obPreeclampsiaScenario, obPreeclampsiaDialogueSeeds,
} from "./ob-preeclampsia.js";
import {
  strokeAlertScenario, strokeAlertDialogueSeeds,
} from "./stroke-alert.js";
import {
  stepdownSepsisScenario, stepdownSepsisDialogueSeeds,
} from "./stepdown-sepsis.js";
import {
  abdominalPainInterpreterScenario, abdominalPainInterpreterDialogueSeeds,
} from "./abdominal-pain-interpreter.js";
import {
  oncologyBadNewsScenario, oncologyBadNewsDialogueSeeds,
} from "./oncology-bad-news.js";
import {
  postopFeverScenario, postopFeverDialogueSeeds,
} from "./postop-fever.js";
import {
  primaryCareDyslipidemiaScenario, primaryCareDyslipidemiaDialogueSeeds,
} from "./primary-care-dyslipidemia.js";

import type { LearnerScenarioView } from "./builders.js";
export type { LearnerScenarioView };

export const scenarioBank = [
  edChestPainScenario,
  pediatricAsthmaScenario,
  wardDeliriumScenario,
  telehealthDiabetesScenario,
  obPreeclampsiaScenario,
  psychiatricSafetyScenario,
  strokeAlertScenario,
  stepdownSepsisScenario,
  abdominalPainInterpreterScenario,
  oncologyBadNewsScenario,
  postopFeverScenario,
  primaryCareDyslipidemiaScenario,
  adultAbdominalPainScenario,
  pedsFeverScenario,
] as const satisfies readonly Scenario[];

export function findScenarioFixtureById(
  scenarioId: string,
  scenarios: readonly Scenario[] = scenarioBank,
): Scenario | undefined {
  for (const scenario of scenarios) {
    if (scenario.scenarioId === scenarioId) {
      return scenario;
    }
  }
  return undefined;
}

export type ScenarioDialogueSeedBankEntry = {
  scenarioId: string;
  seeds: readonly DialogueFixtureSeed[];
};

export const scenarioDialogueSeedBank = [
  { scenarioId: edChestPainScenario.scenarioId, seeds: edChestPainDialogueSeeds },
  { scenarioId: pediatricAsthmaScenario.scenarioId, seeds: pediatricAsthmaDialogueSeeds },
  { scenarioId: wardDeliriumScenario.scenarioId, seeds: wardDeliriumDialogueSeeds },
  { scenarioId: telehealthDiabetesScenario.scenarioId, seeds: telehealthDiabetesDialogueSeeds },
  { scenarioId: obPreeclampsiaScenario.scenarioId, seeds: obPreeclampsiaDialogueSeeds },
  { scenarioId: psychiatricSafetyScenario.scenarioId, seeds: psychiatricSafetyDialogueSeeds },
  { scenarioId: strokeAlertScenario.scenarioId, seeds: strokeAlertDialogueSeeds },
  { scenarioId: stepdownSepsisScenario.scenarioId, seeds: stepdownSepsisDialogueSeeds },
  { scenarioId: abdominalPainInterpreterScenario.scenarioId, seeds: abdominalPainInterpreterDialogueSeeds },
  { scenarioId: oncologyBadNewsScenario.scenarioId, seeds: oncologyBadNewsDialogueSeeds },
  { scenarioId: postopFeverScenario.scenarioId, seeds: postopFeverDialogueSeeds },
  { scenarioId: primaryCareDyslipidemiaScenario.scenarioId, seeds: primaryCareDyslipidemiaDialogueSeeds },
  { scenarioId: adultAbdominalPainScenario.scenarioId, seeds: adultAbdominalPainDialogueSeeds },
  { scenarioId: pedsFeverScenario.scenarioId, seeds: pedsFeverDialogueSeeds },
] as const satisfies readonly ScenarioDialogueSeedBankEntry[];

export type ScenarioBankMaturityReport = {
  scenarioCount: number;
  targetScenarioCount: number;
  missingScenarioCount: number;
  statusCounts: Record<Scenario["status"], number>;
  validationStageCounts: Record<Scenario["governance"]["validationStage"], number>;
  activationEligibleScenarioIds: string[];
  blockedScenarioIds: Array<{ scenarioId: string; reason: "not_approved" | "governance_not_ready" | "dialogue_seed_not_ready" }>;
  scenarioMaturityBreakdown: Array<{
    scenarioId: string;
    status: Scenario["status"];
    validationStage: Scenario["governance"]["validationStage"];
    activationEligible: boolean;
    blockerIds: string[];
    reviewGateStates: Scenario["review"];
    dialogueSeedReady: boolean;
    traceabilityReady: boolean;
    requiredTraceTagCount: number;
    assetNeedTypes: string[];
    environmentId: string | null;
    recommendedNextAction:
      | "ready_for_local_formative_queue_assembly"
      | "complete_required_review_gates"
      | "repair_dialogue_seed_replay"
      | "repair_traceability_contract"
      | "complete_governance_review";
  }>;
  clinicalSettings: string[];
  actorRoleCoverage: string[];
  safetyCriticalTraceTags: string[];
  hiddenFactPolicy: {
    redactsAll: boolean;
    requiresTriggerForAll: boolean;
  };
  fixtureCompleteness: {
    completeScenarioIds: string[];
    incompleteScenarioIds: Array<{ scenarioId: string; blockers: string[] }>;
    requiredActorRoles: string[];
    missingRequiredActorRoles: string[];
  };
  communicationProfileCoverage: {
    completeScenarioIds: string[];
    incompleteScenarioIds: Array<{ scenarioId: string; missingActorIds: string[] }>;
    actorCount: {
      total: number;
      withCommunicationProfile: number;
    };
  };
  pressureActorCoverage: {
    completeScenarioIds: string[];
    incompleteScenarioIds: Array<{ scenarioId: string; blockers: string[] }>;
    scenarioCountWithNonPatientActors: number;
    minimumNonPatientActorCount: number;
  };
  traceabilityCoverage: {
    completeScenarioIds: string[];
    incompleteScenarioIds: Array<{ scenarioId: string; blockers: string[] }>;
    requiredTraceTagsCoveredByRubric: boolean;
    eventTagsWithinRequiredTraceTags: boolean;
    safetyCriticalTagsWithinRequiredTraceTags: boolean;
  };
  dialogueSeedCoverage: {
    seededScenarioIds: string[];
    missingSeedScenarioIds: string[];
    guardrailProbeScenarioIds: string[];
  };
  sharedAssetReuseMaturity: {
    claimBoundary: "scenario_bank_shared_asset_reuse_metadata_only";
    lookupKeyCount: number;
    reusableLookupKeyCount: number;
    duplicateLookupKeyCount: number;
    scenarioCountWithLookupKeys: number;
    scenarioCountWithReusableKeys: number;
    topReusableLookupKeys: Array<{ lookupKey: string; scenarioCount: number }>;
    lruReuseCandidateScenarioIds: string[];
    notEvidenceFor: Array<"generated_asset_readiness" | "shared_asset_library_materialization" | "quest_readiness" | "runtime_readiness" | "production_asset_readiness">;
  };
};

export type ScenarioBankExamSequenceBoundary =
  | "activation_ready"
  | "draft_review_required"
  | "governance_review_required"
  | "dialogue_seed_replay_required";

export type ScenarioBankExamSequenceStation = {
  stationOrder: number;
  scenarioId: string;
  title: string;
  status: Scenario["status"];
  environmentId: string | null;
  actorRoles: string[];
  actorCount: number;
  requiredTraceTagCount: number;
  assetNeedTypes: string[];
  dialogueSeedCount: number;
  guardrailProbeReady: boolean;
  activationEligible: boolean;
  learnerUseBoundary: ScenarioBankExamSequenceBoundary;
  reviewBlockers: string[];
  reviewSummary: string;
};

export type ScenarioBankExamSequenceProjection = {
  source: "scenario_bank_ordered_sequence";
  targetStationCount: number;
  stationCount: number;
  missingStationCount: number;
  activationEligibleCount: number;
  learnerUseBoundary: "activation_ready_only";
  stations: ScenarioBankExamSequenceStation[];
};

export type DynamicEncounterFactoryPlanningScenario = {
  factoryPlanningOrder: number;
  scenarioId: string;
  title: string;
  status: Scenario["status"];
  validationStage: Scenario["governance"]["validationStage"];
  actorRoles: string[];
  actorCount: number;
  multiActorReady: boolean;
  dialogueSeedCount: number;
  dialogueSeedReady: boolean;
  traceabilityReady: boolean;
  requiredTraceTagCount: number;
  safetyCriticalTraceTagCount: number;
  eventScheduleCount: number;
  rubricCount: number;
  requiredReviewerRoleCount: number;
  environmentId: string | null;
  equipmentCount: number;
  assetNeedTypes: string[];
  factoryPlanningMetadataComplete: boolean;
  factoryPlanningMetadataBlockers: string[];
  encounterFactoryInputSummary: {
    source: "scenario_definition_and_dialogue_seed_bank";
    scenarioBankOrder: number;
    factorySelectionRole: "anchor" | "next_factory_planning_scenario" | "candidate";
    factorySelectionMode: DynamicEncounterFactoryPlanningProjection["nextFactoryPlanningScenarioSelectionMode"];
    factorySelectionClaimBoundary: DynamicEncounterFactoryPlanningProjection["claimBoundary"];
    actorAssetWorkOrderCount: number;
    environmentAssetWorkOrderCount: number;
    equipmentAssetWorkOrderCount: number;
    sharedAssetLookupKeys: string[];
    requiredTraceTags: string[];
    dynamicBehaviorTraceTags: string[];
  };
  humanoidPerformanceContract: {
    claimBoundary: "case_definition_humanoid_performance_metadata_only";
    actorCount: number;
    locomotionActorRoles: string[];
    expressionActorRoles: string[];
    gazeActorRoles: string[];
    lipSyncActorRoles: string[];
    interactiveActorRoles: string[];
    actorRuntimeRealismRequirements: Array<{
      actorId: string;
      role: string;
      baselineMood: string[];
      locomotionRequired: boolean;
      expressionRequired: boolean;
      gazeRequired: boolean;
      lipSyncRequired: boolean;
      interactionRequired: boolean;
      requiredCueIds: string[];
    }>;
    emotionStateCount: number;
    dialogueDrivenVisemeMappingRequired: boolean;
    gazeTargetingRequired: boolean;
    locomotionPlanningRequired: boolean;
    notEvidenceFor: Array<"generated_humanoid_asset_readiness" | "animation_quality" | "quest_readiness" | "runtime_readiness" | "clinical_validity">;
  };
  activationEligible: boolean;
  learnerUseBoundary: ScenarioBankExamSequenceBoundary;
  reviewBlockers: string[];
  recommendedNextAction: ScenarioBankMaturityReport["scenarioMaturityBreakdown"][number]["recommendedNextAction"];
};

export type DynamicEncounterFactoryPlanningProjection = {
  source: "scenario_bank_dynamic_encounter_factory_planning";
  claimBoundary: "review_gated_factory_metadata_only";
  anchorScenarioId: string;
  nextFactoryPlanningScenarioId: string | null;
  nextFactoryPlanningScenarioSelectionMode: "approved_encounter_variant" | "next_scenario_fallback" | "anchor_not_found";
  learnerUseBoundary: "activation_ready_only";
  scenarios: DynamicEncounterFactoryPlanningScenario[];
};

const targetStep2CsStyleStationCount = 14;
const requiredCaseBankActorRoles = [
  "consultant",
  "family",
  "interpreter",
  "medical_assistant",
  "nurse",
  "patient",
  "physician",
  "respiratory_therapist",
  "system",
] as const;

export function evaluateScenarioBankMaturity(scenarios: readonly Scenario[]): ScenarioBankMaturityReport {
  const activationEligibleScenarioIds: string[] = [];
  const blockedScenarioIds: ScenarioBankMaturityReport["blockedScenarioIds"] = [];
  const actorRoleCoverage = uniqueSorted(scenarios.flatMap((scenario) => scenario.actors.map((actor) => actor.role)));
  const incompleteScenarioIds = scenarios
    .map((scenario) => ({ scenarioId: scenario.scenarioId, blockers: scenarioFixtureCompletenessBlockers(scenario) }))
    .filter((result) => result.blockers.length > 0);
  const communicationProfileGaps = scenarios
    .map((scenario) => ({
      scenarioId: scenario.scenarioId,
      missingActorIds: scenario.actors
        .filter((actor) => !actor.communicationProfile)
        .map((actor) => actor.actorId),
    }))
    .filter((result) => result.missingActorIds.length > 0);
  const actorCount = scenarios.reduce((count, scenario) => count + scenario.actors.length, 0);
  const actorCommunicationProfileCount = scenarios.reduce(
    (count, scenario) => count + scenario.actors.filter((actor) => Boolean(actor.communicationProfile)).length,
    0,
  );
  const traceabilityGaps = scenarios
    .map((scenario) => ({ scenarioId: scenario.scenarioId, blockers: scenarioTraceabilityBlockers(scenario) }))
    .filter((result) => result.blockers.length > 0);
  const pressureActorGaps = scenarios
    .map((scenario) => ({ scenarioId: scenario.scenarioId, blockers: pressureActorCoverageBlockers(scenario) }))
    .filter((result) => result.blockers.length > 0);

  for (const scenario of scenarios) {
    if (isActivationEligible(scenario)) {
      activationEligibleScenarioIds.push(scenario.scenarioId);
    } else {
      blockedScenarioIds.push({
        scenarioId: scenario.scenarioId,
        reason: scenario.status !== "approved"
          ? "not_approved"
          : hasReplayReadyDialogueSeeds(scenario)
            ? "governance_not_ready"
            : "dialogue_seed_not_ready",
      });
    }
  }

  return {
    scenarioCount: scenarios.length,
    targetScenarioCount: targetStep2CsStyleStationCount,
    missingScenarioCount: Math.max(targetStep2CsStyleStationCount - scenarios.length, 0),
    statusCounts: countBy(["approved", "draft", "retired"], scenarios.map((scenario) => scenario.status)),
    validationStageCounts: countBy(
      ["stage_0_synthetic_draft", "stage_1_expert_reviewed", "stage_2_pilot_ready", "stage_3_validated"],
      scenarios.map((scenario) => scenario.governance.validationStage),
    ),
    activationEligibleScenarioIds,
    blockedScenarioIds,
    scenarioMaturityBreakdown: scenarios.map((scenario) => {
      const traceabilityBlockers = scenarioTraceabilityBlockers(scenario);
      const dialogueSeedReady = hasReplayReadyDialogueSeeds(scenario);
      const reviewGateBlockers = scenarioReviewGateBlockers(scenario);
      const activationEligible = isActivationEligible(scenario);
      return {
        scenarioId: scenario.scenarioId,
        status: scenario.status,
        validationStage: scenario.governance.validationStage,
        activationEligible,
        blockerIds: [
          ...reviewGateBlockers,
          ...(dialogueSeedReady ? [] : ["dialogue_seed_replay_required"]),
          ...traceabilityBlockers,
        ],
        reviewGateStates: { ...scenario.review },
        dialogueSeedReady,
        traceabilityReady: traceabilityBlockers.length === 0,
        requiredTraceTagCount: scenario.requiredTraceTags.length,
        assetNeedTypes: uniqueSorted((scenario.assetNeeds ?? []).map((assetNeed) => assetNeed.assetType)),
        environmentId: scenario.environment?.environmentId ?? null,
        recommendedNextAction: scenarioMaturityRecommendedNextAction({
          activationEligible,
          reviewGateBlockers,
          dialogueSeedReady,
          traceabilityBlockers,
        }),
      };
    }),
    clinicalSettings: uniqueSorted(scenarios.map((scenario) => scenario.environment?.environmentId).filter((value): value is string => Boolean(value))),
    actorRoleCoverage,
    safetyCriticalTraceTags: uniqueSorted(scenarios.flatMap((scenario) => scenario.governance.safetyCriticalTraceTags)),
    hiddenFactPolicy: {
      redactsAll: scenarios.every((scenario) => scenario.governance.hiddenFactPolicy.learnerView === "redact_hidden_facts"),
      requiresTriggerForAll: scenarios.every((scenario) => scenario.governance.hiddenFactPolicy.disclosureRequiresTrigger),
    },
    fixtureCompleteness: {
      completeScenarioIds: scenarios
        .filter((scenario) => !incompleteScenarioIds.some((result) => result.scenarioId === scenario.scenarioId))
        .map((scenario) => scenario.scenarioId),
      incompleteScenarioIds,
      requiredActorRoles: [...requiredCaseBankActorRoles],
      missingRequiredActorRoles: requiredCaseBankActorRoles.filter((role) => !actorRoleCoverage.includes(role)),
    },
    communicationProfileCoverage: {
      completeScenarioIds: scenarios
        .filter((scenario) => !communicationProfileGaps.some((result) => result.scenarioId === scenario.scenarioId))
        .map((scenario) => scenario.scenarioId),
      incompleteScenarioIds: communicationProfileGaps,
      actorCount: {
        total: actorCount,
        withCommunicationProfile: actorCommunicationProfileCount,
      },
    },
    pressureActorCoverage: {
      completeScenarioIds: scenarios
        .filter((scenario) => !pressureActorGaps.some((result) => result.scenarioId === scenario.scenarioId))
        .map((scenario) => scenario.scenarioId),
      incompleteScenarioIds: pressureActorGaps,
      scenarioCountWithNonPatientActors: scenarios.length - pressureActorGaps.length,
      minimumNonPatientActorCount: 1,
    },
    traceabilityCoverage: {
      completeScenarioIds: scenarios
        .filter((scenario) => !traceabilityGaps.some((result) => result.scenarioId === scenario.scenarioId))
        .map((scenario) => scenario.scenarioId),
      incompleteScenarioIds: traceabilityGaps,
      requiredTraceTagsCoveredByRubric: traceabilityGaps.every((gap) =>
        gap.blockers.every((blocker) => !blocker.startsWith("required_trace_tag_missing_from_rubric:"))
      ),
      eventTagsWithinRequiredTraceTags: traceabilityGaps.every((gap) =>
        gap.blockers.every((blocker) => !blocker.startsWith("event_schedule_tag_not_required:"))
      ),
      safetyCriticalTagsWithinRequiredTraceTags: traceabilityGaps.every((gap) =>
        gap.blockers.every((blocker) => !blocker.startsWith("safety_critical_tag_not_required:"))
      ),
    },
    dialogueSeedCoverage: evaluateDialogueSeedCoverage(scenarios),
    sharedAssetReuseMaturity: evaluateSharedAssetReuseMaturity(scenarios),
  };
}

function evaluateSharedAssetReuseMaturity(scenarios: readonly Scenario[]): ScenarioBankMaturityReport["sharedAssetReuseMaturity"] {
  const scenarioLookupKeys = scenarios.map((scenario) => ({
    scenarioId: scenario.scenarioId,
    lookupKeys: buildEncounterFactoryInputSummary(
      scenario,
      scenarioDialogueSeedBank.find((entry) => entry.scenarioId === scenario.scenarioId)?.seeds ?? [],
      {
        scenarioBankOrder: scenarios.indexOf(scenario) + 1,
        factorySelectionRole: "candidate",
        factorySelectionMode: "next_scenario_fallback",
        factorySelectionClaimBoundary: "review_gated_factory_metadata_only",
      },
    ).sharedAssetLookupKeys,
  }));
  const scenarioCountsByLookupKey = new Map<string, Set<string>>();
  for (const scenario of scenarioLookupKeys) {
    for (const lookupKey of scenario.lookupKeys) {
      const scenarioIds = scenarioCountsByLookupKey.get(lookupKey) ?? new Set<string>();
      scenarioIds.add(scenario.scenarioId);
      scenarioCountsByLookupKey.set(lookupKey, scenarioIds);
    }
  }
  const reusableLookupKeys = [...scenarioCountsByLookupKey.entries()]
    .map(([lookupKey, scenarioIds]) => ({ lookupKey, scenarioCount: scenarioIds.size }))
    .filter((entry) => entry.scenarioCount > 1)
    .sort((left, right) => right.scenarioCount - left.scenarioCount || left.lookupKey.localeCompare(right.lookupKey));
  const reusableLookupKeySet = new Set(reusableLookupKeys.map((entry) => entry.lookupKey));

  return {
    claimBoundary: "scenario_bank_shared_asset_reuse_metadata_only",
    lookupKeyCount: scenarioCountsByLookupKey.size,
    reusableLookupKeyCount: reusableLookupKeys.length,
    duplicateLookupKeyCount: reusableLookupKeys.reduce((count, entry) => count + entry.scenarioCount - 1, 0),
    scenarioCountWithLookupKeys: scenarioLookupKeys.filter((scenario) => scenario.lookupKeys.length > 0).length,
    scenarioCountWithReusableKeys: scenarioLookupKeys.filter((scenario) =>
      scenario.lookupKeys.some((lookupKey) => reusableLookupKeySet.has(lookupKey))
    ).length,
    topReusableLookupKeys: reusableLookupKeys.slice(0, 5),
    lruReuseCandidateScenarioIds: scenarioLookupKeys
      .filter((scenario) => scenario.lookupKeys.some((lookupKey) => reusableLookupKeySet.has(lookupKey)))
      .map((scenario) => scenario.scenarioId),
    notEvidenceFor: [
      "generated_asset_readiness",
      "shared_asset_library_materialization",
      "quest_readiness",
      "runtime_readiness",
      "production_asset_readiness",
    ],
  };
}

function pressureActorCoverageBlockers(scenario: Scenario): string[] {
  const nonPatientActors = scenario.actors.filter((actor) => actor.role !== "patient" && actor.role !== "system");
  return nonPatientActors.length > 0 ? [] : ["non_patient_pressure_actor_missing"];
}

export function buildScenarioBankExamSequenceProjection(
  scenarios: readonly Scenario[] = scenarioBank,
): ScenarioBankExamSequenceProjection {
  const maturity = evaluateScenarioBankMaturity(scenarios);
  const activationEligibleScenarioIds = new Set(maturity.activationEligibleScenarioIds);

  return {
    source: "scenario_bank_ordered_sequence",
    targetStationCount: targetStep2CsStyleStationCount,
    stationCount: scenarios.length,
    missingStationCount: maturity.missingScenarioCount,
    activationEligibleCount: maturity.activationEligibleScenarioIds.length,
    learnerUseBoundary: "activation_ready_only",
    stations: scenarios.map((scenario, index) => {
      const dialogueSeedEntry = scenarioDialogueSeedBank.find((entry) => entry.scenarioId === scenario.scenarioId);
      const guardrailProbeReady = dialogueSeedEntry?.seeds.some((seed) => seed.safetyExpectation === "blocks_hidden_truth_probe") ?? false;
      const learnerUseBoundary = learnerUseBoundaryForScenario(scenario, activationEligibleScenarioIds);

      return {
        stationOrder: index + 1,
        scenarioId: scenario.scenarioId,
        title: scenario.title,
        status: scenario.status,
        environmentId: scenario.environment?.environmentId ?? null,
        actorRoles: uniqueSorted(scenario.actors.map((actor) => actor.role)),
        actorCount: scenario.actors.length,
        requiredTraceTagCount: scenario.requiredTraceTags.length,
        assetNeedTypes: uniqueSorted((scenario.assetNeeds ?? []).map((assetNeed) => assetNeed.assetType)),
        dialogueSeedCount: dialogueSeedEntry?.seeds.length ?? 0,
        guardrailProbeReady,
        activationEligible: activationEligibleScenarioIds.has(scenario.scenarioId),
        learnerUseBoundary,
        reviewBlockers: reviewBlockersForBoundary(learnerUseBoundary),
        reviewSummary: reviewSummaryForBoundary(learnerUseBoundary),
      };
    }),
  };
}

export function buildDynamicEncounterFactoryPlanningProjection(
  scenarios: readonly Scenario[] = scenarioBank,
  anchorScenarioId = edChestPainScenario.scenarioId,
): DynamicEncounterFactoryPlanningProjection {
  const maturity = evaluateScenarioBankMaturity(scenarios);
  const maturityByScenarioId = new Map(maturity.scenarioMaturityBreakdown.map((entry) => [entry.scenarioId, entry]));
  const activationEligibleScenarioIds = new Set(maturity.activationEligibleScenarioIds);
  const anchorIndex = scenarios.findIndex((scenario) => scenario.scenarioId === anchorScenarioId);
  const anchorBaseId = normalizeScenarioEncounterBaseId(anchorScenarioId);
  const remainingScenarios = anchorIndex >= 0 ? scenarios.slice(anchorIndex + 1) : [];
  const nextApprovedEncounterVariant = remainingScenarios.find((scenario) =>
    scenario.status === "approved" && normalizeScenarioEncounterBaseId(scenario.scenarioId) === anchorBaseId,
  );
  const nextFallbackScenarioId = remainingScenarios[0]?.scenarioId ?? null;
  const nextFactoryPlanningScenarioId = nextApprovedEncounterVariant?.scenarioId ?? nextFallbackScenarioId;
  const nextFactoryPlanningScenarioSelectionMode = (() => {
    if (anchorIndex < 0) return "anchor_not_found";
    if (nextApprovedEncounterVariant) return "approved_encounter_variant";
    if (nextFallbackScenarioId === null) return "anchor_not_found";
    return "next_scenario_fallback";
  })();

  return {
    source: "scenario_bank_dynamic_encounter_factory_planning",
    claimBoundary: "review_gated_factory_metadata_only",
    anchorScenarioId,
    nextFactoryPlanningScenarioId,
    nextFactoryPlanningScenarioSelectionMode,
    learnerUseBoundary: "activation_ready_only",
    scenarios: scenarios.map((scenario, index) => {
      const maturityEntry = maturityByScenarioId.get(scenario.scenarioId);
      const dialogueSeedEntry = scenarioDialogueSeedBank.find((entry) => entry.scenarioId === scenario.scenarioId);
      const learnerUseBoundary = learnerUseBoundaryForScenario(scenario, activationEligibleScenarioIds);
      const factoryPlanningMetadataBlockers = scenarioFactoryPlanningMetadataBlockers(scenario);
      const encounterFactoryInputSummary = buildEncounterFactoryInputSummary(scenario, dialogueSeedEntry?.seeds ?? [], {
        scenarioBankOrder: index + 1,
        factorySelectionRole: scenario.scenarioId === anchorScenarioId
          ? "anchor"
          : scenario.scenarioId === nextFactoryPlanningScenarioId
            ? "next_factory_planning_scenario"
            : "candidate",
        factorySelectionMode: nextFactoryPlanningScenarioSelectionMode,
        factorySelectionClaimBoundary: "review_gated_factory_metadata_only",
      });

      return {
        factoryPlanningOrder: index + 1,
        scenarioId: scenario.scenarioId,
        title: scenario.title,
        status: scenario.status,
        validationStage: scenario.governance.validationStage,
        actorRoles: uniqueSorted(scenario.actors.map((actor) => actor.role)),
        actorCount: scenario.actors.length,
        multiActorReady: scenario.actors.length >= 2,
        dialogueSeedCount: dialogueSeedEntry?.seeds.length ?? 0,
        dialogueSeedReady: maturityEntry?.dialogueSeedReady ?? hasReplayReadyDialogueSeeds(scenario),
        traceabilityReady: maturityEntry?.traceabilityReady ?? scenarioTraceabilityBlockers(scenario).length === 0,
        requiredTraceTagCount: scenario.requiredTraceTags.length,
        safetyCriticalTraceTagCount: scenario.governance.safetyCriticalTraceTags.length,
        eventScheduleCount: scenario.eventSchedule.length,
        rubricCount: scenario.reviewRubric.length,
        requiredReviewerRoleCount: scenario.governance.requiredReviewerRoles.length,
        environmentId: scenario.environment?.environmentId ?? null,
        equipmentCount: scenario.equipment?.length ?? 0,
        assetNeedTypes: uniqueSorted((scenario.assetNeeds ?? []).map((assetNeed) => assetNeed.assetType)),
        factoryPlanningMetadataComplete: factoryPlanningMetadataBlockers.length === 0,
        factoryPlanningMetadataBlockers,
        encounterFactoryInputSummary,
        humanoidPerformanceContract: buildHumanoidPerformanceContract(scenario, dialogueSeedEntry?.seeds ?? []),
        activationEligible: activationEligibleScenarioIds.has(scenario.scenarioId),
        learnerUseBoundary,
        reviewBlockers: maturityEntry?.blockerIds ?? reviewBlockersForBoundary(learnerUseBoundary),
        recommendedNextAction: maturityEntry?.recommendedNextAction ?? "complete_required_review_gates",
      };
    }),
  };
}

function buildHumanoidPerformanceContract(
  scenario: Scenario,
  dialogueSeeds: readonly DialogueFixtureSeed[],
): DynamicEncounterFactoryPlanningScenario["humanoidPerformanceContract"] {
  const nonSystemActors = scenario.actors.filter((actor) => actor.role !== "system");
  const interactiveActorRoles = uniqueSorted(nonSystemActors.map((actor) => actor.role));
  const expressionActorRoles = uniqueSorted(
    nonSystemActors
      .filter((actor) => Boolean(actor.communicationProfile) || (actor.demeanor ?? "").trim().length > 0)
      .map((actor) => actor.role),
  );
  const emotionalStates = uniqueSorted(nonSystemActors.flatMap((actor) => actor.communicationProfile?.baselineMood ?? []));
  const hasDialogueSeeds = dialogueSeeds.length > 0;
  const hasEscalationTimeline = scenario.eventSchedule.length > 0 || nonSystemActors.some((actor) =>
    (actor.communicationProfile?.escalationTriggers.length ?? 0) > 0
    || (actor.communicationProfile?.deescalationTriggers.length ?? 0) > 0
  );

  return {
    claimBoundary: "case_definition_humanoid_performance_metadata_only",
    actorCount: nonSystemActors.length,
    locomotionActorRoles: interactiveActorRoles,
    expressionActorRoles,
    gazeActorRoles: interactiveActorRoles,
    lipSyncActorRoles: hasDialogueSeeds ? interactiveActorRoles : [],
    interactiveActorRoles,
    actorRuntimeRealismRequirements: nonSystemActors.map((actor) => ({
      actorId: actor.actorId,
      role: actor.role,
      baselineMood: [...(actor.communicationProfile?.baselineMood ?? [])],
      locomotionRequired: hasEscalationTimeline,
      expressionRequired: expressionActorRoles.includes(actor.role),
      gazeRequired: nonSystemActors.length > 1,
      lipSyncRequired: hasDialogueSeeds,
      interactionRequired: true,
      requiredCueIds: [
        "case_definition_driven_expression_selection",
        "dialogue_viseme_and_gaze_mapping",
        "actor_target_gaze_from_trace_intent",
        "scenario_actor_interaction_affordance",
        ...(hasEscalationTimeline ? ["scenario_timeline_locomotion_or_posture_change"] : []),
      ],
    })),
    emotionStateCount: emotionalStates.length,
    dialogueDrivenVisemeMappingRequired: hasDialogueSeeds,
    gazeTargetingRequired: nonSystemActors.length > 1,
    locomotionPlanningRequired: hasEscalationTimeline,
    notEvidenceFor: [
      "generated_humanoid_asset_readiness",
      "animation_quality",
      "quest_readiness",
      "runtime_readiness",
      "clinical_validity",
    ],
  };
}

function buildEncounterFactoryInputSummary(
  scenario: Scenario,
  dialogueSeeds: readonly DialogueFixtureSeed[],
  selectionMetadata: Pick<
    DynamicEncounterFactoryPlanningScenario["encounterFactoryInputSummary"],
    "scenarioBankOrder" | "factorySelectionRole" | "factorySelectionMode" | "factorySelectionClaimBoundary"
  >,
): DynamicEncounterFactoryPlanningScenario["encounterFactoryInputSummary"] {
  const assetNeeds = scenario.assetNeeds ?? [];
  const dialogueTraceTags = dialogueSeeds.flatMap((seed) =>
    seed.expectedTraceTags.filter((tag) => tag !== "guardrail_hidden_truth" && tag !== "patient_note_submitted")
  );
  const scheduledTraceTags = scenario.eventSchedule.map((entry) => entry.tag);

  return {
    source: "scenario_definition_and_dialogue_seed_bank",
    ...selectionMetadata,
    actorAssetWorkOrderCount: assetNeeds.filter((assetNeed) => assetNeed.assetType === "character").length,
    environmentAssetWorkOrderCount: assetNeeds.filter((assetNeed) => assetNeed.assetType === "environment").length,
    equipmentAssetWorkOrderCount: assetNeeds.filter((assetNeed) => assetNeed.assetType === "equipment").length,
    sharedAssetLookupKeys: uniqueSorted([
      `semantic::environment::${scenario.environment?.environmentId ?? scenario.scenarioId}`,
      ...scenario.actors.map((actor) => `semantic::actor::${actor.role}::${actor.actorId}`),
      ...(scenario.equipment ?? []).map((item) => `semantic::equipment::${normalizeSemanticKey(item)}`),
    ]),
    requiredTraceTags: [...scenario.requiredTraceTags],
    dynamicBehaviorTraceTags: uniqueSorted([
      ...scheduledTraceTags,
      ...dialogueTraceTags,
      ...scenario.governance.safetyCriticalTraceTags,
    ]).filter((tag) => scenario.requiredTraceTags.includes(tag)),
  };
}

export function buildDynamicEncounterFactoryProjectionArtifact(
  scenarios: readonly Scenario[] = scenarioBank,
  anchorScenarioId = edChestPainScenario.scenarioId,
): DynamicEncounterFactoryProjectionArtifact {
  const projection = buildDynamicEncounterFactoryPlanningProjection(scenarios, anchorScenarioId);
  const anchorIndex = scenarios.findIndex((scenario) => scenario.scenarioId === anchorScenarioId);
  const normalizedAnchorIndex = Math.max(anchorIndex, 0);
  const scenarioBankSlice = scenarios.slice(normalizedAnchorIndex, normalizedAnchorIndex + 3);

  return {
    schemaVersion: "openclinxr.dynamic-encounter-factory-projection-artifact.v1",
    source: "scenario_bank_dynamic_encounter_factory_projection_artifact",
    claimBoundary: "review_gated_factory_metadata_only",
    anchorScenarioId,
    nextFactoryPlanningScenarioId: projection.nextFactoryPlanningScenarioId,
    nextFactoryPlanningScenarioSelectionMode: projection.nextFactoryPlanningScenarioSelectionMode,
    learnerUseBoundary: projection.learnerUseBoundary,
    scenarioBankSlice,
  };
}

export const variantScenarioBank = [
  edChestPainScenario,
  edChestPainScenarioV2,
  edChestPainScenarioV3,
  ...scenarioBank.slice(1),
] as const satisfies readonly Scenario[];

function normalizeScenarioEncounterBaseId(scenarioId: string): string {
  return scenarioId.replace(/_v\d+$/i, "");
}

function normalizeSemanticKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function createLearnerScenarioView(scenario: Scenario): LearnerScenarioView {
  return JSON.parse(JSON.stringify({
    ...scenario,
    actors: scenario.actors.map(({ hiddenFacts: _hiddenFacts, ...actor }) => actor),
  })) as LearnerScenarioView;
}

function isActivationEligible(scenario: Scenario): boolean {
  return scenario.status === "approved"
    && Object.values(scenario.review).every((state) => state === "approved")
    && scenario.governance.validationStage !== "stage_0_synthetic_draft"
    && scenario.governance.scoreUseLabel !== "validated_summative"
    && hasReplayReadyDialogueSeeds(scenario);
}

function learnerUseBoundaryForScenario(
  scenario: Scenario,
  activationEligibleScenarioIds: ReadonlySet<string>,
): ScenarioBankExamSequenceBoundary {
  if (activationEligibleScenarioIds.has(scenario.scenarioId)) {
    return "activation_ready";
  }
  if (scenario.status !== "approved") {
    return "draft_review_required";
  }
  if (!hasReplayReadyDialogueSeeds(scenario)) {
    return "dialogue_seed_replay_required";
  }
  return "governance_review_required";
}

function reviewSummaryForBoundary(boundary: ScenarioBankExamSequenceBoundary): string {
  const summaries: Record<ScenarioBankExamSequenceBoundary, string> = {
    activation_ready: "Approved for local formative station queue assembly.",
    draft_review_required: "Draft scenario remains faculty/admin review content until required review gates approve it.",
    governance_review_required: "Scenario is approved but still needs governance review before learner queue activation.",
    dialogue_seed_replay_required: "Scenario is approved but deterministic dialogue replay seeds must pass before activation.",
  };
  return summaries[boundary];
}

function reviewBlockersForBoundary(boundary: ScenarioBankExamSequenceBoundary): string[] {
  const blockers: Record<ScenarioBankExamSequenceBoundary, string[]> = {
    activation_ready: [],
    draft_review_required: ["scenario_status:draft", "faculty_review_required"],
    governance_review_required: ["governance_review_required"],
    dialogue_seed_replay_required: ["dialogue_seed_replay_required"],
  };
  return [...blockers[boundary]];
}

function scenarioReviewGateBlockers(scenario: Scenario): string[] {
  return [
    scenario.status === "approved" ? undefined : `scenario_status:${scenario.status}`,
    scenario.review.clinical === "approved" ? undefined : `clinical_review:${scenario.review.clinical}`,
    scenario.review.psychometric === "approved" ? undefined : `psychometric_review:${scenario.review.psychometric}`,
    scenario.review.legal === "approved" ? undefined : `legal_review:${scenario.review.legal}`,
    scenario.review.simulationQa === "approved" ? undefined : `simulation_qa_review:${scenario.review.simulationQa}`,
    scenario.governance.validationStage === "stage_1_expert_reviewed" ? undefined : `validation_stage:${scenario.governance.validationStage}`,
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function scenarioMaturityRecommendedNextAction(input: {
  activationEligible: boolean;
  reviewGateBlockers: string[];
  dialogueSeedReady: boolean;
  traceabilityBlockers: string[];
}): ScenarioBankMaturityReport["scenarioMaturityBreakdown"][number]["recommendedNextAction"] {
  if (input.activationEligible) return "ready_for_local_formative_queue_assembly";
  if (input.reviewGateBlockers.length > 0) return "complete_required_review_gates";
  if (!input.dialogueSeedReady) return "repair_dialogue_seed_replay";
  if (input.traceabilityBlockers.length > 0) return "repair_traceability_contract";
  return "complete_governance_review";
}

function hasReplayReadyDialogueSeeds(scenario: Scenario): boolean {
  const actorIds = new Set(scenario.actors.map((actor) => actor.actorId));
  const allowedTraceTags = new Set([
    ...scenario.requiredTraceTags,
    ...scenario.governance.safetyCriticalTraceTags,
    "guardrail_hidden_truth",
  ]);
  const seedEntry = scenarioDialogueSeedBank.find((entry) => entry.scenarioId === scenario.scenarioId);

  if (!seedEntry) return false;

  return seedEntry.seeds.length > 0
    && seedEntry.seeds.some((seed) => seed.safetyExpectation === "blocks_hidden_truth_probe")
    && seedEntry.seeds.every((seed) =>
      actorIds.has(seed.actorId)
      && seed.visibleFacts.length > 0
      && seed.hiddenFactCanaries.length > 0
      && seed.expectedTraceTags.every((tag) => allowedTraceTags.has(tag))
    );
}

function scenarioFixtureCompletenessBlockers(scenario: Scenario): string[] {
  const assetNeeds = scenario.assetNeeds ?? [];
  const assetTypes = new Set(assetNeeds.map((assetNeed) => assetNeed.assetType));
  const actorRoles = new Set(scenario.actors.map((actor) => actor.role));
  const blockers = [
    scenario.actors.length >= 2 ? undefined : "actors_under_2",
    actorRoles.has("patient") ? undefined : "missing_patient_actor",
    scenario.eventSchedule.length > 0 ? undefined : "missing_event_schedule",
    scenario.reviewRubric.length >= 4 ? undefined : "review_rubric_under_4",
    assetTypes.has("character") ? undefined : "missing_character_asset",
    assetTypes.has("environment") ? undefined : "missing_environment_asset",
    scenario.governance.sourceIds.length > 0 ? undefined : "missing_governance_source",
    scenario.governance.requiredReviewerRoles.length >= 4 ? undefined : "missing_review_governance_roles",
    scenario.governance.safetyCriticalTraceTags.length > 0 ? undefined : "missing_safety_critical_trace_tags",
  ];

  return blockers.filter((blocker): blocker is string => typeof blocker === "string");
}

function scenarioTraceabilityBlockers(scenario: Scenario): string[] {
  const requiredTraceTags = new Set(scenario.requiredTraceTags);
  const rubricTraceTags = new Set(scenario.reviewRubric.flatMap((rubricItem) => rubricItem.requiredTraceTags));
  const eventTraceTags = new Set(scenario.eventSchedule.map((scheduledEvent) => scheduledEvent.tag));
  const safetyCriticalTraceTags = new Set(scenario.governance.safetyCriticalTraceTags);

  return [
    ...[...requiredTraceTags]
      .filter((tag) => !rubricTraceTags.has(tag))
      .map((tag) => `required_trace_tag_missing_from_rubric:${tag}`),
    ...[...eventTraceTags]
      .filter((tag) => !requiredTraceTags.has(tag))
      .map((tag) => `event_schedule_tag_not_required:${tag}`),
    ...[...safetyCriticalTraceTags]
      .filter((tag) => !requiredTraceTags.has(tag))
      .map((tag) => `safety_critical_tag_not_required:${tag}`),
  ].sort();
}

function scenarioFactoryPlanningMetadataBlockers(scenario: Scenario): string[] {
  const assetTypes = new Set((scenario.assetNeeds ?? []).map((assetNeed) => assetNeed.assetType));

  return [
    scenario.actors.length >= 2 ? undefined : "multi_actor_metadata_missing",
    hasReplayReadyDialogueSeeds(scenario) ? undefined : "dialogue_seed_metadata_missing",
    scenarioTraceabilityBlockers(scenario).length === 0 ? undefined : "traceability_metadata_incomplete",
    scenario.environment ? undefined : "environment_metadata_missing",
    scenario.equipment && scenario.equipment.length > 0 ? undefined : "equipment_metadata_missing",
    assetTypes.has("character") ? undefined : "character_asset_need_missing",
    assetTypes.has("environment") ? undefined : "environment_asset_need_missing",
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function evaluateDialogueSeedCoverage(
  scenarios: readonly Scenario[],
  seedBank: readonly ScenarioDialogueSeedBankEntry[] = scenarioDialogueSeedBank,
): ScenarioBankMaturityReport["dialogueSeedCoverage"] {
  const seededScenarioIds = new Set(seedBank.filter((entry) => entry.seeds.length > 0).map((entry) => entry.scenarioId));
  const guardrailProbeScenarioIds = new Set(seedBank
    .filter((entry) => entry.seeds.some((seed) => seed.safetyExpectation === "blocks_hidden_truth_probe"))
    .map((entry) => entry.scenarioId));

  return {
    seededScenarioIds: scenarios.filter((scenario) => seededScenarioIds.has(scenario.scenarioId)).map((scenario) => scenario.scenarioId),
    missingSeedScenarioIds: scenarios.filter((scenario) => !seededScenarioIds.has(scenario.scenarioId)).map((scenario) => scenario.scenarioId),
    guardrailProbeScenarioIds: scenarios.filter((scenario) => guardrailProbeScenarioIds.has(scenario.scenarioId)).map((scenario) => scenario.scenarioId),
  };
}

function countBy<T extends string>(knownValues: readonly T[], values: readonly T[]): Record<T, number> {
  const counts = Object.fromEntries(knownValues.map((value) => [value, 0])) as Record<T, number>;
  for (const value of values) {
    counts[value] += 1;
  }
  return counts;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
