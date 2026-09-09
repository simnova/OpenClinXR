import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";

/**
 * Composition-root conventions (ArchUnit-style; "the apps are composition roots").
 *
 * WHY: apps/ hold the product rather than wiring it — apps/api 41 files / 10,106
 * lines, apps/ui-admin 40 / 11,941, apps/ui-xr 101 / 33,795, against a CellixJs
 * reference whose largest app is 1,506 lines and whose apps/api/src/index.ts only
 * registers infrastructure services and sets context. Every behaviour belongs in
 * packages/**; an app module may only compose, boot, and expose what a package
 * built. Three defects follow, and this file gates all three:
 *
 *  (a) SIZE. Nothing stops an app growing. The budget table below is frozen at the
 *      CURRENT measurement — the ceiling, not a target. New behaviour lands in a
 *      package; the budgets only shrink.
 *  (b) VALIDATION MIXED WITH FUNCTIONALITY. Validator functions (parse…/validate…/
 *      assert…/is…) exported alongside other exports from an app module mean the
 *      composition root owns domain rules. New app modules must keep validators in
 *      packages or in validator-only modules; the 31 current mixers are frozen and
 *      may only be split.
 *  (c) NAMING. Composition roots are shared wiring — file names stay lower
 *      kebab-case so agents and humans find entry points without guessing.
 *
 * RATCHET SEMANTICS (same as checks/file-size-budgets.ts):
 *  - New code is held to the hard rule (under budget, separated, kebab-case).
 *  - Existing offenders are grandfathered in COMPOSITION_ROOT_APP_BUDGETS /
 *    VALIDATION_SEPARATION_FREEZE at their CURRENT measurement. Ceilings can only
 *    be LOWERED. Do not add entries to widen the gate; move the code instead.
 */

// ── App source budgets (frozen ceiling) ─────────────────────────────────────

/** One frozen ceiling per production app: measurement at freeze time, shrink-only. */
export type CompositionRootAppBudget = {
  app: string;
  maxFiles: number;
  maxLines: number;
  reason: string;
};

export const COMPOSITION_ROOT_APP_BUDGETS: readonly CompositionRootAppBudget[] = [
  {
    app: "apps/api",
    maxFiles: 7,
    maxLines: 799,
    reason:
      "frozen at the 2026-09-07 measurement; ratchet toward CellixJs apps/api (15 files / 686 lines, registers infrastructure services and sets context, nothing else)",
  },
  {
    app: "apps/ui-admin",
    maxFiles: 4,
    maxLines: 239,
    reason:
      "frozen at the 2026-09-07 measurement; ratchet toward the CellixJs largest app (ui-community, 19 files / 1,506 lines) — behaviour moves to packages",
  },
  {
    app: "apps/ui-xr",
    maxFiles: 10,
    maxLines: 6054,
    reason:
      "tightened 6083 -> 6054 on 2026-09-09 when the supported-actor placement composition moved to @openclinxr/xr-runtime-state; ratchet toward the CellixJs largest app (ui-community, 19 files / 1,506 lines) — behaviour moves to packages",
  },
] as const;

// ── App source measurement ──────────────────────────────────────────────────

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

/**
 * Logical line count: newline count, so a file without a trailing newline counts
 * its last partial line. `text.split(/\r?\n/).length` overcounts that case by one
 * (and disagrees with the frozen budgets by exactly the number of such files).
 */
function countLogicalLines(text: string): number {
  if (text.length === 0) return 0;
  const parts = text.split(/\r?\n/);
  return /(\r?\n)$/.test(text) ? parts.length - 1 : parts.length;
}

/**
 * Walk <app>/src recursively; count non-test .ts/.tsx, excluding node_modules,
 * dist and *.d.ts. A missing directory returns { files: 0, lines: 0 }.
 */
export function measureAppSource(app: string): { files: number; lines: number } {
  const root = findWorkspaceRoot();
  const start = join(root, app, "src");
  if (!existsSync(start)) return { files: 0, lines: 0 };
  let files = 0;
  let lines = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!/node_modules$|[/\\]dist$/.test(full)) walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const rel = relative(root, full);
        if (/\.(test|spec)\.(ts|tsx)$/.test(rel)) continue;
        if (/\.d\.ts$/.test(rel)) continue;
        files += 1;
        lines += countLogicalLines(readFileSync(full, "utf8"));
      }
    }
  };
  walk(start);
  return { files, lines };
}

export type CompositionRootViolation = { app?: string; file?: string; detail: string };

/**
 * One violation per app whose measurement exceeds its budget in files OR lines.
 * Growth fails the gate; moving code into packages (or deleting it) is the fix —
 * never raising the ceiling.
 */
export function checkAppSourceBudgets(
  budgets: readonly CompositionRootAppBudget[] = COMPOSITION_ROOT_APP_BUDGETS,
): CompositionRootViolation[] {
  const violations: CompositionRootViolation[] = [];
  for (const budget of budgets) {
    const measured = measureAppSource(budget.app);
    if (measured.files > budget.maxFiles || measured.lines > budget.maxLines) {
      violations.push({
        app: budget.app,
        detail:
          `${budget.app}: ${measured.files} files / ${measured.lines} lines > frozen budget ` +
          `${budget.maxFiles} files / ${budget.maxLines} lines (budgets only shrink — put new behaviour in a package; do NOT raise the ceiling). ${budget.reason}`,
      });
    }
  }
  return violations;
}

