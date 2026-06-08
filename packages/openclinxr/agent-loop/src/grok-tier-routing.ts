/**
 * Grok-harness-only tiered model routing: plan → delegate → execute with explicit upgrade path.
 * Does not alter Codex Desktop routing (.codex/agents) or Moonbridge assist policy.
 */

import {
  buildGrokRepoAgentSpawnSpec,
  recommendRepoAgentsForConsult,
  type GrokRepoAgentSpawnSpec,
} from "./grok-repo-agent-spawn.js";

export type GrokHarnessSurface =
  | "grok_native_spawn_subagent"
  | "cursor_composer_task"
  | "local_repo_agent_consult"
  | "direct_deepseek_api";

export type GrokTierId =
  | "tier0_local_consult"
  | "tier1_deepseek_flash_scout"
  | "tier2_deepseek_pro_analysis"
  | "tier3_deepseek_pro_execution"
  | "tier4_grok_compose_integrate"
  | "tier5_grok_build_frontier";

export type GrokSubagentType = "explore" | "plan" | "general-purpose";

export type GrokTierSpec = {
  tierId: GrokTierId;
  label: string;
  model: string | "none";
  grokSubagentType: GrokSubagentType | null;
  preferredSurface: GrokHarnessSurface;
  capabilityMode: "read-only" | "read-write" | "all" | null;
  role: "scout" | "plan" | "execute" | "integrate" | "frontier";
};

export type GrokTierUpgradeTrigger = {
  triggerId: string;
  fromTier: GrokTierId;
  toTier: GrokTierId;
  signal: string;
};

export type GrokTierWorkOrder = {
  schemaVersion: "openclinxr.grok-tier-work-order.v1";
  generatedAt: string;
  harness: "grok_only";
  sliceId: string;
  sliceSummary: string;
  activeTier: GrokTierId;
  recommendedStartTier: GrokTierId;
  upgradeLadder: GrokTierId[];
  scoutPrompt: string;
  planPrompt: string | null;
  executionPrompt: string | null;
  integrationNotes: string[];
  upgradeTriggers: GrokTierUpgradeTrigger[];
  safeguards: string[];
  falseGates: string[];
  spawnSubagentHints: {
    explore: { subagent_type: "explore"; capability_mode: "read-only"; model: string };
    plan: { subagent_type: "plan"; capability_mode: "read-only"; model: string };
    execute: { subagent_type: "general-purpose"; capability_mode: "read-write"; model: string };
  };
  cursorTaskWarning: string;
  repoAgentSpawns: {
    scout: GrokRepoAgentSpawnSpec | null;
    plan: GrokRepoAgentSpawnSpec | null;
    execute: GrokRepoAgentSpawnSpec | null;
  };
  repoAgentSpawnNote: string;
};

export type GrokTierIntrospectionReport = {
  schemaVersion: "openclinxr.grok-tier-introspection.v1";
  generatedAt: string;
  harness: "grok_only";
  posture: "aligned" | "degraded" | "blocked";
  checks: Array<{ checkId: string; passed: boolean; note: string }>;
  recommendedSurface: GrokHarnessSurface;
  activeUpgradePath: GrokTierId[];
  cursorTaskDelegationAllowed: boolean;
  nativeSpawnSubagentPreferred: boolean;
  introspectionPrompts: string[];
  safeguards: string[];
};

