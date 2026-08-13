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
import { WORKER_OUTPUT_BUDGET_DIRECTIVE, WORKER_SHARED_TREE_DIRECTIVE, WORKER_TONE_DIRECTIVE } from "./worker-directives.js";

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
  /** True when task/role requires vision/multimodal (images, cagematch/UI-XR evidence screenshots, visual reports). Such efforts are reserved for grok-4-fast (first) then grok-4-pro. */
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

export { WORKER_OUTPUT_BUDGET_DIRECTIVE, WORKER_SHARED_TREE_DIRECTIVE, WORKER_TONE_DIRECTIVE } from "./worker-directives.js";

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

/**
 * Env flag managers must export when launching delegated headless/--yolo workers.
 * Project hooks (.grok/hooks/*) NO-OP mutating SessionStart/Stop/PostToolUse coord work when set.
 * Docs: ~/.grok/docs/user-guide/10-hooks.md, 14-headless-mode.md; skill: worker-scoped-session.
 */
export const OPENCLINXR_WORKER_ENV = {
  flag: "OPENCLINXR_WORKER",
  value: "1",
  altSignals: ["GROK_SUBAGENT"] as const,
  exportLine: "export OPENCLINXR_WORKER=1",
  headlessPrefix: "OPENCLINXR_WORKER=1",
  skill: ".grok/skills/worker-scoped-session/SKILL.md",
} as const;

/**
 * Enables `spawn_subagent` in headless `grok -p` sessions.
 * Proven (agentic-eval persona-binding + spawn-reliability): without GROK_SUBAGENTS=1 the
 * spawn tool is absent from the -p tool list (0 tool_calls); with it, multi-level
 * grok→deepseek cost-tiering can fire.
 */
export const GROK_SUBAGENTS_ENV = {
  flag: "GROK_SUBAGENTS",
  value: "1",
  exportLine: "export GROK_SUBAGENTS=1",
  headlessPrefix: "GROK_SUBAGENTS=1",
} as const;



/** Per-job temp root convention — avoids parallel Blender/skin races on fixed /tmp names. */
export const OPENCLINXR_JOB_TMP_CONVENTION = {
  envVar: "OPENCLINXR_JOB_TMP",
  pattern: "${TMPDIR:-/tmp}/openclinxr-job-${USER:-u}-$$-${OPENCLINXR_JOB_ID:-job}",
  filePattern: "$OPENCLINXR_JOB_TMP/<meshId>_<stage>_$$.<ext>",
  forbidExample: "/tmp/openclinxr_skin_albedo_mixed.png",
  skill: ".grok/skills/per-job-temp/SKILL.md",
} as const;

/** Large-task fan-out skill (force parallel cheap workers instead of solo frontier). */
export const LARGE_TASK_ORCHESTRATION_SKILL = ".grok/skills/large-task-orchestration/SKILL.md" as const;

export function looksLikeLargeParallelTask(task?: string): boolean {
  if (!task) return false;
  const t = task.toLowerCase();
  const signals = [
    "large task",
    "parallel",
    "fan-out",
    "fan out",
    "workstream",
    "multi-package",
    "multi package",
    "batch",
    "all meshes",
    "every mesh",
    "blender",
    "across packages",
    "disjoint",
    "n workers",
    "multiple workers",
    "worktrees",
    "decompose",
  ];
  return signals.some((s) => t.includes(s));
}

/**
 * Bounded-autonomy dispatch flags for manager-launched headless workers.
 * Replaces blanket `--yolo` (an undocumented alias): `--always-approve` avoids interactive hangs.
 * Blast radius is bounded by `--deny` rules — the DETERMINISTIC control (VERIFIED 2026-08-04:
 * `--deny 'Bash(rm *)'` blocked an `rm` non-interactively in every context). `--sandbox workspace`
 * is BEST-EFFORT defense-in-depth only — it fenced out-of-cwd writes when shell-launched but
 * FAILED OPEN once under a nested spawn, so do NOT treat it as a hard boundary. `--cwd` alone is
 * NOT a boundary either (a bare `--always-approve` worker wrote outside it). Real safety = --deny
 * + intended-files-only integration from an isolated worktree. Proofs: agentic-eval
 * tests/permission-bounds.test.ts. Caller supplies --model / --cwd / --output-format / --max-turns.
 */
