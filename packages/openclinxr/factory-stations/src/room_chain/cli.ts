/**
 * Package-internal CLI for the ward finish chain.
 *
 * Reached only by a script inside this same package (or by a process-boundary
 * spawn from tools/); never re-exported from `index.ts` or any package.json
 * `exports` entry, so it stays off the reviewed public surface.
 *
 * Usage:
 *   pnpm --filter @openclinxr/factory-stations exec tsx src/room_chain/cli.ts \
 *     [--seed 205] [--out-dir .openclinxr/evidence/ward-finish-chain] \
 *     [--pass-timeout-ms 3600000]
 */
import { pathToFileURL } from "node:url";
import { runWardFinishChain } from "./run.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runWardFinishChain(process.argv.slice(2));
}
