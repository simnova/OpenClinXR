import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CEILING_FILENAME,
  generateCeilings,
  measureContexts,
} from "../../../packages/openclinxr-verification/architecture-rules/src/checks/context-field-budgets.ts";
import { measureTestImports } from "../../../packages/openclinxr-verification/architecture-rules/src/checks/test-import-surface.ts";
import {
  ENTRYPOINT_EXPORT_BUDGET,
  measureExportSurface,
} from "../../../packages/openclinxr-verification/architecture-rules/src/checks/export-surface-budgets.ts";

/**
 * Writes one arch-ceiling.json per over-budget package, and DELETES the file from any package
 * that has come under budget. Ceilings are generated on purpose: the two hand-edited freeze
 * tables in architecture-rules are the most-contended source files in the repo, because every
 * extraction slice must edit both. Per-package generated files mean two parallel workers in
 * different packages never touch the same ceiling.
 */
function repoRoot(): string {
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

const root = repoRoot();
const measurements = measureContexts();
const ceilings = generateCeilings(measurements);
const testImports = measureTestImports();
const internalByPkg = new Map(testImports.map((t) => [t.pkg, t.internal]));
const exportSurface = measureExportSurface();
const exportsByPkg = new Map(exportSurface.map((e) => [e.pkg, e]));
const packagesRoot = join(root, "packages", "openclinxr");

const written: string[] = [];
const removed: string[] = [];

const allPackages = new Set([
  ...measurements.map((m) => m.pkg),
  ...testImports.map((t) => t.pkg),
  ...exportSurface.map((e) => e.pkg),
]);

for (const pkg of allPackages) {
  const file = join(packagesRoot, pkg, CEILING_FILENAME);
  const contexts = ceilings[pkg]?.contexts;
  const internal = internalByPkg.get(pkg) ?? 0;
  const surface = exportsByPkg.get(pkg);
  const overExportBudget = (surface?.exports ?? 0) > ENTRYPOINT_EXPORT_BUDGET;
  const stars = surface?.starExports ?? 0;
  if (contexts === undefined && internal === 0 && !overExportBudget && stars === 0) {
    if (existsSync(file)) {
      rmSync(file);
      removed.push(`packages/openclinxr/${pkg}/${CEILING_FILENAME}`);
    }
    continue;
  }
  const body: {
    contexts?: Record<string, number>;
    testInternalImports?: number;
    rootEntrypointExports?: number;
    starExports?: number;
  } = {};
  if (contexts !== undefined) {
    body.contexts = Object.fromEntries(
      Object.entries(contexts).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  if (internal > 0) body.testInternalImports = internal;
  if (overExportBudget && surface !== undefined) body.rootEntrypointExports = surface.exports;
  if (stars > 0) body.starExports = stars;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  written.push(`packages/openclinxr/${pkg}/${CEILING_FILENAME}`);
}

console.log(`context types measured: ${measurements.length}`);
console.log(`packages with tests measured: ${testImports.length}`);
console.log(`packages with an entrypoint measured: ${exportSurface.length}`);
console.log(`ceilings written: ${written.length}`);
for (const f of written.sort()) console.log(`  + ${f}`);
for (const f of removed.sort()) console.log(`  - ${f}`);
