import { buildRoleHarnessPolicies, rolePathScopes } from "./role-harness-policy-tables.js";

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

export type RolePathScope = {
  /** Globs relative to repo root — agent may EDIT these */
  writeRoots: string[];
  /** Globs agent should prefer for READ/grep (always includes writeRoots + minimal rehydrate) */
  readRoots: string[];
  /** Globs agent must NOT edit; residual to parent/other owner */
  forbidden: string[];
  /** Where handoffs/artifacts for this role may be written */
  outputRoots: string[];
  /** Optional preferred package filters for CLI */
  preferredCli?: string[];
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
  pathScope: RolePathScope;
};

export type SoleAuthorLock = {
  lockId: string;
  paths: string[];
  ownerRoleId: string;
  note: string;
};

export const soleAuthorLocks: SoleAuthorLock[] = [
  {
    lockId: "agent-roster",
    paths: ["docs/agent-ops/**", ".grok/agents/**", ".grok/personas/**", ".grok/roles/**"],
    ownerRoleId: "hrbp",
    note: "HRBP sole-authors agent org chart (COMPOSITION-ROOTS.md overridden by composition-roots lock)",
  },
  {
    lockId: "protected-blueprint",
    paths: [
      "docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md",
      "docs/openclinxr/openclaw-runbook-2026-05-27.md",
      "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md",
      "docs/openclinxr/doc-authority-registry-2026-05-27.md",
      "docs/openclinxr/doc-authority-registry-2026-05-27.json",
      "docs/openclinxr/generated-artifact-registry-2026-05-27.md",
      "docs/openclinxr/generated-artifact-registry-2026-05-27.json",
    ],
    ownerRoleId: "openclaw-drift-police",
    note: "Do not weaken; drift-police guards",
  },
  {
    lockId: "ceo-voice",
    paths: [
      "docs/agent-ops/CEO-VOICE.md",
      ".grok/agents/orchestrator.md",
      ".grok/personas/orchestrator.toml",
    ],
    ownerRoleId: "hrbp",
    note: "BOD-approved CEO voice",
  },
  {
    lockId: "path-scope-policy",
    paths: ["packages/openclinxr/agent-loop/src/role-harness-policy.ts"],
    ownerRoleId: "hrbp",
    note: "pathScope SSOT; implementers may PR with hrbp review",
  },
  {
    lockId: "composition-roots",
    paths: [
      "docs/agent-ops/COMPOSITION-ROOTS.md",
      "packages/cellix/**",
      "packages/openclinxr/architecture-rules/**",
    ],
    ownerRoleId: "architect",
    note: "Architect sole-authors composition doctrine + cellix seedwork + architecture-rules",
  },
];

export type SoleAuthorLockViolation = {
  lockId: string;
  path: string;
  ownerRoleId: string;
};

export function findSoleAuthorLockViolations(
  roleId: string,
  touched: string[],
): SoleAuthorLockViolation[] {
  const violations: SoleAuthorLockViolation[] = [];
  for (const lock of soleAuthorLocks) {
    if (roleId === lock.ownerRoleId) continue;
    for (const lockPath of lock.paths) {
      for (const touchedPath of touched) {
        if (!pathMatchesAnyGlob(touchedPath, [lockPath])) continue;
        // Wave C-arch: if this role owns another lock covering the same path, allow
        // (e.g. architect owns composition-roots for COMPOSITION-ROOTS.md under docs/agent-ops/**).
        const ownedCovering = soleAuthorLocks.some(
          (owned) =>
            owned.ownerRoleId === roleId && pathMatchesAnyGlob(touchedPath, owned.paths),
        );
        if (ownedCovering) continue;
        violations.push({
          lockId: lock.lockId,
          path: touchedPath,
          ownerRoleId: lock.ownerRoleId,
        });
      }
    }
  }
  return violations;
}

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
    grok: { model: "deepseek-v4-flash", reasoningEffort: "high" },
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

export const productionPipelineAssistNote =
  "Asset generation, scene optimization, and factory QA are not fully procedural. Production may use a swappable ModelAssistProvider (Moonbridge today; DeepSeek or other approved online models later) for bounded agentic evaluation and optimization behind explicit gates—not as a readiness or clinical-validity claim.";

