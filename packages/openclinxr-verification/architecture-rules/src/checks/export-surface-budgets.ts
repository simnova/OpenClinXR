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
 * TWO CLAUSES. The numeric one is retired.
 *
 * 1. ENTRYPOINT EXPORTS. The count ceiling (`rootEntrypointExports`, budget 25) is not the
 *    gate. A package publishes the names in its package-local `public-api.json`, sealed from
 *    the Closing-record surface, and `checkReviewedPublicApi` refuses a derived export that
 *    file does not list. Do not raise `rootEntrypointExports`. The constant below stays as
 *    the historical budget; this check does not consult it.
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
export const PUBLIC_API_FILENAME = "public-api.json";

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

export type ReviewedEntrypoint = { pkg: string; specifier: string; exports: readonly string[] };

export type PublicApiDocument = { entrypoints: Readonly<Record<string, readonly string[]>> };

/**
 * Derived entrypoint names must be the reviewed file, as a set. `rootEntrypointExports` is
 * not read. A missing file is the same failure as a name the file does not list.
 */
export function checkReviewedPublicApi(
  measurements: readonly ReviewedEntrypoint[],
  readApi: (pkg: string) => PublicApiDocument | null,
): ExportViolation[] {
  const violations: ExportViolation[] = [];
  const byPkg = new Map<string, ReviewedEntrypoint[]>();
  for (const measurement of measurements) {
    const list = byPkg.get(measurement.pkg) ?? [];
    list.push(measurement);
    byPkg.set(measurement.pkg, list);
  }
  for (const [pkg, entries] of byPkg) {
    const doc = readApi(pkg);
    if (doc === null) {
      violations.push({
        pkg,
        detail:
          `${pkg}/${PUBLIC_API_FILENAME}: missing. The reviewed surface is this file, not a count in ` +
          `${CEILING_FILENAME}. Seal it from the Closing-record residual. Do not copy arch-index.json.`,
      });
      continue;
    }
    const reviewed = doc.entrypoints ?? {};
    const seen = new Set<string>();
    for (const entry of entries) {
      seen.add(entry.specifier);
      const allowed = new Set(reviewed[entry.specifier] ?? []);
      const derived = new Set(entry.exports);
      for (const name of [...derived].sort()) {
        if (!allowed.has(name)) {
          violations.push({
            pkg,
            detail:
              `${pkg} ${entry.specifier} exports ${name}, which ${PUBLIC_API_FILENAME} does not list. ` +
              "A derived export outside the reviewed file is refused. Add the name only when a file " +
              "outside the package binds it. Do not raise rootEntrypointExports.",
          });
        }
      }
      for (const name of [...allowed].sort()) {
        if (!derived.has(name)) {
          violations.push({
            pkg,
            detail:
              `${pkg} ${entry.specifier} lists ${name} in ${PUBLIC_API_FILENAME}, but the entrypoint does not ` +
              "export it. The reviewed file is the derived surface, not a copy of an old index.",
          });
        }
      }
    }
    for (const specifier of Object.keys(reviewed).sort()) {
      if (seen.has(specifier)) continue;
      for (const name of reviewed[specifier] ?? []) {
        violations.push({
          pkg,
          detail:
            `${pkg} ${specifier} lists ${name} in ${PUBLIC_API_FILENAME}, but that entrypoint is not a derived ` +
            "export of the package.",
        });
      }
    }
  }
  return violations;
}

export function checkExportSurface(
  measurements: readonly ExportMeasurement[] = measureExportSurface(),
  ceilingFor: (pkg: string) => ExportCeiling | null = readExportCeiling,
): ExportViolation[] {
  const violations: ExportViolation[] = [];
  for (const m of measurements) {
    const ceiling = ceilingFor(m.pkg);
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
