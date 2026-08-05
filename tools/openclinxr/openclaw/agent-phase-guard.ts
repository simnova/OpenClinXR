/**
 * Orchestrator phase guard — detect + warn, NOT hard-block.
 *
 * FAIL-OPEN by design: any unknown phase, missing/corrupt state file, or parse
 * error → { verdict: "allow" }.  This is a productivity guardrail, NOT a
 * security control.  It must never strand the operator or break unattended
 * automation.
 *
 * State lives on disk at `.openclinxr/openclaw/agent-phase-state.json` so it
 * survives context compaction and process death.  No in-memory cache.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Orchestrator work phase (persisted to disk). */
export type AgentPhase = "idle" | "delegating" | "integrating";

/** Tool-category classification computed from the action. */
export type ActionCategory = "delegation" | "direct_edit" | "coordination" | "read_only" | "unknown";

/** Verdict returned by the guard evaluation (pure — no side effects). */
export interface GuardVerdict {
  verdict: "allow" | "warn";
  reason?: string;
  /** Concrete NEXT ACTION the orchestrator should take (not merely "don't do that"). */
  recovery?: string;
}

/** Input the hook supplies about the attempted action. */
export interface ActionInput {
  /** Tool name as the harness reports it (e.g. "search_replace", "write", "Bash"). */
  toolName: string;
  /** Optional first file path argument if the tool exposes one. */
  filePath?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_RELATIVE_PATH = ".openclinxr/openclaw/agent-phase-state.json";

/** Tool names the orchestrator uses to delegate work. */
const DELEGATION_TOOLS = new Set([
  "spawn_subagent",
  "Task",               // Cursor Task
  "workflow",
  "todo_write",
  "monitor",
  "scheduler_create",
]);

/** Tool names that directly mutate source files. */
const DIRECT_EDIT_TOOLS = new Set([
  "search_replace",
  "write",
  "Edit",               // legacy / alias
]);

/** Coordination files the orchestrator is allowed to touch in any phase. */
const COORDINATION_PATHS = [
  "PROJECT_STATUS.md",
  "docs/openclinxr/worker-backlog-and-validation-matrix.md",
  "operator-steering-needed-questions.md",
  "operator-open-questions.md",
  "operator-suggestion-backlog.md",
  ".openclinxr/openclaw/",
  ".openclinxr/slices/",
  "docs/agent-ops/",
];

/** Product source roots the orchestrator must delegate (CEO write roots only). */
const PRODUCT_ROOTS = ["packages/", "apps/"];

// ---------------------------------------------------------------------------
// Pure evaluation (no I/O — testable in isolation)
// ---------------------------------------------------------------------------

/**
 * Classify the action category from tool name + optional file path.
 * Pure — no disk access.
 */
export function classifyAction(input: ActionInput): ActionCategory {
  if (DELEGATION_TOOLS.has(input.toolName)) return "delegation";
  if (DIRECT_EDIT_TOOLS.has(input.toolName)) {
    // If the edit targets a coordination file, treat it as coordination.
    if (input.filePath && isCoordinationPath(input.filePath)) return "coordination";
    // If the edit targets product source, treat it as direct_edit.
    if (input.filePath && isProductPath(input.filePath)) return "direct_edit";
    // Ambiguous file-less write → direct_edit (conservative).
    if (!input.filePath) return "direct_edit";
    // Fall-through: named path not in product roots → allow.
    return "unknown";
  }
  // Bash / run_terminal_command — check if the command touches product sources.
  if (input.toolName === "Bash" || input.toolName === "run_terminal_command") {
    if (input.filePath && isProductPath(input.filePath)) return "direct_edit";
    return "unknown";
  }
  // read_file, grep, list_dir, lsp, etc. — always safe.
  return "read_only";
}

function isCoordinationPath(filePath: string): boolean {
  return COORDINATION_PATHS.some((p) => filePath.startsWith(p));
}

function isProductPath(filePath: string): boolean {
  return PRODUCT_ROOTS.some((r) => filePath.startsWith(r));
}

/**
 * Evaluate whether the orchestrator may perform `action` while in `phase`.
 * Pure — no disk access, no side effects.  Always fails open.
 */
export function evaluateOrchestratorAction(
  phase: AgentPhase | string,
  action: ActionInput,
): GuardVerdict {
  const cat = classifyAction(action);

  // Unknown / corrupted phase → allow (fail-open)
  if (!isKnownPhase(phase)) return { verdict: "allow" };

  const p = phase as AgentPhase;

  // idle → everything is allowed (no active delegation cycle)
  if (p === "idle") return { verdict: "allow" };

  // Read-only, coordination, or unknown categories → always allowed
  if (cat === "read_only" || cat === "coordination" || cat === "unknown") {
    return { verdict: "allow" };
  }

  // Delegation tools → always allowed (that's the goal)
  if (cat === "delegation") return { verdict: "allow" };

  // ---------- direct_edit while delegating or integrating ----------
  if (cat === "direct_edit") {
    const recovery = buildRecovery(p);
    if (p === "delegating") {
      return {
        verdict: "warn",
        reason: `Direct source edit (${action.toolName}) while phase is "delegating" — orchestrator should delegate implementation, not perform it.`,
        recovery,
      };
    }
    if (p === "integrating") {
      return {
        verdict: "warn",
        reason: `Direct source edit (${action.toolName}) while phase is "integrating" — orchestrator should only update coordination files (PROJECT_STATUS.md, worker-backlog) in this phase.`,
        recovery,
      };
    }
  }

  // Fallback — allow (fail-open)
  return { verdict: "allow" };
}

function isKnownPhase(phase: string): phase is AgentPhase {
  return phase === "idle" || phase === "delegating" || phase === "integrating";
}

function buildRecovery(phase: AgentPhase): string {
  if (phase === "delegating") {
    return `Delegate to a worker via: pnpm grok:agent:spawn-spec --role <role> --task "<description>"`;
  }
  // integrating
  return `Only coordination file edits are allowed in "integrating" phase.  Delegate product changes via: pnpm grok:agent:spawn-spec --role <role> --task "<description>"`;
}

// ---------------------------------------------------------------------------
// State file I/O (fails open on every error path)
// ---------------------------------------------------------------------------

const VALID_PHASES: ReadonlySet<string> = new Set(["idle", "delegating", "integrating"]);

interface StatePayload {
  phase: string;
  updatedAt: string;
}

/**
 * Read the current orchestrator phase from disk.
 * Returns "idle" on any error (missing file, corrupt JSON, unknown phase).
 */
export function readPhase(repoRoot: string): AgentPhase {
  const statePath = path.join(repoRoot, STATE_RELATIVE_PATH);
  try {
    if (!existsSync(statePath)) return "idle";
    const raw = readFileSync(statePath, "utf8");
    const payload: StatePayload = JSON.parse(raw);
    if (typeof payload?.phase === "string" && VALID_PHASES.has(payload.phase)) {
      return payload.phase as AgentPhase;
    }
    return "idle";
  } catch {
    // Any I/O or parse error → idle (fail-open)
    return "idle";
  }
}

/**
 * Persist the orchestrator phase to disk.
 * Throws on I/O error (caller should catch).  Does NOT validate — use readPhase
 * to read back what was written.
 */
export function writePhase(repoRoot: string, phase: AgentPhase): void {
  const statePath = path.join(repoRoot, STATE_RELATIVE_PATH);
  mkdirSync(path.dirname(statePath), { recursive: true });
  const payload: StatePayload = {
    phase,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(statePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// CLI entry (called by .grok/hooks/agent-phase-guard.json PreToolUse hook)
// ---------------------------------------------------------------------------

/**
 * CLI contract:
 *   - Reads phase from disk
 *   - Treats the attempted action as a direct source edit (the hook matcher
 *     already filters to file-editing tools)
 *   - Prints warn verdict + recovery to stderr if warn
 *   - Exits 0 always (this is detect-and-warn, not a blocker)
 *   - Inert unless OPENCLINXR_PHASE_GUARD=1
 */
function main(): void {
  if (process.env.OPENCLINXR_PHASE_GUARD !== "1") {
    // Inert by default — no output, no overhead.
    process.exit(0);
  }

  const repoRoot = process.env.OPENCLINXR_REPO_ROOT || process.cwd();

  // Worker / subagent sessions skip the guard entirely.
  if (
    process.env.OPENCLINXR_WORKER === "1" ||
    process.env.OPENCLINXR_WORKER === "true" ||
    process.env.GROK_SUBAGENT !== undefined
  ) {
    process.exit(0);
  }

  const phase = readPhase(repoRoot);
  const action: ActionInput = {
    toolName: process.env.GROK_TOOL_NAME || "unknown",
    filePath: process.env.GROK_TOOL_FILE_PATH || undefined,
  };

  const verdict = evaluateOrchestratorAction(phase, action);

  if (verdict.verdict === "warn") {
    const msg = [
      `[agent-phase-guard] WARN: ${verdict.reason ?? "direct edit while in non-idle phase"}`,
      `Phase: ${phase}`,
      verdict.recovery ? `Next action: ${verdict.recovery}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    process.stderr.write(`${msg}\n`);
  }

  // Always exit 0 — this is a guardrail, not a gate.
  process.exit(0);
}

// Only run CLI when executed directly (not imported for tests).
// Vitest sets VITEST; tsx --test uses node:test which doesn't set it,
// so we also guard against import.meta.url vs process.argv[1].
const isMain =
  process.argv[1]?.includes("agent-phase-guard") &&
  !process.argv[1]?.includes("agent-phase-guard.test");

if (isMain) {
  main();
}
