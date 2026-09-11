import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPackageAgentIndex,
  INDEX_FILENAME,
  indexedPackages,
  serializePackageAgentIndex,
} from "../../../packages/openclinxr-verification/architecture-rules/src/checks/package-agent-index.ts";

/**
 * Writes one arch-index.json per package that publishes a src/index.ts, and DELETES the file from
 * any directory that has stopped publishing one. Every field is derived from the tree; see
 * checks/package-agent-index.ts for why the index is generated rather than written.
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
const packagesRoot = join(root, "packages", "openclinxr");
const written: string[] = [];
const unchanged: string[] = [];
const removed: string[] = [];
const withoutPurpose: string[] = [];

const indexed = new Set(indexedPackages(root));
const arenaRoot = join(packagesRoot, "arena");
if (existsSync(arenaRoot)) {
  for (const entry of readdirSync(arenaRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = `arena/${entry.name}`;
    if (existsSync(join(packagesRoot, nested, "src", "index.ts"))) indexed.add(nested);
  }
}
for (const pkg of indexed) {
  const built = buildPackageAgentIndex(pkg, root);
  if (built === null) continue;
  const file = join(packagesRoot, pkg, INDEX_FILENAME);
  const next = serializePackageAgentIndex(built);
  const rel = `packages/openclinxr/${pkg}/${INDEX_FILENAME}`;
  if (built.purpose === undefined) withoutPurpose.push(pkg);
  if (existsSync(file) && readFileSync(file, "utf8") === next) {
    unchanged.push(rel);
    continue;
  }
  writeFileSync(file, next);
  written.push(rel);
}

// A directory that stopped publishing an entrypoint keeps a file describing nothing.
for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || indexed.has(entry.name)) continue;
  const file = join(packagesRoot, entry.name, INDEX_FILENAME);
  if (!existsSync(file)) continue;
  rmSync(file);
  removed.push(`packages/openclinxr/${entry.name}/${INDEX_FILENAME}`);
}

console.log(`packages with an entrypoint: ${indexed.size}`);
console.log(`indexes written or updated: ${written.length}`);
console.log(`indexes already current: ${unchanged.length}`);
for (const f of written.sort()) console.log(`  + ${f}`);
for (const f of removed.sort()) console.log(`  - ${f}`);
if (withoutPurpose.length > 0) {
  console.log(
    `\nentrypoints with no leading TSDoc, so no purpose to index (${withoutPurpose.length}):`,
  );
  console.log(`  ${withoutPurpose.sort().join(", ")}`);
  console.log(
    "  A worker reading one of these indexes learns WHAT the package exports and not WHY it exists.",
  );
}
