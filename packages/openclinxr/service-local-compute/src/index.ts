/**
 * Local infrastructure for compute-service contracts: slotted processes and browser capture.
 */
import { spawn } from "node:child_process";
import type {
  ComputeProcessResult,
  ComputeServices,
} from "@openclinxr/compute-services-spec";
import { withComputeSlot } from "@openclinxr/compute-slots";

const PYTHON_EXIT_CODE_ARGS = ["--python-exit-code", "1"];

export type LocalComputeServicesOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  browserLaunch?: () => Promise<{ close(): Promise<void> }>;
};

async function launchChromium(): Promise<{ close(): Promise<void> }> {
  // Keep the local-only provider out of browser application bundles that consume
  // factory-stations contracts. It resolves only when scene capture actually runs.
  const provider = await import(/* @vite-ignore */ "playwright") as {
    chromium: { launch(options: { headless: boolean }): Promise<{ close(): Promise<void> }> };
  };
  return provider.chromium.launch({ headless: true });
}

function failClosedBlenderArgs(args: string[]): string[] {
  if (!args.includes("--python") || args.includes("--python-exit-code")) return args;
  const backgroundAt = args.indexOf("--background");
  if (backgroundAt === -1) return [...PYTHON_EXIT_CODE_ARGS, ...args];
  return [...args.slice(0, backgroundAt + 1), ...PYTHON_EXIT_CODE_ARGS, ...args.slice(backgroundAt + 1)];
}

function runProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env: Record<string, string | undefined>;
}): Promise<ComputeProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: { ...process.env, ...input.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result: ComputeProcessResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = input.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
        }, input.timeoutMs)
      : null;
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error: Error) => {
      if (timer) clearTimeout(timer);
      finish({ code: 127, stdout, stderr: `${stderr}\n${String(error)}`, timedOut, signal: null });
    });
    child.on("close", (code: number | null, signal: string | null) => {
      if (timer) clearTimeout(timer);
      finish({ code: code ?? 1, stdout, stderr, timedOut, signal: signal ?? null });
    });
  });
}

export function createLocalComputeServices(options: LocalComputeServicesOptions = {}): ComputeServices {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? {};
  return {
    blender: {
      run: (request) => {
        const args = failClosedBlenderArgs([
          ...request.args,
          ...(request.device === undefined ? [] : ["--device", request.device]),
        ]);
        return withComputeSlot("blender", { label: request.label, cwd }, () =>
          runProcess({ command: request.script, args, cwd, timeoutMs: request.timeoutMs, env }));
      },
    },
    gpuJob: {
      run: (request) => withComputeSlot("gpu", { label: request.label, cwd: request.cwd }, () =>
        runProcess({
          command: request.command,
          args: request.args,
          cwd: request.cwd,
          timeoutMs: request.timeoutMs,
          env: request.env,
        })),
    },
    sceneCapture: {
      withBrowser: async <T>(label: string, fn: (browser: unknown) => Promise<T> | T): Promise<T> =>
        withComputeSlot("browser-capture", { label, cwd }, async () => {
          const browser = options.browserLaunch
            ? await options.browserLaunch()
            : await launchChromium();
          try {
            return await fn(browser);
          } finally {
            await browser.close();
          }
        }),
    },
  };
}

export type {
  BlenderDevice,
  BlenderRunRequest,
  BlenderService,
  ComputeProcessResult,
  ComputeServices,
  GpuJobRunRequest,
  GpuJobService,
  SceneCaptureService,
  ServiceBase,
} from "@openclinxr/compute-services-spec";
