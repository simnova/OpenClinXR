export const scoreWeights = {
  clinical_validity: 10,
  psychometric_defensibility: 10,
  technical_feasibility: 9,
  architecture_coherence: 7,
  security_privacy: 9,
  ux_workflow_fit: 7,
  cost_performance_efficiency: 7,
  open_source_sustainability: 5,
  market_gtm_strength: 6,
  evidence_discipline: 8,
  implementation_readiness: 6,
  adversarial_robustness: 5,
  legal_regulatory_resilience: 6,
  specialty_clinical_generalizability: 5,
} as const;

export type ScoreDimension = keyof typeof scoreWeights;
export type AgentTeam = "coordinator" | "core" | "physicians" | "adversarial" | "legal" | "leadership";

export type AgentRole = {
  agentId: string;
  team: AgentTeam;
  name: string;
  dimensions: ScoreDimension[];
  memoryTopics: string[];
};

export type AgentMemoryEntry = {
  id: string;
  agentId: string;
  team: AgentTeam;
  topic: string;
  summary: string;
  detail?: string;
  confidence: number;
  iteration: number;
  status: "active" | "superseded";
  sourceIds?: string[];
  supersedes?: string[];
};

export type AgentMemoryIndex = {
  activeEntries: AgentMemoryEntry[];
  byTopic: Map<string, AgentMemoryEntry[]>;
  byAgent: Map<string, AgentMemoryEntry[]>;
  search(query: string): AgentMemoryEntry[];
};

export type IterationDebt = {
  id: string;
  owner: string;
  summary: string;
  status: "open" | "closed";
};

export type IterationRisk = IterationDebt & {
  severity: "low" | "medium" | "high" | "critical";
};

export type IterationScorecard = {
  iterationId: string;
  scoredBy: string;
  confidence: number;
  dimensions: Record<ScoreDimension, { score: number; rationale: string }>;
  criticalRisks: IterationRisk[];
  evidenceDebt: IterationDebt[];
  decisionDebt: IterationDebt[];
};

export type LegacyScorecard = {
  iteration_id: string;
  plan_type: string;
  scored_by: string;
  scored_at: string;
  dimensions: Record<ScoreDimension, { score: number; rationale: string }>;
  critical_risks: Array<{
    id: string;
    severity: IterationRisk["severity"];
    summary: string;
    owner: string;
    status: IterationDebt["status"];
  }>;
  evidence_debt: Array<{
    id: string;
    summary: string;
    owner: string;
    status: IterationDebt["status"];
  }>;
  decision_debt: Array<{
    id: string;
    summary: string;
    owner: string;
    status: IterationDebt["status"];
  }>;
  confidence: number;
  summary: string;
};

export type MaturityTrend = "improving" | "plateaued" | "regressing";

export type MaturityDelta = {
  trend: MaturityTrend;
  weightedScore: number;
  previousWeightedScore?: number;
  scoreDelta?: number;
  confidence: number;
  readyForLeadershipReview: boolean;
  blockers: string[];
  lowDimensions: ScoreDimension[];
};

export type WorkOrderStage =
  | "core_revision"
  | "physician_specialty_review"
  | "legal_governance_review"
  | "adversarial_counterplan"
  | "leadership_review"
  | "leadership_preflight";

export type AgentWorkOrder = {
  id: string;
  stage: WorkOrderStage;
  goal: string;
  assignedAgentIds: string[];
  dimensions: ScoreDimension[];
  memoryTopics: string[];
  requiredOutput: string;
  dependsOnStages: WorkOrderStage[];
};

export type NextAction = {
  id: string;
  actionType: "close_evidence_debt" | "resolve_decision_debt" | "mitigate_critical_risk" | "raise_score_dimension";
  owner: string;
  summary: string;
  dimensions: ScoreDimension[];
};

export type LeadershipGate = {
  ready: boolean;
  blockers: string[];
};

export type AgentLoopPlan = {
  iterationId: string;
  candidatePlanTitle: string;
  rosterVersion: string;
  memoryIndex: AgentMemoryIndex;
  maturityDelta: MaturityDelta;
  workOrders: AgentWorkOrder[];
  nextActions: NextAction[];
  leadershipGate: LeadershipGate;
};

