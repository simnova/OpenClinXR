/**
 * Infrastructure-neutral contracts for expensive Blender, ML/GPU, and scene-capture work.
 * Application and factory code depend on these interfaces; only infrastructure packages
 * choose local executables, acquire compute slots, or launch browsers.
 */

export interface ServiceBase {
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

export type BlenderRunRequest = {
  /** Blender-compatible executable to launch (including an embedded Infinigen Python). */
  script: string;
  args: string[];
  label: string;
  timeoutMs: number;
  /** Appended as `--device <device>` after the supplied script arguments. */
  device?: BlenderDevice;
};

export interface BlenderService extends ServiceBase {
  run(request: BlenderRunRequest): Promise<ComputeProcessResult>;
}

export type GpuJobRunRequest = {
  command: string;
  args: string[];
  cwd: string;
  label: string;
  timeoutMs: number;
  env: Record<string, string | undefined>;
};

export interface GpuJobService extends ServiceBase {
  run(request: GpuJobRunRequest): Promise<ComputeProcessResult>;
}

export interface SceneCaptureService extends ServiceBase {
  withBrowser<T>(label: string, fn: (browser: unknown) => Promise<T> | T): Promise<T>;
}

export type ComputeServices = {
  blender: BlenderService;
  gpuJob: GpuJobService;
  sceneCapture: SceneCaptureService;
};
