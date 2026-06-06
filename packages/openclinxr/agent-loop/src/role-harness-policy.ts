export type BackgroundAgentTaskType =
  | "bounded_scout"
  | "implementation_worker"
  | "specialist_review"
  | "adversarial_review"
  | "leadership_preflight"
  | "leadership_synthesis";

export type BackgroundAgentReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type BackgroundAgentPolicyTier =
  | "fast_bounded"
  | "standard_execution"
  | "expert_review"
  | "frontier_thinking";

export type HarnessKind = "grok" | "codex" | "openai_default";
export type CodexSandboxMode = "read-only" | "workspace-write";
export type RepoWorkflowSkillId =
  | "openclinxr-openclaw"
  | "anny-asset-pipeline"
  | "provider-boundary"
  | "turborepo-skill"
  | "ant-design-cli-skill";

export type HarnessModelSpec = {
  model: string;
  reasoningEffort: BackgroundAgentReasoningEffort;
};

export type RepoRoleHarnessPolicy = {
  roleId: string;
  policyTier: BackgroundAgentPolicyTier;
  taskType: BackgroundAgentTaskType;
  sandboxMode: CodexSandboxMode;
  recommendedSkills: RepoWorkflowSkillId[];
  /** Codex Desktop cannot select DeepSeek in the model picker; Moonbridge is an optional first-pass assist bridge only. */
  moonbridgeAssistOnCodex: boolean;
  writeScopeNote: string;
};

const tierDefaults: Record<
  BackgroundAgentPolicyTier,
  {
    taskType: BackgroundAgentTaskType;
    openai: HarnessModelSpec;
    grok: HarnessModelSpec;
    codex: HarnessModelSpec;
    moonbridgeAssistOnCodex: boolean;
  }
> = {
  fast_bounded: {
    taskType: "bounded_scout",
    openai: { model: "gpt-5.4-mini", reasoningEffort: "low" },
    grok: { model: "deepseek-v4-flash", reasoningEffort: "low" },
    codex: { model: "gpt-5.4-mini", reasoningEffort: "low" },
    moonbridgeAssistOnCodex: true,
  },
  standard_execution: {
    taskType: "implementation_worker",
    openai: { model: "gpt-5.4", reasoningEffort: "medium" },
    grok: { model: "deepseek-v4-pro", reasoningEffort: "medium" },
    codex: { model: "gpt-5.4", reasoningEffort: "medium" },
    moonbridgeAssistOnCodex: false,
  },
  expert_review: {
    taskType: "specialist_review",
    openai: { model: "gpt-5.4", reasoningEffort: "high" },
    grok: { model: "deepseek-v4-pro", reasoningEffort: "high" },
    codex: { model: "gpt-5.4", reasoningEffort: "high" },
    moonbridgeAssistOnCodex: true,
  },
  frontier_thinking: {
    taskType: "leadership_synthesis",
    openai: { model: "gpt-5.5", reasoningEffort: "xhigh" },
    grok: { model: "grok-build", reasoningEffort: "xhigh" },
    codex: { model: "gpt-5.5", reasoningEffort: "xhigh" },
    moonbridgeAssistOnCodex: false,
  },
};

