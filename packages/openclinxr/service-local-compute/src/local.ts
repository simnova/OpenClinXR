/**
 * Local infrastructure for compute-service contracts: slotted processes and browser capture.
 *
 * Published on the `./local` subpath; the root entrypoint publishes no symbols
 * so the measured root surface stays at the reviewed count.
 *
 * Cancellation: on unix each spawned job owns a process group (detached:true,
 * pgid == child.pid). Timeout/abort signal ONLY that group: SIGTERM, then the
 * existing grace SIGKILL. The slot is released only after the owned group is
 * gone (verified via kill(-pgid,0) polling) AND the owned child has closed, so
 * a SIGTERM-ignoring grandchild that outlives an early-closing wrapper still
 * blocks settle until escalation kills it. No unrelated PIDs/pools are touched.
 * Windows has no process groups here: fallback kills only the known child;
 * group-liveness is not available there (tested platform: mac/Linux).
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
  signal?: AbortSignal;
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

function abortErrorFor(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new Error("Compute process aborted");
}

function runProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env: Record<string, string | undefined>;
  timeoutKillGraceMs?: number | false;
  signal?: AbortSignal;
}): Promise<ComputeProcessResult> {
  const signal = input.signal;
  if (signal?.aborted) return Promise.reject(abortErrorFor(signal));
  return new Promise((resolve, reject) => {
    const ownsGroup = process.platform !== "win32";
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: { ...process.env, ...input.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: ownsGroup, // unix only: wrapper + grandchildren share pgid == child.pid
    });
    // Capture once: every later group signal targets exactly this pgid.
    const groupId = child.pid;
    const canSignalGroup = ownsGroup && groupId !== undefined;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelKind: "timeout" | "abort" | null = null;
    let childClosed: { code: number | null; sig: string | null } | null = null;
    let childFailed: Error | null = null;
    let settled = false;
    let cleaned = false;
    const timers: NodeJS.Timeout[] = [];
    const track = (t: NodeJS.Timeout): NodeJS.Timeout => { timers.push(t); return t; };
    const clearAll = (): void => { for (const t of timers) clearTimeout(t); timers.length = 0; };

    function groupAlive(): boolean {
      if (childFailed !== null) return false; // spawn error: no group to wait for
      if (!canSignalGroup || groupId === undefined) {
        return child.exitCode === null && child.signalCode === null;
      }
      try {
        process.kill(-groupId, 0);
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | null)?.code;
        if (code === "ESRCH") return false;
        return true; // EPERM: group exists but unpermitted
      }
    }

    function killOwned(sig: NodeJS.Signals): void {
      if (settled) return; // never kill after settle: guards PID/pgid reuse
      if (child.exitCode !== null || child.signalCode !== null) {
        // Owned child reaped; still attempt group SIGKILL only while unsettled
        // and group verifiably alive (covers early-wrapper-close case).
        if (!groupAlive()) return;
      }
      try {
        if (canSignalGroup && groupId !== undefined) process.kill(-groupId, sig);
        else child.kill(sig);
      } catch { /* ESRCH: group already gone; settle path below handles it */ }
    }

    function cleanup(): void {
      if (cleaned) return; cleaned = true;
      clearAll();
      if (signal) signal.removeEventListener("abort", onAbort);
    }
    // Settle ONLY when owned child closed AND owned group gone — always, not
    // only after cancel. An early-closing stdio:ignore wrapper must not
    // release the slot / clear the deadline while its grandchild group lives.
    function trySettle(): void {
      if (settled) return;
      if (childClosed === null && childFailed === null) return;
      if (groupAlive()) {
        // Owned group still live: hold slot + original deadline, re-poll
        // until gone (deadline/cancel escalation proceeds on its own timers).
        track(setTimeout(() => { if (!settled) trySettle(); }, 50).unref());
        if (cancelKind !== null) pollGroup();
        return;
      }
      settled = true;
      cleanup();
      if (childFailed && !(signal?.aborted && !timedOut)) {
        resolve({ code: 127, stdout, stderr: `${stderr}\n${String(childFailed)}`, timedOut, signal: null });
        return;
      }
      if (signal?.aborted && !timedOut) { reject(abortErrorFor(signal)); return; }
      const closed = childClosed ?? { code: 1, sig: null };
      resolve({ code: closed.code ?? 1, stdout, stderr, timedOut, signal: closed.sig ?? null });
    }

    function fireCancel(kind: "timeout" | "abort"): void {
      if (settled || cancelKind !== null) {
        // Second cancel (e.g. abort racing timeout): keep first kind for
        // timedOut honesty, but re-check liveness.
        pollGroup();
        return;
      }
      cancelKind = kind;
      if (kind === "timeout") timedOut = true;
      killOwned("SIGTERM");
      if (input.timeoutKillGraceMs !== false) {
        track(setTimeout(() => {
          if (settled) return;
          if (groupAlive()) killOwned("SIGKILL");
          pollGroup();
        }, input.timeoutKillGraceMs ?? 5_000).unref());
      }
      pollGroup();
    }

    function pollGroup(): void {
      if (settled) return;
      if (cancelKind === null) return;
      if (!groupAlive()) { trySettle(); return; }
      // Re-poll until escalation kills the group; timers cleared on settle.
      track(setTimeout(pollGroup, 50).unref());
    }

    const onAbort = (): void => fireCancel("abort");
    if (input.timeoutMs > 0) track(setTimeout(() => fireCancel("timeout"), input.timeoutMs).unref());
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    // Abort may have fired between precheck/spawn/listener registration.
    if (signal?.aborted) fireCancel("abort");
    // Pipes are piped (not ignored) in the pipe-hold path; guard against
    // unhandled 'error' on the streams after group SIGKILL tears them down.
    child.stdout.on("error", () => {});
    child.stderr.on("error", () => {});
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error: Error) => {
      childFailed = error;
      if (childClosed === null) childClosed = { code: null, sig: null };
      trySettle();
    });
    child.on("close", (code: number | null, sig: string | null) => {
      childClosed = { code, sig };
      trySettle();
    });
  });
}

