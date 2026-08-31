import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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
 *    MUST be removed (the second check enforces this — the ratchet only tightens).
 *
 * Scope: hand-written NON-TEST TypeScript source under the two zones below. Test files,
 * generated code, dist, and public assets are excluded.
 */

// ── Default zone budgets ────────────────────────────────────────────────────

export const ZONE_BUDGETS: readonly { prefix: string; maxLines: number }[] = [
  { prefix: "packages/openclinxr/", maxLines: 500 },
  { prefix: "apps/", maxLines: 600 },
] as const;

// ── Default brownfield freeze list ───────────────────────────────────────────
/**
 * Brownfield freeze list — current over-budget offenders grandfathered at their present
 * line count. Ordered by size (biggest = highest-priority paydown). Ceilings can only be
 * LOWERED. Do not add new entries to widen the gate; split the file instead.
 */
export const SIZE_FREEZE: Record<string, { maxLines: number; reason: string }> = {
  "apps/ui-xr/src/main.ts": { maxLines: 9980, reason: "XR runtime god-file — #1 paydown; split by subsystem (scene, input, locomotion, capture, HUD); #57 exam-form boot extract; #44 station-environment extract; #72 actor-floor-composition + encounter-actor-framing extract; #83 physics-touch apply extract + seated posture; #115 station-context + station-vitals extract (honest unauthored vitals)" },
  "apps/ui-xr/src/runtime-state.ts": { maxLines: 3741, reason: "XR runtime-state god-file — split by state slice; #57 compact snapshot options" },
  "apps/api/src/api-route-support.ts": { maxLines: 1124, reason: "shared route-level helpers extracted from app.ts during the composition-root migration — split by domain alongside the remaining route modules" },
  "packages/openclinxr/asset-registry/src/index.ts": { maxLines: 2843, reason: "barrel god-file — split registry/query/store concerns; #44 spatial zones extract" },
  "packages/openclinxr/scenario-fixtures/src/scenario-bank-maturity.ts": { maxLines: 822, reason: "residual: maturity/exam-sequence/factory-planning analytics — split report builders by projection next (bank arrays + 11 scenarios + builders already extracted)" },
  "packages/openclinxr/arena/iwsdk-spike/src/index.ts": { maxLines: 2398, reason: "arena spike barrel — split by concern" },
  "packages/openclinxr/capability-gateway/src/asset-generation-jobs.ts": { maxLines: 2107, reason: "job orchestration — split by job kind" },
  "apps/ui-admin/src/api-client-types.ts": { maxLines: 1410, reason: "residual: admin DTO type surface (generated-adjacent) — split by domain area next; fetch client extracted to api-client.ts (586, under budget)" },
  "packages/openclinxr/asset-registry/src/runtime-bundles.ts": { maxLines: 1638, reason: "bundle builder — split builder/validate/shape" },
  "apps/ui-admin/src/App.tsx": { maxLines: 1604, reason: "admin shell — extract panels/containers; #57 QueueReviewSnapshotHistory extract" },
  "apps/arena/ui-xr-iwsdk-spike/src/main.ts": { maxLines: 1456, reason: "arena spike entry — split by subsystem" },
  "packages/openclinxr/scenario-runtime/src/scenario-runtime.ts": { maxLines: 806, reason: "ScenarioRuntime orchestration class — extracted from the former 1162-line index.ts; decompose the class methods next" },
  "apps/api/src/api-bootstrap.ts": { maxLines: 908, reason: "bootstrap wiring — split by subsystem registration" },
  "apps/arena/model-vetting-studio/src/candidate-capture.ts": { maxLines: 770, reason: "capture pipeline — split views/geometry/url; residual render path" },
  "apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx": { maxLines: 655, reason: "large admin panel — readiness summaries extracted to environment-queue-readiness-summaries.ts" },
  "packages/openclinxr/arena/model-vetting/src/logic.ts": { maxLines: 534, reason: "residual: model-vetting report build + validators (interleaved exported/internal) — split validators next; types extracted" },
  "apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.tsx": { maxLines: 682, reason: "large panel — extract sub-sections/containers" },
  "apps/ui-admin/src/CaseAuthoringWorkbench.tsx": { maxLines: 673, reason: "large authoring panel — extract form sections (pure data helpers moved to case-authoring-io.ts)" },
  "packages/openclinxr/agent-loop/src/grok-tier-routing.ts": { maxLines: 607, reason: "tier routing — split table/logic" },
  "packages/openclinxr/arena/model-vetting/src/pipeline-candidate.ts": { maxLines: 581, reason: "pipeline — split stages" },
  "packages/openclinxr/arena/physics-touch-contract/src/adapters/jolt.ts": { maxLines: 502, reason: "adapter — near budget; trim on next touch" },
};

