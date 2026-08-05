export {
  arbitrateTurnTaking,
  type ArbitrateTurnTakingInput,
} from "./turn-taking.js";
export { resolveLearnerBargeIn } from "./barge-in.js";
export {
  buildHistoryTakingCoverageSpec,
  coverageTraceTagForDomain,
  domainsForTraceTag,
  initialHistoryTakingCoverageState,
  updateHistoryTakingCoverage,
} from "./history-coverage.js";
export {
  CONVERSATION_CLAIM_SCOPE,
  CONVERSATION_NOT_EVIDENCE_FOR,
  type ActorTurnInProgress,
  type BargeInOutcome,
  type BargeInResolution,
  type ConversationActorRef,
  type ConversationNotEvidenceFor,
  type HistoryTakingCoverageSpec,
  type HistoryTakingCoverageState,
  type HistoryTakingCoverageUpdateInput,
  type HistoryTakingCoverageUpdateResult,
  type HistoryTakingDomain,
  type LearnerBargeInInput,
  type TurnTakingDecision,
  type TurnTakingReason,
} from "./types.js";
export {
  resolveEmotionTransition,
  EmotionEngine,
  type CaseEmotionPolicy,
  type EmotionEvent,
  type EmotionEventKind,
  type EmotionTransition,
  type EmotionTransitionInput,
  type EmotionTransitionRule,
} from "./emotion-engine.js";

import {
  arbitrateTurnTaking,
  type ArbitrateTurnTakingInput,
} from "./turn-taking.js";
import { resolveLearnerBargeIn } from "./barge-in.js";
import {
  buildHistoryTakingCoverageSpec,
  initialHistoryTakingCoverageState,
  updateHistoryTakingCoverage,
} from "./history-coverage.js";
import {
  resolveEmotionTransition,
  type EmotionTransition,
  type EmotionTransitionInput,
} from "./emotion-engine.js";
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
import type { Scenario } from "@openclinxr/shared-schemas";

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
