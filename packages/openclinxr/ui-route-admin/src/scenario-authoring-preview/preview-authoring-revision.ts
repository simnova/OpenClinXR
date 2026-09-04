import { authoredContentIdentity } from "@openclinxr/domain";
import {
  buildDynamicEncounterFactoryPlanningProjection,
  createLearnerScenarioView,
} from "@openclinxr/scenario-fixtures";
import { type Scenario, validateScenario } from "@openclinxr/shared-schemas";
import { evaluateScenarioPromotion } from "./evaluate-scenario-promotion.js";
import type { AuthoringPreviewChange, AuthoringPreviewResult } from "./types.js";
import { AUTHORING_PREVIEW_NOT_EVIDENCE_FOR } from "./types.js";

export {
  AUTHORING_PREVIEW_NOT_EVIDENCE_FOR,
  STALE_REVIEW_IDENTITY_REFUSAL,
  STALE_VALIDATION_REFUSAL,
  type AuthoringPreviewChange,
  type AuthoringPreviewResult,
  type PromotionDecision,
} from "./types.js";
export { evaluateScenarioPromotion } from "./evaluate-scenario-promotion.js";
export { authoredContentIdentity };

function stable(value: unknown): string {
  return JSON.stringify(value);
}

function projectProductionRuntime(scenario: Scenario) {
  const learner = createLearnerScenarioView(scenario);
  const factory = buildDynamicEncounterFactoryPlanningProjection([scenario], scenario.scenarioId).scenarios[0];
  if (!factory) {
    throw new Error("dynamic encounter factory planning projection returned no scenario row");
  }
  return {
    actors: learner.actors.map((actor) => ({
      actorId: actor.actorId,
      role: actor.role,
      displayName: actor.displayName,
      demeanor: actor.demeanor ?? null,
    })),
    dialogue: learner.actors.map((actor) => ({
      actorId: actor.actorId,
      openingUtterance: actor.openingUtterance ?? null,
      communicationStyle: actor.communicationProfile?.style ?? null,
      communicationIntensity: actor.communicationProfile?.intensity ?? null,
    })),
    emotion: {
      policy: learner.emotionPolicy ?? null,
      factoryEmotionStateCount: factory.humanoidPerformanceContract.emotionStateCount,
      factoryExpressionActorRoles: factory.humanoidPerformanceContract.expressionActorRoles,
    },
    assets: {
      environmentId: factory.environmentId,
      equipmentCount: factory.equipmentCount,
      assetNeedTypes: factory.assetNeedTypes,
      sharedAssetLookupKeys: factory.encounterFactoryInputSummary.sharedAssetLookupKeys,
      actorAssetWorkOrderCount: factory.encounterFactoryInputSummary.actorAssetWorkOrderCount,
      environmentAssetWorkOrderCount: factory.encounterFactoryInputSummary.environmentAssetWorkOrderCount,
      equipmentAssetWorkOrderCount: factory.encounterFactoryInputSummary.equipmentAssetWorkOrderCount,
    },
  };
}

function pushChanged(
  changes: AuthoringPreviewChange[],
  surface: AuthoringPreviewChange["surface"],
  path: string,
  before: unknown,
  after: unknown,
): void {
  if (stable(before) === stable(after)) {
    return;
  }
  changes.push({
    surface,
    change: "changed",
    path,
    before: before === undefined ? null : stable(before),
    after: after === undefined ? null : stable(after),
  });
}

function diffKeyed(
  changes: AuthoringPreviewChange[],
  surface: AuthoringPreviewChange["surface"],
  approved: readonly { actorId: string }[],
  draft: readonly { actorId: string }[],
): void {
  const before = new Map(approved.map((row) => [row.actorId, row]));
  const after = new Map(draft.map((row) => [row.actorId, row]));
  for (const [key, row] of before) {
    if (!after.has(key)) {
      changes.push({ surface, change: "removed", path: key, before: stable(row), after: null });
    }
  }
  for (const [key, row] of after) {
    const previous = before.get(key);
    if (!previous) {
      changes.push({ surface, change: "added", path: key, before: null, after: stable(row) });
      continue;
    }
    pushChanged(changes, surface, key, previous, row);
  }
}

function diffProductionRuntime(
  approved: ReturnType<typeof projectProductionRuntime>,
  draft: ReturnType<typeof projectProductionRuntime>,
): readonly AuthoringPreviewChange[] {
  const changes: AuthoringPreviewChange[] = [];
  diffKeyed(changes, "actor", approved.actors, draft.actors);
  diffKeyed(changes, "dialogue", approved.dialogue, draft.dialogue);
  pushChanged(changes, "emotion", "emotion", approved.emotion, draft.emotion);
  pushChanged(changes, "asset", "assets", approved.assets, draft.assets);
  return changes;
}

export function previewAuthoringRevision(input: {
  draft: unknown;
  approved?: unknown;
  reviewIdentity?: string | null;
}): AuthoringPreviewResult {
  const schema = validateScenario(input.draft);
  const draftIdentity = schema.ok ? authoredContentIdentity(input.draft) : null;
  const approvedSchema =
    input.approved === undefined ? null : validateScenario(input.approved);
  const changes =
    schema.ok && approvedSchema?.ok
      ? diffProductionRuntime(
          projectProductionRuntime(input.approved as Scenario),
          projectProductionRuntime(input.draft as Scenario),
        )
      : [];
  return {
    validationOk: schema.ok,
    validationErrors: schema.ok ? [] : schema.errors,
    draftIdentity,
    changes,
    promotion: evaluateScenarioPromotion({
      validationOk: schema.ok,
      validationErrors: schema.ok ? [] : schema.errors,
      draftIdentity: draftIdentity ?? "",
      reviewIdentity: input.reviewIdentity === undefined ? null : input.reviewIdentity,
    }),
    notEvidenceFor: AUTHORING_PREVIEW_NOT_EVIDENCE_FOR,
  };
}