export type CreateAgentLoopPlanInput = {
  iterationId: string;
  candidatePlanTitle: string;
  scorecard: IterationScorecard;
  previousScorecard?: IterationScorecard;
  memoryEntries: AgentMemoryEntry[];
  leadershipThreshold?: number;
};

export type EvaluateMaturityDeltaInput = {
  previous?: IterationScorecard;
  current: IterationScorecard;
  leadershipThreshold?: number;
};

export const defaultAgentLoopRoster = {
  version: "agent-loop-roster-v1",
  roles: [
    role("chief-coordinator", "coordinator", "Chief Coordinator", ["implementation_readiness", "adversarial_robustness"], [
      "loop-performance",
      "unresolved-decisions",
    ]),
    role("rubric-steward", "coordinator", "Rubric Steward", ["evidence_discipline", "implementation_readiness"], [
      "score-history",
      "rubric-weights",
    ]),
    role("solution-architect", "core", "Solution Architect", ["technical_feasibility", "architecture_coherence", "implementation_readiness"], [
      "architecture-decisions",
      "component-boundaries",
    ]),
    role("xr-systems-architect", "core", "XR Systems Architect", ["technical_feasibility", "cost_performance_efficiency"], [
      "quest-webxr",
      "asset-pipeline",
    ]),
    role("clinical-simulation-lead", "core", "Clinical Simulation Lead", ["clinical_validity", "ux_workflow_fit"], [
      "scenario-realism",
      "faculty-review",
    ]),
    role("psychometrics-lead", "core", "Psychometrics Lead", ["psychometric_defensibility", "evidence_discipline"], [
      "validity",
      "rater-calibration",
    ]),
    role("security-privacy-lead", "core", "Security And Privacy Lead", ["security_privacy", "legal_regulatory_resilience"], [
      "consent",
      "audit-logs",
    ]),
    role("implementation-planning-lead", "core", "Implementation Planning Lead", ["implementation_readiness", "architecture_coherence"], [
      "implementation-plan",
      "tdd",
    ]),
    role("emergency-medicine-physician", "physicians", "Emergency Medicine Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["ed-realism", "acute-escalation"]),
    role("cardiology-physician", "physicians", "Cardiology Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["chest-pain", "cardiac-risk"]),
    role("internal-medicine-physician", "physicians", "Internal Medicine Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["adult-medicine", "diagnostic-reasoning"]),
    role("psychiatry-physician", "physicians", "Psychiatry Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["behavioral-health", "suicide-risk"]),
    role("pediatrics-physician", "physicians", "Pediatrics Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["pediatric-assessment", "guardian-communication"]),
    role("obgyn-physician", "physicians", "Obstetrics And Gynecology Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["pregnancy-triage", "reproductive-health"]),
    role("surgery-physician", "physicians", "Surgery Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["procedural-triage", "perioperative-risk"]),
    role("general-counsel", "leadership", "General Counsel", ["legal_regulatory_resilience", "evidence_discipline"], [
      "claims-governance",
      "liability",
    ]),
    role("healthcare-compliance-counsel", "legal", "Healthcare Compliance Counsel", ["security_privacy", "legal_regulatory_resilience"], [
      "healthcare-compliance",
      "retention",
    ]),
    role("ai-governance-counsel", "legal", "AI Governance Counsel", ["legal_regulatory_resilience", "security_privacy"], [
      "ai-governance",
      "synthetic-voice",
    ]),
    role("clinical-safety-critic", "adversarial", "Clinical Safety Critic", ["clinical_validity", "specialty_clinical_generalizability"], [
      "clinical-safety",
      "unsafe-assumptions",
    ]),
    role("psychometric-overclaim-critic", "adversarial", "Psychometric Overclaim Critic", [
      "psychometric_defensibility",
      "evidence_discipline",
    ], ["validity-overclaim", "fairness"]),
    role("security-privacy-attacker", "adversarial", "Security And Privacy Attacker", ["security_privacy", "legal_regulatory_resilience"], [
      "threat-model",
      "privacy-exposure",
    ]),
    role("implementation-plan-gap-attacker", "adversarial", "Implementation Plan Gap Attacker", [
      "implementation_readiness",
      "architecture_coherence",
    ], ["plan-gaps", "dependency-gates"]),
    role("cto", "leadership", "Chief Technology Officer", ["technical_feasibility", "cost_performance_efficiency"], [
      "technology-strategy",
      "delivery-risk",
    ]),
    role("chief-medical-officer", "leadership", "Chief Medical Officer", ["clinical_validity", "specialty_clinical_generalizability"], [
      "clinical-safety",
      "physician-acceptance",
    ]),
    role("chief-psychometrician", "leadership", "Chief Psychometrician", ["psychometric_defensibility", "evidence_discipline"], [
      "validity-argument",
      "score-use",
    ]),
  ],
} as const;

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

function role(
  agentId: string,
  team: AgentTeam,
  name: string,
  dimensions: ScoreDimension[],
  memoryTopics: string[],
): AgentRole {
  return { agentId, team, name, dimensions, memoryTopics };
}

function compareMemoryEntries(left: AgentMemoryEntry, right: AgentMemoryEntry): number {
  return right.confidence - left.confidence || right.iteration - left.iteration || left.id.localeCompare(right.id);
}

function groupEntries<T extends string>(
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

function lowDimensions(scorecard: IterationScorecard, threshold: number): ScoreDimension[] {
  return (Object.keys(scoreWeights) as ScoreDimension[]).filter((dimension) => scorecard.dimensions[dimension].score < threshold);
}

function leadershipBlockers(scorecard: IterationScorecard, weightedScore: number, leadershipThreshold: number): string[] {
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

function workOrdersFor(scorecard: IterationScorecard, maturityDelta: MaturityDelta): AgentWorkOrder[] {
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

function leadershipAgentsFor(dimensions: ScoreDimension[]): string[] {
  if (dimensions.length === 0) {
    return ["cto", "chief-medical-officer", "chief-psychometrician", "general-counsel"];
  }
  return agentsForDimensions(dimensions, ["leadership"]);
}

function nextActionsFor(scorecard: IterationScorecard, low: ScoreDimension[]): NextAction[] {
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

function agentsForDimensions(dimensions: readonly ScoreDimension[], teams: readonly AgentTeam[]): string[] {
  const requested = dimensions.length > 0 ? dimensions : (["implementation_readiness"] as const);
  return defaultAgentLoopRoster.roles
    .filter((agent) => teams.includes(agent.team))
    .filter((agent) => requested.some((dimension) => agent.dimensions.includes(dimension)))
    .map((agent) => agent.agentId);
}

function dimensionsForOwnerOrText(owner: string, summary: string, low: ScoreDimension[]): ScoreDimension[] {
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

function priorityDimensions(dimensions: ScoreDimension[], low: ScoreDimension[]): ScoreDimension[] {
  const lowMatches = dimensions.filter((dimension) => low.includes(dimension));
  return lowMatches.length > 0 ? lowMatches : dimensions;
}

function ownerForDimension(dimension: ScoreDimension): string {
  const agent = defaultAgentLoopRoster.roles.find((role) => role.team === "core" && role.dimensions.includes(dimension))
    ?? defaultAgentLoopRoster.roles.find((role) => role.dimensions.includes(dimension));
  return agent?.agentId ?? "chief-coordinator";
}

function isClinicalSpecialtyDimension(dimension: ScoreDimension): boolean {
  return dimension === "clinical_validity" || dimension === "specialty_clinical_generalizability" || dimension === "psychometric_defensibility";
}

function isLegalDimension(dimension: ScoreDimension): boolean {
  return dimension === "legal_regulatory_resilience" || dimension === "security_privacy";
}

function uniqueAgentIds(agentIds: readonly string[]): string[] {
  return [...new Set(agentIds)].filter((agentId) => agentId.length > 0);
}

function roundScore(value: number): number {
  return Number(value.toFixed(3));
}
