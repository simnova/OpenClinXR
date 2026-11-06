// C33 sidecar recognizer: frames 16 kHz int16 PCM to transcribe.py --serve over
// stdio pipes and resolves each framed request with its parsed JSON line.
import { spawn } from "node:child_process";

/**
 * Lazily spawn `python script --serve model` once with stdio pipes and
 * serialize one framed request at a time (4-byte LE length + int16 bytes).
 */
export function createSidecarRecognizer({ python, script, model = "base.en" }) {
  let child = null;
  let buffer = Buffer.alloc(0);
  let pending = null;
  let chain = Promise.resolve();

  const pump = () => {
    if (pending === null) return;
    const newline = buffer.indexOf(0x0a);
    if (newline < 0) return;
    const line = buffer.subarray(0, newline).toString("utf8");
    buffer = buffer.subarray(newline + 1);
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      current.reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (parsed !== null && typeof parsed === "object" && typeof parsed.error === "string") {
      current.reject(new Error(parsed.error));
      return;
    }
    current.resolve(parsed);
  };

  const failPending = (reason) => {
    if (pending === null) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    current.reject(reason);
  };

  const ensureChild = () => {
    if (child !== null) return child;
    const next = spawn(python, [script, "--serve", model], { stdio: ["pipe", "pipe", "pipe"] });
    next.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      pump();
    });
    next.on("error", (error) => failPending(error));
    next.on("exit", (code, signal) => {
      child = null;
      failPending(new Error(`sidecar exited with code ${code ?? signal ?? "unknown"}`));
    });
    child = next;
    return next;
  };

  const request = (pcm) =>
    new Promise((resolve, reject) => {
      let proc;
      try {
        proc = ensureChild();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      const bytes = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      const frame = Buffer.alloc(4 + bytes.length);
      frame.writeUInt32LE(bytes.length, 0);
      bytes.copy(frame, 4);
      const entry = {
        resolve,
        reject,
        timer: setTimeout(() => {
          if (pending === entry) pending = null;
          reject(new Error("sidecar request timed out after 60 s"));
        }, 60000),
      };
      if (typeof entry.timer.unref === "function") entry.timer.unref();
      pending = entry;
      proc.stdin.write(frame, (error) => {
        if (error !== undefined && error !== null && pending === entry) {
          pending = null;
          clearTimeout(entry.timer);
          reject(error);
        }
      });
    });

  const recognize = async ({ pcm }) => {
    const run = chain.then(() => request(pcm));
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    recognize,
    ready: async () => {
      await recognize({ pcm: new Int16Array(16000) });
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
