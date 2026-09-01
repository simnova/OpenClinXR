/**
 * Grok-harness-only: map repo-defined agents/** roles to native spawn_subagent specs
 * using role-harness-policy model tiers (continuously synced via pnpm agent:harness:sync).
 */

import type { GrokSubagentType } from "./grok-tier-routing.js";
import {
  formatPathScopeBlock,
  getRepoRoleHarnessPolicy,
  getRolePathScope,
  repoRoleHarnessPolicies,
  resolveHarnessModelSpec,
  type BackgroundAgentPolicyTier,
  type BackgroundAgentReasoningEffort,
  type HarnessKind,
  type RepoRoleHarnessPolicy,
  type RepoWorkflowSkillId,
  type RolePathScope,
} from "./role-harness-policy.js";
import {
  buildParentSpawnChecklist,
  type ParentSpawnChecklist,
} from "./spawn-isolation.js";
import {
  WORKER_OUTPUT_BUDGET_DIRECTIVE,
  WORKER_PLANTED_CONTRACT_DIRECTIVE,
  WORKER_SHARED_TREE_DIRECTIVE,
  WORKER_STATUS_REPORTING_DIRECTIVE,
  WORKER_TONE_DIRECTIVE,
} from "./worker-directives.js";

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
  /** Worktree isolation for write roles (sandboxMode=workspace-write + read-write capability). Read-only / frontier → none. */
  isolation: "none" | "worktree";
  /** Parent must forward isolation into spawn_subagent when mustPassIsolationToHarness. */
  parentChecklist: ParentSpawnChecklist;
  recommendedSkills: RepoWorkflowSkillId[];
  writeScopeNote: string;
  pathScope: RolePathScope;
  spawnPrompt: string;
  spawnSubagentCall: {
    subagent_type: GrokSubagentType;
    capability_mode: "read-only" | "read-write";
    /** Explicit model — the parent must not inherit grok-4.6 by omitting model. */
    model: string;
    description: string;
    prompt: string;
    /** Worktree isolation: "worktree" for workspace-write writers, "none" otherwise. */
    isolation: "none" | "worktree";
  } | null;
  memoryConsultPaths: {
    charter: string;
    memory: string;
    index: string;
  };
  safeguards: string[];
  /** True when task/role requires vision/multimodal (images, cagematch/UI-XR evidence screenshots, visual reports). Such efforts route to deepseek-v4-flash-vision-exp (grok-4.6 is rung-2 escalate only). */
  multimodal?: boolean;
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

export {
  WORKER_OUTPUT_BUDGET_DIRECTIVE,
  WORKER_PLANTED_CONTRACT_DIRECTIVE,
  WORKER_SHARED_TREE_DIRECTIVE,
  WORKER_STATUS_REPORTING_DIRECTIVE,
  WORKER_TONE_DIRECTIVE,
} from "./worker-directives.js";
export {
  GROK_SUBAGENTS_ENV,
  LARGE_TASK_ORCHESTRATION_SKILL,
  WORKER_HEADLESS_DISPATCH_FLAGS,
  formatWorkerHeadlessDispatchFlags,
  formatWorkerHeadlessEnvPrefix,
  looksLikeLargeParallelTask,
  OPENCLINXR_JOB_TMP_CONVENTION,
  OPENCLINXR_WORKER_ENV,
} from "./worker-launch-config.js";
import {
  GROK_SUBAGENTS_ENV,
  LARGE_TASK_ORCHESTRATION_SKILL,
  looksLikeLargeParallelTask,
  OPENCLINXR_JOB_TMP_CONVENTION,
  OPENCLINXR_WORKER_ENV,
} from "./worker-launch-config.js";

