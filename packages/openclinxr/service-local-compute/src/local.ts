/**
 * Local infrastructure for compute-service contracts: slotted processes and browser capture.
 *
 * Published on the `./local` subpath; the root entrypoint publishes no symbols
 * so the measured root surface stays at the reviewed count.
 */
import { spawn } from "node:child_process";
import type {
  ComputeProcessResult,
  ComputeServices,
} from "@openclinxr/compute-services-spec/contracts";
import { withComputeSlot } from "@openclinxr/compute-slots/slots";

const PYTHON_EXIT_CODE_ARGS = ["--python-exit-code", "1"];

type LocalComputeServicesOptions = {
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
  timeoutKillGraceMs?: number | false;
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
          if (input.timeoutKillGraceMs !== false) {
            setTimeout(() => child.kill("SIGKILL"), input.timeoutKillGraceMs ?? 5_000).unref();
          }
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
        const requestedArgs = [
          ...request.args,
          ...(request.device === undefined ? [] : ["--device", request.device]),
        ];
        const args = request.ensurePythonExitCode === false
          ? requestedArgs
          : failClosedBlenderArgs(requestedArgs);
        return withComputeSlot("blender", { label: request.label, cwd }, () =>
          runProcess({
            command: request.script,
            args,
            cwd,
            timeoutMs: request.timeoutMs,
            env,
            ...(request.timeoutKillGraceMs === undefined
              ? {}
              : { timeoutKillGraceMs: request.timeoutKillGraceMs }),
          }));
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