export const GROK_TIER_LADDER: GrokTierSpec[] = [
  {
    tierId: "tier0_local_consult",
    label: "Local repo-agent consult",
    model: "none",
    grokSubagentType: null,
    preferredSurface: "local_repo_agent_consult",
    capabilityMode: null,
    role: "scout",
  },
  {
    tierId: "tier1_deepseek_flash_scout",
    label: "DeepSeek V4 Flash scout",
    model: "deepseek-v4-flash",
    grokSubagentType: "explore",
    preferredSurface: "grok_native_spawn_subagent",
    capabilityMode: "read-only",
    role: "scout",
  },
  {
    tierId: "tier2_deepseek_pro_analysis",
    label: "DeepSeek V4 Pro analysis / plan",
    model: "deepseek-v4-pro",
    grokSubagentType: "plan",
    preferredSurface: "grok_native_spawn_subagent",
    capabilityMode: "read-only",
    role: "plan",
  },
  {
    tierId: "tier3_deepseek_pro_execution",
    label: "DeepSeek V4 Pro bounded execution",
    model: "deepseek-v4-pro",
    grokSubagentType: "general-purpose",
    preferredSurface: "grok_native_spawn_subagent",
    capabilityMode: "read-write",
    role: "execute",
  },
  {
    tierId: "tier4_grok_compose_integrate",
    label: "Grok Composer integrate",
    model: "grok-composer-2.5-fast",
    grokSubagentType: null,
    preferredSurface: "cursor_composer_task",
    capabilityMode: "all",
    role: "integrate",
  },
  {
    tierId: "tier5_grok_build_frontier",
    label: "Grok Build frontier synthesis",
    model: "grok-build",
    grokSubagentType: null,
    preferredSurface: "grok_native_spawn_subagent",
    capabilityMode: "all",
    role: "frontier",
  },
];

export const GROK_TIER_UPGRADE_TRIGGERS: GrokTierUpgradeTrigger[] = [
  {
    triggerId: "scout_generic_no_paths",
    fromTier: "tier1_deepseek_flash_scout",
    toTier: "tier2_deepseek_pro_analysis",
    signal: "Flash scout returns generic advice without file paths or repo-specific gates.",
  },
  {
    triggerId: "scout_misses_q_gate",
    fromTier: "tier1_deepseek_flash_scout",
    toTier: "tier2_deepseek_pro_analysis",
    signal: "Scout omits Q1/Q4/Q5 blueprint-factory gate language for the slice.",
  },
  {
    triggerId: "plan_ambiguous_scope",
    fromTier: "tier2_deepseek_pro_analysis",
    toTier: "tier4_grok_compose_integrate",
    signal: "Pro plan cannot bound write scope or conflicts with lease/active slice.",
  },
  {
    triggerId: "execution_test_fail_twice",
    fromTier: "tier3_deepseek_pro_execution",
    toTier: "tier4_grok_compose_integrate",
    signal: "Bounded execution fails focused verification twice on the same acceptance criteria.",
  },
  {
    triggerId: "protected_claim_touch",
    fromTier: "tier3_deepseek_pro_execution",
    toTier: "tier5_grok_build_frontier",
    signal: "Slice touches promotion, readiness, Quest, clinical, or scoring claim boundaries.",
  },
  {
    triggerId: "integration_cross_package",
    fromTier: "tier3_deepseek_pro_execution",
    toTier: "tier4_grok_compose_integrate",
    signal: "Slice spans multiple packages or requires merge/integration judgment.",
  },
  {
    triggerId: "two_evidence_only_slices",
    fromTier: "tier1_deepseek_flash_scout",
    toTier: "tier4_grok_compose_integrate",
    signal: "Two consecutive evidence-only slices — coordinator consult then product pivot.",
  },
  {
    triggerId: "cursor_task_cost_warning",
    fromTier: "tier4_grok_compose_integrate",
    toTier: "tier1_deepseek_flash_scout",
    signal: "Composer would spawn Cursor Task subagents for read-only work — use native explore instead.",
  },
];

export const GROK_TIER_SAFEGUARDS = [
  "Grok harness only: Codex Desktop keeps .codex/agents tier models unchanged.",
  "Never use Cursor Task for tier0–tier2 read-only scouts; prefer spawn_subagent explore or local consult.",
  "Composer owns lease, state files, post-slice guards, and integration — not parallel write subagents.",
  "Record tier used per slice in PROJECT_STATUS.md (tier: flash|pro|compose|frontier).",
  "Run pnpm grok:tier:introspect before multi-subagent waves and after context compaction.",
  "Upgrade on explicit triggers only; do not skip to frontier for routine implementation.",
  "Protected promotion gates stay false unless Patrick explicitly approves scope expansion.",
  "Spawn only repo-defined agents/** roles via pnpm grok:agent:spawn-spec — never generic Cursor Task agents.",
  "Regenerate role pointers after policy edits: pnpm agent:harness:sync.",
];

