/**
 * Harness-neutral role SSOT (Atlantis pattern #2).
 *
 * Generated from role-harness-policy.ts — VENDOR-FREE: no model IDs
 * (deepseek/grok/composer/gpt). Harness adapters map tier→model.
 */
import {
  repoRoleHarnessPolicies,
  type BackgroundAgentPolicyTier,
  type BackgroundAgentReasoningEffort,
  type CodexSandboxMode,
  type RepoRoleHarnessPolicy,
} from "./role-harness-policy.js";

/** Neutral tiers — includes `retired` for future soft-delete without model leakage. */
export type NeutralManifestTier =
  | "fast_bounded"
  | "standard_execution"
  | "expert_review"
  | "frontier_thinking"
  | "retired";

export type NeutralManifestRole = {
  name: string;
  tier: NeutralManifestTier;
  effort: BackgroundAgentReasoningEffort;
  sandboxMode: CodexSandboxMode;
  /** Write ownership globs (policy pathScope.writeRoots). */
  ownerGlobs: string[];
};

export type HarnessNeutralManifest = {
  schemaVersion: 1;
  /** Flat orchestration only — no nested sub-agent trees (Atlantis max_depth=1). */
  maxNestingDepth: 1;
  generatedFrom: string;
  roles: NeutralManifestRole[];
};

/** Effort by tier (reasoning intensity only — no vendor model IDs). */
export const NEUTRAL_TIER_EFFORT: Record<
  Exclude<NeutralManifestTier, "retired">,
  BackgroundAgentReasoningEffort
> = {
  fast_bounded: "low",
  standard_execution: "medium",
  expert_review: "high",
  frontier_thinking: "xhigh",
};

export const HARNESS_NEUTRAL_MANIFEST_REL =
  "docs/agent-ops/harness-neutral/manifest.json";

export const HARNESS_NEUTRAL_SOURCE_REL =
  "packages/openclinxr/agent-loop/src/role-harness-policy.ts";

/**
 * Grok main-session CEO agent is hand-maintained and not a policy role.
 * Allowed as extra in `.grok/agents/` only — not required in policy or Codex.
 */
export const GROK_ONLY_EXTRA_AGENTS = new Set(["orchestrator"]);

/** Non-role stems ignored when scanning agent directories. */
export const AGENT_DIR_IGNORE_STEMS = new Set(["readme", "README"]);

/**
 * AGENTS.md vendor RUNTIME tokens that fail the boundary check.
 * Path-scope config references (`.grok/`) are warn-only on this repo today.
 */
export const AGENTS_MD_RUNTIME_FAIL_TOKENS = ["spawn_subagent", "--yolo"] as const;
export const AGENTS_MD_RUNTIME_WARN_TOKENS = [".grok/"] as const;

/** Exact vendor model / runtime IDs forbidden inside neutral SSOT. */
const FORBIDDEN_NEUTRAL_MODEL_RE =
  /\b(?:deepseek|grok-build|grok-composer|grok-4|composer-2|gpt-5\.|claude-|gemini-)/i;

function isPolicyTier(tier: string): tier is BackgroundAgentPolicyTier {
  return (
    tier === "fast_bounded" ||
    tier === "standard_execution" ||
    tier === "expert_review" ||
    tier === "frontier_thinking"
  );
}

export function effortForTier(tier: NeutralManifestTier): BackgroundAgentReasoningEffort {
  if (tier === "retired") return "low";
  return NEUTRAL_TIER_EFFORT[tier];
}

