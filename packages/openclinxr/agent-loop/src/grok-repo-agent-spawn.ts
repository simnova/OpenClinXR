/**
 * Grok-harness-only: map repo-defined agents/** roles to native spawn_subagent specs
 * using role-harness-policy model tiers (continuously synced via pnpm agent:harness:sync).
 */

import type { GrokSubagentType } from "./grok-tier-routing.js";
import {
  getRepoRoleHarnessPolicy,
  repoRoleHarnessPolicies,
  resolveHarnessModelSpec,
  type BackgroundAgentPolicyTier,
  type BackgroundAgentReasoningEffort,
  type HarnessKind,
  type RepoRoleHarnessPolicy,
  type RepoWorkflowSkillId,
} from "./role-harness-policy.js";

export type GrokRepoAgentSpawnSurface = "grok_native_spawn_subagent" | "composer_main_thread";

export type GrokRepoAgentSpawnSpec = {
  schemaVersion: "openclinxr.grok-repo-agent-spawn.v1";
  harness: "grok_only";
  roleId: string;
  roleDir: string;
  group: string;
  policyTier: BackgroundAgentPolicyTier;
  taskType: RepoRoleHarnessPolicy["taskType"];
  model: string;
  reasoningEffort: BackgroundAgentReasoningEffort;
  grokSubagentType: GrokSubagentType | null;
  capabilityMode: "read-only" | "read-write" | null;
  spawnSurface: GrokRepoAgentSpawnSurface;
  recommendedSkills: RepoWorkflowSkillId[];
  writeScopeNote: string;
  spawnPrompt: string;
  spawnSubagentCall: {
    subagent_type: GrokSubagentType;
    capability_mode: "read-only" | "read-write";
    description: string;
    prompt: string;
  } | null;
  memoryConsultPaths: {
    charter: string;
    memory: string;
    index: string;
  };
  safeguards: string[];
};

export type GrokRepoAgentSpawnRegistryReport = {
  schemaVersion: "openclinxr.grok-repo-agent-spawn-registry.v1";
  generatedAt: string;
  harness: "grok_only";
  posture: "aligned" | "degraded" | "blocked";
  roleCount: number;
  policiesCount: number;
  checks: Array<{ checkId: string; passed: boolean; note: string }>;
  agents: GrokRepoAgentSpawnSpec[];
};

export const GROK_REPO_AGENT_SPAWN_SAFEGUARDS = [
  "Spawn only repo-defined roles from agents/** with charter.md + memory.md + index.json.",
  "Never use Cursor Task for repo-agent consults; use native spawn_subagent with role-mapped subagent_type.",
  "Regenerate pointers after policy changes: pnpm agent:harness:sync.",
  "Frontier roles (vp-engineering-delivery) stay on Composer/grok-build — do not spawn as cheap subagents.",
  "After spawn, run pnpm grok:tier:post-slice and pnpm agent:memory:append when the role learns something durable.",
];

const skillPaths: Record<RepoWorkflowSkillId, string> = {
  "openclinxr-openclaw": ".agents/skills/openclinxr-openclaw/SKILL.md",
  "anny-asset-pipeline": ".agents/skills/anny-asset-pipeline/SKILL.md",
  "provider-boundary": ".agents/skills/provider-boundary/SKILL.md",
  "turborepo-skill": ".agents/skills/turborepo/SKILL.md",
  "ant-design-cli-skill": ".agents/skills/antd/SKILL.md",
};

export const GROK_REPO_AGENT_CONSULT_DEFAULTS: Record<string, string[]> = {
  orchestration: ["chief-coordinator"],
  drift: ["openclaw-drift-police", "implementation-plan-gap-attacker"],
  planning: ["implementation-planning-lead"],
  xr: ["xr-systems-architect"],
  assets: ["asset-pipeline-lead", "rigging-animation-specialist"],
  clinical: ["pediatrics-physician", "clinical-safety-critic"],
  license: ["license-provenance-specialist"],
  realism: ["visual-realism-adversary", "productivity-skeptic"],
  leadership: ["vp-engineering-delivery"],
};

export function resolveGrokSpawnSurfaceForPolicy(policy: RepoRoleHarnessPolicy): {
  grokSubagentType: GrokSubagentType | null;
  capabilityMode: "read-only" | "read-write" | null;
  spawnSurface: GrokRepoAgentSpawnSurface;
} {
  if (policy.policyTier === "frontier_thinking") {
    return { grokSubagentType: null, capabilityMode: null, spawnSurface: "composer_main_thread" };
  }
  if (policy.policyTier === "fast_bounded") {
    return {
      grokSubagentType: "explore",
      capabilityMode: "read-only",
      spawnSurface: "grok_native_spawn_subagent",
    };
  }
  if (policy.policyTier === "expert_review") {
    return {
      grokSubagentType: "plan",
      capabilityMode: "read-only",
      spawnSurface: "grok_native_spawn_subagent",
    };
  }
  if (policy.sandboxMode === "workspace-write") {
    return {
      grokSubagentType: "general-purpose",
      capabilityMode: "read-write",
      spawnSurface: "grok_native_spawn_subagent",
    };
  }
  return {
    grokSubagentType: "plan",
    capabilityMode: "read-only",
    spawnSurface: "grok_native_spawn_subagent",
  };
}