export const repoRoleHarnessPolicies: RepoRoleHarnessPolicy[] = [
  {
    roleId: "chief-coordinator",
    policyTier: "fast_bounded",
    taskType: "bounded_scout",
    sandboxMode: "read-only",
    recommendedSkills: ["openclinxr-openclaw"],
    moonbridgeAssistOnCodex: true,
    writeScopeNote: "Orchestration and state records only; do not patch product code.",
  },
  {
    roleId: "openclaw-drift-police",
    policyTier: "fast_bounded",
    taskType: "bounded_scout",
    sandboxMode: "read-only",
    recommendedSkills: ["openclinxr-openclaw"],
    moonbridgeAssistOnCodex: true,
    writeScopeNote: "Drift fixes in coordination surfaces only; never weaken protected factory guardrails.",
  },
  {
    roleId: "implementation-plan-gap-attacker",
    policyTier: "fast_bounded",
    taskType: "bounded_scout",
    sandboxMode: "read-only",
    recommendedSkills: ["openclinxr-openclaw"],
    moonbridgeAssistOnCodex: true,
    writeScopeNote: "Read-only adversarial review unless explicitly assigned a non-overlapping doc fix.",
  },
  {
    roleId: "productivity-skeptic",
    policyTier: "fast_bounded",
    taskType: "bounded_scout",
    sandboxMode: "read-only",
    recommendedSkills: ["openclinxr-openclaw", "anny-asset-pipeline"],
    moonbridgeAssistOnCodex: true,
    writeScopeNote: "Challenge fixture-grade progress; push toward tangible runtime/model evidence.",
  },
  {
    roleId: "visual-realism-adversary",
    policyTier: "fast_bounded",
    taskType: "bounded_scout",
    sandboxMode: "read-only",
    recommendedSkills: ["openclinxr-openclaw", "anny-asset-pipeline"],
    moonbridgeAssistOnCodex: true,
    writeScopeNote: "Adversary review artifacts only; do not promote B+ or readiness gates.",
  },
  {
    roleId: "implementation-planning-lead",
    policyTier: "standard_execution",
    taskType: "implementation_worker",
    sandboxMode: "read-only",
    recommendedSkills: ["openclinxr-openclaw", "turborepo-skill"],
    moonbridgeAssistOnCodex: false,
    writeScopeNote: "Planning and sequencing guidance; implementation writes belong to the main worker unless disjoint.",
  },
  {
    roleId: "asset-pipeline-lead",
    policyTier: "standard_execution",
    taskType: "implementation_worker",
    sandboxMode: "workspace-write",
    recommendedSkills: ["openclinxr-openclaw", "anny-asset-pipeline", "provider-boundary"],
    moonbridgeAssistOnCodex: false,
    writeScopeNote: "May write in tools/openclinxr/asset-pipeline/, model-vetting studio, and ignored cagematch outputs when assigned.",
  },
  {
    roleId: "rigging-animation-specialist",
    policyTier: "standard_execution",
    taskType: "implementation_worker",
    sandboxMode: "workspace-write",
    recommendedSkills: ["openclinxr-openclaw", "anny-asset-pipeline"],
    moonbridgeAssistOnCodex: false,
    writeScopeNote: "May write rigging/animation pipeline surfaces when assigned a disjoint slice.",
  },
  {
    roleId: "xr-systems-architect",
    policyTier: "standard_execution",
    taskType: "implementation_worker",
    sandboxMode: "workspace-write",
    recommendedSkills: ["openclinxr-openclaw", "turborepo-skill"],
    moonbridgeAssistOnCodex: false,
    writeScopeNote: "May write ui-xr production app, arena sidecars, and XR packages when assigned; no production IWSDK promotion.",
  },
  {
    roleId: "pediatrics-physician",
    policyTier: "expert_review",
    taskType: "specialist_review",
    sandboxMode: "read-only",
    recommendedSkills: ["openclinxr-openclaw"],
    moonbridgeAssistOnCodex: true,
    writeScopeNote: "Clinical wording and scenario review only; no scoring or validity claims.",
  },
  {
    roleId: "clinical-safety-critic",
    policyTier: "expert_review",
    taskType: "specialist_review",
    sandboxMode: "read-only",
    recommendedSkills: ["openclinxr-openclaw"],
    moonbridgeAssistOnCodex: true,
    writeScopeNote: "Safety critique and review-safe language only.",
  },
  {
    roleId: "license-provenance-specialist",
    policyTier: "expert_review",
    taskType: "specialist_review",
    sandboxMode: "read-only",
    recommendedSkills: ["openclinxr-openclaw", "provider-boundary"],
    moonbridgeAssistOnCodex: true,
    writeScopeNote: "Provenance and license review; do not enable paid/cloud providers.",
  },
  {
    roleId: "vp-engineering-delivery",
    policyTier: "frontier_thinking",
    taskType: "leadership_synthesis",
    sandboxMode: "read-only",
    recommendedSkills: ["openclinxr-openclaw", "turborepo-skill"],
    moonbridgeAssistOnCodex: false,
    writeScopeNote: "Leadership synthesis and sequencing judgment; not routine implementation.",
  },
];

const repoRoleHarnessPolicyById = new Map(
  repoRoleHarnessPolicies.map((policy) => [policy.roleId, policy]),
);

export function getRepoRoleHarnessPolicy(roleId: string): RepoRoleHarnessPolicy | undefined {
  return repoRoleHarnessPolicyById.get(roleId);
}

export function resolveHarnessModelSpec(
  policyTier: BackgroundAgentPolicyTier,
  harness: HarnessKind,
): HarnessModelSpec {
  const defaults = tierDefaults[policyTier];
  if (harness === "grok") {
    return defaults.grok;
  }
  if (harness === "codex") {
    return defaults.codex;
  }
  return defaults.openai;
}

export function shouldRecommendMoonbridgeAssist(harness: HarnessKind, policy: RepoRoleHarnessPolicy): boolean {
  return harness === "codex" && policy.moonbridgeAssistOnCodex;
}

export const productionPipelineAssistNote =
  "Asset generation, scene optimization, and factory QA are not fully procedural. Production may use a swappable ModelAssistProvider (Moonbridge today; DeepSeek or other approved online models later) for bounded agentic evaluation and optimization behind explicit gates—not as a readiness or clinical-validity claim.";