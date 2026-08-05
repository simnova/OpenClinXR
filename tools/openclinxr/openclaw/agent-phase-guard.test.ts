/**
 * Tests for agent-phase-guard — pure evaluation + state file round-trip.
 *
 * Run: pnpm test:tools   (vitest run tools/**\/*.test.ts)
 *   or: pnpm exec tsx --test tools/openclinxr/openclaw/agent-phase-guard.test.ts
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  evaluateOrchestratorAction,
  classifyAction,
  readPhase,
  writePhase,
} from "./agent-phase-guard.js";
import type { AgentPhase, ActionInput, GuardVerdict } from "./agent-phase-guard.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAction(toolName: string, filePath?: string): ActionInput {
  return { toolName, filePath };
}

function setupTempRepo(): string {
  const dir = path.join(tmpdir(), `agent-phase-guard-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function teardownTempRepo(repoRoot: string): void {
  try {
    rmSync(repoRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

// ---------------------------------------------------------------------------
// classifyAction
// ---------------------------------------------------------------------------

describe("classifyAction", () => {
  it("classifies delegation tools", () => {
    expect(classifyAction(makeAction("spawn_subagent"))).toBe("delegation");
    expect(classifyAction(makeAction("Task"))).toBe("delegation");
    expect(classifyAction(makeAction("workflow"))).toBe("delegation");
    expect(classifyAction(makeAction("todo_write"))).toBe("delegation");
  });

  it("classifies direct edit tools as direct_edit when targeting product paths", () => {
    expect(classifyAction(makeAction("search_replace", "packages/cellix/src/foo.ts"))).toBe("direct_edit");
    expect(classifyAction(makeAction("write", "apps/ui-xr/main.ts"))).toBe("direct_edit");
    expect(classifyAction(makeAction("Edit", "packages/openclinxr/domain/index.ts"))).toBe("direct_edit");
  });

  it("classifies direct edit tools as coordination when targeting coordination paths", () => {
    expect(classifyAction(makeAction("search_replace", "PROJECT_STATUS.md"))).toBe("coordination");
    expect(classifyAction(makeAction("write", "docs/openclinxr/worker-backlog-and-validation-matrix.md"))).toBe("coordination");
    expect(classifyAction(makeAction("search_replace", ".openclinxr/openclaw/board-agent-phase-guard-hook-v1.json"))).toBe("coordination");
    expect(classifyAction(makeAction("write", ".openclinxr/slices/some-slice/brief.json"))).toBe("coordination");
  });

  it("classifies file-less write as direct_edit (conservative)", () => {
    expect(classifyAction(makeAction("write"))).toBe("direct_edit");
    expect(classifyAction(makeAction("search_replace"))).toBe("direct_edit");
  });

  it("classifies read-only tools", () => {
    expect(classifyAction(makeAction("read_file"))).toBe("read_only");
    expect(classifyAction(makeAction("grep"))).toBe("read_only");
    expect(classifyAction(makeAction("list_dir"))).toBe("read_only");
    expect(classifyAction(makeAction("lsp"))).toBe("read_only");
  });
});

// ---------------------------------------------------------------------------
// evaluateOrchestratorAction — core logic
// ---------------------------------------------------------------------------

describe("evaluateOrchestratorAction", () => {
  // ---------- fail-open on unknown / corrupt phase ----------

  it("allows on unknown phase string (fail-open)", () => {
    const v = evaluateOrchestratorAction("garbage", makeAction("write", "packages/foo.ts"));
    expect(v.verdict).toBe("allow");
  });

  it("allows on empty phase string (fail-open)", () => {
    const v = evaluateOrchestratorAction("", makeAction("write", "packages/foo.ts"));
    expect(v.verdict).toBe("allow");
  });

  // ---------- idle phase ----------

  it("allows direct edit when phase is idle", () => {
    const v = evaluateOrchestratorAction("idle", makeAction("write", "packages/foo.ts"));
    expect(v.verdict).toBe("allow");
  });

  it("allows delegation when phase is idle", () => {
    const v = evaluateOrchestratorAction("idle", makeAction("spawn_subagent"));
    expect(v.verdict).toBe("allow");
  });

  // ---------- delegating phase ----------

  it("allows delegation tools when phase is delegating", () => {
    const v = evaluateOrchestratorAction("delegating", makeAction("spawn_subagent"));
    expect(v.verdict).toBe("allow");
  });

  it("WARNS on direct source edit when phase is delegating", () => {
    const v = evaluateOrchestratorAction("delegating", makeAction("search_replace", "packages/cellix/foo.ts"));
    expect(v.verdict).toBe("warn");
    expect(v.reason).toContain("delegating");
    expect(v.reason).toContain("search_replace");
  });

  it("recovery string names the next action (delegating → spawn-spec)", () => {
    const v = evaluateOrchestratorAction("delegating", makeAction("write", "apps/ui-xr/main.ts"));
    expect(v.verdict).toBe("warn");
    expect(v.recovery).toBeDefined();
    expect(v.recovery!).toContain("pnpm grok:agent:spawn-spec --role");
    expect(v.recovery!).toContain("Delegate to a worker");
  });

  it("allows coordination-path edits when phase is delegating", () => {
    const v = evaluateOrchestratorAction("delegating", makeAction("search_replace", "PROJECT_STATUS.md"));
    expect(v.verdict).toBe("allow");
  });

  // ---------- integrating phase ----------

  it("WARNS on direct source edit when phase is integrating", () => {
    const v = evaluateOrchestratorAction("integrating", makeAction("write", "packages/openclinxr/foo.ts"));
    expect(v.verdict).toBe("warn");
    expect(v.reason).toContain("integrating");
  });

  it("recovery string names the next action (integrating → spawn-spec)", () => {
    const v = evaluateOrchestratorAction("integrating", makeAction("write", "apps/ui-xr/main.ts"));
    expect(v.verdict).toBe("warn");
    expect(v.recovery).toBeDefined();
    expect(v.recovery!).toContain("pnpm grok:agent:spawn-spec --role");
  });

  it("allows coordination-path edits when phase is integrating", () => {
    const v = evaluateOrchestratorAction("integrating", makeAction("search_replace", "PROJECT_STATUS.md"));
    expect(v.verdict).toBe("allow");
  });

  // ---------- unknown tool → allow ----------

  it("allows unknown tool names in any phase (fail-open)", () => {
    expect(evaluateOrchestratorAction("delegating", makeAction("some_future_tool")).verdict).toBe("allow");
    expect(evaluateOrchestratorAction("integrating", makeAction("some_future_tool")).verdict).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// State file round-trip (integration with real filesystem)
// ---------------------------------------------------------------------------

describe("phase state file I/O", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = setupTempRepo();
  });

  afterEach(() => {
    teardownTempRepo(repoRoot);
  });

  it("returns idle when state file does not exist (fail-open)", () => {
    expect(readPhase(repoRoot)).toBe("idle");
  });

  it("returns idle when state file is corrupt JSON (fail-open)", () => {
    const statePath = path.join(repoRoot, ".openclinxr/openclaw/agent-phase-state.json");
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, "not json at all {{{", "utf8");
    expect(readPhase(repoRoot)).toBe("idle");
  });

  it("returns idle when state file has unknown phase (fail-open)", () => {
    writePhase(repoRoot, "delegating");
    // Corrupt the file manually
    const statePath = path.join(repoRoot, ".openclinxr/openclaw/agent-phase-state.json");
    writeFileSync(statePath, JSON.stringify({ phase: "bogus", updatedAt: new Date().toISOString() }), "utf8");
    expect(readPhase(repoRoot)).toBe("idle");
  });

  it("round-trips all valid phases through the file (write → read)", () => {
    const phases: AgentPhase[] = ["idle", "delegating", "integrating"];
    for (const phase of phases) {
      writePhase(repoRoot, phase);
      expect(readPhase(repoRoot)).toBe(phase);
    }
  });

  it("writePhase creates parent directories automatically", () => {
    // repoRoot is fresh — no .openclinxr dir yet
    writePhase(repoRoot, "delegating");
    const statePath = path.join(repoRoot, ".openclinxr/openclaw/agent-phase-state.json");
    expect(existsSync(statePath)).toBe(true);
    expect(readPhase(repoRoot)).toBe("delegating");
  });
});