export function buildRepoAgentSpawnPrompt(input: {
  roleId: string;
  roleDir: string;
  policy: RepoRoleHarnessPolicy;
  task?: string;
  harness?: HarnessKind;
}): string {
  const harness = input.harness ?? "grok";
  const modelSpec = resolveHarnessModelSpec(input.policy.policyTier, harness);
  const skillNote =
    input.policy.recommendedSkills.length > 0
      ? `Skills: ${input.policy.recommendedSkills.map((s) => skillPaths[s]).join(", ")}.`
      : "";
  return [
    `Persona (Grok Build, .grok/personas/ + charter): ${input.roleId}-expert. See .grok/personas/${input.roleId}.toml or matching expertise toml (expert-terse-bluf base). BLUF + terse + domain jargon only. BOTTOM LINE first sentence. Bullets file:line. ≤100 words target. End exactly "Recommended next: <slice-name> (Q#)". Assume other agents share lexicon per agents/rules/LEX_AGENTIC.md. ORCHESTRATION COORDINATOR (chief-coordinator role) CHUNK VISIBILITY / NOTICEABILITY + SIZABLE COLLABORATIVE VERTICAL SLICE MANDATE (Q1/Q5; see agentic-lexicon.md + chunk-visibility-noticeability.md): every delegated slice/work chunk must be a sizable collaborative vertical slice (multi-role body targeting functional area e.g. WebXR asset/scene factory or exam running/UI-XR or model proving ground/Model Vetting; provable by interacting/showcasing in the apps; productivity-skeptic assesses teamwork/collaboration + website evidence readiness) big enough to be noticeable in tester app (Model Vetting cagematch png/webm + packed model-vetting-report.v1 .candidates) or sample scene (UI-XR peds runtime with garmentGeometry/sleeveDeform/no-cull/cyan); if no visible delta (sub-pixel/same-color/cull-hidden/fixture), expand scope (geo/contrast/motion/no-cull/re-orchestrate with phenotype.garmentLayers) until skeptic-visible 3D/runtime change confirmed; never accept invisible or non-collaborative minor changes as advancement. Anti-toil: expand or pivot after 1 evidence-only or isolated task. Use lowest-cost first (flash for coordinator scoping) + escalation.`,
    `You are the repo-defined role \`${input.roleId}\` for /Volumes/files/src/openclinxr.`,
    "OpenClaw-style file-backed workflow — not an external runtime.",
    "Confirm AGENTS.md, PROJECT_STATUS.md, docs/agent-factory/**, agents/**, tools/agent-factory/** exist.",
    `Read ${input.roleDir}/charter.md (## Persona section = instructions) and ${input.roleDir}/memory.md (tight limit) plus .agent-factory/memory-index.json entries for this role.`,
    "Follow agents/rules/agent-consult.md, agents/rules/subagent-protocol.md, agents/rules/grok-tier-routing.md.",
    `Policy tier: ${input.policy.policyTier}; model: ${modelSpec.model}; task type: ${input.policy.taskType}.`,
    input.policy.writeScopeNote,
    skillNote,
    `ESCALATION GUARD (self-escalation on inability): If at any point you determine you are UNABLE to complete the task to the required standard at your current tier (model: ${modelSpec.model}), you MUST explicitly emit a line starting with "UNABLE:" followed by a concise reason and the recommended higher-tier helper. Escalation ladder (start at the cheapest sufficient tier): deepseek-v4-flash (scout/consult/read-only), then deepseek-v4-pro (bounded analysis/execution), then grok-build (frontier synthesis or when lower tiers have failed). The orchestration coordinator (chief-coordinator role) will then spawn a new helper subagent of the recommended higher tier using pnpm grok:agent:spawn-spec for the appropriate role and tier per agentic-lexicon.md (preserving cheap-first and sizable collaborative vertical slice scoping). Do not continue past your confident capability.`,
    input.task ?? "Return concise findings, blockers, recommended next slice, and file paths. Respect Q1/Q4/Q5 gates.",
    input.policy.sandboxMode === "read-only"
      ? "Read-only: do not edit unless explicitly assigned a non-overlapping write scope."
      : "Bounded write scope only; do not edit coordination files unless the slice owns them.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildGrokRepoAgentSpawnSpec(input: {
  roleId: string;
  roleDir: string;
  group: string;
  task?: string;
  policy?: RepoRoleHarnessPolicy;
}): GrokRepoAgentSpawnSpec {
  const policy =
    input.policy ??
    getRepoRoleHarnessPolicy(input.roleId) ??
    ({
      roleId: input.roleId,
      policyTier: "fast_bounded",
      taskType: "bounded_scout",
      sandboxMode: "read-only",
      recommendedSkills: ["openclinxr-openclaw"],
      moonbridgeAssistOnCodex: true,
      writeScopeNote: "Read-only repo-agent consultation unless explicitly assigned a non-overlapping write scope.",
    } satisfies RepoRoleHarnessPolicy);

  const modelSpec = resolveHarnessModelSpec(policy.policyTier, "grok");
  const surface = resolveGrokSpawnSurfaceForPolicy(policy);
  const spawnPrompt = buildRepoAgentSpawnPrompt({
    roleId: input.roleId,
    roleDir: input.roleDir,
    policy,
    task: input.task,
  });

  const spawnSubagentCall =
    surface.grokSubagentType && surface.capabilityMode
      ? {
          subagent_type: surface.grokSubagentType,
          capability_mode: surface.capabilityMode,
          description: `${input.roleId} (${policy.policyTier})`,
          prompt: spawnPrompt,
        }
      : null;

  return {
    schemaVersion: "openclinxr.grok-repo-agent-spawn.v1",
    harness: "grok_only",
    roleId: input.roleId,
    roleDir: input.roleDir,
    group: input.group,
    policyTier: policy.policyTier,
    taskType: policy.taskType,
    model: modelSpec.model,
    reasoningEffort: modelSpec.reasoningEffort,
    grokSubagentType: surface.grokSubagentType,
    capabilityMode: surface.capabilityMode,
    spawnSurface: surface.spawnSurface,
    recommendedSkills: policy.recommendedSkills,
    writeScopeNote: policy.writeScopeNote,
    spawnPrompt,
    spawnSubagentCall,
    memoryConsultPaths: {
      charter: `${input.roleDir}/charter.md`,
      memory: `${input.roleDir}/memory.md`,
      index: `${input.roleDir}/index.json`,
    },
    safeguards: GROK_REPO_AGENT_SPAWN_SAFEGUARDS,
  };
}