export const GROK_CURSOR_TASK_WARNING =
  "Cursor Task maps to spawn_subagent but only exposes composer-2.5-fast and generalPurpose/code-reviewer types. For DeepSeek flash scouts use native Grok spawn_subagent subagent_type=explore (read-only), not Cursor Task.";

export const GROK_TIER_PACKAGE_SCRIPTS = [
  "grok:tier:introspect",
  "grok:tier:work-order",
  "grok:tier:check",
  "grok:tier:brief",
  "grok:tier:slice-start",
  "grok:tier:slice-introspect",
  "grok:tier:post-slice",
] as const;

export type GrokDelegationIntent = "scout" | "plan" | "execute" | "integrate" | "frontier";

export type GrokDelegationAdvice = {
  intent: GrokDelegationIntent;
  recommendedTier: GrokTierId;
  recommendedSurface: GrokHarnessSurface;
  useNativeSpawnSubagent: boolean;
  useCursorTask: boolean;
  warnings: string[];
  spawnHint: GrokTierWorkOrder["spawnSubagentHints"][keyof GrokTierWorkOrder["spawnSubagentHints"]] | null;
};

export type GrokTierUpgradeEvaluation = {
  shouldUpgrade: boolean;
  fromTier: GrokTierId;
  toTier: GrokTierId | null;
  matchedTriggerId: string | null;
  reason: string;
};

export const GROK_TIER_IDS: GrokTierId[] = GROK_TIER_LADDER.map((entry) => entry.tierId);

const GROK_TIER_ID_ALIASES: Partial<Record<string, GrokTierId>> = {
  tier3_deepseek_pro_execute: "tier3_deepseek_pro_execution",
};

export function parseGrokTierId(input: string): GrokTierId {
  const normalized = input.trim();
  const aliased = GROK_TIER_ID_ALIASES[normalized];
  if (aliased) return aliased;
  const spec = GROK_TIER_LADDER.find((entry) => entry.tierId === normalized);
  if (spec) return spec.tierId;
  throw new Error(`Unknown Grok tier: ${normalized}. Valid: ${GROK_TIER_IDS.join(", ")}`);
}

export function getGrokTierSpec(tierId: GrokTierId): GrokTierSpec {
  const spec = GROK_TIER_LADDER.find((entry) => entry.tierId === tierId);
  if (!spec) throw new Error(`Unknown Grok tier: ${tierId}`);
  return spec;
}

export function evaluateGrokDelegationAdvice(input: {
  intent: GrokDelegationIntent;
  preferZeroCost?: boolean;
}): GrokDelegationAdvice {
  const tierByIntent: Record<GrokDelegationIntent, GrokTierId> = {
    scout: input.preferZeroCost ? "tier0_local_consult" : "tier1_deepseek_flash_scout",
    plan: "tier2_deepseek_pro_analysis",
    execute: "tier3_deepseek_pro_execution",
    integrate: "tier4_grok_compose_integrate",
    frontier: "tier5_grok_build_frontier",
  };
  const recommendedTier = tierByIntent[input.intent];
  const spec = getGrokTierSpec(recommendedTier);
  const warnings: string[] = [];
  let useCursorTask = false;
  let useNativeSpawnSubagent = false;
  let spawnHint: GrokDelegationAdvice["spawnHint"] = null;

  if (spec.preferredSurface === "grok_native_spawn_subagent" && spec.grokSubagentType) {
    useNativeSpawnSubagent = true;
    spawnHint = spec.grokSubagentType === "explore"
      ? { subagent_type: "explore", capability_mode: "read-only", model: "deepseek-v4-flash" }
      : spec.grokSubagentType === "plan"
        ? { subagent_type: "plan", capability_mode: "read-only", model: "deepseek-v4-pro" }
        : { subagent_type: "general-purpose", capability_mode: "read-write", model: "deepseek-v4-pro" };
  }
  if (input.intent === "scout" || input.intent === "plan") {
    warnings.push(GROK_CURSOR_TASK_WARNING);
    useCursorTask = false;
  }
  if (input.intent === "integrate") {
    useCursorTask = false;
    warnings.push("Composer owns integration; do not spawn parallel write subagents for state files.");
  }
  if (input.intent === "frontier") {
    warnings.push("Frontier tier reserved for protected-claim or ambiguous cross-domain synthesis.");
  }

  return {
    intent: input.intent,
    recommendedTier,
    recommendedSurface: spec.preferredSurface,
    useNativeSpawnSubagent,
    useCursorTask,
    warnings,
    spawnHint,
  };
}