/** Shared coordination read roots for all roles (minimal rehydrate) */
const COORD_READ = [
  "AGENTS.md",
  "PROJECT_STATUS.md",
  "docs/openclinxr/worker-backlog-and-validation-matrix.md",
  "agents/rules/**",
  "docs/agent-ops/**",
];

function findRoleDir(roleId: string): string | null {
  // Map roleId → agents/<group>/<role> based on known structure
  const known: Record<string, string> = {
    "chief-coordinator": "agents/coordinator/chief-coordinator",
    hrbp: "agents/coordinator/hrbp",
    archivist: "agents/coordinator/archivist",
    pmo: "agents/coordinator/pmo",
    "openclaw-drift-police": "agents/adversarial/openclaw-drift-police",
    "implementation-plan-gap-attacker": "agents/adversarial/implementation-plan-gap-attacker",
    "productivity-skeptic": "agents/adversarial/productivity-skeptic",
    "visual-realism-adversary": "agents/adversarial/visual-realism-adversary",
    "implementation-planning-lead": "agents/core/implementation-planning-lead",
    architect: "agents/core/architect",
    "asset-pipeline-lead": "agents/core/asset-pipeline-lead",
    "rigging-animation-specialist": "agents/core/rigging-animation-specialist",
    "xr-systems-architect": "agents/core/xr-systems-architect",
    "pediatrics-physician": "agents/physicians/pediatrics-physician",
    "clinical-safety-critic": "agents/adversarial/clinical-safety-critic",
    "license-provenance-specialist": "agents/legal/license-provenance-specialist",
    "vp-engineering-delivery": "agents/leadership/vp-engineering-delivery",
  };
  return known[roleId] ?? null;
}

/** Build readRoots = writeRoots + COORD_READ + agents/<role>/** + brief/handoff access. */
function buildReadRoots(roleId: string, writeRoots: string[], extra: string[] = []): string[] {
  const roleDir = findRoleDir(roleId);
  const roleAgentGlob = roleDir ? [`${roleDir}/**`] : [];
  return [
    ...writeRoots,
    ...COORD_READ,
    ...roleAgentGlob,
    ".openclinxr/slices/**/brief.json",
    ".openclinxr/slices/**/handoffs/**",
    ...extra,
  ];
}

export function getRolePathScope(roleId: string): RolePathScope {
  const raw = rolePathScopes[roleId] ?? {
    writeRoots: [],
    readRoots: [],
    forbidden: ["apps/**", "packages/**"],
    outputRoots: [`.openclinxr/slices/**/handoffs/${roleId}.json`],
  };
  if (raw.readRoots.length === 0) {
    return {
      ...raw,
      readRoots: buildReadRoots(roleId, raw.writeRoots),
    };
  }
  return {
    ...raw,
    readRoots: [
      ...raw.writeRoots,
      ...COORD_READ,
      ...(findRoleDir(roleId) ? [`${findRoleDir(roleId)}/**`] : []),
      ".openclinxr/slices/**/brief.json",
      ".openclinxr/slices/**/handoffs/**",
      ...raw.readRoots,
    ],
  };
}

/** Convert a glob to a regex: support **, *, trailing /**, exact prefixes. */
export function pathMatchesAnyGlob(filePath: string, globs: string[]): boolean {
  for (const glob of globs) {
    let pattern = glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex specials
      .replace(/\*\*/g, "___DOUBLESTAR___")
      .replace(/\*/g, "[^/]*")
      .replace(/___DOUBLESTAR___/g, ".*");
    // Trailing /** means match everything inside
    if (pattern.endsWith("/[^/]*")) {
      pattern = pattern.slice(0, -"[^/]*".length) + ".*";
    }
    const re = new RegExp(`^${pattern}$`);
    if (re.test(filePath)) return true;
  }
  return false;
}

export function assertTouchedWithinWriteRoots(
  touched: string[],
  scope: RolePathScope,
): { ok: boolean; violations: string[] } {
  const violations = touched.filter((p) => !pathMatchesAnyGlob(p, scope.writeRoots));
  return { ok: violations.length === 0, violations };
}

