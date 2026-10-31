/**
 * Machine-wide cap on heavy jobs (hook runs, turbo test/build fan-outs).
 *
 * Usage: tsx tools/openclinxr/openclaw/heavy-slot.ts <label> -- <cmd> [args...]
 *
 * Every session on this machine shares the `heavy` compute-slot pool
 * (~/.openclinxr/locks/heavy; size from compute-slots, default 2, env OPENCLINXR_SLOTS_HEAVY). A job
 * waits for a slot, then runs with its width capped so the pool as a whole
 * stays near the core count: TURBO_CONCURRENCY and CELLIX_VITEST_MAX_WORKERS
 * are set unless the caller already set them.
 *
 * Nested calls (a hook step that runs `pnpm architecture`) see
 * OPENCLINXR_HEAVY_SLOT_HELD and pass straight through, so a holder never
 * waits on a slot its own child needs.
 *
 * Operator 2026-10-30: "Yes, add the cap" after load ran 50-126 on 10 cores.
 */
import { spawnSync } from "node:child_process";
import { availableParallelism, constants } from "node:os";
import { pathToFileURL } from "node:url";
import { readComputeSlotsStatus, withComputeSlot } from "@openclinxr/compute-slots/slots";

export const HEAVY_POOL = "heavy";
export const HELD_ENV = "OPENCLINXR_HEAVY_SLOT_HELD";

export type JobWidth = { turboConcurrency: number; vitestMaxWorkers: number };

/** Split the cores evenly across the pool; turbo tasks x vitest workers <= per-job share. */
export function jobWidth(cores: number, poolSize: number): JobWidth {
  const share = Math.max(1, Math.floor(cores / Math.max(1, poolSize)));
  const turboConcurrency = Math.max(1, Math.floor(share / 2));
  const vitestMaxWorkers = Math.max(1, Math.floor(share / turboConcurrency));
  return { turboConcurrency, vitestMaxWorkers };
}

/** Env for the child: caller-set values win; the held marker always lands. */
export function childEnv(base: NodeJS.ProcessEnv, width: JobWidth): NodeJS.ProcessEnv {
  return {
    ...base,
    [HELD_ENV]: "1",
    TURBO_CONCURRENCY: base["TURBO_CONCURRENCY"] ?? String(width.turboConcurrency),
    CELLIX_VITEST_MAX_WORKERS: base["CELLIX_VITEST_MAX_WORKERS"] ?? String(width.vitestMaxWorkers),
  };
}

export function parseArgs(argv: string[]): { label: string; command: string[] } {
  const sep = argv.indexOf("--");
  if (sep < 1 || sep === argv.length - 1) {
    throw new Error("usage: heavy-slot.ts <label> -- <cmd> [args...]");
  }
  return { label: argv.slice(0, sep).join(" "), command: argv.slice(sep + 1) };
}

function run(command: string[], env: NodeJS.ProcessEnv): number {
  const [file, ...args] = command;
  const result = spawnSync(file as string, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.signal) return 128 + (constants.signals[result.signal] ?? 1);
  return result.status ?? 1;
}

async function main(): Promise<void> {
  const { label, command } = parseArgs(process.argv.slice(2));
  if (process.env[HELD_ENV] === "1") {
    process.exit(run(command, process.env));
  }
  // The pool's size is owned by compute-slots (DEFAULT_SIZES / OPENCLINXR_SLOTS_HEAVY).
  const poolSize = readComputeSlotsStatus().pools.find((pool) => pool.pool === HEAVY_POOL)?.size ?? 1;
  const width = jobWidth(availableParallelism(), poolSize);
  const status = await withComputeSlot(HEAVY_POOL, { label }, (lease) => {
    if (lease.waitedMs > 1000) {
      console.log(`[heavy-slot] ${label}: got slot ${lease.slot} after ${Math.round(lease.waitedMs / 1000)} s`);
    }
    return run(command, childEnv(process.env, width));
  });
  process.exit(status);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