export const GROK_REPO_AGENT_SPAWN_SAFEGUARDS = [
  "Spawn only repo-defined roles from agents/** with charter.md + memory.md + index.json.",
  "Never use Cursor Task for repo-agent consults; use native spawn_subagent with role-mapped subagent_type.",
  "Never spawn bare harness general-purpose/explore/plan for product delivery without a mapped repo role (assertDeliveryRoleMapped); use pnpm grok:agent:spawn-spec --role <roleId>.",
  "Regenerate pointers after policy changes: pnpm agent:harness:sync.",
  "Frontier roles (vp-engineering-delivery) stay on Composer/grok-build — do not spawn as cheap subagents.",
  "After spawn, run pnpm grok:tier:post-slice and pnpm agent:memory:append when the role learns something durable.",
  "Headless/--yolo workers MUST set OPENCLINXR_WORKER=1 so SessionStart docs hygiene and CEO coord hooks NO-OP (workers must not mutate registries/PROJECT_STATUS/docs/_archive).",
  "Headless `grok -p` workers that may spawn children MUST set GROK_SUBAGENTS=1 — without it spawn_subagent is absent from the -p tool list (agentic-eval A/B).",
  "Large tasks: decompose into N disjoint path-scoped workstreams with isolation=worktree, distinct ports, and per-job temp dirs (never shared /tmp basenames).",
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
  architecture: ["architect"],
  topology: ["architect"],
  docs_warehouse: ["archivist"],
  archive: ["archivist"],
  pmo: ["pmo"],
  temporal: ["pmo"],
  hygiene: ["pmo"],
  cadence: ["pmo", "hrbp"],
  temporal_decision: ["pmo"],
  temporal_review: ["pmo", "openclaw-drift-police"],
  workaround: ["pmo", "openclaw-drift-police"],
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
  multimodal?: boolean;
}): string {
  const harness = input.harness ?? "grok";
  const modelSpec = resolveHarnessModelSpec(input.policy.policyTier, harness);
  const isMultimodal = !!input.multimodal;
  // Multimodal (vision / Imagine / trellis / glb-grade) routes to deepseek-v4-flash-vision-exp — matches buildGrokRepoAgentSpawnSpec hardening. grok-4.6 is rung-2 escalate only.
  const effectiveModel = isMultimodal ? "deepseek-v4-flash-vision-exp" : modelSpec.model;
  const isWriter = input.policy.sandboxMode === "workspace-write";
  const largeTask = looksLikeLargeParallelTask(input.task);

  const skillNote =
    input.policy.recommendedSkills.length > 0
      ? `Skills: ${input.policy.recommendedSkills.map((s) => skillPaths[s]).join(", ")}.`
      : "";
  const harnessSkills = [
    skillNote,
    isWriter || largeTask ? `Harness skills: ${LARGE_TASK_ORCHESTRATION_SKILL}; ${OPENCLINXR_WORKER_ENV.skill}; ${OPENCLINXR_JOB_TMP_CONVENTION.skill}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const multimodalNote = isMultimodal
    ? " MULTIMODAL: images/cagematch/UI-XR/png/webm/Imagine/trellis → deepseek-v4-flash-vision-exp; grok-4.6 is rung-2 escalate only (quota near exhausted)."
    : "";
  const escalateLadder = isMultimodal
    ? "(deepseek-v4-flash-vision-exp → grok-4.6 rung-2 escalate → grok-build)"
    : "(flash → pro → grok-build, cheap-first)";
  const compositionPointer =
    isWriter
      ? "COMPOSITION-ROOTS: feature→packages; apps compose/boot only; tools CLI. Residual topology/DI/seedwork → architect. See docs/agent-ops/COMPOSITION-ROOTS.md."
      : "";
  // Headless/--yolo workers: OPENCLINXR_WORKER=1 (hooks NO-OP) + GROK_SUBAGENTS=1 (spawn_subagent in -p).
  const workerEnvBlock = isWriter
    ? [
        `WORKER ENV: headless/--yolo launches MUST use ${OPENCLINXR_WORKER_ENV.headlessPrefix} ${GROK_SUBAGENTS_ENV.headlessPrefix}.`,
        "When OPENCLINXR_WORKER=1, SessionStart docs hygiene + CEO coord hooks NO-OP; do NOT edit PROJECT_STATUS.md, docs/openclinxr/*registry*, docs/_archive/**, AGENTS.md.",
        "When GROK_SUBAGENTS=1, headless grok -p exposes spawn_subagent.",
        `TEMP: export ${OPENCLINXR_JOB_TMP_CONVENTION.envVar}=${OPENCLINXR_JOB_TMP_CONVENTION.pattern}; files as ${OPENCLINXR_JOB_TMP_CONVENTION.filePattern}; FORBID fixed ${OPENCLINXR_JOB_TMP_CONVENTION.forbidExample}.`,
        "PORTS: distinct portless/dev ports per job (never share one fixed port).",
      ].join(" ")
    : "";
  const fanOutBlock = largeTask || isWriter
    ? largeTask
      ? `LARGE-TASK FAN-OUT (required): decompose into N≥2 disjoint file-scoped workstreams; each gets worktree isolation + unique ${OPENCLINXR_JOB_TMP_CONVENTION.envVar} + distinct ports; prefer deepseek-v4-pro workers over solo frontier. See ${LARGE_TASK_ORCHESTRATION_SKILL}.`
      : `If task spans multiple packages/meshes/files: self-decompose into disjoint workstreams (worktree + unique temp + ports).`
    : "";
  return [
    WORKER_TONE_DIRECTIVE,
    WORKER_OUTPUT_BUDGET_DIRECTIVE,
    WORKER_STATUS_REPORTING_DIRECTIVE,
    WORKER_PLANTED_CONTRACT_DIRECTIVE,
    `Role \`${input.roleId}\` @ /Volumes/files/src/openclinxr. OpenClaw file-backed (not external runtime).`,
    "Rehydrate: pathScope (below) + charter Persona + memory (tight) + PROJECT_STATUS snapshot header as needed; no full AGENTS.md/LEX unless UNABLE. " +
    `Read ${input.roleDir}/charter.md + memory.md.`,
    "MANDATE_VISIBILITY: agents/rules/MANDATE_VISIBILITY.md + LEX (pointer only).",
    compositionPointer,
    `Tier: ${input.policy.policyTier}; model: ${effectiveModel}${multimodalNote ? " (multimodal)" : ""}; task: ${input.policy.taskType}.`,
    input.policy.writeScopeNote,
    harnessSkills,
    workerEnvBlock,
    fanOutBlock,
    formatPathScopeBlock(input.policy.pathScope),
    `ESCALATION: emit "UNABLE:" + reason + recommended helper ${escalateLadder}. Coordinator spawns via spawn-spec.`,
    input.task ?? "Return findings, blockers, recommended next slice, file paths. Q1/Q4/Q5.",
    input.policy.sandboxMode === "read-only"
      ? "Read-only unless assigned non-overlapping write scope."
      : "Bounded write only; no coordination files unless slice owns them. Parent/CEO owns PROJECT_STATUS + registries + post-slice.",
    "RESUME_FROM: if continuation, short deltas only; still update the same handoff JSON (status/evidence/touched/blockers/recommended_next).",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Roles whose default job is looking at pixels (goal-verification skeptics inherit
 * parent CHANGED_FILES PNGs). Always route to deepseek-v4-flash-vision-exp even
 * with an empty task string — measured 2026-09-01: harness skeptics on
 * deepseek-v4-flash 400 "This model does not support image".
 */
export const VISION_INFER_ROLE_IDS: ReadonlySet<string> = new Set([
  "visual-realism-adversary",
  "productivity-skeptic",
  "imagine-trellis",
]);

export const DEEPSEEK_FLASH_VISION_MODEL = "deepseek-v4-flash-vision-exp";

export function requiresMultimodalReasoning(roleId: string, task?: string, files?: readonly string[]): boolean {
  if (VISION_INFER_ROLE_IDS.has(roleId)) {
    return true;
  }
  const text = `${roleId} ${task || ""} ${(files ?? []).join(" ")}`.toLowerCase();
  const visualIndicators = [
    "image", "png", "jpg", "jpeg", "screenshot", "capture", "visual evidence", "vision", "multimodal",
    "cagematch", "model-vetting", "front.png", "three_quarter", "body_motion",
    "sleeve_deform", "garmentgeometry", "garmentdeform", "ui-xr.*(capture|evidence|png|visual)",
    "body_motion_probe", "inspection.*(png|image|visual)", "cagematch report", "rigging report.*visual",
    "model vetting.*(png|image|visual)", "screenshots", "webm", "visuals in",
    "imagine", "trellis", "glb-grade", "escape-hatch",
  ];
  return visualIndicators.some((ind) => new RegExp(ind).test(text));
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
      pathScope: getRolePathScope(input.roleId),
    } satisfies RepoRoleHarnessPolicy);

  const isMultimodal = requiresMultimodalReasoning(input.roleId, input.task);

  let modelSpec = resolveHarnessModelSpec(policy.policyTier, "grok");
  if (isMultimodal) {
    // Vision / Imagine / glb-grade → deepseek-v4-flash-vision-exp (cheap, vision-capable).
    // Never default vision work to grok-4.6 (quota near exhausted); grok-4.6 is rung-2 escalate only.
    modelSpec = { model: DEEPSEEK_FLASH_VISION_MODEL, reasoningEffort: "high" };
  }

  const surface = resolveGrokSpawnSurfaceForPolicy(policy);
  const spawnPrompt = buildRepoAgentSpawnPrompt({
    roleId: input.roleId,
    roleDir: input.roleDir,
    policy,
    ...(input.task !== undefined ? { task: input.task } : {}),
    multimodal: isMultimodal,
  });

  // Worktree isolation for writers: workspace-write + read-write capability + grok_native_spawn
  const isolation: "none" | "worktree" =
    policy.sandboxMode === "workspace-write" &&
    surface.capabilityMode === "read-write" &&
    surface.spawnSurface === "grok_native_spawn_subagent"
      ? "worktree"
      : "none";

  const parentChecklist = buildParentSpawnChecklist({
    isolation,
    pathScope: policy.pathScope,
    capabilityMode: surface.capabilityMode,
    sandboxMode: policy.sandboxMode,
  });

  const spawnSubagentCall =
    surface.grokSubagentType && surface.capabilityMode
      ? {
          subagent_type: surface.grokSubagentType,
          capability_mode: surface.capabilityMode,
          model: modelSpec.model,
          description: `${input.roleId} (${policy.policyTier}${isMultimodal ? ", multimodal" : ""})`,
          prompt: spawnPrompt,
          isolation,
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
    pathScope: policy.pathScope,
    spawnPrompt,
    isolation,
    parentChecklist,
    spawnSubagentCall,
    memoryConsultPaths: {
      charter: `${input.roleDir}/charter.md`,
      memory: `${input.roleDir}/memory.md`,
      index: `${input.roleDir}/index.json`,
    },
    safeguards: GROK_REPO_AGENT_SPAWN_SAFEGUARDS,
    multimodal: isMultimodal,
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
      checkId: "scouts_use_appropriate_model",
      passed: agents
        .filter((a) => a.policyTier === "fast_bounded")
        .every((a) => {
          if (a.multimodal) {
            // Multimodal/vision scouts use explore + deepseek-v4-flash-vision-exp (cheap, vision-capable)
            return a.grokSubagentType === "explore" && a.model === "deepseek-v4-flash-vision-exp";
          }
          return a.grokSubagentType === "explore" && a.model === "deepseek-v4-flash";
        }),
      note: "fast_bounded non-multimodal must use explore + deepseek-v4-flash; multimodal scouts must use explore + deepseek-v4-flash-vision-exp",
    },
    {
      checkId: "multimodal_uses_deepseek_vision",
      passed: agents
        .filter((a) => a.multimodal)
        .every((a) => a.model === "deepseek-v4-flash-vision-exp"),
      note: "Any multimodal-reasoning (vision, Imagine/trellis, cagematch/UI-XR image evidence, screenshots) must resolve to deepseek-v4-flash-vision-exp — never grok-4.6 by default (quota near exhausted); grok-4.6 is rung-2 escalate only.",
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
  const iso = call.isolation === "worktree" ? " isolation=worktree" : "";
  const checklist =
    spec.parentChecklist.mustPassIsolationToHarness
      ? " parentChecklist.mustPassIsolationToHarness=true"
      : "";
  const worker =
    call.capability_mode === "read-write"
      ? ` headlessEnv=${OPENCLINXR_WORKER_ENV.headlessPrefix} ${GROK_SUBAGENTS_ENV.headlessPrefix}`
      : "";
  return `${spec.roleId}: spawn_subagent ${call.subagent_type} (${call.capability_mode})${iso}${checklist}${worker} model=${spec.model} — ${spec.policyTier}`;
}
