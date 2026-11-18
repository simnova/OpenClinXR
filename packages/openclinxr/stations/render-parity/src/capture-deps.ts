/** Injected capture dependencies: structural seam so the station never imports evidence lib copies (station render-parity). */

import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export type CaptureServerProc = ChildProcessByStdio<null, Readable, Readable>;

export type CaptureServerHandle = {
  port?: number;
  /** Always `http://127.0.0.1:<port>/` (trailing slash). */
  url: string;
  proc: CaptureServerProc;
};

/** Minimal page surface the capture actually calls (structural: real pages satisfy it). */
export type CapturePage = {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  addInitScript(script: string): Promise<unknown>;
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate(pageFunction: string | ((...args: never[]) => unknown), arg?: unknown): Promise<unknown>;
  waitForFunction(fn: () => boolean, arg?: unknown, opts?: { timeout?: number }): Promise<unknown>;
  on(event: string, listener: (payload: unknown) => void): void;
  locator(selector: string): {
    count(): Promise<number>;
    screenshot(opts: { path: string }): Promise<unknown>;
  };
};

export type CaptureBrowser = {
  newPage(opts?: { viewport?: { width: number; height: number }; deviceScaleFactor?: number }): Promise<CapturePage>;
  close(): Promise<void>;
};

/** Chromium surface the capture needs: launch only. */
export type CaptureChromium = {
  launch(opts?: { headless?: boolean; channel?: string; args?: string[] }): Promise<CaptureBrowser>;
};

/** Everything runRuntimeCapture takes from the evidence lib side, passed in by the thin CLI. */
export type CaptureDeps = {
  chromium: CaptureChromium;
  spawnPortlessDevServer(opts: {
    filter: string;
    cwd?: string;
    readyTimeoutMs?: number;
  }): Promise<CaptureServerHandle>;
  stopPortlessDevServer(proc: CaptureServerProc | null | undefined): Promise<void>;
  BROWSER_PAGE_GLOBALS_INIT_SCRIPT: string;
};

/**
 * Spawn a portless dev server, run `fn`, then stop the server. A failed stop
 * is reported and rejects (after the capture result is already written by
 * `fn`); a body error still propagates when the stop succeeds.
 */
export async function withPortlessServer<T>(
  deps: Pick<CaptureDeps, "spawnPortlessDevServer" | "stopPortlessDevServer">,
  opts: { filter: string; cwd?: string; readyTimeoutMs?: number },
  fn: (server: CaptureServerHandle) => Promise<T>,
): Promise<T> {
  const server = await deps.spawnPortlessDevServer(opts);
  let bodyError: unknown = null;
  let result: T | undefined;
  try {
    result = await fn(server);
  } catch (error: unknown) {
    bodyError = error;
  }
  try {
    await deps.stopPortlessDevServer(server.proc);
  } catch (stopError: unknown) {
    console.error(`[teardown] stopPortlessDevServer failed: ${String(stopError)}`);
    throw bodyError !== null ? bodyError : stopError;
  }
  if (bodyError !== null) throw bodyError;
  return result as T;
}