export function recommendRepoAgentsForConsult(consultKind: keyof typeof GROK_REPO_AGENT_CONSULT_DEFAULTS): string[] {
  return GROK_REPO_AGENT_CONSULT_DEFAULTS[consultKind] ?? ["chief-coordinator"];
}

export function buildGrokRepoAgentSpawnRegistry(input: {
  roles: Array<{ roleId: string; roleDir: string; group: string }>;
  generatedAt?: string;
}): GrokRepoAgentSpawnRegistryReport {
  const agents = input.roles.map((role) => buildGrokRepoAgentSpawnSpec(role));
  const policyIds = new Set(repoRoleHarnessPolicies.map((p) => p.roleId));
  const roleIds = new Set(input.roles.map((r) => r.roleId));
  const missingPolicy = input.roles.filter((r) => !policyIds.has(r.roleId)).map((r) => r.roleId);
  const orphanPolicies = repoRoleHarnessPolicies.filter((p) => !roleIds.has(p.roleId)).map((p) => p.roleId);
  const frontierOnSubagent = agents.filter(
    (a) => a.policyTier === "frontier_thinking" && a.spawnSubagentCall !== null,
  );

  const checks = [
    {
      checkId: "all_roles_have_policy",
      passed: missingPolicy.length === 0,
      note: missingPolicy.length === 0 ? "ok" : `Missing policy: ${missingPolicy.join(", ")}`,
    },
    {
      checkId: "all_policies_have_role_dir",
      passed: orphanPolicies.length === 0,
      note: orphanPolicies.length === 0 ? "ok" : `Orphan policies: ${orphanPolicies.join(", ")}`,
    },
    {
      checkId: "frontier_not_spawned_cheap",
      passed: frontierOnSubagent.length === 0,
      note: frontierOnSubagent.length === 0 ? "ok" : `Frontier roles incorrectly spawnable: ${frontierOnSubagent.map((a) => a.roleId).join(", ")}`,
    },
    {
      checkId: "scouts_use_explore_flash",
      passed: agents
        .filter((a) => a.policyTier === "fast_bounded")
        .every((a) => a.grokSubagentType === "explore" && a.model === "deepseek-v4-flash"),
      note: "fast_bounded roles must map to explore + deepseek-v4-flash",
    },
  ];

  const failed = checks.filter((c) => !c.passed);
  const posture: GrokRepoAgentSpawnRegistryReport["posture"] =
    failed.some((c) => c.checkId === "all_roles_have_policy" || c.checkId === "frontier_not_spawned_cheap")
      ? "blocked"
      : failed.length > 0
        ? "degraded"
        : "aligned";

  return {
    schemaVersion: "openclinxr.grok-repo-agent-spawn-registry.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    harness: "grok_only",
    posture,
    roleCount: agents.length,
    policiesCount: repoRoleHarnessPolicies.length,
    checks,
    agents,
  };
}

export function formatGrokRepoAgentSpawnBrief(spec: GrokRepoAgentSpawnSpec): string {
  const call = spec.spawnSubagentCall;
  if (!call) {
    return `${spec.roleId}: Composer/grok-build only (${spec.model}) — ${spec.writeScopeNote}`;
  }
  return `${spec.roleId}: spawn_subagent ${call.subagent_type} (${call.capability_mode}) model=${spec.model} — ${spec.policyTier}`;
}