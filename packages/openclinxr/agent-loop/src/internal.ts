import type { HarnessKind } from "./role-harness-policy.js";
import { scoreWeights } from "./types.js";
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

export function openaiEquivalentForTier(
  policyTier: BackgroundAgentPolicyTier,
): BackgroundAgentModelRecommendation["openaiEquivalent"] {
  switch (policyTier) {
    case "fast_bounded":
      return { model: "gpt-5.4-mini", reasoningEffort: "low" };
    case "standard_execution":
      return { model: "gpt-5.4", reasoningEffort: "medium" };
    case "expert_review":
      return { model: "gpt-5.4", reasoningEffort: "high" };
    case "frontier_thinking":
      return { model: "gpt-5.5", reasoningEffort: "xhigh" };
  }
}

export function policyTierForTaskType(taskType: BackgroundAgentTaskType): BackgroundAgentPolicyTier {
  switch (taskType) {
    case "bounded_scout":
      return "fast_bounded";
    case "implementation_worker":
      return "standard_execution";
    case "specialist_review":
      return "expert_review";
    case "leadership_preflight":
    case "adversarial_review":
    case "leadership_synthesis":
      return "frontier_thinking";
  }
}

export function rationaleForTaskType(taskType: BackgroundAgentTaskType): string {
  switch (taskType) {
    case "bounded_scout":
      return "Use for read-only scouting, narrow gap checks, and quick sidecar review while the main thread keeps the critical path.";
    case "implementation_worker":
      return "Use for bounded code or documentation slices with clear ownership and ordinary integration risk.";
    case "specialist_review":
      return "Use for clinical, legal, psychometric, security, or architecture review that needs more depth but not full frontier synthesis.";
    case "leadership_preflight":
      return "Use for cross-domain blocker triage before senior leadership approval is appropriate.";
    case "adversarial_review":
    case "leadership_synthesis":
      return "Reserve frontier reasoning for adversarial or leadership synthesis where the work is primarily hard thinking across tradeoffs.";
  }
}

export function harnessModelForTask(
  taskType: BackgroundAgentTaskType,
  harness: HarnessKind,
): { model: BackgroundAgentModelName; reasoningEffort: BackgroundAgentReasoningEffort } {
  const policyTier = policyTierForTaskType(taskType);
  switch (policyTier) {
    case "fast_bounded":
      if (harness === "grok") {
        return { model: "deepseek-v4-flash", reasoningEffort: "low" };
      }
      return { model: "gpt-5.4-mini", reasoningEffort: "low" };
    case "standard_execution":
      if (harness === "grok") {
        return { model: "deepseek-v4-pro", reasoningEffort: "medium" };
      }
      return { model: "gpt-5.4", reasoningEffort: "medium" };
    case "expert_review":
      if (harness === "grok") {
        return { model: "deepseek-v4-pro", reasoningEffort: "high" };
      }
      return { model: "gpt-5.4", reasoningEffort: "high" };
    case "frontier_thinking": {
      const reasoningEffort: BackgroundAgentReasoningEffort =
        taskType === "leadership_preflight" ? "high" : "xhigh";
      if (harness === "grok") {
        return { model: "grok-build", reasoningEffort };
      }
      return { model: "gpt-5.5", reasoningEffort };
    }
  }
}

export function mapToRecord<T>(map: Map<string, T[]>): Record<string, T[]> {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}


export function compareMemoryEntries(left: AgentMemoryEntry, right: AgentMemoryEntry): number {
  return right.confidence - left.confidence || right.iteration - left.iteration || left.id.localeCompare(right.id);
}

export function groupEntries<T extends string>(
  entries: AgentMemoryEntry[],
  key: (entry: AgentMemoryEntry) => T,
): Map<T, AgentMemoryEntry[]> {
  const grouped = new Map<T, AgentMemoryEntry[]>();
  for (const entry of entries) {
    const entryKey = key(entry);
    grouped.set(entryKey, [...(grouped.get(entryKey) ?? []), entry]);
  }
  return grouped;
}

export function lowDimensions(scorecard: IterationScorecard, threshold: number): ScoreDimension[] {
  return (Object.keys(scoreWeights) as ScoreDimension[]).filter((dimension) => scorecard.dimensions[dimension].score < threshold);
}

export function leadershipBlockers(scorecard: IterationScorecard, weightedScore: number, leadershipThreshold: number): string[] {
  const blockers: string[] = [];
  if (weightedScore < leadershipThreshold) {
    blockers.push("weighted_score_below_threshold");
  }
  if (scorecard.confidence < 0.75) {
    blockers.push("low_confidence");
  }
  if (scorecard.criticalRisks.some((risk) => risk.status === "open" && ["high", "critical"].includes(risk.severity))) {
    blockers.push("open_high_or_critical_risk");
  }
  if (scorecard.evidenceDebt.some((debt) => debt.status === "open")) {
    blockers.push("open_evidence_debt");
  }
  if (scorecard.decisionDebt.some((debt) => debt.status === "open")) {
    blockers.push("open_decision_debt");
  }
  return blockers;
}

