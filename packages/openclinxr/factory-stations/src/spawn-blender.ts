import type { ComputeProcessResult } from "@openclinxr/compute-services-spec/contracts";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";

export type BlenderProcessResult = ComputeProcessResult;

export function spawnBlenderProcess(
  blender: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; signal?: AbortSignal },
): Promise<BlenderProcessResult> {
  const script = args.find((arg) => arg.endsWith(".py"));
  return createLocalComputeServices({ cwd: opts.cwd, ...(opts.signal === undefined ? {} : { signal: opts.signal }) }).blender.run({
    script: blender,
    args,
    label: `blender:${script ?? args[0] ?? "process"}`,
    timeoutMs: opts.timeoutMs,
  });
}
