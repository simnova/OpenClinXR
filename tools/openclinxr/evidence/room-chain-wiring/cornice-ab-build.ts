/** Build the non-shipping cornice A/B arms through the registered room chain. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOM_CHAIN_RECIPES, runRoomChain } from "@openclinxr/factory-stations/room-chain";

const root = ".openclinxr/evidence/cornice-ab";
const environments = ["inpatient_ward_room_v1", "stepdown_room_v1"] as const;
const variants = {
  v1: { cornice: "none" as const },
  v3: { cornice: "wall-angle" as const, corniceProfile: "angle" as const, corniceWidthMm: 15, corniceColorSource: "tbar" as const },
  v4: { cornice: "wall-angle" as const, corniceProfile: "angle" as const, corniceWidthMm: 24, corniceColorSource: "wall" as const },
  "v4-flush": { cornice: "wall-angle" as const, corniceProfile: "flush" as const, corniceWidthMm: 24, corniceColorSource: "wall" as const },
};
const sha256 = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");
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
  const shipped = environmentId === "inpatient_ward_room_v1"
    ? "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb"
    : "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb";
  results[`${environmentId}/v2`] = { finalGlb: shipped, glbSha256: sha256(shipped), reusedShippedAsset: true };
}

mkdirSync(root, { recursive: true });
writeFileSync(path.join(root, "build-manifest.json"), `${JSON.stringify({
  schemaVersion: "openclinxr.cornice-ab-build.v1",
  generatedAt: new Date().toISOString(),
  results,
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
