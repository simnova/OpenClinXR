import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Factory→app import-inversion fitness rule (ArchUnit-style; "the factory does not
 * import the apps it feeds").
 *
 * WHY: The production factory — packages/ plus tools/openclinxr/{dark-factory,factory}/
 * — exists to FEED the learner app with generated stations, equipment, and bundles. When
 * a factory stage imports the XR app's source (today: multi-case-runner.ts runs its
 * `room` stage through apps/ui-xr/src/station-environment.ts and its `equipment` stage
 * through apps/ui-xr/src/station-equipment-builders.ts), the chain cannot run without the
 * app's source tree and the dependency arrow points from factory to UI — backwards. The
 * fix is moving the needed builders into a package the app also consumes, not reaching
 * into the app.
 *
 * RATCHET SEMANTICS:
 *  - New / unfrozen factory files must resolve no import into apps/ (a hard rule).
 *  - Existing inversions are grandfathered in APP_IMPORT_INVERSION_FREEZE at the CURRENT
 *    measurement — the ceiling. They may only SHRINK; any new inversion fails the gate.
 *    When a frozen file no longer imports from apps/, its freeze entry MUST be removed
 *    (clause 5 enforces this — the ratchet only tightens).
 *
 * Scope: hand-written NON-TEST TypeScript source under the factory roots below.
 * Evidence harnesses (tools/openclinxr/evidence/) are OUT OF SCOPE by design: an
 * evidence harness exists to drive the app, so importing it is correct there.
 */

// ── Default scan roots ───────────────────────────────────────────────────────

export const FACTORY_SCAN_ROOTS: readonly string[] = [
  "packages",
  "tools/openclinxr/dark-factory",
  "tools/openclinxr/factory",
] as const;

// ── Default brownfield freeze list ───────────────────────────────────────────
/**
 * Brownfield freeze list — current inversions grandfathered at the present measurement.
 * Entries can only be REMOVED (as frozen files stop importing apps/). Do not add new
 * entries to widen the gate; move the needed builder into a package instead.
 */
export const APP_IMPORT_INVERSION_FREEZE: Record<string, { reason: string }> = {
  "tools/openclinxr/dark-factory/multi-case-runner.ts": {
    reason:
      "brownfield: room stage imports ../../../apps/ui-xr/src/station-environment.js and equipment stage imports ../../../apps/ui-xr/src/station-equipment-builders.js — the fix is moving station-environment.ts and station-equipment-builders.ts into a package (57 importers, a separate slice)",
  },
};

// ── Config type ──────────────────────────────────────────────────────────────

export type FactoryAppImportInversion = { file: string; specifier: string };

export type FactoryAppImportInversionConfig = {
  freeze?: Record<string, { reason: string }>;
  /**
   * When supplied, the detector scans ONLY these in-memory sources and does not touch
   * disk (counterweight probes). Absent, it scans FACTORY_SCAN_ROOTS on disk.
   */
  sources?: { file: string; text: string }[];
  workspaceRoot?: string;
};

// ── Private helpers ──────────────────────────────────────────────────────────

const SKIP =
  /node_modules|[/\\](dist|generated|public|scratch)[/\\]|\.test\.|\.spec\.|\.gen\.|\.d\.ts$|codegen|tsbuildinfo/;

const APP_UI_SCOPED_PATTERN = /^@openclinxr\/ui-(?:admin|xr|shared)(?:\/|$)/;

function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

function listFactorySourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const name = entry.name.toString();
      const full = join(dir, name);
      if (entry.isDirectory()) {
        if (!/node_modules$|[/\\]dist$|[/\\]generated$|[/\\]public$|[/\\]scratch$/.test(full)) walk(full);
      } else if (/\.(ts|tsx)$/.test(name)) {
        const rel = relative(root, full).split(/[/\\]/).join("/");
        if (!SKIP.test(rel)) out.push(rel);
      }
    }
  };
  for (const scanRoot of FACTORY_SCAN_ROOTS) walk(join(root, scanRoot));
  return out;
}

function specifiersIn(text: string): string[] {
  const out: string[] = [];
  const pattern = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(["'])([^"']+)\1/g;
  for (const match of text.matchAll(pattern)) {
    const specifier = match[2];
    if (specifier !== undefined) out.push(specifier);
  }
  return out;
}

function specifierResolvesIntoApps(file: string, specifier: string): boolean {
  if (specifier.startsWith(".")) {
    const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
    return resolved === "apps" || resolved.startsWith("apps/");
  }
  if (specifier === "apps" || specifier.startsWith("apps/")) return true;
  return APP_UI_SCOPED_PATTERN.test(specifier);
}

// ── Public check functions (pure — no vitest) ────────────────────────────────

/**
 * Rule: every factory source file must resolve no import into apps/, or be named in
 * the (shrink-only) freeze. Returns one row per offending specifier.
 */
export function detectFactoryAppImportInversions(
  config?: FactoryAppImportInversionConfig,
): FactoryAppImportInversion[] {
  const freeze = config?.freeze ?? APP_IMPORT_INVERSION_FREEZE;
  const inversions: FactoryAppImportInversion[] = [];
  const reportSource = (file: string, text: string): void => {
    if (freeze[file] !== undefined) return;
    for (const specifier of specifiersIn(text)) {
      if (specifierResolvesIntoApps(file, specifier)) inversions.push({ file, specifier });
    }
  };

  if (config?.sources !== undefined) {
    for (const source of config.sources) reportSource(source.file, source.text);
    return inversions;
  }

  const root = config?.workspaceRoot ?? findWorkspaceRoot();
  for (const rel of listFactorySourceFiles(root)) {
    reportSource(rel, readFileSync(join(root, rel), "utf8"));
  }
  return inversions;
}

/**
 * Human-readable failure lines: WHY the inversion matters and what to do instead.
 */
export function formatFactoryAppImportInversions(
  inversions: FactoryAppImportInversion[],
): string[] {
  return inversions.map(
    (row) =>
      `${row.file}: imports ${row.specifier} — the production factory must not import the apps it feeds (the chain cannot run without the XR app's source tree; the dependency arrow points factory→UI). Move the needed builder into a package the app also consumes. Grandfathering is only for pre-existing frozen entries, which may only shrink.`,
  );
}
