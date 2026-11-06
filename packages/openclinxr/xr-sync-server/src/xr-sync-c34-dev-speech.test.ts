import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type EncounterSnapshot, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C34 RED (planted by lane manager, 2026-11-06): the dev entrypoint wires the faster-whisper sidecar recognizer.
// Contract (names are the spec):
//   room state field `speechAvailable: boolean` (true iff the server has a speech recognizer); snapshot field `speechAvailable?: boolean`.
//   dev-server.ts reads env: XR_SYNC_STT=off disables; XR_SYNC_STT_PYTHON (default /Volumes/files/openclinxr-assets/stt/venv/bin/python),
//   XR_SYNC_STT_SCRIPT (default <repo>/tools/openclinxr/evidence/xr-sync/stt/transcribe.py), XR_SYNC_STT_MODEL (default base.en).
//   Boot: spawn `<python> <script> --serve <model>`, probe it with 1 s of silence (timeout 180 s). Probe ok -> recognizer injected, stdout line
//   `xr-sync speech ready model=<model>` BEFORE the `xr-sync listening ...` line. Missing python/script, spawn error, early exit, probe failure,
//   or XR_SYNC_STT=off -> no recognizer, stdout line `xr-sync speech unavailable: <reason>`, server still listens and joins; speech-audio is
//   rejected "speech-recognizer-unavailable". It must never crash the process. SIGTERM also kills the sidecar.
//   Framing (unchanged from the c33 harness sidecar): 4-byte LE length + int16 PCM in, one JSON line {text, confidence} (or {error}) out.
const FAKE_SCRIPT = `
let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    if (buf.length < 4) return;
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) return;
    buf = buf.subarray(4 + len);
    process.stdout.write(JSON.stringify({ text: "fake heard " + len / 2 + " samples", confidence: 0.9 }) + "\\n");
  }
});
`;
const children: ChildProcess[] = [];
const dirs: string[] = [];
const servers: EncounterServer[] = [];
const conns: SyncConnection[] = [];
afterEach(async () => {
  while (conns.length > 0) await conns.pop()?.leave().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
  while (children.length > 0) children.pop()?.kill("SIGKILL");
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === "object" && address !== null ? address.port : 0));
    });
  });
}
async function bootDev(env: Record<string, string>): Promise<{ port: number; lines: string[]; child: ChildProcess; exited: () => number | null | undefined }> {
  const port = await freePort();
  const child = spawn("../../../node_modules/.bin/tsx", ["src/dev-server.ts"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), XR_SYNC_INSTANCE: "c34-test", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  const lines: string[] = [];
  let code: number | null | undefined;
  child.on("exit", (c) => { code = c; });
  let pending = "";
  child.stdout?.on("data", (d: Buffer) => { pending += d.toString(); const parts = pending.split("\n"); pending = parts.pop() ?? ""; lines.push(...parts); });
  const deadline = Date.now() + 60000;
  while (!lines.some((l) => l.startsWith("xr-sync listening"))) {
    if (code !== undefined) throw new Error(`dev-server exited ${code}: ${lines.join(" | ")}`);
    if (Date.now() > deadline) throw new Error(`dev-server did not listen: ${lines.join(" | ")}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  return { port, lines, child, exited: () => code };
}
async function snapshotOf(port: number): Promise<{ learner: SyncConnection; snapshot: EncounterSnapshot }> {
  const learner = await connect(`ws://127.0.0.1:${port}`, { roomOptions: { actors: ["a1", "a2"] } });
  conns.push(learner);
  const snapshot = await new Promise<EncounterSnapshot>((resolve) => { learner.onState((s) => resolve(s)); });
  return { learner, snapshot };
}
const pcm = (samples: number): Uint8Array => new Uint8Array(new Int16Array(samples).fill(500).buffer);
async function fakeSidecar(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "c34-stt-"));
  dirs.push(dir);
  const script = join(dir, "fake-stt.mjs");
  await writeFile(script, FAKE_SCRIPT);
  return script;
}

describe("xr-sync-server C34 speech availability", () => {
  it("createEncounterServer reports speechAvailable from the injected recognizer", async () => {
    const withRecognizer = await createEncounterServer({ speechRecognizer: async () => ({ text: "x", confidence: 0.5 }) } as never);
    servers.push(withRecognizer);
    const a = await connect(withRecognizer.url, { roomOptions: { actors: ["a1"] } });
    conns.push(a);
    expect((await new Promise<EncounterSnapshot>((r) => a.onState((s) => r(s)))).speechAvailable).toBe(true);
    const without = await createEncounterServer({} as never);
    servers.push(without);
    const b = await connect(without.url, { roomOptions: { actors: ["a1"] } });
    conns.push(b);
    expect((await new Promise<EncounterSnapshot>((r) => b.onState((s) => r(s)))).speechAvailable).toBe(false);
  }, 30000);

  it("the dev entrypoint wires the sidecar: ready line first, snapshot true, speech-audio recognized", async () => {
    const script = await fakeSidecar();
    const dev = await bootDev({ XR_SYNC_STT_PYTHON: process.execPath, XR_SYNC_STT_SCRIPT: script, XR_SYNC_STT_MODEL: "tiny.en" });
    const ready = dev.lines.findIndex((l) => l.startsWith("xr-sync speech ready model=tiny.en"));
    expect(ready).toBeGreaterThanOrEqual(0);
    expect(ready).toBeLessThan(dev.lines.findIndex((l) => l.startsWith("xr-sync listening")));
    const { learner, snapshot } = await snapshotOf(dev.port);
    expect(snapshot.speechAvailable).toBe(true);
    const ack = (await learner.sendIntent("speech-audio" as never, { pcm: pcm(16000), sampleRate: 16000 })) as { status: string; transcript?: { text: string; confidence: number } };
    expect(ack).toMatchObject({ status: "ack", transcript: { text: "fake heard 16000 samples", confidence: 0.9 } });
  }, 90000);

  it.each([
    ["missing python", (script: string) => ({ XR_SYNC_STT_PYTHON: "/nonexistent/python", XR_SYNC_STT_SCRIPT: script })],
    ["missing script", () => ({ XR_SYNC_STT_PYTHON: process.execPath, XR_SYNC_STT_SCRIPT: "/nonexistent/transcribe.py" })],
    ["sidecar exits at boot", () => ({ XR_SYNC_STT_PYTHON: process.execPath, XR_SYNC_STT_SCRIPT: "-e", XR_SYNC_STT_MODEL: "process.exit(3)" })],
    ["disabled by env", (script: string) => ({ XR_SYNC_STT: "off", XR_SYNC_STT_PYTHON: process.execPath, XR_SYNC_STT_SCRIPT: script })],
  ])("%s: the server stays up, reports speech unavailable, rejects speech-audio", async (_name, makeEnv) => {
    const script = await fakeSidecar();
    const dev = await bootDev((makeEnv as (s: string) => Record<string, string>)(script));
    expect(dev.lines.some((l) => l.startsWith("xr-sync speech unavailable:"))).toBe(true);
    expect(dev.lines.some((l) => l.startsWith("xr-sync speech ready"))).toBe(false);
    const { learner, snapshot } = await snapshotOf(dev.port);
    expect(snapshot.speechAvailable).toBe(false);
    expect(await learner.sendIntent("speech-audio" as never, { pcm: pcm(16000), sampleRate: 16000 })).toMatchObject({ status: "reject", reason: "speech-recognizer-unavailable" });
    expect(dev.exited()).toBeUndefined();
  }, 90000);
});
