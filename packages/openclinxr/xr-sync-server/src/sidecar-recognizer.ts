// C34 faster-whisper sidecar recognizer (dev entrypoint only, never exported
// from index.ts). TypeScript port of
// tools/openclinxr/evidence/xr-sync/stt/sidecar-recognizer.mjs: frames 16 kHz
// int16 PCM to `python script --serve model` over stdio pipes (4-byte LE
// length + int16 bytes in, one JSON line {text, confidence} or {error} out)
// with serialized requests and a 60 s request timeout.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { SpeechRecognizer } from "./speech-audio.js";

export interface SidecarRecognizerOptions {
  python: string;
  script: string;
  model?: string;
  /** Probe (ready()) timeout in ms. Defaults to 180000. */
  probeTimeoutMs?: number;
  /** Per-request timeout in ms. Defaults to 60000. */
  requestTimeoutMs?: number;
}

interface PendingEntry {
  resolve: (value: { text: string; confidence: number }) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const DEFAULT_PROBE_TIMEOUT_MS = 180000;
const REQUEST_TIMEOUT_MS = 60000;

export function createSidecarRecognizer(opts: SidecarRecognizerOptions): {
  recognize: SpeechRecognizer;
  ready: (timeoutMs?: number) => Promise<void>;
  close: () => void;
} {
  const model = opts.model ?? "base.en";
  let child: ChildProcess | null = null;
  let buffer = Buffer.alloc(0);
  let pending: PendingEntry | null = null;
  let chain: Promise<void> = Promise.resolve();

  const pump = (): void => {
    if (pending === null) return;
    const newline = buffer.indexOf(0x0a);
    if (newline < 0) return;
    const line = buffer.subarray(0, newline).toString("utf8");
    buffer = buffer.subarray(newline + 1);
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      current.reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (isRecord(parsed) && typeof parsed["error"] === "string") {
      current.reject(new Error(parsed["error"]));
      return;
    }
    current.resolve(parsed as { text: string; confidence: number });
  };

  const failPending = (reason: Error): void => {
    if (pending === null) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    current.reject(reason);
  };

  const ensureChild = (): ChildProcess => {
    if (child !== null) return child;
    buffer = Buffer.alloc(0);
    const next = spawn(opts.python, [opts.script, "--serve", model], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Swallow stdin EPIPE (and any spawn plumbing error) here so it can only
    // surface as a request rejection, never an uncaught exception.
    next.on("error", (error: Error) => {
      if (child === next) failPending(error);
    });
    next.stdin?.on("error", () => undefined);
    // Drain stderr (model load chatter) so a full pipe never stalls the child.
    next.stderr?.on("data", () => undefined);
    next.stdout?.on("data", (chunk: Buffer) => {
      if (child !== next) return;
      buffer = Buffer.concat([buffer, chunk]);
      pump();
    });
    next.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      if (child !== next) return;
      child = null;
      failPending(new Error(`sidecar exited with code ${code ?? signal ?? "unknown"}`));
    });
    child = next;
    return next;
  };

  const request = (pcm: Int16Array, timeoutMs: number, label: string): Promise<{ text: string; confidence: number }> =>
    new Promise<{ text: string; confidence: number }>((resolve, reject) => {
      let proc: ChildProcess;
      try {
        proc = ensureChild();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      const stdin = proc.stdin;
      if (stdin === null || stdin === undefined) {
        reject(new Error("sidecar stdin unavailable"));
        return;
      }
      const bytes = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      const frame = Buffer.alloc(4 + bytes.length);
      frame.writeUInt32LE(bytes.length, 0);
      bytes.copy(frame, 4);
      const entry: PendingEntry = {
        resolve,
        reject,
        timer: setTimeout(() => {
          if (pending === entry) pending = null;
          // A late reply from this request must never answer the next one: drop the child and its buffered output.
          try {
            child?.kill();
          } catch {
            // Already gone.
          }
          child = null;
          buffer = Buffer.alloc(0);
          reject(new Error(`sidecar ${label} timed out after ${timeoutMs} ms`));
        }, timeoutMs),
      };
      if (typeof entry.timer.unref === "function") entry.timer.unref();
      pending = entry;
      stdin.write(frame, (error: Error | null | undefined) => {
        if (error !== undefined && error !== null && pending === entry) {
          pending = null;
          clearTimeout(entry.timer);
          reject(error);
        }
      });
    });

  const enqueue = (pcm: Int16Array, timeoutMs: number, label: string): Promise<{ text: string; confidence: number }> => {
    const run = chain.then(() => request(pcm, timeoutMs, label));
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const recognize: SpeechRecognizer = ({ pcm }) => enqueue(pcm, opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS, "request");

  return {
    recognize,
    // The probe covers the model load, so it carries its own (longer) timeout instead of the per-request one.
    ready: async (timeoutMs?: number) => {
      await enqueue(new Int16Array(16000), timeoutMs ?? opts.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS, "probe");
    },
    close: () => {
      try {
        child?.kill();
      } catch {
        // Already gone; close is idempotent.
      }
      child = null;
    },
  };
}

const DEFAULT_PYTHON = "/Volumes/files/openclinxr-assets/stt/venv/bin/python";

function hasSlash(path: string): boolean {
  return path.includes("/");
}

/** Boot the sidecar for the dev entrypoint. Never throws. */
export async function bootSidecarRecognizer(
  env: Record<string, string | undefined>,
  defaults: { script: string },
  hooks?: { onCreated(close: () => void): void },
): Promise<{ recognizer: SpeechRecognizer | null; close: () => void; reason: string }> {
  try {
    if (env["XR_SYNC_STT"] === "off") {
      return { recognizer: null, close: () => undefined, reason: "disabled by XR_SYNC_STT=off" };
    }
    const python = env["XR_SYNC_STT_PYTHON"] ?? DEFAULT_PYTHON;
    const script = env["XR_SYNC_STT_SCRIPT"] ?? defaults.script;
    const model = env["XR_SYNC_STT_MODEL"] ?? "base.en";
    if (hasSlash(python) && !existsSync(python)) {
      return { recognizer: null, close: () => undefined, reason: `missing python: ${python}` };
    }
    if (hasSlash(script) && !existsSync(script)) {
      return { recognizer: null, close: () => undefined, reason: `missing script: ${script}` };
    }
    const requestTimeoutMs = Number(env["XR_SYNC_STT_REQUEST_TIMEOUT_MS"]);
    const sidecar = createSidecarRecognizer({ python, script, model, ...(Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 ? { requestTimeoutMs } : {}) });
    hooks?.onCreated(sidecar.close);
    try {
      await sidecar.ready();
    } catch (error) {
      sidecar.close();
      const message = error instanceof Error ? error.message : String(error);
      return { recognizer: null, close: () => undefined, reason: message.slice(0, 160) };
    }
    return { recognizer: sidecar.recognize, close: sidecar.close, reason: model };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { recognizer: null, close: () => undefined, reason: message.slice(0, 160) };
  }
}
