/**
 * #549 — regenerate tools/openclinxr/evidence/waist-fit-coverage.json.
 *
 * Measures the two known-good library rails plus every live-cast MPFB asset from
 * live-scenario-actor-cast.ts (D1). Gowned / no-lower actors are declared skips.
 *
 *   pnpm exec tsx tools/openclinxr/evidence/waist-fit-coverage-write.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIBRARY_WAIST_SUBJECTS,
  measureWaistAt,
  type WaistCoverageRow,
} from "./garments-meet-at-the-waist-measure.ts";
import { listUniqueLiveCastMpfbAssetPaths } from "./live-scenario-actor-cast.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ARTIFACT = join(REPO_ROOT, "tools/openclinxr/evidence/waist-fit-coverage.json");

async function main(): Promise<void> {
  const subjects: WaistCoverageRow[] = [];

  for (const lib of LIBRARY_WAIST_SUBJECTS) {
    const row = await measureWaistAt(lib.id, lib.glbPath, "library");
    subjects.push(row);
    console.log(
      row.skipped
        ? `${row.id} SKIP ${row.skipReason}`
        : `${row.id} library overlapMm=${row.overlapMm?.toFixed(1)} gapped=${row.gapped}/${row.overlaps.length}`,
    );
  }

  for (const rel of listUniqueLiveCastMpfbAssetPaths()) {
    const id = rel.split("/").pop()!.replace(/\.glb$/i, "");
    const row = await measureWaistAt(id, pathResolve(REPO_ROOT, rel), "cast");
    subjects.push(row);
    console.log(
      row.skipped
        ? `${row.id} SKIP ${row.skipReason}`
        : `${row.id} cast overlapMm=${row.overlapMm?.toFixed(1)} gapped=${row.gapped}/${row.overlaps.length}`,
    );
  }

  subjects.sort((a, b) => a.id.localeCompare(b.id));
  const artifact = {
    generatedBy: "tools/openclinxr/evidence/waist-fit-coverage-write.ts",
    enumeratedFrom: "live-scenario-actor-cast.ts + library known-good rails",
    subjects: subjects.map(({ overlaps: _o, ...pub }) => pub),
  };
  writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`\nwrote ${ARTIFACT}: ${subjects.length} subjects`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