export function createLocalComputeServices(options: LocalComputeServicesOptions = {}): ComputeServices {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? {};
  const signal = options.signal;
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
        return withComputeSlot("blender", { label: request.label, cwd, ...(signal === undefined ? {} : { signal }) }, () =>
          runProcess({
            command: request.script,
            args,
            cwd,
            timeoutMs: request.timeoutMs,
            env,
            ...(request.timeoutKillGraceMs === undefined
              ? {}
              : { timeoutKillGraceMs: request.timeoutKillGraceMs }),
            ...(signal === undefined ? {} : { signal }),
          }));
      },
    },
    gpuJob: {
      run: (request) => withComputeSlot("gpu", { label: request.label, cwd: request.cwd, ...(signal === undefined ? {} : { signal }) }, () =>
        runProcess({
          command: request.command,
          args: request.args,
          cwd: request.cwd,
          timeoutMs: request.timeoutMs,
          env: request.env,
          ...(signal === undefined ? {} : { signal }),
        })),
    },
    sceneCapture: {
      withBrowser: async <T>(label: string, fn: (browser: unknown) => Promise<T> | T): Promise<T> =>
        withComputeSlot("browser-capture", {
          label,
          cwd,
          ...(signal === undefined ? {} : { signal }),
        }, async () => {
          const abortError = (): Error => abortErrorFor(signal);
          // Prelaunch check: never start a launch after abort.
          if (signal?.aborted) throw abortError();
          let browser: { close(): Promise<void> };
          try {
            browser = await (options.browserLaunch
              ? options.browserLaunch()
              : launchChromium());
          } catch (error) {
            if (signal?.aborted) throw abortError();
            throw error;
          }
          try {
            // Recheck: abort may have fired while the constructor was
            // pending; the slot stays held until cleanup below finishes.
            if (signal?.aborted) throw abortError();
            return await fn(browser);
          } finally {
            await browser.close();
          }
        }),
    },
  };
}
