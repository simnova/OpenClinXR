/**
 * Private process helpers for the dark-factory multi-case chain.
 *
 * Blender work runs through the existing local-compute facade
 * (`@openclinxr/service-local-compute/local`), which owns the blender
 * compute slot, the child process GROUP (SIGTERM, then SIGKILL escalation),
 * and releases the slot only after the group is gone — so a SIGTERM-ignoring
 * grandchild cannot outlive the batch. This module only adds the chain's
 * failure policy on top: non-zero exit or timeout is a throw with stderr
 * context, never a masked success. No direct child_process launches here.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";

export function uniqueRunDir(evidenceRoot: string): string {
  mkdirSync(evidenceRoot, { recursive: true });
  return mkdtempSync(path.join(evidenceRoot, "runs-"));
}

const BLENDER_TIMEOUT_MS = 45 * 60 * 1000;

export async function runBlenderExec(
  label: string,
  argv: string[],
  cwd: string,
  signal?: AbortSignal,
  timeoutMs: number = BLENDER_TIMEOUT_MS,
): Promise<string> {
  signal?.throwIfAborted();
  const services = createLocalComputeServices({
    cwd,
    ...(signal === undefined ? {} : { signal }),
  });
  const result = await services.blender.run({
    script: "python3",
    args: argv,
    label,
    timeoutMs,
    ensurePythonExitCode: false,
  });
  if (result.timedOut) {
    throw new Error(`${label}: Blender work timed out after ${timeoutMs}ms (stderr tail: ${result.stderr.slice(-500)})`);
  }
  if (result.code !== 0) {
    throw new Error(`${label}: Blender work exited code ${result.code} (stderr tail: ${result.stderr.slice(-500)})`);
  }
  return result.stdout;
}