export function workOrdersFor(scorecard: IterationScorecard, maturityDelta: MaturityDelta): AgentWorkOrder[] {
  const low = maturityDelta.lowDimensions;
  const coreDimensions = low.filter((dimension) => !isLegalDimension(dimension) && !isClinicalSpecialtyDimension(dimension));
  const orders: AgentWorkOrder[] = [];

  orders.push({
    id: `${scorecard.iterationId}-core-revision`,
    stage: "core_revision",
    goal: "Revise the implementation plan and code backlog around the weakest rubric dimensions and open debts.",
    assignedAgentIds: uniqueAgentIds(["chief-coordinator", "rubric-steward", ...agentsForDimensions(coreDimensions, ["core", "coordinator"])]),
    dimensions: coreDimensions.length > 0 ? coreDimensions : ["implementation_readiness"],
    memoryTopics: ["implementation-plan", "evidence-discipline", "component-boundaries"],
    requiredOutput: "Core revision memo with closed or explicitly re-owned score, evidence, and decision gaps.",
    dependsOnStages: [],
  });

  if (low.some(isClinicalSpecialtyDimension)) {
    orders.push({
      id: `${scorecard.iterationId}-physician-specialty-review`,
      stage: "physician_specialty_review",
      goal: "Review clinical realism, escalation pressure, specialty generalization, and case-bank risks.",
      assignedAgentIds: uniqueAgentIds(["emergency-medicine-physician", "cardiology-physician", ...agentsForDimensions(low, ["physicians"])]),
      dimensions: low.filter(isClinicalSpecialtyDimension),
      memoryTopics: ["specialty-realism", "clinical-safety", "case-bank"],
      requiredOutput: "Specialty critique with scenario fixes, forbidden overclaims, and asset/dialogue implications.",
      dependsOnStages: ["core_revision"],
    });
  }

  if (low.some(isLegalDimension)) {
    orders.push({
      id: `${scorecard.iterationId}-legal-governance-review`,
      stage: "legal_governance_review",
      goal: "Review claims, privacy, consent, AI governance, and regulated-use boundaries before leadership escalation.",
      assignedAgentIds: uniqueAgentIds(["general-counsel", "healthcare-compliance-counsel", "ai-governance-counsel"]),
      dimensions: low.filter(isLegalDimension),
      memoryTopics: ["claims-governance", "healthcare-compliance", "ai-governance"],
      requiredOutput: "Counsel-ready issue list with mitigations and unresolved decisions.",
      dependsOnStages: ["core_revision"],
    });
  }

  const revisionStages = orders.map((order) => order.stage);
  orders.push({
    id: `${scorecard.iterationId}-adversarial-counterplan`,
    stage: "adversarial_counterplan",
    goal: "Attack the revised plan and produce a stronger counterplan or required remediations.",
    assignedAgentIds: uniqueAgentIds(agentsForDimensions(low, ["adversarial"])),
    dimensions: low.length > 0 ? low : ["adversarial_robustness"],
    memoryTopics: ["plan-gaps", "unsafe-assumptions", "privacy-exposure"],
    requiredOutput: "Adversarial counterplan with blocking issues, outdo strategy, and testable acceptance gates.",
    dependsOnStages: revisionStages,
  });

  orders.push({
    id: `${scorecard.iterationId}-leadership-${maturityDelta.readyForLeadershipReview ? "review" : "preflight"}`,
    stage: maturityDelta.readyForLeadershipReview ? "leadership_review" : "leadership_preflight",
    goal: maturityDelta.readyForLeadershipReview
      ? "Senior leadership critiques the mature plan and either approves or sends it back for final revisions."
      : "Prepare blocker-focused leadership preflight without pretending the plan is ready for approval.",
    assignedAgentIds: uniqueAgentIds(leadershipAgentsFor(low)),
    dimensions: low.length > 0 ? low : ["implementation_readiness"],
    memoryTopics: ["leadership-blockers", "score-use", "delivery-risk"],
    requiredOutput: "Leadership review packet or preflight blocker brief tied to the rubric.",
    dependsOnStages: ["adversarial_counterplan"],
  });

  return orders;
}

export function leadershipAgentsFor(dimensions: ScoreDimension[]): string[] {
  if (dimensions.length === 0) {
    return ["cto", "chief-medical-officer", "chief-psychometrician", "general-counsel"];
  }
  return agentsForDimensions(dimensions, ["leadership"]);
}

