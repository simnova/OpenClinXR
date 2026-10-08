/**
 * Infrastructure-neutral contracts for expensive Blender, ML/GPU, and scene-capture work.
 * Application and factory code depend on these interfaces; only infrastructure packages
 * choose local executables, acquire compute slots, or launch browsers.
 *
 * Published on the `./contracts` subpath; the root entrypoint publishes no symbols
 * so the measured root surface stays at the reviewed count.
 */

interface ServiceBase {
  startUp?(): Promise<unknown> | unknown;
  shutDown?(): Promise<void> | void;
}

export type ComputeProcessResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  signal: string | null;
};

export type BlenderDevice = "metal" | "cpu";

type BlenderRunRequest = {
  /** Blender-compatible executable to launch (including an embedded Infinigen Python). */
  script: string;
  args: string[];
  label: string;
  timeoutMs: number;
  /** Preserve a legacy launcher's argv when false; defaults to fail-closed Python execution. */
  ensurePythonExitCode?: boolean;
  /** Send SIGKILL this many milliseconds after a timeout SIGTERM; false preserves SIGTERM-only callers. */
  timeoutKillGraceMs?: number | false;
  /** Appended as `--device <device>` after the supplied script arguments. */
  device?: BlenderDevice;
};

interface BlenderService extends ServiceBase {
  run(request: BlenderRunRequest): Promise<ComputeProcessResult>;
}

type GpuJobRunRequest = {
  command: string;
  args: string[];
  cwd: string;
  label: string;
  timeoutMs: number;
  env: Record<string, string | undefined>;
};

interface GpuJobService extends ServiceBase {
  run(request: GpuJobRunRequest): Promise<ComputeProcessResult>;
}

interface SceneCaptureService extends ServiceBase {
  withBrowser<T>(label: string, fn: (browser: unknown) => Promise<T> | T): Promise<T>;
}

export type ComputeServices = {
  blender: BlenderService;
  gpuJob: GpuJobService;
  sceneCapture: SceneCaptureService;
};
