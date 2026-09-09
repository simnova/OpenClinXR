import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Export surface budget (ArchUnit-style; "a package publishes an interface, not a namespace").
 *
 * WHY: a package exporting 220 symbols has no interface — every internal is public, so any
 * rename is a breaking change and nothing can be made private later without a consumer
 * hunt. MEASURED 2026-09-07 across the 41 packages with a src/index.ts: the median root
 * entrypoint publishes 59 symbols and 31 packages exceed 25. The CellixJs reference
 * publishes a median of 6 per entrypoint, and its domain-seedwork keeps 3 of its 15 source
 * files unreachable by omitting them from `exports` — a mechanism no package here uses.
 *
 * TWO CLAUSES, because a count alone does not create privacy.
 *
 * 1. ENTRYPOINT EXPORTS, budget 25. Provenance is two measurements, neither fitted to the
 *    current state: CellixJs's 59 entrypoints have a p90 of 21, and THIS repo's own 64
 *    subpath entrypoints have a p75 of 15. 25 clears both. 10 of 41 packages already pass.
 *
 * 2. STAR EXPORTS, no budget, pure shrink-only from today's count. `export * from "./x.js"`
 *    republishes a module wholesale, so a symbol added inside becomes public with nobody
 *    deciding it should be. 249 walls stand today and 13 packages already have none. A NEW
 *    package must have zero; an existing one may only shrink. Forcing all 249 at once would
 *    be a freeze list larger than the rule, which is the theatre this repo's own criterion
 *    rejects.
 *
 * CEILINGS ARE PER-PACKAGE AND GENERATED, sharing arch-ceiling.json with the context budget
 * and the test import surface. See checks/context-field-budgets.ts for why.
 */

export const ENTRYPOINT_EXPORT_BUDGET = 25;
export const CEILING_FILENAME = "arch-ceiling.json";

export type ExportMeasurement = { pkg: string; exports: number; starExports: number };

const DECLARED_EXPORT =
  /^export (?:declare )?(?:async )?(?:function|const|class|type|interface|enum|let|var)\s+(\w+)/gmu;
// `export type { … }` is a re-export block like any other and publishes exactly as much. The
// pattern matched only `export {`, so every type-only block was INVISIBLE to this measurement.
// Measured 2026-09-08 before the fix: 296 symbols across 38 files, entrypoints included.
const NAMED_EXPORT_BLOCK = /^export (?:type )?\{([^}]*)\}/gmu;
const STAR_EXPORT = /^export \* from "([^"]+)"/gmu;

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
 * Every symbol reachable from `entry`, following `export *` chains. Exported so the test can
 * drive it on a fixture rather than only on the tree.
 */
export function exportedSymbols(entry: string, seen: Set<string> = new Set()): Set<string> {
  if (!existsSync(entry)) return new Set();
  const real = realpathSync(entry);
  if (seen.has(real)) return new Set();
  seen.add(real);
  const text = readFileSync(real, "utf8");
  const out = new Set<string>();
  for (const match of text.matchAll(DECLARED_EXPORT)) out.add(match[1] ?? "");
  for (const match of text.matchAll(NAMED_EXPORT_BLOCK)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = part.trim().split(" as ").pop()?.replace(/^type\s+/u, "").trim();
      if (name !== undefined && name !== "") out.add(name);
    }
  }
  for (const match of text.matchAll(STAR_EXPORT)) {
    const target = match[1] ?? "";
    if (!target.startsWith(".")) continue;
    const resolved = resolve(dirname(real), target.replace(/\.js$/u, ".ts"));
    for (const symbol of exportedSymbols(resolved, seen)) out.add(symbol);
  }
  out.delete("");
  return out;
}

