import type { HarnessKind } from "./role-harness-policy.js";
import { scoreWeights } from "./types.js";
import {
  recommendWorkflowSkillsForWorkOrder,
} from "./model-recommendation.js";

import type {
  ScoreDimension,
  AgentTeam,
  AgentRole,
  AgentMemoryEntry,
  AgentMemoryIndex,
  SerializableAgentMemoryIndex,
  IterationDebt,
  IterationRisk,
  IterationScorecard,
  LegacyScorecard,
  MaturityTrend,
  MaturityDelta,
  WorkOrderStage,
  AgentWorkOrder,
  NextAction,
  LeadershipGate,
  AgentLoopPlan,
  SerializableAgentLoopPlan,
  AgentDispatchPacket,
  BackgroundAgentTaskType,
  BackgroundAgentModelName,
  BackgroundAgentReasoningEffort,
  BackgroundAgentPolicyTier,
  ModelAssistBridge,
  BackgroundAgentModelRecommendation,
  AgentWorkflowSkillId,
  AgentWorkflowSkillRecommendation,
  RecommendBackgroundAgentModelInput,
  CreateAgentLoopPlanInput,
  EvaluateMaturityDeltaInput,
} from "./types.js";
import { defaultAgentLoopRoster } from "./roster.js";
import {
  openaiEquivalentForTier,
  policyTierForTaskType,
  rationaleForTaskType,
  harnessModelForTask,
  mapToRecord,
  compareMemoryEntries,
  groupEntries,
  lowDimensions,
  leadershipBlockers,
  workOrdersFor,
  leadershipAgentsFor,
  nextActionsFor,
  agentsForDimensions,
  dimensionsForOwnerOrText,
  priorityDimensions,
  ownerForDimension,
  isClinicalSpecialtyDimension,
  isLegalDimension,
  uniqueAgentIds,
  uniqueSkillRecommendations,
  matchesAny,
  roundScore,
} from "./internal.js";

export function buildAgentMemoryIndex(entries: AgentMemoryEntry[]): AgentMemoryIndex {
  const supersededIds = new Set<string>();
  for (const entry of entries) {
    if (entry.status === "superseded") {
      supersededIds.add(entry.id);
    }
    for (const superseded of entry.supersedes ?? []) {
      supersededIds.add(superseded);
    }
  }

  const activeEntries = entries
    .filter((entry) => entry.status === "active" && !supersededIds.has(entry.id))
    .sort(compareMemoryEntries);

  const byTopic = groupEntries(activeEntries, (entry) => entry.topic);
  const byAgent = groupEntries(activeEntries, (entry) => entry.agentId);

  return {
    activeEntries,
    byTopic,
    byAgent,
    search(query: string): AgentMemoryEntry[] {
      const normalized = query.trim().toLowerCase();
      if (normalized.length === 0) {
        return [];
      }

      return activeEntries.filter((entry) =>
        [entry.topic, entry.summary, entry.detail ?? ""].some((value) => value.toLowerCase().includes(normalized)),
      );
    },
  };
}

export function weightedIterationScore(scorecard: IterationScorecard): number {
  const totalWeight = Object.values(scoreWeights).reduce((sum, weight) => sum + weight, 0);
  const weighted = Object.entries(scoreWeights).reduce((sum, [dimension, weight]) => {
    return sum + scorecard.dimensions[dimension as ScoreDimension].score * weight;
  }, 0);
  return roundScore(weighted / totalWeight);
}

export function evaluateMaturityDelta(input: EvaluateMaturityDeltaInput): MaturityDelta {
  const leadershipThreshold = input.leadershipThreshold ?? 4;
  const weightedScore = weightedIterationScore(input.current);
  const previousWeightedScore = input.previous ? weightedIterationScore(input.previous) : undefined;
  const scoreDelta = previousWeightedScore === undefined ? undefined : roundScore(weightedScore - previousWeightedScore);
  const trend = scoreDelta === undefined ? "plateaued" : scoreDelta > 0.05 ? "improving" : scoreDelta < -0.05 ? "regressing" : "plateaued";
  const blockers = leadershipBlockers(input.current, weightedScore, leadershipThreshold);

  const result: MaturityDelta = {
    trend,
    weightedScore,
    confidence: input.current.confidence,
    readyForLeadershipReview: blockers.length === 0,
    blockers,
    lowDimensions: lowDimensions(input.current, leadershipThreshold),
  };

  if (previousWeightedScore !== undefined) {
    result.previousWeightedScore = previousWeightedScore;
  }
  if (scoreDelta !== undefined) {
    result.scoreDelta = scoreDelta;
  }

  return result;
}

