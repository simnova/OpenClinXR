import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadRoomChainLibrary } from "../../dark-factory/multi-case-runner.js";

const RUNTIME_PATHS: Record<string, { glb: string; rig: string; provenanceOut: string }> = {
  inpatient_ward_room_v1: {
    glb: "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb",
    rig: "apps/ui-xr/public/xr-assets/lighting/inpatient_ward_room_v1.rig.json",
    provenanceOut: "docs/openclinxr/room-realism/floor-cast",
  },
};

const digest = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

export function parseRoomPromoteArgs(args: readonly string[]): { environmentId: string; seed?: number } {
  let environmentId = "";
  let seed: number | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--environment") environmentId = String(args[++i] ?? "");
    else if (args[i] === "--seed") seed = Number(args[++i]);
  }
  if (!environmentId) throw new Error("--environment is required");
  if (seed !== undefined && !Number.isFinite(seed)) throw new Error("--seed must be finite");
  return seed === undefined ? { environmentId } : { environmentId, seed };
}

export async function promoteRoom(args = process.argv.slice(2)): Promise<void> {
  const { environmentId, seed: requestedSeed } = parseRoomPromoteArgs(args);
  const { ROOM_CHAIN_RECIPES, runRoomChain } = await loadRoomChainLibrary();
  const recipe = ROOM_CHAIN_RECIPES[environmentId as keyof typeof ROOM_CHAIN_RECIPES];
  const runtime = RUNTIME_PATHS[environmentId];
  if (recipe === undefined || runtime === undefined) throw new Error(`No promotable room-chain recipe for ${environmentId}`);
  const seed = requestedSeed ?? recipe.defaultSeed;
  const before = Object.fromEntries([runtime.glb, runtime.rig].map((file) => [file, existsSync(file) ? digest(file) : null]));
  const chain = await runRoomChain({
    environmentId,
    seed,
    outDir: ".openclinxr/evidence/ward-finish-chain",
  });
  copyFileSync(chain.finalGlb, runtime.glb);
  copyFileSync(chain.rigJson, runtime.rig);
  execFileSync(process.execPath, [
    path.join("node_modules", "tsx", "dist", "cli.mjs"),
    "tools/openclinxr/evidence/room-ward-finish-chain/ship-ward-provenance.ts",
  ], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env, SHIP_WARD_OUT: runtime.provenanceOut, SHIP_WARD_SEED: String(seed) },
  });
  const after = Object.fromEntries([runtime.glb, runtime.rig].map((file) => [file, digest(file)]));
  const changed = Object.keys(after).filter((file) => before[file] !== after[file]);
  process.stdout.write(`${JSON.stringify({ environmentId, seed, cache: chain.cache, before, after, changed }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await promoteRoom();
}
