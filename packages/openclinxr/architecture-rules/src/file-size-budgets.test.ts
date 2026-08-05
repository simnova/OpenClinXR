import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * File-size budget fitness rule (ArchUnit-style; "prevent large files").
 *
 * WHY: Large source files mix architecture with feature integration and are hard for
 * BOTH humans and coding agents to work in — a 1000+ line file exhausts a bounded
 * worker's turns on *reading* before it can safely edit (observed 2026-08-04 on the
 * 1163-line scenario-runtime/src/index.ts). Capping file size forces the arch↔feature
 * split to happen incrementally: new behavior lands in new small modules, not appended
 * to a god-file.
 *
 * Adapted from atlantis-cameras-v2 `packages/icd-verification/archunit-tests/src/
 * file-structure.test.ts` (per-zone LOC budgets + a freeze ratchet).
 *
 * RATCHET SEMANTICS:
 *  - New / unfrozen source files must be <= their zone budget (a hard cap).
 *  - Existing over-budget files are grandfathered in SIZE_FREEZE at their CURRENT line
 *    count — the ceiling. They may only SHRINK; any growth fails the gate, forcing
 *    extraction. When a frozen file drops to/below its zone budget, its freeze entry
 *    MUST be removed (the second test enforces this — the ratchet only tightens).
 *
 * Scope: hand-written NON-TEST TypeScript source under the two zones below. Test files,
 * generated code, dist, and public assets are excluded.
 */

const ZONE_BUDGETS: readonly { prefix: string; maxLines: number }[] = [
  { prefix: "packages/openclinxr/", maxLines: 500 },
  { prefix: "apps/", maxLines: 600 },
] as const;

/**
 * Brownfield freeze list — current over-budget offenders grandfathered at their present
 * line count. Ordered by size (biggest = highest-priority paydown). Ceilings can only be
 * LOWERED. Do not add new entries to widen the gate; split the file instead.
 */
const SIZE_FREEZE: Record<string, { maxLines: number; reason: string }> = {
  "apps/ui-xr/src/main.ts": { maxLines: 10255, reason: "XR runtime god-file — #1 paydown; split by subsystem (scene, input, locomotion, capture, HUD)" },
  "apps/ui-xr/src/runtime-state.ts": { maxLines: 3743, reason: "XR runtime-state god-file — split by state slice" },
  "apps/api/src/app.ts": { maxLines: 3282, reason: "API composition god-file — split into per-route modules registered by the app root" },
  "packages/openclinxr/asset-registry/src/index.ts": { maxLines: 2887, reason: "barrel god-file — split registry/query/store concerns" },
  "packages/openclinxr/scenario-fixtures/src/scenario-bank.ts": { maxLines: 920, reason: "residual: scenario-bank maturity/exam-sequence analytics — extract to scenario-bank-maturity.ts next (11 scenarios + builders already extracted to own files)" },
  "packages/openclinxr/arena/iwsdk-spike/src/index.ts": { maxLines: 2398, reason: "arena spike barrel — split by concern" },
  "packages/openclinxr/capability-gateway/src/asset-generation-jobs.ts": { maxLines: 2107, reason: "job orchestration — split by job kind" },
  "apps/ui-admin/src/api-client.ts": { maxLines: 1876, reason: "generated-adjacent DTO+client — split DTO types from the fetch client" },
  "packages/openclinxr/asset-registry/src/runtime-bundles.ts": { maxLines: 1638, reason: "bundle builder — split builder/validate/shape" },
  "apps/ui-admin/src/App.tsx": { maxLines: 1631, reason: "admin shell — extract panels/containers" },
  "packages/openclinxr/session-state/src/index.ts": { maxLines: 1606, reason: "session-state barrel — split by aggregate" },
  "apps/arena/ui-xr-iwsdk-spike/src/main.ts": { maxLines: 1456, reason: "arena spike entry — split by subsystem" },
  "packages/openclinxr/agent-loop/src/index.ts": { maxLines: 1306, reason: "agent-loop barrel — split by phase" },
  "packages/openclinxr/scenario-runtime/src/scenario-runtime.ts": { maxLines: 806, reason: "ScenarioRuntime orchestration class — extracted from the former 1162-line index.ts; decompose the class methods next" },
  "packages/openclinxr/agent-loop/src/role-harness-policy.ts": { maxLines: 950, reason: "policy tables — split data from logic" },
  "packages/openclinxr/arena/multi-actor-state-spike/src/index.ts": { maxLines: 930, reason: "arena spike barrel — split by concern" },
  "packages/openclinxr/capability-gateway/src/index.ts": { maxLines: 928, reason: "gateway barrel — split routing/matrix/facade" },
  "apps/api/src/api-bootstrap.ts": { maxLines: 908, reason: "bootstrap wiring — split by subsystem registration" },
  "apps/arena/model-vetting-studio/src/candidate-capture.ts": { maxLines: 785, reason: "capture pipeline — split capture/report" },
  "packages/openclinxr/arena/model-vetting/src/index.ts": { maxLines: 772, reason: "model-vetting barrel — split by concern" },
  "packages/openclinxr/voice-gateway/src/index.ts": { maxLines: 742, reason: "voice-gateway barrel — split adapter/gateway" },
  "packages/openclinxr/exam-assembly/src/index.ts": { maxLines: 715, reason: "exam-assembly barrel — split assembly steps" },
  "apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.tsx": { maxLines: 682, reason: "large panel — extract sub-sections/containers" },
  "apps/ui-admin/src/CaseAuthoringWorkbench.tsx": { maxLines: 679, reason: "large authoring panel — extract form sections" },
  "packages/openclinxr/agent-loop/src/grok-tier-routing.ts": { maxLines: 607, reason: "tier routing — split table/logic" },
  "packages/openclinxr/agent-loop/src/slice-team.ts": { maxLines: 594, reason: "slice-team orchestration — split by step" },
  "packages/openclinxr/shared-schemas/src/schemas.ts": { maxLines: 594, reason: "schema barrel — split by domain area" },
  "packages/openclinxr/arena/model-vetting/src/pipeline-candidate.ts": { maxLines: 581, reason: "pipeline — split stages" },
  "packages/openclinxr/arena/physics-touch-contract/src/metrics/measure.ts": { maxLines: 561, reason: "metrics — split by metric" },
  "packages/openclinxr/agent-loop/src/grok-repo-agent-spawn.ts": { maxLines: 551, reason: "spawn prompt builder — split prompt/flags" },
  "packages/openclinxr/arena/physics-touch-contract/src/adapters/jolt.ts": { maxLines: 502, reason: "adapter — near budget; trim on next touch" },
};