/**
 * Soft preferredCli guidance (Wave B2). Soft only — never hard-fail CLI choice in verify.
 * Used by formatPathScopeBlock + parent spawn checklist warnings.
 */
export const PREFERRED_CLI_SOFT_WARN =
  "If running package tests/builds, prefer preferredCli filters; avoid root-wide pnpm test/typecheck unless slice requires monorepo gate.";

/**
 * Roles that may use image_gen / image_edit / video tools for multimodal evidence.
 * All other generated roles ban those tools (Wave B1).
 */
export const VISUAL_MULTIMODAL_ROLE_IDS: ReadonlySet<string> = new Set([
  "productivity-skeptic",
  "visual-realism-adversary",
  "asset-pipeline-lead",
  "xr-systems-architect",
  "rigging-animation-specialist",
]);

const IMAGE_GEN_DISALLOWED_TOOLS = [
  "image_gen",
  "image_edit",
  "image_to_video",
  "reference_to_video",
] as const;

/**
 * Wave B1: per-role Grok `disallowedTools` for generated `.grok/agents/*.md`.
 *
 * - read-only sandbox: ban search_replace, write, workflow
 * - workspace-write: ban workflow (+ spawn_subagent except chief-coordinator); keep shell
 * - non-visual roles: also ban image_gen / image_edit / video tools
 * - visual multimodal roles: keep image tools
 * - never ban `run_terminal_command` here (shell-bypassable; use positive `tools:` via
 *   `allowedToolsForRole` for real read-only bind — agentic-eval persona-binding)
 * - CEO `orchestrator.md` is hand-written (B3 KEEP write + shell with write-roots discipline)
 */
export function disallowedToolsForRole(
  roleId: string,
  policy: Pick<RepoRoleHarnessPolicy, "sandboxMode" | "policyTier">,
): string[] {
  const disallowed: string[] = [];
  if (policy.sandboxMode === "read-only") {
    disallowed.push("search_replace", "write", "workflow");
  } else {
    // standard_execution / workspace-write: ban orchestration surfaces; keep shell + write tools
    disallowed.push("workflow");
  }
  if (roleId !== "chief-coordinator") {
    disallowed.push("spawn_subagent");
  }
  if (!VISUAL_MULTIMODAL_ROLE_IDS.has(roleId)) {
    disallowed.push(...IMAGE_GEN_DISALLOWED_TOOLS);
  }
  return disallowed;
}

/**
 * Positive read/search/lsp allowlist for write-restricted roles (sandboxMode === "read-only").
 * Proven (agentic-eval persona-binding): `disallowedTools` is shell-bypassable via
 * `run_terminal_command`; a positive `tools:` frontmatter is the only reliable restriction.
 * Intentionally omits: write, search_replace, run_terminal_command, workflow, monitor, scheduler_*.
 */
const READ_ONLY_BASE_ALLOWED_TOOLS = [
  "read_file",
  "list_dir",
  "grep",
  "lsp",
  "web_search",
  "web_fetch",
  "open_page",
  "open_page_with_find",
  "memory_search",
  "memory_get",
  "todo_write",
  "ask_user_question",
  "enter_plan_mode",
  "exit_plan_mode",
] as const;

/**
 * Wave B1.1: positive `tools:` allowlist for read-only / scout / review roles.
 * Returns `undefined` for workspace-write execute roles (asset/xr/architect/hrbp/pmo/…)
 * so they keep shell + write without an over-restrictive allowlist.
 */
export function allowedToolsForRole(
  roleId: string,
  policy: Pick<RepoRoleHarnessPolicy, "sandboxMode" | "policyTier">,
): string[] | undefined {
  if (policy.sandboxMode !== "read-only") {
    return undefined;
  }
  const tools: string[] = [...READ_ONLY_BASE_ALLOWED_TOOLS];
  // Coordinator scout may spawn children; still no shell/write (handoffs via parent integrate).
  if (roleId === "chief-coordinator") {
    tools.push("spawn_subagent", "get_command_or_subagent_output", "kill_command_or_subagent");
  }
  if (VISUAL_MULTIMODAL_ROLE_IDS.has(roleId)) {
    tools.push(...IMAGE_GEN_DISALLOWED_TOOLS);
  }
  return tools;
}

