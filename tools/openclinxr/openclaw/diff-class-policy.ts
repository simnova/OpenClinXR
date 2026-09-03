#!/usr/bin/env tsx
/**
 * Layer 4 merge-safety: diff-class policy.
 *
 * Classifies changed paths by *what they touch* and maps each class to EXISTING
 * runners (pnpm scripts / committed proof binaries). This module never re-encodes
 * architecture-rule predicates (file-size ceilings, markdown references, etc.) —
 * it only selects and requires the checks that already own those predicates.
 *
 * Forbidden classes (protected-policy, coordination-state) produce no required
 * checks: a forbidden path is refused, not checked harder.
 */

import { execFileSync } from "node:child_process";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";

export type DiffClass =
  | "protected-policy"
  | "coordination-state"
  | "freeze-ratchet"
  | "architecture-rule"
  | "harness"
  | "secrets-hooks"
  | "claim-surface"
  | "docs"
  | "product"
  | "other";

/**
 * Severity order, most severe first.
 * Used to reduce a whole diff to one blocking decision (`diffClass`).
 * freeze-ratchet outranks architecture-rule: ceiling-map edits escape every other rule.
 */
export const DIFF_CLASS_SEVERITY: readonly DiffClass[] = [
  "protected-policy",
  "coordination-state",
  "freeze-ratchet",
  "architecture-rule",
  "secrets-hooks",
  "harness",
  "claim-surface",
  "docs",
  "product",
  "other",
] as const;

const SEVERITY_RANK: ReadonlyMap<DiffClass, number> = new Map(
  DIFF_CLASS_SEVERITY.map((c, i) => [c, i]),
);

/**
 * Named protected coordination set from agents/rules/GUARD_BLUEPRINT.md (authoritative list).
 * Do NOT blanket-match every docs/openclinxr/*-2026-05-27.md — only this named set.
 *
 * GUARD_BLUEPRINT lists:
 * - docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md
 * - docs/openclinxr/doc-authority-registry-2026-05-27.md + .json
 * - docs/openclinxr/generated-artifact-registry-2026-05-27.md + .json
 * - docs/openclinxr/openclaw-runbook-2026-05-27.md
 * - docs/openclinxr/openclaw-tool-adapters-2026-05-27.md
 */
export const PROTECTED_POLICY_PATHS: readonly string[] = [
  "AGENTS.md",
  "docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md",
  "docs/openclinxr/doc-authority-registry-2026-05-27.md",
  "docs/openclinxr/doc-authority-registry-2026-05-27.json",
  "docs/openclinxr/generated-artifact-registry-2026-05-27.md",
  "docs/openclinxr/generated-artifact-registry-2026-05-27.json",
  "docs/openclinxr/openclaw-runbook-2026-05-27.md",
  "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md",
] as const;

/** Ceiling-map files — SIZE_FREEZE / broken-reference maps live here. */
const FREEZE_RATCHET_PATHS: readonly string[] = [
  "packages/openclinxr/architecture-rules/src/checks/file-size-budgets.ts",
  "packages/openclinxr/architecture-rules/src/checks/markdown-references.ts",
] as const;

const FORBIDDEN_CLASSES = new Set<DiffClass>(["protected-policy", "coordination-state"]);

export type RequiredCheck = {
  id: string;
  /** The EXISTING runner. A pnpm script or a committed script path — never inline logic. */
  command: string;
  /** Which class demanded it, and which paths triggered it. */
  becauseOf: { class: DiffClass; paths: string[] };
  reason: string;
  /**
   * When true, no committed runner exists yet. Do not invent proof logic here —
   * consumers must treat this as an unmet requirement, not a runnable gate.
   */
  unmet?: boolean;
};