// ── Validation separation ───────────────────────────────────────────────────

const VALIDATOR_FN = /export (?:async )?function (parse|validate|assert|is)[A-Z]\w*/;
const OTHER_EXPORT =
  /export (?:async )?function (?!(?:parse|validate|assert|is)[A-Z])\w+|export const \w+|export class \w+/;

const VALIDATION_SCAN_ROOTS = [
  "apps/api/src",
  "apps/ui-admin/src",
  "apps/ui-xr/src",
  "apps/arena",
] as const;

/**
 * Brownfield freeze: the 31 app modules that export a validator (a function whose
 * name starts with parse, validate, assert or is followed by an uppercase letter)
 * ALONGSIDE at least one other export. Generated by running checkValidationSeparation
 * with an empty freeze and pasting what it found. Entries may only be REMOVED (by
 * splitting the module); never add one to excuse a new mixer.
 */
export const VALIDATION_SEPARATION_FREEZE: Record<string, { reason: string }> = {};

export type ValidationSeparationOptions = {
  freeze?: Record<string, { reason: string }>;
  sources?: { file: string; text: string }[];
};

function isTestOrDeclaration(file: string): boolean {
  return /\.(test|spec)\.(ts|tsx)$/.test(file) || /\.d\.ts$/.test(file);
}

function listValidationScanFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!/node_modules$|[/\\]dist$/.test(full)) walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const rel = relative(root, full);
        if (!isTestOrDeclaration(rel)) out.push(rel);
      }
    }
  };
  for (const scanRoot of VALIDATION_SCAN_ROOTS) {
    try {
      walk(join(root, scanRoot));
    } catch {
      // A missing scan root contributes nothing (same posture as measureAppSource).
    }
  }
  return out;
}

/**
 * A violation is a non-test apps/** source that exports BOTH a validator AND at
 * least one other export. A validator-only module is fine. When `sources` is
 * supplied, scan those and do not touch disk. Frozen files are grandfathered —
 * split the module to remove a freeze entry, never widen the freeze.
 */
export function checkValidationSeparation(
  opts?: ValidationSeparationOptions,
): CompositionRootViolation[] {
  const freeze = opts?.freeze ?? VALIDATION_SEPARATION_FREEZE;
  const candidates: { file: string; text: string }[] =
    opts?.sources !== undefined
      ? opts.sources.filter((source) => !isTestOrDeclaration(source.file))
      : (() => {
          const root = findWorkspaceRoot();
          return listValidationScanFiles(root).map((file) => ({
            file,
            text: readFileSync(join(root, file), "utf8"),
          }));
        })();

  const violations: CompositionRootViolation[] = [];
  for (const { file, text } of candidates) {
    if (Object.hasOwn(freeze, file)) continue;
    if (VALIDATOR_FN.test(text) && OTHER_EXPORT.test(text)) {
      violations.push({
        file,
        detail:
          `${file}: exports a validator (parse…/validate…/assert…/is…-Uppercase) alongside other exports — ` +
          `move the validator into a package (or keep this module validator-only); do NOT add a freeze entry for new code.`,
      });
    }
  }
  return violations;
}

// ── App file naming ─────────────────────────────────────────────────────────

export const KEBAB_CASE_APP_ROOTS: readonly string[] = ["apps/ui-admin/src", "apps/ui-xr/src", "apps/arena"] as const;

const NAMING_ALLOWLIST_STEMS = new Set(["index", "main", "vite-env"]);

function namingViolationFor(basename_: string): boolean {
  if (/\.(test|spec)\.(ts|tsx)$/.test(basename_)) return false;
  if (/\.d\.ts$/.test(basename_)) return false;
  if (/\.config\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(basename_)) return false;
  const stem = basename_.split(".")[0] ?? "";
  if (NAMING_ALLOWLIST_STEMS.has(stem)) return false;
  return !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(stem);
}

function listNamingScanFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!/node_modules$|[/\\]dist$/.test(full)) walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push(relative(root, full));
      }
    }
  };
  for (const scanRoot of KEBAB_CASE_APP_ROOTS) {
    try {
      walk(join(root, scanRoot));
    } catch {
      // A missing scan root contributes nothing.
    }
  }
  return out;
}

/**
 * Non-test .ts/.tsx basenames in KEBAB_CASE_APP_ROOTS must be lower kebab-case.
 * Test files (*.test.*, *.spec.*) are exempt — they keep the name of the source
 * they cover. Config shims (*.config.*), declaration files (*.d.ts) and the
 * index/main/vite-env entry stems are exempt. Everything else PascalCase or
 * snake_case is a violation: rename the file and update its importers.
 */
export function checkAppFileNaming(opts?: {
  sources?: { file: string; text: string }[];
}): CompositionRootViolation[] {
  const files: string[] =
    opts?.sources !== undefined
      ? opts.sources.map((source) => source.file)
      : listNamingScanFiles(findWorkspaceRoot());
  const violations: CompositionRootViolation[] = [];
  for (const file of files) {
    if (namingViolationFor(basename(file))) {
      violations.push({
        file,
        detail:
          `${file}: basename is not lower kebab-case — rename the file (git mv) and update every importer; ` +
          `test files (*.test.*, *.spec.*) are exempt because they track their subject.`,
      });
    }
  }
  return violations;
}