export function createAgentLoopPlan(input: CreateAgentLoopPlanInput): AgentLoopPlan {
  const leadershipThreshold = input.leadershipThreshold ?? 4;
  const memoryIndex = buildAgentMemoryIndex(input.memoryEntries);
  const maturityDelta = evaluateMaturityDelta(
    input.previousScorecard
      ? {
          previous: input.previousScorecard,
          current: input.scorecard,
          leadershipThreshold,
        }
      : {
          current: input.scorecard,
          leadershipThreshold,
        },
  );
  const nextActions = nextActionsFor(input.scorecard, maturityDelta.lowDimensions);
  const workOrders = workOrdersFor(input.scorecard, maturityDelta);

  return {
    iterationId: input.iterationId,
    candidatePlanTitle: input.candidatePlanTitle,
    rosterVersion: defaultAgentLoopRoster.version,
    memoryIndex,
    maturityDelta,
    workOrders,
    nextActions,
    leadershipGate: {
      ready: maturityDelta.readyForLeadershipReview,
      blockers: maturityDelta.blockers,
    },
  };
}

export function serializeAgentMemoryIndex(index: AgentMemoryIndex): SerializableAgentMemoryIndex {
  return {
    activeEntries: [...index.activeEntries],
    byTopic: mapToRecord(index.byTopic),
    byAgent: mapToRecord(index.byAgent),
  };
}

export function serializeAgentLoopPlan(plan: AgentLoopPlan): SerializableAgentLoopPlan {
  return {
    ...plan,
    memoryIndex: serializeAgentMemoryIndex(plan.memoryIndex),
  };
}

export function createAgentDispatchPackets(plan: AgentLoopPlan, options: { memoryLimit?: number } = {}): AgentDispatchPacket[] {
  const memoryLimit = options.memoryLimit ?? 8;

  return plan.workOrders.map((order) => {
    const memory = new Map<string, AgentMemoryEntry>();
    for (const topic of order.memoryTopics) {
      for (const entry of plan.memoryIndex.byTopic.get(topic) ?? []) {
        memory.set(entry.id, entry);
      }
    }
    for (const agentId of order.assignedAgentIds) {
      for (const entry of plan.memoryIndex.byAgent.get(agentId) ?? []) {
        memory.set(entry.id, entry);
      }
    }

    const orderDimensions = new Set(order.dimensions);
    const nextActions = plan.nextActions.filter((action) => action.dimensions.some((dimension) => orderDimensions.has(dimension)));

    return {
      workOrderId: order.id,
      stage: order.stage,
      goal: order.goal,
      assignedAgentIds: order.assignedAgentIds,
      dimensions: order.dimensions,
      requiredOutput: order.requiredOutput,
      dependsOnStages: order.dependsOnStages,
      retrievedMemoryEntries: [...memory.values()].sort(compareMemoryEntries).slice(0, memoryLimit),
      nextActions,
      recommendedWorkflowSkills: recommendWorkflowSkillsForWorkOrder(order),
    };
  });
}


export function normalizeLegacyScorecard(scorecard: LegacyScorecard): IterationScorecard {
  return {
    iterationId: scorecard.iteration_id,
    scoredBy: scorecard.scored_by,
    confidence: scorecard.confidence,
    dimensions: scorecard.dimensions,
    criticalRisks: scorecard.critical_risks.map((risk) => ({
      id: risk.id,
      owner: risk.owner,
      summary: risk.summary,
      status: risk.status,
      severity: risk.severity,
    })),
    evidenceDebt: scorecard.evidence_debt.map((debt) => ({
      id: debt.id,
      owner: debt.owner,
      summary: debt.summary,
      status: debt.status,
    })),
    decisionDebt: scorecard.decision_debt.map((debt) => ({
      id: debt.id,
      owner: debt.owner,
      summary: debt.summary,
      status: debt.status,
    })),
  };
}

