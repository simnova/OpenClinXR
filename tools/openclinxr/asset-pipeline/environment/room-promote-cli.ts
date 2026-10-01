import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOM_CHAIN_RECIPES, runRoomChain } from "@openclinxr/factory-stations/room-chain";
import { writeRoomEvidencePoses } from "./derive-room-evidence-poses.js";

const RUNTIME_PATHS: Record<string, { glb: string; rig: string; provenanceOut?: string }> = {
  inpatient_ward_room_v1: {
    glb: "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb",
    rig: "apps/ui-xr/public/xr-assets/lighting/inpatient_ward_room_v1.rig.json",
    provenanceOut: "docs/openclinxr/room-realism/floor-cast",
  },
  stepdown_room_v1: {
    glb: "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb",
    rig: "apps/ui-xr/public/xr-assets/lighting/stepdown_room_v1.rig.json",
  },
};

const digest = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

export function parseRoomPromoteArgs(args: readonly string[]): { environmentId: string; seed?: number; outDir: string; noCache: boolean } {
  let environmentId = "";
  let seed: number | undefined;
  let outDir = ".openclinxr/evidence/ward-finish-chain";
  let noCache = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--environment") environmentId = String(args[++i] ?? "");
    else if (args[i] === "--seed") seed = Number(args[++i]);
    else if (args[i] === "--out-dir") outDir = String(args[++i] ?? "");
    else if (args[i] === "--no-cache") noCache = true;
  }
  if (!environmentId) throw new Error("--environment is required");
  if (seed !== undefined && !Number.isFinite(seed)) throw new Error("--seed must be finite");
  if (!outDir) throw new Error("--out-dir requires a directory");
  return seed === undefined ? { environmentId, outDir, noCache } : { environmentId, seed, outDir, noCache };
}

export async function promoteRoom(args = process.argv.slice(2)): Promise<void> {
  const { environmentId, seed: requestedSeed, outDir, noCache } = parseRoomPromoteArgs(args);
  const recipe = ROOM_CHAIN_RECIPES[environmentId as keyof typeof ROOM_CHAIN_RECIPES];
  const runtime = RUNTIME_PATHS[environmentId];
  if (recipe === undefined || runtime === undefined) throw new Error(`No promotable room-chain recipe for ${environmentId}`);
  const seed = requestedSeed ?? recipe.defaultSeed;
  const before = Object.fromEntries([runtime.glb, runtime.rig].map((file) => [file, existsSync(file) ? digest(file) : null]));
  const chain = await runRoomChain({
    environmentId,
    seed,
    outDir,
    noCache,
  });
  copyFileSync(chain.finalGlb, runtime.glb);
  copyFileSync(chain.rigJson, runtime.rig);
  const evidencePosesPath = path.join(outDir, "room-evidence-poses.json");
  const evidencePoses = await writeRoomEvidencePoses(chain.finalGlb, recipe, evidencePosesPath);
  if (runtime.provenanceOut !== undefined) {
    execFileSync(process.execPath, [
      path.join("node_modules", "tsx", "dist", "cli.mjs"),
      "tools/openclinxr/evidence/room-ward-finish-chain/ship-ward-provenance.ts",
    ], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env, SHIP_WARD_OUT: runtime.provenanceOut, SHIP_WARD_SEED: String(seed), SHIP_WARD_CHAIN_OUT: path.dirname(chain.finalGlb) },
    });
  }
  const after = Object.fromEntries([runtime.glb, runtime.rig].map((file) => [file, digest(file)]));
  const changed = Object.keys(after).filter((file) => before[file] !== after[file]);
  process.stdout.write(`${JSON.stringify({
    environmentId,
    seed,
    cache: chain.cache,
    before,
    after,
    changed,
    evidencePoses: {
      path: evidencePosesPath,
      sha256: digest(evidencePosesPath),
      sourceGlbSha256: evidencePoses.sourceGlbSha256,
      count: evidencePoses.poses.length,
      clearanceM: evidencePoses.clearanceM,
    },
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await promoteRoom();
}
