import type { HarnessKind } from "./role-harness-policy.js";

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

export type SerializableAgentMemoryIndex = {
  activeEntries: AgentMemoryEntry[];
  byTopic: Record<string, AgentMemoryEntry[]>;
  byAgent: Record<string, AgentMemoryEntry[]>;
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

export type SerializableAgentLoopPlan = Omit<AgentLoopPlan, "memoryIndex"> & {
  memoryIndex: SerializableAgentMemoryIndex;
};

export type AgentDispatchPacket = {
  workOrderId: string;
  stage: WorkOrderStage;
  goal: string;
  assignedAgentIds: string[];
  dimensions: ScoreDimension[];
  requiredOutput: string;
  dependsOnStages: WorkOrderStage[];
  retrievedMemoryEntries: AgentMemoryEntry[];
  nextActions: NextAction[];
  recommendedWorkflowSkills: AgentWorkflowSkillRecommendation[];
};

export type BackgroundAgentTaskType =
  | "bounded_scout"
  | "implementation_worker"
  | "specialist_review"
  | "adversarial_review"
  | "leadership_preflight"
  | "leadership_synthesis";

export type BackgroundAgentModelName =
  | "gpt-5.4-mini"
  | "gpt-5.4"
  | "gpt-5.5"
  | "deepseek-v4-flash"
  | "deepseek-v4-pro"
  | "grok-build";
export type BackgroundAgentReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type BackgroundAgentPolicyTier = "fast_bounded" | "standard_execution" | "expert_review" | "frontier_thinking";
export type ModelAssistBridge = "moonbridge" | "none";

export type BackgroundAgentModelRecommendation = {
  taskType: BackgroundAgentTaskType;
  model: BackgroundAgentModelName;
  reasoningEffort: BackgroundAgentReasoningEffort;
  policyTier: BackgroundAgentPolicyTier;
  rationale: string;
  harness?: HarnessKind;
  openaiEquivalent?: {
    model: "gpt-5.4-mini" | "gpt-5.4" | "gpt-5.5";
    reasoningEffort: BackgroundAgentReasoningEffort;
  };
  codexAssistBridge?: ModelAssistBridge;
  productionPipelineAssistNote?: string;
};

export type AgentWorkflowSkillId =
  | "ant-design-cli-skill"
  | "anny-asset-pipeline"
  | "apollo-graphql-skills"
  | "archunitts"
  | "blender-mcp"
  | "meta-iwsdk-mcp"
  | "openclinxr-openclaw"
  | "provider-boundary"
  | "storybook-mcp"
  | "turborepo-skill";

export type AgentWorkflowSkillRecommendation = {
  id: AgentWorkflowSkillId;
  name: string;
  sourceUrl?: string;
  sourceRecordId?: string;
  sourceRecordIds?: string[];
  useWhen: string;
  guardrails: string[];
};

export type RecommendBackgroundAgentModelInput = {
  taskType: BackgroundAgentTaskType;
  harness?: HarnessKind;
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

