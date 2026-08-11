/**
 * issue-291 — regenerate the committed actor-phenotype export from the scenario
 * fixtures. The export is the machine-readable case definition the asset factory
 * Python generator reads (orchestrate_character.py). Run after authoring any
 * fixture `phenotype`:
 *
 *   pnpm exec tsx tools/openclinxr/dark-factory/export-actor-phenotype.ts
 *
 * The committed file is drift-guarded by
 * packages/openclinxr/scenario-fixtures/src/actor-phenotype-export.test.ts.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildActorPhenotypeExport,
  serializeActorPhenotypeExport,
} from "../../../packages/openclinxr/scenario-fixtures/src/actor-phenotype-export.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const DEFAULT_OUTPUT = path.join(
  REPO_ROOT,
  "packages",
  "openclinxr",
  "scenario-fixtures",
  "generated",
  "actor-phenotype.v1.json",
);

async function main(): Promise<void> {
  const output = process.argv[2] ?? DEFAULT_OUTPUT;
  const exported = buildActorPhenotypeExport();
  const serialized = serializeActorPhenotypeExport(exported);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, serialized, "utf8");
  const caseIds = Object.keys(exported.entries).sort();
  const actorCount = caseIds.reduce((n, c) => n + Object.keys(exported.entries[c] ?? {}).length, 0);
  console.log(`EXPORT_WRITTEN ${output}`);
  console.log(`EXPORT_SUMMARY cases=${caseIds.join(",")} actors=${actorCount}`);
}

void main().catch((err) => {
  console.error("EXPORT_FAIL", err);
  process.exit(1);
});