export function buildHarnessNeutralManifest(
  policies: readonly RepoRoleHarnessPolicy[] = repoRoleHarnessPolicies,
): HarnessNeutralManifest {
  const roles: NeutralManifestRole[] = policies
    .map((policy) => {
      const tier: NeutralManifestTier = isPolicyTier(policy.policyTier)
        ? policy.policyTier
        : "retired";
      return {
        name: policy.roleId,
        tier,
        effort: effortForTier(tier),
        sandboxMode: policy.sandboxMode,
        ownerGlobs: [...policy.pathScope.writeRoots],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    schemaVersion: 1,
    maxNestingDepth: 1,
    generatedFrom: HARNESS_NEUTRAL_SOURCE_REL,
    roles,
  };
}

export function formatHarnessNeutralManifestJson(manifest: HarnessNeutralManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export type BoundaryValidationInput = {
  manifest: HarnessNeutralManifest;
  /** Role ids from live policy (repoRoleHarnessPolicies). */
  policyRoleIds: string[];
  /** Stems of `.grok/agents/*.md` (no extension). */
  grokAgentStems: string[];
  /**
   * Stems of `.codex/agents/*.{toml,md}` role files, or null if directory absent.
   * When null, codex parity is skipped.
   */
  codexAgentStems: string[] | null;
  agentsMdText: string;
};

export type BoundaryValidationReport = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

function normalizeAgentStems(stems: string[]): Set<string> {
  return new Set(
    stems
      .map((s) => s.replace(/\.(md|toml)$/i, ""))
      .filter((s) => s && !AGENT_DIR_IGNORE_STEMS.has(s) && s.toLowerCase() !== "readme"),
  );
}

function setDiff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x)).sort();
}

/**
 * Non-writer = sandboxMode is not workspace-write.
 * Writers may hold workspace-write; everyone else must be read-only.
 */
export function isWriterSandbox(sandboxMode: CodexSandboxMode): boolean {
  return sandboxMode === "workspace-write";
}

/**
 * Assert harness-neutral boundaries (parity, vendor isolation, sandbox, flat nesting).
 * Fit to current openclinxr reality: Grok may include `orchestrator`; AGENTS.md may warn on `.grok/`.
 */