export const WORKER_HEADLESS_DISPATCH_FLAGS = [
  "--always-approve",
  "--sandbox workspace",
  "--deny 'Bash(rm -rf *)'",
  "--deny 'Bash(sudo *)'",
  "--deny 'Bash(git push *)'",
] as const;

export function formatWorkerHeadlessDispatchFlags(): string {
  return WORKER_HEADLESS_DISPATCH_FLAGS.join(" ");
}

/**
 * Shell prefix for manager-launched headless workers (bake into dispatch scripts).
 * Example: `OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 OPENCLINXR_JOB_TMP=... grok -p "..." --always-approve --sandbox workspace --cwd <wt>`
 * Pair with formatWorkerHeadlessDispatchFlags() for bounded autonomy (prefer over blanket --yolo).
 * GROK_SUBAGENTS=1 is required so headless -p workers expose spawn_subagent for multi-level tiering.
 */
export function formatWorkerHeadlessEnvPrefix(jobId?: string): string {
  const job = jobId ?? "job";
  return [
    OPENCLINXR_WORKER_ENV.headlessPrefix,
    GROK_SUBAGENTS_ENV.headlessPrefix,
    `OPENCLINXR_JOB_ID=${job}`,
    'OPENCLINXR_JOB_TMP="${TMPDIR:-/tmp}/openclinxr-job-${USER:-u}-$$-' + job + '"',
  ].join(" ");
}

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
  // Multimodal (vision / Imagine / trellis / glb-grade) is grok-4.6 only — matches buildGrokRepoAgentSpawnSpec hardening.
  const effectiveModel = isMultimodal ? "grok-4.6" : modelSpec.model;
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
    ? " MULTIMODAL: images/cagematch/UI-XR/png/webm/Imagine/trellis → grok-4.6; never deepseek text-only for vision."
    : "";
  const escalateLadder = isMultimodal
    ? "UNABLE: escalate grok-4.6 → grok-build (no deepseek for vision)."
    : "UNABLE: escalate flash → pro → grok-build (cheap-first).";
  const compositionPointer =
    isWriter
      ? "COMPOSITION-ROOTS: feature→packages; apps compose/boot only; tools CLI. Residual topology/DI/seedwork → architect. See docs/agent-ops/COMPOSITION-ROOTS.md."
      : "";
  // Headless/--yolo workers: OPENCLINXR_WORKER=1 (hooks NO-OP) + GROK_SUBAGENTS=1 (spawn_subagent in -p).
  const workerEnvBlock = isWriter
    ? [
        `WORKER ENV: headless/--yolo launches MUST use ${OPENCLINXR_WORKER_ENV.headlessPrefix} ${GROK_SUBAGENTS_ENV.headlessPrefix} (or ${OPENCLINXR_WORKER_ENV.exportLine}; ${GROK_SUBAGENTS_ENV.exportLine}).`,
        "When OPENCLINXR_WORKER=1, SessionStart docs hygiene + CEO coord hooks NO-OP — stay in pathScope; do NOT edit PROJECT_STATUS.md, docs/openclinxr/*registry*, docs/_archive/**, AGENTS.md.",
        "When GROK_SUBAGENTS=1, headless grok -p exposes spawn_subagent for multi-level cost-tiering (absent without it).",
        `TEMP: export ${OPENCLINXR_JOB_TMP_CONVENTION.envVar}=${OPENCLINXR_JOB_TMP_CONVENTION.pattern}; files as ${OPENCLINXR_JOB_TMP_CONVENTION.filePattern}; FORBID fixed ${OPENCLINXR_JOB_TMP_CONVENTION.forbidExample}.`,
        "PORTS: distinct portless/dev ports per job (never share one fixed port across parallel workers).",
      ].join(" ")
    : "";
  const fanOutBlock = largeTask || isWriter
    ? largeTask
      ? `LARGE-TASK FAN-OUT (required): decompose into N≥2 disjoint file-scoped workstreams; each gets worktree isolation + unique ${OPENCLINXR_JOB_TMP_CONVENTION.envVar} + distinct ports; prefer deepseek-v4-pro workers over solo frontier. See ${LARGE_TASK_ORCHESTRATION_SKILL}.`
      : `If task spans multiple packages/meshes/files: self-decompose into disjoint workstreams (worktree + unique temp + ports) rather than soloing on frontier. See ${LARGE_TASK_ORCHESTRATION_SKILL}.`
    : "";
  return [
    WORKER_TONE_DIRECTIVE,
    WORKER_OUTPUT_BUDGET_DIRECTIVE,
    `Role \`${input.roleId}\` @ /Volumes/files/src/openclinxr. OpenClaw file-backed (not external runtime).`,
    "Rehydrate: pathScope (below) + charter Persona + memory tight limit + PROJECT_STATUS snapshot header only if needed. Do NOT load full AGENTS.md/LEX unless UNABLE.",
    `Read ${input.roleDir}/charter.md (## Persona) + ${input.roleDir}/memory.md (tight).`,
    "MANDATE_VISIBILITY: see agents/rules/MANDATE_VISIBILITY.md + LEX (pointer only; do not restate).",
    compositionPointer,
    `Tier: ${input.policy.policyTier}; model: ${effectiveModel}${multimodalNote ? " (multimodal)" : ""}; task: ${input.policy.taskType}.`,
    input.policy.writeScopeNote,
    harnessSkills,
    workerEnvBlock,
    fanOutBlock,
    formatPathScopeBlock(input.policy.pathScope),
    `ESCALATION: if below tier capability emit line "UNABLE:" + reason + recommended helper. ${escalateLadder} Coordinator spawns via spawn-spec.`,
    input.task ?? "Return findings, blockers, recommended next slice, file paths. Q1/Q4/Q5.",
    input.policy.sandboxMode === "read-only"
      ? "Read-only unless assigned non-overlapping write scope."
      : "Bounded write only; no coordination files unless slice owns them. Parent/CEO owns PROJECT_STATUS + registries + post-slice.",
    "RESUME_FROM: if continuation, short deltas only; still update the same handoff JSON (status/evidence/touched/blockers/recommended_next).",
  ]
    .filter(Boolean)
    .join(" ");
}