/**
 * Compact markdown/bullet block for spawn prompts.
 * "See agents/rules/MANDATE_VISIBILITY.md + LEX_AGENTIC.md (do not restate full mandate)."
 */
export function formatPathScopeBlock(scope: RolePathScope): string {
  const lines = [
    "## PATH SCOPE (ATL-style write-roots)",
    "",
    "### Write roots (EDIT allowed)",
    ...scope.writeRoots.map((p) => `- \`${p}\``),
    "",
    "### Forbidden (NEVER edit)",
    ...scope.forbidden.slice(0, 5).map((p) => `- \`${p}\``),
    ...(scope.forbidden.length > 5 ? [`- ... and ${scope.forbidden.length - 5} more`] : []),
    "",
    "### Read preference (grep/list/read prefer these)",
    ...scope.readRoots.slice(0, 8).map((p) => `- \`${p}\``),
    ...(scope.readRoots.length > 8 ? [`- ... and ${scope.readRoots.length - 8} more`] : []),
    "",
    "### Output roots (handoffs here)",
    ...scope.outputRoots.map((p) => `- \`${p}\``),
    "",
    "Rules: grep/list/read prefer readRoots; EDIT only writeRoots; if need outside forbidden → residual to parent; never weaken protected docs.",
  ];
  if (scope.preferredCli && scope.preferredCli.length > 0) {
    lines.push("", "### Preferred CLI", ...scope.preferredCli.map((c) => `- \`${c}\``));
    // Wave B2 soft-warn only — never hard-fail CLI choice
    lines.push("", PREFERRED_CLI_SOFT_WARN);
  }
  return lines.join("\n");
}

/** Resolved once at load, after getRolePathScope is defined (see role-harness-policy-tables.ts). */
export const repoRoleHarnessPolicies = buildRoleHarnessPolicies();

const repoRoleHarnessPolicyById = new Map(
  repoRoleHarnessPolicies.map((policy) => [policy.roleId, policy]),
);

export function getRepoRoleHarnessPolicy(roleId: string): RepoRoleHarnessPolicy | undefined {
  return repoRoleHarnessPolicyById.get(roleId);
}

/** Harness built-in type names that must never be used as product-delivery roleIds. */
const UNMAPPED_DELIVERY_ROLE_IDS = new Set([
  "general-purpose",
  "explore",
  "plan",
  "composer",
  "grok-build",
]);

export type DeliveryRoleMappedResult =
  | { ok: true; roleId: string }
  | { ok: false; roleId: string; reason: string };

/**
 * Wave C-arch RIF: product delivery must use a role-mapped agents/** role with
 * RepoRoleHarnessPolicy (pathScope). Bare harness types (general-purpose/explore/plan)
 * without role mapping fail this helper — for CLI/docs/parent checks.
 */
export function assertDeliveryRoleMapped(roleId: string): DeliveryRoleMappedResult {
  const trimmed = roleId.trim();
  if (!trimmed) {
    return {
      ok: false,
      roleId,
      reason:
        "Missing roleId: product delivery must use a role-mapped agents/** role (never bare general-purpose).",
    };
  }
  if (UNMAPPED_DELIVERY_ROLE_IDS.has(trimmed)) {
    return {
      ok: false,
      roleId: trimmed,
      reason: `Never spawn bare harness type "${trimmed}" for product delivery; map to a repo role via pnpm grok:agent:spawn-spec --role <agents/** role>.`,
    };
  }
  const policy = getRepoRoleHarnessPolicy(trimmed);
  if (!policy) {
    return {
      ok: false,
      roleId: trimmed,
      reason: `No RepoRoleHarnessPolicy for "${trimmed}"; product write requires registered pathScope (see docs/agent-ops/PATH-SCOPE.md Wave C-arch).`,
    };
  }
  return { ok: true, roleId: trimmed };
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