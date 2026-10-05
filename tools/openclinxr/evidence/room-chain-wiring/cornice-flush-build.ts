/** Build the non-shipping cornice A/B arms through the registered room chain. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOM_CHAIN_RECIPES, runRoomChain } from "@openclinxr/factory-stations/room-chain";

const root = ".openclinxr/evidence/cornice-flush";
const environments = ["inpatient_ward_room_v1", "stepdown_room_v1"] as const;
const variants = {
  "v4-flush-tile": { corniceProfile: "flush" as const, corniceMaterial: "tile" as const },
  "v4-flush-tbar": { corniceProfile: "flush" as const, corniceMaterial: "tbar" as const },
};
const results: Record<string, unknown> = {};

for (const environmentId of environments) {
  const base = ROOM_CHAIN_RECIPES[environmentId];
  if (!base.finish) throw new Error(`${environmentId} has no finish recipe`);
  for (const [variant, ceilingVariant] of Object.entries(variants)) {
    const outDir = path.join(root, environmentId, variant);
    const finishOverride = {
      ...base.finish,
      ceiling: { ...base.finish.ceiling, ...ceilingVariant },
    };
    const result = await runRoomChain({ environmentId, outDir, finishOverride });
    results[`${environmentId}/${variant}`] = {
      finalGlb: result.finalGlb,
      glbSha256: result.glbSha256,
      cache: result.cache,
      finish: finishOverride,
    };
  }
  results[`${environmentId}/v4-flush-wall`] = {
    commit: "7bc7577308b72b056a26ee96d74f3b3e0d3245d2",
    glbSha256: environmentId === "inpatient_ward_room_v1"
      ? "a25fc5680a64d7c73c6732eda76e968dd82d3594404c6b64ac2258f0847bffac"
      : "40dfbb57c8bdcd5521d76571325c4fe955420e13d11567e5e5c3d11f99e79c8b",
    reusedCommittedCapture: true,
  };
}

mkdirSync(root, { recursive: true });
writeFileSync(path.join(root, "build-manifest.json"), `${JSON.stringify({
  schemaVersion: "openclinxr.cornice-ab-build.v1",
  generatedAt: new Date().toISOString(),
  results,
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