function requiresMultimodalReasoning(roleId: string, task?: string): boolean {
  const text = `${roleId} ${task || ""}`.toLowerCase();
  // Visual/multimodal indicators (must be present in task or combined with evidence review).
  // Pure role name like "productivity-skeptic" alone does not trigger — only when the actual work involves images/screenshots/cagematch visuals etc.
  const visualIndicators = [
    "image", "png", "jpg", "jpeg", "screenshot", "capture", "visual evidence", "vision", "multimodal",
    "cagematch", "model-vetting", "front.png", "three_quarter", "body_motion",
    "sleeve_deform", "garmentgeometry", "garmentdeform", "ui-xr.*(capture|evidence|png|visual)",
    "body_motion_probe", "inspection.*(png|image|visual)", "cagematch report", "rigging report.*visual",
    "model vetting.*(png|image|visual)", "screenshots", "webm", "visuals in",
    "imagine", "trellis", "glb-grade", "escape-hatch",
  ];
  const hasVisual = visualIndicators.some((ind) => new RegExp(ind).test(text));
  // For known visual-adversary roles, still require at least one visual keyword in the task/brief to trigger reservation
  // (so text-only policy reviews on skeptic stay on cheap flash).
  return hasVisual;
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
    // Harden: vision / Imagine / glb-grade is Grok 4.6 only.
    // Never route these to deepseek-v4-flash/pro (text-only; 400 image_url).
    modelSpec = { model: "grok-4.6", reasoningEffort: "high" };
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
            // Multimodal/vision efforts reserved for grok-4-fast (try first) then grok-4-pro
            return a.grokSubagentType === "explore" && (a.model === "grok-4-fast" || a.model === "grok-4-pro");
          }
          return a.grokSubagentType === "explore" && a.model === "deepseek-v4-flash";
        }),
      note: "fast_bounded non-multimodal must use explore + deepseek-v4-flash; multimodal efforts must use explore + grok-4-fast (preferred) or grok-4-pro",
    },
    {
      checkId: "multimodal_reserved_for_grok4",
      passed: agents
        .filter((a) => a.multimodal)
        .every((a) => a.model.startsWith("grok-4")),
      note: "Any multimodal-reasoning (vision, Imagine/trellis, cagematch/UI-XR image evidence, screenshots) must resolve to the grok-4 family (grok-4.6 / grok-4-fast / grok-4-pro) — never deepseek text-only.",
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