export type DiffClassification = {
  byPath: Record<string, DiffClass>;
  classesPresent: DiffClass[];
  /** Most severe class present — the blocking decision for the diff as a whole. */
  diffClass: DiffClass;
  /** Union of the checks required by the classes actually present. */
  requiredChecks: RequiredCheck[];
  /** Classes present that a delegated worker may not touch at all. */
  forbidden: { path: string; class: DiffClass; reason: string }[];
};

/** Static check table: class → existing runners only. No predicate re-encoding. */
type CheckTemplate = {
  id: string;
  command: string;
  reason: string;
  unmet?: boolean;
};

const CHECKS_FOR_CLASS: Readonly<Partial<Record<DiffClass, readonly CheckTemplate[]>>> = {
  // protected-policy / coordination-state: FORBIDDEN — no checks (refuse, don't re-check).
  "freeze-ratchet": [
    {
      id: "architecture",
      command: "pnpm architecture",
      reason:
        "Ceiling-map edits (SIZE_FREEZE / broken refs) are gated by the architecture suite that owns those maps — not re-implemented here.",
    },
  ],
  "architecture-rule": [
    {
      id: "architecture",
      command: "pnpm architecture",
      reason: "Architecture-rules package changes require the existing architecture suite.",
    },
  ],
  docs: [
    {
      id: "architecture",
      command: "pnpm architecture",
      reason: "Markdown / docs diffs are covered by architecture (markdown-references + related).",
    },
  ],
  "claim-surface": [
    {
      id: "architecture",
      command: "pnpm architecture",
      reason: "Decision/promotion/readiness claim surfaces require architecture (decision-invariants + refs).",
    },
  ],
  product: [
    {
      id: "packages-typecheck",
      command: "pnpm packages:typecheck:agent",
      reason: "Product package diffs require standard package typecheck.",
    },
    {
      id: "packages-test",
      command: "pnpm packages:test:agent",
      reason: "Product package diffs require standard package tests.",
    },
  ],
  harness: [
    {
      id: "test-tools",
      command: "pnpm test:tools",
      reason: "OpenClaw / tools harness unit tests (tools/**/*.test.ts).",
    },
    {
      id: "packages-test",
      command: "pnpm packages:test:agent",
      reason: "agent-loop package tests run under packages:test:agent (existing monorepo runner).",
    },
    {
      id: "harness-isolation-proof",
      // No committed isolation-proof script exists in package.json yet (openclaw:worktree:*
      // is promote/list/status only). Mark unmet rather than inventing a proof here.
      command: "(unmet) isolation proof — no committed runner in package.json yet",
      reason:
        "Harness diffs require an isolation proof (worktree + write-deny). No dedicated isolation-proof script is committed yet.",
      unmet: true,
    },
  ],
  // secrets-hooks: no dedicated existing runner beyond hooks themselves; empty by design.
};

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//u, "").replace(/^\/+/u, "");
}

function isUnder(path: string, prefix: string): boolean {
  const p = normalizePath(path);
  const pre = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return p === prefix.replace(/\/$/u, "") || p.startsWith(pre);
}

function isProtectedPolicyPath(path: string): boolean {
  const p = normalizePath(path);
  if (p.toUpperCase() === "AGENTS.MD") return true;
  if (isUnder(p, "docs/madr")) return true;
  return (PROTECTED_POLICY_PATHS as readonly string[]).some(
    (pp) => pp !== "AGENTS.md" && p === pp,
  );
}

function isCoordinationStatePath(path: string): boolean {
  const p = normalizePath(path);
  if (p === "PROJECT_STATUS.md") return true;
  if (p === "docs/openclinxr/worker-backlog-and-validation-matrix.md") return true;
  // Root operator-*.md only (orchestrator/human plane).
  if (/^operator-[^/]+\.md$/u.test(p)) return true;
  return false;
}

function isFreezeRatchetPath(path: string): boolean {
  const p = normalizePath(path);
  return (FREEZE_RATCHET_PATHS as readonly string[]).includes(p);
}

