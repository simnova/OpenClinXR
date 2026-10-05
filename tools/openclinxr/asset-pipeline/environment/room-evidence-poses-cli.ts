import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOM_CHAIN_RECIPES } from "@openclinxr/factory-stations/room-chain";
import { writeRoomEvidencePoses } from "./derive-room-evidence-poses.js";

export function parseRoomEvidencePoseArgs(args: readonly string[]): { environmentId: string; glb: string; output: string } {
  let environmentId = "";
  let glb = "";
  let output = "";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--environment") environmentId = String(args[++index] ?? "");
    else if (args[index] === "--glb") glb = String(args[++index] ?? "");
    else if (args[index] === "--output") output = String(args[++index] ?? "");
  }
  if (!environmentId || !glb || !output) throw new Error("--environment, --glb and --output are required");
  return { environmentId, glb, output };
}

export async function roomEvidencePosesCli(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseRoomEvidencePoseArgs(args);
  const recipe = ROOM_CHAIN_RECIPES[parsed.environmentId as keyof typeof ROOM_CHAIN_RECIPES];
  if (!recipe) throw new Error(`no room-chain recipe for ${parsed.environmentId}`);
  await mkdir(path.dirname(parsed.output), { recursive: true });
  const artifact = await writeRoomEvidencePoses(parsed.glb, recipe, parsed.output);
  process.stdout.write(`${JSON.stringify({ output: parsed.output, environmentId: parsed.environmentId, poses: artifact.poses.length, clearanceM: artifact.clearanceM }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await roomEvidencePosesCli();