// ── Config type ─────────────────────────────────────────────────────────────

export type FileSizeBudgetConfig = {
  zoneBudgets?: readonly { prefix: string; maxLines: number }[];
  sizeFreeze?: Record<string, { maxLines: number; reason: string }>;
  workspaceRoot?: string;
  /**
   * When supplied, the per-file budget check measures ONLY these repo-relative paths
   * (the commit's staged set). A commit is answerable for what it changes; a peer's
   * uncommitted WIP elsewhere in the shared working tree must not block it (#361).
   * Absent, the sweep stays global (CI / manual runs). The freeze-list honesty sweep
   * ignores this field and always stays global.
   */
  stagedFiles?: string[];
};

// ── Private helpers ─────────────────────────────────────────────────────────

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

/**
 * Line count of a path at HEAD. The freeze list is validated against COMMITTED
 * content, not the working tree: uncommitted WIP in a shared checkout must not
 * fabricate "ceiling below actual — impossible" or premature "paid down" flags
 * (#361). Non-git trees (synthetic test fixtures) fall back to the working tree.
 */
function readCommittedLines(root: string, rel: string): number | undefined {
  try {
    const out = execFileSync("git", ["show", `HEAD:${rel}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split(/\r?\n/).length;
  } catch {
    return undefined;
  }
}

/**
 * Line count of a path at the INDEX (`git add` state) — the content a commit
 * actually carries. A staged path with further unstaged edits must be measured
 * at the index version, or the gate answers "is my working tree over budget"
 * instead of "does THIS COMMIT put a file over budget" in both directions:
 * unstaged WIP on a staged file would block a commit that does not carry it,
 * and a working tree trimmed after staging would hide growth the commit does
 * carry (#361). Non-git trees (synthetic test fixtures) fall back to the
 * working tree.
 */
function readIndexLines(root: string, rel: string): number | undefined {
  try {
    const out = execFileSync("git", ["show", `:0:${rel}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split(/\r?\n/).length;
  } catch {
    return undefined;
  }
}

function zoneBudgetFor(
  rel: string,
  zoneBudgets: readonly { prefix: string; maxLines: number }[],
): number | undefined {
  return zoneBudgets.find((z) => rel.startsWith(z.prefix))?.maxLines;
}

// ── Public check functions (pure — no vitest) ───────────────────────────────

/**
 * Rule (a): every hand-written source file must be within its zone budget
 * or its (shrink-only) freeze ceiling.
 *
 * Scoped when `config.stagedFiles` is supplied: only those paths are measured, so a
 * commit is answerable for what it changes. Without a staged set the sweep stays
 * global — the freeze ratchet must still see over-budget files nobody is touching.
 */
export function checkFileSizeBudgets(config?: FileSizeBudgetConfig): string[] {
  const root = config?.workspaceRoot ?? findWorkspaceRoot();
  const zoneBudgets = config?.zoneBudgets ?? ZONE_BUDGETS;
  const sizeFreeze = config?.sizeFreeze ?? SIZE_FREEZE;

  const violations: string[] = [];
  const reportIfOver = (rel: string, linesOverride?: number): void => {
    const zoneBudget = zoneBudgetFor(rel, zoneBudgets);
    if (zoneBudget === undefined) return;
    const lines = linesOverride ?? countLines(root, rel);
    const frozen = sizeFreeze[rel];
    const ceiling = frozen ? frozen.maxLines : zoneBudget;
    if (lines > ceiling) {
      violations.push(
        frozen
          ? `${rel}: ${lines} lines > frozen ceiling ${ceiling} (freeze ceilings may only shrink — split the file; do NOT raise the ceiling). ${frozen.reason}`
          : `${rel}: ${lines} lines > zone budget ${zoneBudget}. Split into smaller modules (new files must be <= budget). Grandfathering is only for pre-existing files.`,
      );
    }
  };

  if (config?.stagedFiles !== undefined) {
    for (const rel of config.stagedFiles) {
      if (!/\.(ts|tsx)$/u.test(rel)) continue;
      if (SKIP.test(rel)) continue;
      try {
        // Measure the INDEX version (what this commit carries), not the working
        // tree — a staged file with further unstaged edits must not be judged by
        // WIP that is not part of the commit, nor hide growth that is. Non-git
        // fixtures fall back to the working tree (#361).
        reportIfOver(rel, readIndexLines(root, rel) ?? countLines(root, rel));
      } catch {
        // Staged path missing from the working tree (e.g. renamed/deleted) — nothing to measure.
      }
    }
    return violations;
  }

  for (const rel of listSourceFiles(root)) reportIfOver(rel);
  return violations;
}

/**
 * Rule (b): the freeze list must stay honest — every entry must still exist
 * AND still be over its zone budget (otherwise remove the entry).
 */
export function checkFreezeListHonesty(config?: FileSizeBudgetConfig): string[] {
  const root = config?.workspaceRoot ?? findWorkspaceRoot();
  const zoneBudgets = config?.zoneBudgets ?? ZONE_BUDGETS;
  const sizeFreeze = config?.sizeFreeze ?? SIZE_FREEZE;

  const stale: string[] = [];
  for (const [rel, entry] of Object.entries(sizeFreeze)) {
    const zoneBudget = zoneBudgetFor(rel, zoneBudgets);
    if (zoneBudget === undefined) {
      stale.push(`${rel}: not in any budgeted zone — remove freeze entry`);
      continue;
    }
    let lines: number;
    // MEASURE THE COMMIT, THEN HEAD (2026-08-31). This check read HEAD only, which cannot see the
    // repair it demands: once a frozen file grows, HEAD holds the violation, so the extraction that
    // brings it back under its ceiling is REJECTED by the same gate that requires it. Measured on
    // CaseAuthoringWorkbench.tsx — staged at 672 against a 679 ceiling, reported as 718 from HEAD —
    // and the only escape was a second hook bypass, i.e. the gate forced the mechanism it exists to
    // prevent.
    //
    // The index is preferred because it IS the commit, which is the same reasoning readIndexLines
    // already carries for checkFileSizeBudgets (:211). HEAD remains the fallback, so #361 still
    // holds: an UNSTAGED working-tree edit in a shared checkout is invisible here and cannot
    // fabricate an "impossible ceiling" or a premature "paid down". Growth still fails — a staged
    // file that grows past its ceiling is measured at the index and reported.
    const committed = readIndexLines(root, rel) ?? readCommittedLines(root, rel);
    if (committed !== undefined) {
      lines = committed;
    } else {
      try {
        lines = countLines(root, rel);
      } catch {
        stale.push(`${rel}: file no longer exists — remove freeze entry`);
        continue;
      }
    }
    if (lines <= zoneBudget) {
      stale.push(`${rel}: now ${lines} lines <= zone budget ${zoneBudget} — remove freeze entry (paid down! ratchet must tighten)`);
    }
    if (entry.maxLines < lines) {
      stale.push(`${rel}: freeze ceiling ${entry.maxLines} is below actual ${lines} — impossible (ceilings only shrink as files shrink)`);
    }
  }
  return stale;
}