/**
 * Claim-bearing docs: docs/madr/** is already protected-policy.
 * Additionally: any docs/** path whose basename or segments include decision / promotion / readiness.
 * Conservative — over-matching makes the class meaningless.
 */
function isClaimSurfacePath(path: string): boolean {
  const p = normalizePath(path);
  if (!p.startsWith("docs/")) return false;
  if (isUnder(p, "docs/madr")) return true;
  // Match path segments / filename tokens, not package-level decision-invariants under packages/
  return /(?:^|\/)[^/]*(?:decision|promotion|readiness)[^/]*/iu.test(p);
}

export function classifyPath(path: string): DiffClass {
  const p = normalizePath(path);

  if (isProtectedPolicyPath(p)) return "protected-policy";
  if (isCoordinationStatePath(p)) return "coordination-state";
  if (isFreezeRatchetPath(p)) return "freeze-ratchet";
  if (isUnder(p, "packages/openclinxr/architecture-rules")) return "architecture-rule";
  if (isUnder(p, ".githooks") || isUnder(p, ".husky")) return "secrets-hooks";
  if (isUnder(p, "tools/openclinxr/openclaw") || isUnder(p, "packages/openclinxr/agent-loop")) {
    return "harness";
  }
  if (isClaimSurfacePath(p)) return "claim-surface";
  if (p.endsWith(".md")) return "docs";
  if (isUnder(p, "apps") || isUnder(p, "packages")) return "product";
  return "other";
}

function mostSevere(classes: Iterable<DiffClass>): DiffClass {
  let best: DiffClass = "other";
  let bestRank = SEVERITY_RANK.get("other") ?? Number.MAX_SAFE_INTEGER;
  for (const c of classes) {
    const rank = SEVERITY_RANK.get(c) ?? Number.MAX_SAFE_INTEGER;
    if (rank < bestRank) {
      best = c;
      bestRank = rank;
    }
  }
  return best;
}

function forbiddenReason(cls: DiffClass): string {
  if (cls === "protected-policy") {
    return (
      "policy integrity — protected blueprint-factory guardrails / AGENTS.md / docs/madr; "
      + "delegated workers must not touch (see agents/rules/GUARD_BLUEPRINT.md)"
    );
  }
  if (cls === "coordination-state") {
    return (
      "ownership — orchestrator/human coordination plane (PROJECT_STATUS, operator-*, "
      + "worker-backlog); delegated workers must not write"
    );
  }
  return `forbidden class: ${cls}`;
}

function buildRequiredChecks(
  byPath: Record<string, DiffClass>,
  classesPresent: DiffClass[],
): RequiredCheck[] {
  // id → accumulated check (dedupe same id from multiple classes)
  const byId = new Map<string, RequiredCheck>();

  for (const cls of classesPresent) {
    if (FORBIDDEN_CLASSES.has(cls)) continue;
    const templates = CHECKS_FOR_CLASS[cls];
    if (!templates) continue;

    const pathsForClass = Object.entries(byPath)
      .filter(([, c]) => c === cls)
      .map(([path]) => path)
      .sort();

    for (const t of templates) {
      const existing = byId.get(t.id);
      if (existing) {
        // Merge becauseOf paths; keep first reason; union classes via path lists under same id.
        // Prefer recording both classes: extend paths; if class differs, append class context in paths only.
        if (existing.becauseOf.class === cls) {
          const merged = new Set([...existing.becauseOf.paths, ...pathsForClass]);
          existing.becauseOf.paths = [...merged].sort();
        } else {
          // Same check id from a different class: attach additional class paths under a composite becauseOf
          // by expanding paths with a class-stable merge (keep primary class as first trigger).
          const mergedPaths = new Set([...existing.becauseOf.paths, ...pathsForClass]);
          existing.becauseOf.paths = [...mergedPaths].sort();
          // Note secondary class in reason only if not already mentioned.
          if (!existing.reason.includes(cls)) {
            existing.reason = `${existing.reason} Also required by class ${cls}.`;
          }
        }
        continue;
      }

      byId.set(t.id, {
        id: t.id,
        command: t.command,
        reason: t.reason,
        unmet: t.unmet,
        becauseOf: { class: cls, paths: [...pathsForClass] },
      });
    }
  }

  // Stable order: by first appearance in severity of becauseOf.class, then id.
  return [...byId.values()].sort((a, b) => {
    const ra = SEVERITY_RANK.get(a.becauseOf.class) ?? 99;
    const rb = SEVERITY_RANK.get(b.becauseOf.class) ?? 99;
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });
}

