import type { ComputeProcessResult } from "@openclinxr/compute-services-spec";
import { createLocalComputeServices } from "@openclinxr/service-local-compute";

export type BlenderProcessResult = ComputeProcessResult;

export function spawnBlenderProcess(
  blender: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<BlenderProcessResult> {
  const script = args.find((arg) => arg.endsWith(".py"));
  return createLocalComputeServices({ cwd: opts.cwd }).blender.run({
    script: blender,
    args,
    label: `blender:${script ?? args[0] ?? "process"}`,
    timeoutMs: opts.timeoutMs,
  });
}
