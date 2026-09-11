export {
  type CaseEmotionPolicy,
  EmotionEngine,
  type EmotionEventKind,
  type EmotionTransition,
} from "./emotion-engine.js";
export {
  classifyEmotionEventDetailed,
  type EmotionEventClassifierVerdict,
} from "./emotion-event-classifier.js";
export {
  mapEmotionPerformance,
  stripProviderMarkup,
} from "./emotion-performance-mapper.js";
export {
  buildHistoryTakingCoverageSpec,
  domainsForTraceTag,
  initialHistoryTakingCoverageState,
  updateHistoryTakingCoverage,
} from "./history-coverage.js";
export {
  type LearnerSttBargeInRecord,
  resolveLearnerBargeInFromStt,
} from "./learner-stt-barge-in.js";
export {
  type ArbitrateTurnTakingInput,
  arbitrateTurnTaking,
} from "./turn-taking.js";
export type {
  ActorTurnInProgress,
  BargeInContext,
  BargeInOutcome,
  BargeInResolution,
  HistoryTakingCoverageSpec,
  HistoryTakingCoverageState,
  LearnerBargeInInput,
  TurnCancellationDirective,
  TurnTakingDecision,
} from "./types.js";

import type { Scenario } from "@openclinxr/shared-schemas";
import { resolveLearnerBargeIn } from "./barge-in.js";
import {
  type EmotionTransition,
  type EmotionTransitionInput,
  resolveEmotionTransition,
} from "./emotion-engine.js";
import {
  buildHistoryTakingCoverageSpec,
  initialHistoryTakingCoverageState,
  updateHistoryTakingCoverage,
} from "./history-coverage.js";
import {
  type ArbitrateTurnTakingInput,
  arbitrateTurnTaking,
} from "./turn-taking.js";
import type {
  ActorTurnInProgress,
  BargeInResolution,
  HistoryTakingCoverageSpec,
  HistoryTakingCoverageState,
  HistoryTakingCoverageUpdateInput,
  HistoryTakingCoverageUpdateResult,
  LearnerBargeInInput,
  TurnTakingDecision,
} from "./types.js";

/**
 * Optional injectable conversation policy surface for ScenarioRuntime.
 * Pure deterministic functions; no network, no paid LLM.
 */
export type ConversationPolicy = {
  arbitrateTurnTaking(input: ArbitrateTurnTakingInput): TurnTakingDecision;
  resolveLearnerBargeIn(
    inProgress: ActorTurnInProgress | null | undefined,
    bargeInInput: LearnerBargeInInput,
  ): BargeInResolution;
  buildHistoryTakingCoverageSpec(
    scenario: Pick<Scenario, "scenarioId" | "requiredTraceTags">,
  ): HistoryTakingCoverageSpec;
  initialHistoryTakingCoverageState(spec: HistoryTakingCoverageSpec): HistoryTakingCoverageState;
  updateHistoryTakingCoverage(
    prevState: HistoryTakingCoverageState,
    input: HistoryTakingCoverageUpdateInput,
    spec?: HistoryTakingCoverageSpec,
  ): HistoryTakingCoverageUpdateResult;
  resolveEmotionTransition(input: EmotionTransitionInput): EmotionTransition;
};

export function createDefaultConversationPolicy(): ConversationPolicy {
  return {
    arbitrateTurnTaking,
    resolveLearnerBargeIn,
    buildHistoryTakingCoverageSpec,
    initialHistoryTakingCoverageState,
    updateHistoryTakingCoverage,
    resolveEmotionTransition,
  };
}
