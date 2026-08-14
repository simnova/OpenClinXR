/**
 * Collision-safe portless Vite dev server helper for parallel worktrees / evidence jobs.
 *
 * Pattern:
 * 1. Reserve a free port via `findFreePort()` (Vite treats CLI `--port 0` as falsy → 5173,
 *    so true ephemeral bind requires an explicit free port from the OS).
 * 2. Spawn `pnpm --filter <pkg> dev:portless` with that `PORT`.
 * 3. Parse the **actual** bound port from Vite's `Local: http://127.0.0.1:<port>/` line
 *    (covers TOCTOU race / `--strictPort=false` auto-increment).
 * 4. Return `{ port, url, proc }`.
 *
 * Prefer this over hand-rolled spawn + fixed-port fan-out ranges (e.g. 5330–5339).
 */

import {
  type ChildProcessByStdio,
  spawn,
} from "node:child_process";
import type { Readable } from "node:stream";
import { createServer } from "node:net";

export type SpawnPortlessDevServerOptions = {
  /** pnpm package filter, e.g. `@openclinxr/ui-xr`. */
  filter: string;
  /** Extra env merged over `process.env`. `PORT` defaults to `"0"` (dynamic). */
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Max wait for Vite Local: line (default 120s). */
  readyTimeoutMs?: number;
  /**
   * When true (default), after parsing Local: also HTTP-poll until the root
   * responds (or soft timeout). Set false to return as soon as Vite prints Local:.
   */
  httpReadyProbe?: boolean;
};

export type PortlessDevServer = {
  port: number;
  /** Always `http://127.0.0.1:<port>/` (trailing slash). */
  url: string;
  proc: ChildProcessByStdio<null, Readable, Readable>;
};

/**
 * Vite prints either "Local:   http://127.0.0.1:5173/" or localhost.
 *
 * With FORCE_COLOR / a TTY, Vite 5–8 wraps tokens in SGR escapes, e.g.
 *   `\x1b[1mLocal\x1b[22m:\x1b[32m   http://127.0.0.1:49877/\x1b[39m`
 * so a naïve `Local:\s+http` matcher never fires even though the human-readable
 * tail of the same buffer looks correct. Strip CSI sequences before matching.
 */
const LOCAL_URL_RE =
  /Local:\s+https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)\/?/i;

/** CSI / OSC color and style sequences Vite (and picocolors) inject into logs. */
const ANSI_ESCAPE_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

/** Exported for unit tests — pure, no I/O. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

/**
 * Parse the bound port from a Vite (or pnpm-wrapped Vite) stdout/stderr buffer.
 * Returns null when no Local: URL line is present after ANSI strip.
 */
export function parseViteLocalPort(combinedOutput: string): number | null {
  const m = stripAnsi(combinedOutput).match(LOCAL_URL_RE);
  if (!m) return null;
  const port = Number(m[1]);
  if (!Number.isFinite(port) || port <= 0) return null;
  return port;
}

/**
 * Ask the OS for an ephemeral free TCP port on 127.0.0.1.
 * Concurrent callers that still hold their listeners get distinct ports;
 * after close the port may be reused — prefer `PORT=0` on the child when possible.
 */
export function findFreePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, host, () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        server.close(() => reject(new Error("findFreePort: no bound address")));
        return;
      }
      const { port } = addr;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function killProc(proc: ChildProcessByStdio<null, Readable, Readable>): void {
  if (proc.exitCode !== null || proc.killed) return;
  try {
    proc.kill("SIGTERM");
  } catch {
    // ignore
  }
  // Escalate if still alive shortly after.
  setTimeout(() => {
    if (proc.exitCode === null && !proc.killed) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }, 2_000).unref?.();
}

/**
 * Spawn a package's `dev:portless` script, wait until Vite reports its Local URL,
 * parse the **actual** bound port, and return handle + URL.
 *
 * On timeout / early exit the child is killed and the promise rejects.
 */
