import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CEILING_FILENAME,
  generateCeilings,
  measureContexts,
} from "../../../packages/openclinxr/architecture-rules/src/checks/context-field-budgets.ts";

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
const packagesRoot = join(root, "packages", "openclinxr");

const written: string[] = [];
const removed: string[] = [];

for (const pkg of new Set(measurements.map((m) => m.pkg))) {
  const file = join(packagesRoot, pkg, CEILING_FILENAME);
  const ceiling = ceilings[pkg];
  if (ceiling === undefined) {
    if (existsSync(file)) {
      rmSync(file);
      removed.push(`packages/openclinxr/${pkg}/${CEILING_FILENAME}`);
    }
    continue;
  }
  const sorted = Object.fromEntries(
    Object.entries(ceiling.contexts).sort(([a], [b]) => a.localeCompare(b)),
  );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ contexts: sorted }, null, 2)}\n`);
  written.push(`packages/openclinxr/${pkg}/${CEILING_FILENAME}`);
}

console.log(`context types measured: ${measurements.length}`);
console.log(`ceilings written: ${written.length}`);
for (const f of written.sort()) console.log(`  + ${f}`);
for (const f of removed.sort()) console.log(`  - ${f}`);