export function evaluateGrokTierUpgrade(input: {
  currentTier: GrokTierId;
  scoutOutput?: string;
  verificationFailures?: number;
  evidenceOnlyStreak?: number;
  touchesProtectedClaims?: boolean;
}): GrokTierUpgradeEvaluation {
  const output = (input.scoutOutput ?? "").toLowerCase();
  const hasRepoPaths = /\/volumes\/files\/src\/openclinxr|packages\/|tools\/|apps\/|agents\//i.test(output);
  const mentionsBlueprintGate = /q1|q4|q5|blueprint|factory gate/i.test(output);

  if (input.touchesProtectedClaims && input.currentTier !== "tier5_grok_build_frontier") {
    return upgradeResult(input.currentTier, "tier5_grok_build_frontier", "protected_claim_touch", "Slice touches promotion/readiness claim boundaries.");
  }
  if ((input.evidenceOnlyStreak ?? 0) >= 2 && input.currentTier === "tier1_deepseek_flash_scout") {
    return upgradeResult(input.currentTier, "tier4_grok_compose_integrate", "two_evidence_only_slices", "Two consecutive evidence-only slices require coordinator consult and product pivot.");
  }
  if ((input.verificationFailures ?? 0) >= 2 && input.currentTier === "tier3_deepseek_pro_execution") {
    return upgradeResult(input.currentTier, "tier4_grok_compose_integrate", "execution_test_fail_twice", "Bounded execution failed focused verification twice.");
  }
  if (input.currentTier === "tier1_deepseek_flash_scout" && output.length > 0 && !hasRepoPaths) {
    return upgradeResult(input.currentTier, "tier2_deepseek_pro_analysis", "scout_generic_no_paths", "Flash scout output lacks repo-specific file paths.");
  }
  if (input.currentTier === "tier1_deepseek_flash_scout" && output.length > 0 && !mentionsBlueprintGate) {
    return upgradeResult(input.currentTier, "tier2_deepseek_pro_analysis", "scout_misses_q_gate", "Flash scout omitted blueprint-factory gate language.");
  }
  if (input.currentTier === "tier2_deepseek_pro_analysis" && /ambiguous|cannot bound|conflict/i.test(output)) {
    return upgradeResult(input.currentTier, "tier4_grok_compose_integrate", "plan_ambiguous_scope", "Pro plan could not bound write scope.");
  }

  return {
    shouldUpgrade: false,
    fromTier: input.currentTier,
    toTier: null,
    matchedTriggerId: null,
    reason: "No upgrade trigger matched; stay on current tier.",
  };
}

export function formatGrokTierRecordLine(tierId: GrokTierId): string {
  const spec = getGrokTierSpec(tierId);
  const short =
    spec.role === "scout" && spec.model === "deepseek-v4-flash"
      ? "flash"
      : spec.role === "plan" || (spec.role === "execute" && spec.model === "deepseek-v4-pro")
        ? "pro"
        : spec.role === "integrate"
          ? "compose"
          : spec.role === "frontier"
            ? "frontier"
            : "local";
  return `tier: ${short} (${tierId})`;
}

export function formatGrokTierIntrospectionBrief(report: GrokTierIntrospectionReport): string {
  const failed = report.checks.filter((check) => !check.passed).map((check) => check.checkId);
  const lines = [
    `Grok tier posture: ${report.posture}`,
    `Preferred surface: ${report.recommendedSurface}`,
    `Cursor Task for scouts: ${report.cursorTaskDelegationAllowed ? "allowed" : "blocked"}`,
    ...(failed.length > 0 ? [`Failed checks: ${failed.join(", ")}`] : []),
    "Introspection:",
    ...report.introspectionPrompts.map((prompt) => `- ${prompt}`),
  ];
  return lines.join("\n");
}

