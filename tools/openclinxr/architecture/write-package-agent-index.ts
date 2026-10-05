import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPackageAgentIndex,
  candidatePackageDirs,
  findWorkspaceRoot,
  INDEX_FILENAME,
  indexedPackages,
  serializePackageAgentIndex,
} from "../../../packages/openclinxr-verification/architecture-rules/src/checks/package-agent-index.ts";

/**
 * Writes one arch-index.json per package that publishes a src/index.ts, and DELETES the file from
 * any directory that has stopped publishing one. Every field is derived from the tree; see
 * checks/package-agent-index.ts for why the index is generated rather than written.
 *
 * The enumerated set is the gate's own indexedPackages(), not a second list kept beside it. A
 * hardcoded list here (the file once named arena/ explicitly) would let a new nested package —
 * e.g. packages/openclinxr/stations/<x> — fail the currentness gate with a remedy
 * (pnpm arch:index) that never writes its file. write-package-agent-index.test.ts pins the two
 * enumerations together.
 */

/**
 * The package set this writer maintains, as relative paths under packages/openclinxr.
 * Exported so the test can pin it to the gate's enumeration without executing any writes.
 */
export function writerIndexedPackages(root: string = findWorkspaceRoot()): string[] {
  return indexedPackages(root);
}

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

export function main(): void {
  const root = repoRoot();
  const packagesRoot = join(root, "packages", "openclinxr");
  const written: string[] = [];
  const unchanged: string[] = [];
  const removed: string[] = [];
  const withoutPurpose: string[] = [];

  const indexed = new Set(writerIndexedPackages(root));
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
  // Candidates come from the gate's own walk, so nested orphans are removed too.
  for (const rel of candidatePackageDirs(root)) {
    if (indexed.has(rel)) continue;
    const file = join(packagesRoot, rel, INDEX_FILENAME);
    if (!existsSync(file)) continue;
    rmSync(file);
    removed.push(`packages/openclinxr/${rel}/${INDEX_FILENAME}`);
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
}

const invokedAsScript =
  process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) main();