export function classifyDiff(paths: string[]): DiffClassification {
  const byPath: Record<string, DiffClass> = {};
  for (const raw of paths) {
    const p = normalizePath(raw);
    if (!p) continue;
    byPath[p] = classifyPath(p);
  }

  const classSet = new Set<DiffClass>(Object.values(byPath));
  // Severity order for classesPresent
  const classesPresent = DIFF_CLASS_SEVERITY.filter((c) => classSet.has(c));
  const diffClass =
    classesPresent.length === 0 ? ("other" as DiffClass) : mostSevere(classesPresent);

  const forbidden: DiffClassification["forbidden"] = [];
  for (const [path, cls] of Object.entries(byPath)) {
    if (FORBIDDEN_CLASSES.has(cls)) {
      forbidden.push({ path, class: cls, reason: forbiddenReason(cls) });
    }
  }
  forbidden.sort((a, b) => a.path.localeCompare(b.path));

  const requiredChecks = buildRequiredChecks(byPath, classesPresent);

  return {
    byPath,
    classesPresent,
    diffClass,
    requiredChecks,
    forbidden,
  };
}

/** Changed paths for a branch vs a base, via `git diff --name-only <base>...<head>`. */
export function changedPathsForBranch(repoRoot: string, base: string, head: string): string[] {
  const out = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
    cwd: repoRoot,
    encoding: "utf8",
    env: gitEnvWithoutInheritedRepoVars(),
  });
  return out
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(normalizePath);
}

export function formatClassification(c: DiffClassification): string {
  const lines: string[] = [
    "Diff-class policy",
    `  diffClass       ${c.diffClass}`,
    `  classesPresent  ${c.classesPresent.length === 0 ? "(none)" : c.classesPresent.join(", ")}`,
    `  pathCount       ${Object.keys(c.byPath).length}`,
  ];

  if (c.forbidden.length > 0) {
    lines.push("  FORBIDDEN (delegated workers must not touch):");
    for (const f of c.forbidden) {
      lines.push(`    - [${f.class}] ${f.path}`);
      lines.push(`      reason: ${f.reason}`);
    }
  } else {
    lines.push("  forbidden       (none)");
  }

  if (c.requiredChecks.length > 0) {
    lines.push("  requiredChecks:");
    for (const check of c.requiredChecks) {
      const unmetTag = check.unmet ? " [UNMET — no committed runner]" : "";
      lines.push(`    - ${check.id}${unmetTag}`);
      lines.push(`      command: ${check.command}`);
      lines.push(`      because: ${check.becauseOf.class} (${check.becauseOf.paths.length} path(s))`);
      lines.push(`      reason:  ${check.reason}`);
    }
  } else {
    lines.push("  requiredChecks  (none)");
  }

  lines.push("  byPath:");
  for (const path of Object.keys(c.byPath).sort()) {
    lines.push(`    ${path} → ${c.byPath[path]}`);
  }

  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repoRoot = process.cwd();
  const base = process.argv[2] ?? "main";
  const head = process.argv[3] ?? "HEAD";
  const paths = changedPathsForBranch(repoRoot, base, head);
  const classification = classifyDiff(paths);
  console.log(formatClassification(classification));
  process.exit(classification.forbidden.length > 0 ? 2 : 0);
}