export function recommendGrokStartTier(input: {
  taskKind: "scout" | "plan" | "execute" | "integrate";
  preferZeroCost?: boolean;
}): GrokTierId {
  if (input.preferZeroCost && input.taskKind === "scout") return "tier0_local_consult";
  if (input.taskKind === "scout") return "tier1_deepseek_flash_scout";
  if (input.taskKind === "plan") return "tier2_deepseek_pro_analysis";
  if (input.taskKind === "execute") return "tier3_deepseek_pro_execution";
  return "tier4_grok_compose_integrate";
}

export function buildGrokTierWorkOrder(input: {
  sliceId: string;
  sliceSummary: string;
  scoutQuestion: string;
  planQuestion?: string;
  executionScope?: string;
  falseGates?: string[];
  generatedAt?: string;
  startTier?: GrokTierId;
  scoutAgent?: { roleId: string; roleDir: string; group: string };
  planAgent?: { roleId: string; roleDir: string; group: string };
  executeAgent?: { roleId: string; roleDir: string; group: string };
}): GrokTierWorkOrder {
  const startTier = input.startTier ?? recommendGrokStartTier({ taskKind: "scout" });
  const scoutRole =
    input.scoutAgent ??
    ({
      roleId: recommendRepoAgentsForConsult("orchestration")[0] ?? "chief-coordinator",
      roleDir: "agents/coordinator/chief-coordinator",
      group: "coordinator",
    } as const);
  const planRole =
    input.planAgent ??
    ({
      roleId: recommendRepoAgentsForConsult("planning")[0] ?? "implementation-planning-lead",
      roleDir: "agents/core/implementation-planning-lead",
      group: "core",
    } as const);
  const scoutSpawn = buildGrokRepoAgentSpawnSpec({
    ...scoutRole,
    task: input.scoutQuestion,
  });
  const planSpawn = input.planQuestion
    ? buildGrokRepoAgentSpawnSpec({ ...planRole, task: input.planQuestion })
    : null;
  const executeSpawn = input.executionScope && input.executeAgent
    ? buildGrokRepoAgentSpawnSpec({ ...input.executeAgent, task: input.executionScope })
    : null;
  const upgradeLadder: GrokTierId[] = [
    "tier0_local_consult",
    "tier1_deepseek_flash_scout",
    "tier2_deepseek_pro_analysis",
    "tier3_deepseek_pro_execution",
    "tier4_grok_compose_integrate",
    "tier5_grok_build_frontier",
  ];
  return {
    schemaVersion: "openclinxr.grok-tier-work-order.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    harness: "grok_only",
    sliceId: input.sliceId,
    sliceSummary: input.sliceSummary,
    activeTier: startTier,
    recommendedStartTier: startTier,
    upgradeLadder,
    scoutPrompt: scoutSpawn.spawnPrompt,
    planPrompt: planSpawn?.spawnPrompt ?? null,
    executionPrompt: executeSpawn?.spawnPrompt ?? null,
    integrationNotes: [
      "Composer integrates subagent summaries, runs focused verify, updates state files.",
      "If flash scout insufficient, upgrade to pro plan before any write scope.",
      "If pro execution fails twice, Composer owns debug and integration.",
    ],
    upgradeTriggers: GROK_TIER_UPGRADE_TRIGGERS,
    safeguards: GROK_TIER_SAFEGUARDS,
    falseGates: input.falseGates ?? [
      "b_plus_visual_realism_gate",
      "scene_placement_readiness",
      "quest_readiness",
      "production_asset_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
    spawnSubagentHints: {
      explore: {
        subagent_type: "explore",
        capability_mode: "read-only",
        model: "deepseek-v4-flash",
      },
      plan: {
        subagent_type: "plan",
        capability_mode: "read-only",
        model: "deepseek-v4-pro",
      },
      execute: {
        subagent_type: "general-purpose",
        capability_mode: "read-write",
        model: "deepseek-v4-pro",
      },
    },
    cursorTaskWarning: GROK_CURSOR_TASK_WARNING,
    repoAgentSpawns: {
      scout: scoutSpawn,
      plan: planSpawn,
      execute: executeSpawn,
    },
    repoAgentSpawnNote: `Use repo agents only. Scout: ${scoutSpawn.roleId} (${scoutSpawn.model}). CLI: pnpm grok:agent:spawn-spec -- --role ${scoutSpawn.roleId}`,
  };
}

export function validateGrokHarnessTierConfig(configToml: string): {
  ok: boolean;
  errors: string[];
  exploreModel?: string;
  planModel?: string;
} {
  const errors: string[] = [];
  const explore = readTomlQuotedValue(configToml, "subagents.models", "explore");
  const plan = readTomlQuotedValue(configToml, "subagents.models", "plan");
  const defaultModel = readTomlQuotedValue(configToml, "subagents", "default_model");
  if (explore !== "deepseek-v4-flash") errors.push(`subagents.models.explore must be deepseek-v4-flash (got ${explore ?? "missing"})`);
  if (plan !== "deepseek-v4-pro") errors.push(`subagents.models.plan must be deepseek-v4-pro (got ${plan ?? "missing"})`);
  if (defaultModel) errors.push(`subagents.default_model must be unset (got ${defaultModel})`);
  if (!configToml.includes("tier routing") && !configToml.includes("grok-tier-routing")) {
    errors.push("Missing grok tier routing reference in .grok/config.toml");
  }
  return { ok: errors.length === 0, errors, exploreModel: explore, planModel: plan };
}

export function buildGrokTierIntrospectionReport(input: {
  configToml: string;
  ruleFilePresent: boolean;
  packageScriptsPresent: boolean;
  generatedAt?: string;
}): GrokTierIntrospectionReport {
  const configCheck = validateGrokHarnessTierConfig(input.configToml);
  const checks = [
    {
      checkId: "grok_subagent_models",
      passed: configCheck.ok,
      note: configCheck.ok
        ? `explore=${configCheck.exploreModel} plan=${configCheck.planModel}`
        : configCheck.errors.join("; "),
    },
    {
      checkId: "grok_tier_rule_present",
      passed: input.ruleFilePresent,
      note: input.ruleFilePresent
        ? "agents/rules/grok-tier-routing.md present"
        : "Missing agents/rules/grok-tier-routing.md",
    },
    {
      checkId: "grok_tier_cli_scripts",
      passed: input.packageScriptsPresent,
      note: input.packageScriptsPresent
        ? "pnpm grok:tier:* scripts registered"
        : "Missing package.json grok:tier scripts",
    },
    {
      checkId: "cursor_task_not_scout_default",
      passed: true,
      note: GROK_CURSOR_TASK_WARNING,
    },
  ];
  const failed = checks.filter((c) => !c.passed);
  const posture: GrokTierIntrospectionReport["posture"] =
    failed.length === 0 ? "aligned" : failed.some((c) => c.checkId === "grok_subagent_models") ? "blocked" : "degraded";
  return {
    schemaVersion: "openclinxr.grok-tier-introspection.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    harness: "grok_only",
    posture,
    checks,
    recommendedSurface: "grok_native_spawn_subagent",
    activeUpgradePath: GROK_TIER_LADDER.map((t) => t.tierId),
    cursorTaskDelegationAllowed: false,
    nativeSpawnSubagentPreferred: true,
    introspectionPrompts: [
      "Before delegating: is this read-only? If yes, use spawn_subagent explore (flash), not Cursor Task.",
      "Did flash output cite repo file paths? If no, upgrade to tier2 pro plan.",
      "Does slice touch promotion/readiness claims? If yes, skip to tier4/tier5 Composer/grok-build.",
      "After two evidence-only slices, run coordinator consult then force product slice.",
      "Run pnpm grok:tier:introspect and pnpm agent:harness:prove after policy changes.",
    ],
    safeguards: GROK_TIER_SAFEGUARDS,
  };
}

function upgradeResult(
  fromTier: GrokTierId,
  toTier: GrokTierId,
  triggerId: string,
  reason: string,
): GrokTierUpgradeEvaluation {
  return {
    shouldUpgrade: true,
    fromTier,
    toTier,
    matchedTriggerId: triggerId,
    reason,
  };
}

function readTomlQuotedValue(content: string, section: string, key: string): string | undefined {
  const sectionHeader = `[${section}]`;
  let inSection = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.length === 0) continue;
    if (trimmed === sectionHeader) {
      inSection = true;
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*"([^"]*)"/);
    if (match && match[1] === key) return match[2];
  }
  return undefined;
}