/** Root-entrypoint export count and star-wall count for every package with a src/index.ts. */
export function measureExportSurface(): ExportMeasurement[] {
  const root = findWorkspaceRoot();
  const packagesRoot = join(root, "packages", "openclinxr");
  const out: ExportMeasurement[] = [];
  if (!existsSync(packagesRoot)) return out;
  for (const pkg of readdirSync(packagesRoot)) {
    const entry = join(packagesRoot, pkg, "src", "index.ts");
    if (!existsSync(entry)) continue;
    const stars = (readFileSync(entry, "utf8").match(STAR_EXPORT) ?? []).length;
    out.push({ pkg, exports: exportedSymbols(entry).size, starExports: stars });
  }
  return out.sort((a, b) => b.exports - a.exports);
}

export type ExportCeiling = { rootEntrypointExports?: number; starExports?: number };

export function readExportCeiling(pkg: string): ExportCeiling | null {
  const file = join(findWorkspaceRoot(), "packages", "openclinxr", pkg, CEILING_FILENAME);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as ExportCeiling;
}

export type ExportViolation = { pkg: string; detail: string };

export function checkExportSurface(
  measurements: readonly ExportMeasurement[] = measureExportSurface(),
  ceilingFor: (pkg: string) => ExportCeiling | null = readExportCeiling,
): ExportViolation[] {
  const violations: ExportViolation[] = [];
  for (const m of measurements) {
    const ceiling = ceilingFor(m.pkg);
    const exportCeiling = ceiling?.rootEntrypointExports;
    if (m.exports > ENTRYPOINT_EXPORT_BUDGET && exportCeiling === undefined) {
      violations.push({
        pkg: m.pkg,
        detail:
          `packages/openclinxr/${m.pkg}: root entrypoint publishes ${m.exports} symbols > budget ` +
          `${ENTRYPOINT_EXPORT_BUDGET}, with no ceiling. A package that publishes every internal has a ` +
          "namespace, not an interface: nothing can be renamed or made private without a consumer hunt. " +
          "FIX: publish the symbols consumers need and move the rest behind them, or split the package " +
          "into subpath entrypoints. Do NOT add a ceiling by hand; run pnpm arch:ceilings.",
      });
    } else if (exportCeiling !== undefined && m.exports > exportCeiling) {
      violations.push({
        pkg: m.pkg,
        detail:
          `packages/openclinxr/${m.pkg}: root entrypoint grew to ${m.exports} symbols > ceiling ` +
          `${exportCeiling}. Ceilings only shrink — do not republish another internal.`,
      });
    } else if (
      exportCeiling !== undefined &&
      (m.exports < exportCeiling || m.exports <= ENTRYPOINT_EXPORT_BUDGET)
    ) {
      violations.push({
        pkg: m.pkg,
        detail:
          `packages/openclinxr/${m.pkg}: export ceiling ${exportCeiling} is above the measured ${m.exports} ` +
          "— the surface shrank but the ceiling did not. Run pnpm arch:ceilings.",
      });
    }

    const starCeiling = ceiling?.starExports;
    if (m.starExports > 0 && starCeiling === undefined) {
      violations.push({
        pkg: m.pkg,
        detail:
          `packages/openclinxr/${m.pkg}: ${m.starExports} \`export * from\` wall(s) with no ceiling. A star ` +
          "export republishes a module wholesale, so a symbol added inside becomes public with nobody " +
          "deciding it should be. A NEW package must name what it exports. Run pnpm arch:ceilings.",
      });
    } else if (starCeiling !== undefined && m.starExports > starCeiling) {
      violations.push({
        pkg: m.pkg,
        detail:
          `packages/openclinxr/${m.pkg}: star exports rose to ${m.starExports} > ceiling ${starCeiling}. ` +
          "Ceilings only shrink — name the symbols instead of adding another wall.",
      });
    } else if (starCeiling !== undefined && m.starExports < starCeiling) {
      violations.push({
        pkg: m.pkg,
        detail:
          `packages/openclinxr/${m.pkg}: star ceiling ${starCeiling} is above the measured ${m.starExports} ` +
          "— walls were removed but the ceiling was not lowered. Run pnpm arch:ceilings.",
      });
    }
  }
  return violations;
}