export async function spawnPortlessDevServer(
  opts: SpawnPortlessDevServerOptions,
): Promise<PortlessDevServer> {
  const readyTimeoutMs = opts.readyTimeoutMs ?? 120_000;
  const httpReadyProbe = opts.httpReadyProbe !== false;
  const cwd = opts.cwd ?? process.cwd();

  // Explicit free port: Vite coerces CLI port 0 → DEFAULT_DEV_PORT 5173 (falsy check).
  // Pre-scan via listen(0) so parallel worktrees do not all stampede on 5173.
  const requested = opts.env?.PORT;
  const portEnv =
    requested !== undefined && requested !== "" && String(requested) !== "0"
      ? String(requested)
      : String(await findFreePort());

  // Drop FORCE_COLOR so Vite does not paint the Local: line when the harness injects it.
  // parseViteLocalPort still strips CSI if colour leaks through (e.g. opts.env re-enables it).
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...opts.env,
    PORT: portEnv,
    NO_COLOR: opts.env?.NO_COLOR ?? process.env.NO_COLOR ?? "1",
    // Never flood evidence runs with rustc/cargo noise from transitive tools.
    RUST_LOG: opts.env?.RUST_LOG ?? process.env.RUST_LOG ?? "error",
  };
  if (opts.env?.FORCE_COLOR === undefined) {
    delete childEnv.FORCE_COLOR;
  }

  const proc = spawn("pnpm", ["--filter", opts.filter, "dev:portless"], {
    cwd,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutBuf = "";
  let stderrBuf = "";
  let settled = false;

  const failTail = () =>
    `stdout tail: ${stripAnsi(stdoutBuf).slice(-600)} | stderr tail: ${stripAnsi(stderrBuf).slice(-600)}`;

  try {
    const bound = await new Promise<PortlessDevServer>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        killProc(proc);
        // If the tail contains a Local: line after strip, the matcher was broken (ANSI);
        // surface that so the next failure is not misread as "server never started".
        const latePort = parseViteLocalPort(`${stdoutBuf}\n${stderrBuf}`);
        const lateHint =
          latePort !== null
            ? ` (Local: line WAS present for port ${latePort} after ANSI strip — matcher/regression bug, not a dead server)`
            : "";
        reject(
          new Error(
            `spawnPortlessDevServer: timeout after ${readyTimeoutMs}ms waiting for Vite Local: line (filter=${opts.filter}).${lateHint} ${failTail()}`,
          ),
        );
      }, readyTimeoutMs);

      const onChunk = (chunk: string, stream: "out" | "err") => {
        if (stream === "out") stdoutBuf += chunk;
        else stderrBuf += chunk;
        if (settled) return;
        const port = parseViteLocalPort(`${stdoutBuf}\n${stderrBuf}`);
        if (port === null) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          port,
          url: `http://127.0.0.1:${port}/`,
          proc,
        });
      };

      proc.stdout.setEncoding("utf8");
      proc.stderr.setEncoding("utf8");
      proc.stdout.on("data", (d: string | Buffer) => onChunk(String(d), "out"));
      proc.stderr.on("data", (d: string | Buffer) => onChunk(String(d), "err"));

      proc.once("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });

      proc.once("exit", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(
          new Error(
            `spawnPortlessDevServer: process exited before ready (code=${code} signal=${signal} filter=${opts.filter}). ${failTail()}`,
          ),
        );
      });
    });

    if (httpReadyProbe) {
      const probeDeadline = Date.now() + Math.min(30_000, readyTimeoutMs);
      while (Date.now() < probeDeadline) {
        if (bound.proc.exitCode !== null) {
          throw new Error(
            `spawnPortlessDevServer: server exited after Local: line (code=${bound.proc.exitCode})`,
          );
        }
        try {
          const res = await fetch(bound.url);
          // Any HTTP response means the listener is up (even 404).
          if (res.status > 0) return bound;
        } catch {
          // retry
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      // Local: already printed — return even if probe is slow (e.g. heavy optimizeDeps).
    }

    return bound;
  } catch (err) {
    killProc(proc);
    throw err;
  }
}

/** Best-effort SIGTERM (then SIGKILL) for a portless child. */
export function stopPortlessDevServer(proc: ChildProcessByStdio<null, Readable, Readable> | null | undefined): void {
  if (!proc) return;
  killProc(proc);
}