export function validateHarnessBoundaries(input: BoundaryValidationInput): BoundaryValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { manifest } = input;
  if (manifest.schemaVersion !== 1) {
    errors.push(`manifest.schemaVersion must be 1 (got ${String(manifest.schemaVersion)})`);
  }
  if (manifest.maxNestingDepth !== 1) {
    errors.push(
      `manifest.maxNestingDepth must be 1 (flat orchestration); got ${String(manifest.maxNestingDepth)}`,
    );
  }

  const roleNames = manifest.roles.map((r) => r.name);
  if (new Set(roleNames).size !== roleNames.length) {
    errors.push("manifest.roles: duplicate role names");
  }

  for (const role of manifest.roles) {
    const asRecord = role as NeutralManifestRole & {
      children?: unknown;
      roles?: unknown;
      subroles?: unknown;
    };
    if (asRecord.children != null || asRecord.roles != null || asRecord.subroles != null) {
      errors.push(
        `manifest.roles[${role.name}]: nested role hierarchy forbidden (maxNestingDepth=1)`,
      );
    }
    // (c) non-writer roles have sandboxMode read-only
    if (!isWriterSandbox(role.sandboxMode) && role.sandboxMode !== "read-only") {
      errors.push(
        `non-writer ${role.name}: sandboxMode must be read-only (got ${String(role.sandboxMode)})`,
      );
    }
  }

  const policySet = new Set(input.policyRoleIds);
  const manifestSet = new Set(roleNames);
  if (setDiff(policySet, manifestSet).length || setDiff(manifestSet, policySet).length) {
    errors.push(
      `policy vs manifest role parity: missing_in_manifest=${JSON.stringify(setDiff(policySet, manifestSet))} extra_in_manifest=${JSON.stringify(setDiff(manifestSet, policySet))}`,
    );
  }

  const grokSet = normalizeAgentStems(input.grokAgentStems);
  const grokPolicy = new Set([...grokSet].filter((s) => !GROK_ONLY_EXTRA_AGENTS.has(s)));
  const missingGrok = setDiff(policySet, grokPolicy);
  const extraGrok = setDiff(grokPolicy, policySet);
  if (missingGrok.length || extraGrok.length) {
    errors.push(
      `Grok role parity (.grok/agents): missing=${JSON.stringify(missingGrok)} extra=${JSON.stringify(extraGrok)} (allowed Grok-only: ${[...GROK_ONLY_EXTRA_AGENTS].join(", ")})`,
    );
  }
  // Grok must still contain all policy roles
  for (const role of policySet) {
    if (!grokSet.has(role)) {
      errors.push(`.grok/agents missing policy role: ${role}`);
    }
  }

  if (input.codexAgentStems !== null) {
    const codexSet = normalizeAgentStems(input.codexAgentStems);
    const missingCodex = setDiff(policySet, codexSet);
    const extraCodex = setDiff(codexSet, policySet);
    if (missingCodex.length || extraCodex.length) {
      errors.push(
        `Codex role parity (.codex/agents): missing=${JSON.stringify(missingCodex)} extra=${JSON.stringify(extraCodex)}`,
      );
    }
  }

  // (b) AGENTS.md vendor runtime tokens
  const agentsText = input.agentsMdText;
  const agentsLower = agentsText.toLowerCase();
  for (const token of AGENTS_MD_RUNTIME_FAIL_TOKENS) {
    if (agentsLower.includes(token.toLowerCase())) {
      errors.push(`AGENTS.md: vendor runtime token forbidden: ${token}`);
    }
  }
  for (const token of AGENTS_MD_RUNTIME_WARN_TOKENS) {
    if (agentsText.includes(token) || agentsLower.includes(token.toLowerCase())) {
      warnings.push(
        `AGENTS.md: vendor runtime token on warn-list (allowed for path-scope config refs): ${token}`,
      );
    }
  }

  // Neutral SSOT must not leak exact vendor model IDs
  const manifestBlob = JSON.stringify(manifest);
  if (FORBIDDEN_NEUTRAL_MODEL_RE.test(manifestBlob)) {
    errors.push("manifest.json: vendor model id leaked into harness-neutral SSOT");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Build a deliberately invalid input for unit tests (seeded violation).
 * Does not mutate the live repo.
 */
export function seedBoundaryViolation(
  base: BoundaryValidationInput,
  kind: "parity" | "sandbox" | "nesting" | "agents_md_token" | "vendor_model",
): BoundaryValidationInput {
  const clone: BoundaryValidationInput = {
    ...base,
    manifest: {
      ...base.manifest,
      roles: base.manifest.roles.map((r) => ({ ...r, ownerGlobs: [...r.ownerGlobs] })),
    },
    policyRoleIds: [...base.policyRoleIds],
    grokAgentStems: [...base.grokAgentStems],
    codexAgentStems: base.codexAgentStems ? [...base.codexAgentStems] : null,
    agentsMdText: base.agentsMdText,
  };

  switch (kind) {
    case "parity":
      clone.grokAgentStems = clone.grokAgentStems.filter((s) => s !== "architect");
      break;
    case "sandbox": {
      const target = clone.manifest.roles.find((r) => r.sandboxMode === "read-only");
      if (target) {
        // Force invalid sandbox string via cast — simulates corrupt manifest
        (target as { sandboxMode: CodexSandboxMode }).sandboxMode =
          "danger-full-access" as CodexSandboxMode;
      }
      break;
    }
    case "nesting":
      clone.manifest = { ...clone.manifest, maxNestingDepth: 2 as 1 };
      break;
    case "agents_md_token":
      clone.agentsMdText = `${clone.agentsMdText}\nUse spawn_subagent for everything.\n`;
      break;
    case "vendor_model": {
      const first = clone.manifest.roles[0];
      if (first) {
        (first as { name: string }).name = "deepseek-v4-flash-role";
      }
      break;
    }
    default:
      break;
  }
  return clone;
}