const SKIP =
  /node_modules|[/\\](dist|generated|public|scratch)[/\\]|\.test\.|\.spec\.|\.gen\.|\.d\.ts$|codegen|tsbuildinfo/;

function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    try {
      readFileSync(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!/node_modules$|[/\\]dist$|[/\\]generated$|[/\\]public$|[/\\]scratch$/.test(full)) walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const rel = relative(root, full);
        if (!SKIP.test(rel)) out.push(rel);
      }
    }
  };
  for (const zoneDir of ["packages", "apps"]) walk(join(root, zoneDir));
  return out;
}

function countLines(root: string, rel: string): number {
  return readFileSync(join(root, rel), "utf8").split(/\r?\n/).length;
}

function zoneBudgetFor(rel: string): number | undefined {
  return ZONE_BUDGETS.find((z) => rel.startsWith(z.prefix))?.maxLines;
}

const workspaceRoot = findWorkspaceRoot();

describe("file-size budgets (prevent large files)", () => {
  it("keeps every hand-written source file within its zone budget or its (shrink-only) freeze ceiling", () => {
    const violations: string[] = [];
    for (const rel of listSourceFiles(workspaceRoot)) {
      const zoneBudget = zoneBudgetFor(rel);
      if (zoneBudget === undefined) continue;
      const lines = countLines(workspaceRoot, rel);
      const frozen = SIZE_FREEZE[rel];
      const ceiling = frozen ? frozen.maxLines : zoneBudget;
      if (lines > ceiling) {
        violations.push(
          frozen
            ? `${rel}: ${lines} lines > frozen ceiling ${ceiling} (freeze ceilings may only shrink — split the file; do NOT raise the ceiling). ${frozen.reason}`
            : `${rel}: ${lines} lines > zone budget ${zoneBudget}. Split into smaller modules (new files must be <= budget). Grandfathering is only for pre-existing files.`,
        );
      }
    }
    expect(violations, `File-size budget violations:\n${violations.join("\n")}`).toEqual([]);
  });

  it("keeps the freeze list honest — every entry still exists and is still over its zone budget (else remove it)", () => {
    const stale: string[] = [];
    for (const [rel, entry] of Object.entries(SIZE_FREEZE)) {
      const zoneBudget = zoneBudgetFor(rel);
      if (zoneBudget === undefined) {
        stale.push(`${rel}: not in any budgeted zone — remove freeze entry`);
        continue;
      }
      let lines: number;
      try {
        lines = countLines(workspaceRoot, rel);
      } catch {
        stale.push(`${rel}: file no longer exists — remove freeze entry`);
        continue;
      }
      if (lines <= zoneBudget) {
        stale.push(`${rel}: now ${lines} lines <= zone budget ${zoneBudget} — remove freeze entry (paid down! ratchet must tighten)`);
      }
      if (entry.maxLines < lines) {
        stale.push(`${rel}: freeze ceiling ${entry.maxLines} is below actual ${lines} — impossible (ceilings only shrink as files shrink)`);
      }
    }
    expect(stale, `Stale freeze entries:\n${stale.join("\n")}`).toEqual([]);
  });
});