export function nextActionsFor(scorecard: IterationScorecard, low: ScoreDimension[]): NextAction[] {
  const actions: NextAction[] = [];
  for (const debt of scorecard.evidenceDebt.filter((item) => item.status === "open")) {
    actions.push({
      id: debt.id,
      actionType: "close_evidence_debt",
      owner: debt.owner,
      summary: debt.summary,
      dimensions: dimensionsForOwnerOrText(debt.owner, debt.summary, low),
    });
  }
  for (const debt of scorecard.decisionDebt.filter((item) => item.status === "open")) {
    actions.push({
      id: debt.id,
      actionType: "resolve_decision_debt",
      owner: debt.owner,
      summary: debt.summary,
      dimensions: dimensionsForOwnerOrText(debt.owner, debt.summary, low),
    });
  }
  for (const risk of scorecard.criticalRisks.filter((item) => item.status === "open")) {
    actions.push({
      id: risk.id,
      actionType: "mitigate_critical_risk",
      owner: risk.owner,
      summary: risk.summary,
      dimensions: dimensionsForOwnerOrText(risk.owner, risk.summary, low),
    });
  }
  for (const dimension of low) {
    actions.push({
      id: `${scorecard.iterationId}-${dimension}`,
      actionType: "raise_score_dimension",
      owner: ownerForDimension(dimension),
      summary: `Raise ${dimension} above the leadership threshold with evidence, tests, or explicit scope reduction.`,
      dimensions: [dimension],
    });
  }
  return actions;
}

export function agentsForDimensions(dimensions: readonly ScoreDimension[], teams: readonly AgentTeam[]): string[] {
  const requested = dimensions.length > 0 ? dimensions : (["implementation_readiness"] as const);
  return defaultAgentLoopRoster.roles
    .filter((agent) => teams.includes(agent.team))
    .filter((agent) => requested.some((dimension) => agent.dimensions.includes(dimension)))
    .map((agent) => agent.agentId);
}

export function dimensionsForOwnerOrText(owner: string, summary: string, low: ScoreDimension[]): ScoreDimension[] {
  const ownerRole = defaultAgentLoopRoster.roles.find((candidate) => candidate.agentId === owner);
  if (ownerRole) {
    return priorityDimensions([...ownerRole.dimensions], low);
  }

  const text = `${owner} ${summary}`.toLowerCase();
  if (text.includes("xr") || text.includes("quest") || text.includes("webxr")) {
    const dimensions: ScoreDimension[] = ["technical_feasibility", "cost_performance_efficiency"];
    return priorityDimensions(dimensions, low);
  }
  if (text.includes("legal") || text.includes("counsel") || text.includes("claim")) {
    const dimensions: ScoreDimension[] = ["legal_regulatory_resilience", "evidence_discipline"];
    return priorityDimensions(dimensions, low);
  }
  if (text.includes("clinical") || text.includes("physician") || text.includes("specialty")) {
    const dimensions: ScoreDimension[] = ["clinical_validity", "specialty_clinical_generalizability"];
    return priorityDimensions(dimensions, low);
  }
  if (text.includes("psychometric")) {
    const dimensions: ScoreDimension[] = ["psychometric_defensibility", "evidence_discipline"];
    return priorityDimensions(dimensions, low);
  }
  if (text.includes("test-automation") || text.includes("verification") || text.includes("tests")) {
    const dimensions: ScoreDimension[] = ["implementation_readiness", "evidence_discipline"];
    return priorityDimensions(dimensions, low);
  }
  if (text.includes("implementation-planning") || text.includes("pinned versions") || text.includes("dependency")) {
    const dimensions: ScoreDimension[] = ["implementation_readiness", "architecture_coherence"];
    return priorityDimensions(dimensions, low);
  }
  if (text.includes("vp-engineering") || text.includes("deterministic station core")) {
    const dimensions: ScoreDimension[] = ["implementation_readiness", "technical_feasibility"];
    return priorityDimensions(dimensions, low);
  }
  return low.slice(0, 2);
}

export function priorityDimensions(dimensions: ScoreDimension[], low: ScoreDimension[]): ScoreDimension[] {
  const lowMatches = dimensions.filter((dimension) => low.includes(dimension));
  return lowMatches.length > 0 ? lowMatches : dimensions;
}

export function ownerForDimension(dimension: ScoreDimension): string {
  const agent = defaultAgentLoopRoster.roles.find((role) => role.team === "core" && role.dimensions.includes(dimension))
    ?? defaultAgentLoopRoster.roles.find((role) => role.dimensions.includes(dimension));
  return agent?.agentId ?? "chief-coordinator";
}

export function isClinicalSpecialtyDimension(dimension: ScoreDimension): boolean {
  return dimension === "clinical_validity" || dimension === "specialty_clinical_generalizability" || dimension === "psychometric_defensibility";
}

export function isLegalDimension(dimension: ScoreDimension): boolean {
  return dimension === "legal_regulatory_resilience" || dimension === "security_privacy";
}

export function uniqueAgentIds(agentIds: readonly string[]): string[] {
  return [...new Set(agentIds)].filter((agentId) => agentId.length > 0);
}

export function uniqueSkillRecommendations(recommendations: readonly AgentWorkflowSkillRecommendation[]): AgentWorkflowSkillRecommendation[] {
  const byId = new Map<AgentWorkflowSkillId, AgentWorkflowSkillRecommendation>();
  for (const recommendation of recommendations) {
    if (!byId.has(recommendation.id)) {
      byId.set(recommendation.id, recommendation);
    }
  }
  return [...byId.values()];
}

export function matchesAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

export function roundScore(value: number): number {
  return Number(value.toFixed(3));
}

