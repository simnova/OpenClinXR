/**
 * Measures shipped cast GLB triangle counts through the production join and writes
 * `packages/openclinxr/asset-registry/src/measured-station-geometry.json`.
 *
 * #705: `evaluateScenarioReadiness(scenario, measuredTriangleCounts?)` landed in #700 but no
 * production caller passes counts, so the API readiness surface still weighs DECLARED geometry.
 * Neither consumer can open a GLB (apps/api has no gltf reader outside tests; scenario-runtime
 * depends only on workspace packages), so the counts are a build-time artifact: the factory
 * measures once and commits the numbers, and every caller reads them (dark-factory shape, D9).
 *
 * The join mirrors `runtime-bundles.ts` (edModel calls): scenario asset id -> cast role; the GLB
 * path for each role comes from the SSOT cast table `resolveScenarioActorCast`. Only the three ED
 * characters have a demonstrated join to shipped GLBs; the environment and equipment manifests do
 * not, so they stay declared and the readiness evaluator's fail-closed incomplete blocker covers
 * them.
 *
 * #707: the artifact carries a per-source `fingerprints` map (bytes + sha256) so a gate
 * (`findStaleMeasuredGeometry` in the asset-registry package) can tell when a rebake has changed
 * the bytes the counts were read from. The generator reads the file once and emits the fingerprint
 * from those bytes.
 *
 * Run from the repo root: `pnpm exec tsx tools/openclinxr/measure-station-geometry.ts`
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Document, NodeIO } from "@gltf-transform/core";
import {
  ED_CHEST_PAIN_SCENARIO_ID,
  resolveScenarioActorCast,
} from "../../packages/openclinxr/asset-registry/src/actor-casting.js";

/**
 * The production join for the ED station (mirrors runtime-bundles.ts:710-712 edModel calls).
 * The GLB each role loads is resolved from the cast-table SSOT, not re-declared here.
 */
const ED_CHARACTER_JOIN: ReadonlyArray<{ scenarioAssetId: string; role: string }> = [
  { scenarioAssetId: "patient_robert_hayes_character", role: "patient" },
  { scenarioAssetId: "nurse_maria_alvarez_character", role: "nurse" },
  { scenarioAssetId: "spouse_anna_hayes_character", role: "family" },
];

const REPO = join(import.meta.dirname, "../..");
const OUT = join(
  REPO,
  "packages/openclinxr/asset-registry/src/measured-station-geometry.json",
);

function countTriangles(doc: Document): number {
  let triangles = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute("POSITION");
      triangles += (idx?.getCount() ?? pos?.getCount() ?? 0) / 3;
    }
  }
  return Math.round(triangles);
}

async function main(): Promise<void> {
  const cast = resolveScenarioActorCast(ED_CHEST_PAIN_SCENARIO_ID);
  const triangles: Record<string, number> = {};
  const sources: Record<string, string> = {};
  const fingerprints: Record<string, { bytes: number; sha256: string }> = {};
  for (const row of ED_CHARACTER_JOIN) {
    const castRow = cast.find(
      (c) => c.role === row.role || (row.role === "family" && c.role === "family_member"),
    );
    if (!castRow) throw new Error(`no cast row for role ${row.role} in ${ED_CHEST_PAIN_SCENARIO_ID}`);
    const glbPath = castRow.assetPath;
    const absGlb = join(REPO, glbPath);
    if (!existsSync(absGlb)) {
      throw new Error(`GLB missing for ${row.scenarioAssetId}: ${glbPath}`);
    }
    const doc = await new NodeIO().read(absGlb);
    const bytes = readFileSync(absGlb);
    triangles[row.scenarioAssetId] = countTriangles(doc);
    sources[row.scenarioAssetId] = glbPath;
    fingerprints[row.scenarioAssetId] = {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  const artifact = {
    generatedBy: "tools/openclinxr/measure-station-geometry.ts",
    generatedAt: new Date().toISOString(),
    sources,
    triangles,
    fingerprints,
  };
  writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`wrote ${OUT}\n`);
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
