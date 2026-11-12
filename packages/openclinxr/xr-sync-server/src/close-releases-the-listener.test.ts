import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "@openclinxr/xr-sync-client";
import { afterEach, describe, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C2SRV RED: after `await handle.close()` resolves, the server's port must
// accept no TCP connection and the process must hold no handle from it, for
// both the live and the replay branch (RR1 run-18: replayServer.close()
// resolved, yet node still held LISTEN on the replay port until SIGKILL).
// close() is server.gracefullyShutdown(false); the httpServer handed to
// WebSocketTransport is never closed by our code.
// Contract: for each branch (live | replay) x (no client | one ws client
// left connected), after close() (1) net.connect to the port gets
// ECONNREFUSED and (2) a spawned child doing create->connect->close exits by
// itself with code 0. No process.exit, no server.unref, no socket destroying
// in this test: close() itself must release the listener.

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(HERE, "..", "..", "..", "..");
const SERVER_SRC = join(HERE, "index.ts");
const CLIENT_SRC = join(WORKSPACE_ROOT, "packages", "openclinxr", "xr-sync-client", "src", "index.ts");
// Single-process spawn (tsk_c14ed0dae359deca): node runs the child directly
// with the tsx ESM loader (resolved specifier; tsx 4.21.0 maps "./esm" to
// ./dist/esm/index.mjs), so the failure-path SIGKILL below lands on the
// process that holds the listener instead of a wrapper whose node grandchild
// would survive with ppid 1.
const TSX_ESM_LOADER = import.meta.resolve("tsx/esm");

// Child budget: tsx startup plus colyseus boot is a few seconds. This is a
// fail-fast ceiling, not a lengthened timeout: a released listener lets the
// child exit in well under it; a leaked listener hangs past it.
const CHILD_TIMEOUT_MS = 15000;
const STEP_MS = 200;

// ReplayDir fixture copied from xr-sync-c10-station-replay.test.ts (the
// recorded station-1 trace it replays; station-2 kept so the index matches
// the fixture under test).
const ev = (kind: string, extra: Record<string, unknown> = {}) => ({ seq: null, kind, actorId: "", turnId: null, ...extra });
const TRACE_S1 = {
  schema: "openclinxr.xr-sync.conversation-trace.v1",
  stationId: "station-1",
  events: [
    ev("phase-changed", { phase: "doorway" }), ev("phase-changed", { phase: "encounter" }),
    ev("select-actor", { seq: 10, actorId: "a2" }), ev("utterance-start", { seq: 11 }),
    ev("utterance-end", { seq: 12, actorId: "a2", turnId: 1 }), ev("turn-completed", { actorId: "a2", turnId: 1 }),
    ev("utterance-start", { seq: 13 }), ev("utterance-end", { seq: 14, actorId: "a2", turnId: 2 }),
    ev("turn-completed", { actorId: "a2", turnId: 2 }), ev("phase-changed", { phase: "note" }),
    ev("phase-changed", { phase: "closed" }),
  ],
  turns: [
    { turnId: 1, actorId: "a2", replyId: "fx-reply-p", cueId: "cue-fx-p", startSeq: 12, end: "completed", endSeq: null },
    { turnId: 2, actorId: "a2", replyId: "fx-reply-q", cueId: "cue-fx-q", startSeq: 14, end: "completed", endSeq: null },
  ],
  emotions: [
    { from: "neutral", to: "reassured", trigger: "learner_acknowledgement", changed: true, turnIndex: 1 },
    { from: "reassured", to: "reassured", trigger: "learner_acknowledgement", changed: false, turnIndex: 2 },
  ],
};
const TRACE_S2 = {
  schema: "openclinxr.xr-sync.conversation-trace.v1",
  stationId: "station-2",
  events: [
    ev("phase-changed", { phase: "doorway" }), ev("observer-joined"), ev("phase-changed", { phase: "encounter" }),
    ev("select-actor", { seq: 500, actorId: "a1" }), ev("utterance-start", { seq: 519 }),
    ev("utterance-end", { seq: 521, actorId: "a1", turnId: 1 }), ev("turn-completed", { actorId: "a1", turnId: 1 }),
    ev("utterance-start", { seq: 559 }), ev("utterance-end", { seq: 561, actorId: "a1", turnId: 2 }),
    ev("utterance-start", { seq: 563, turnId: 2 }), ev("utterance-end", { seq: 565, actorId: "a1", turnId: 3 }),
    ev("turn-completed", { actorId: "a1", turnId: 3 }), ev("phase-changed", { phase: "note" }),
    ev("phase-changed", { phase: "closed" }), ev("observer-left"),
  ],
  turns: [
    { turnId: 1, actorId: "a1", replyId: "fx-reply-a", cueId: "cue-fx-a", startSeq: 521, end: "completed", endSeq: null },
    { turnId: 2, actorId: "a1", replyId: "fx-reply-b", cueId: "cue-fx-b", startSeq: 561, end: "interrupted", endSeq: 563 },
    { turnId: 3, actorId: "a1", replyId: "fx-reply-c", cueId: "cue-fx-c", startSeq: 565, end: "completed", endSeq: null },
  ],
  emotions: [
    { from: "neutral", to: "reassured", trigger: "learner_acknowledgement", changed: true, turnIndex: 1 },
    { from: "reassured", to: "reassured", trigger: "learner_acknowledgement", changed: false, turnIndex: 2 },
    { from: "reassured", to: "concerned", trigger: "learner_interruption", changed: true, turnIndex: 2 },
    { from: "concerned", to: "neutral", trigger: "learner_acknowledgement", changed: true, turnIndex: 3 },
  ],
};

function writeReplayDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-sync-close-replay-"));
  writeFileSync(join(dir, "S1fx.conversation-trace.json"), JSON.stringify(TRACE_S1));
  writeFileSync(join(dir, "S2fx.conversation-trace.json"), JSON.stringify(TRACE_S2));
  const entry = (t: { stationId: string; turns: Array<{ end: string }> }, i: number, file: string, obs: boolean) => ({
    stationId: t.stationId, stationIndex: i, traceFile: file, phases: ["doorway", "encounter", "note", "closed"],
    turnCount: t.turns.length, turnEnds: t.turns.map((x) => x.end), observerPresent: obs,
  });
  writeFileSync(join(dir, "exam-session.review-index.json"), JSON.stringify({
    schema: "openclinxr.xr-sync.exam-session-review-index.v1", complete: true, stationCount: 2,
    stations: [entry(TRACE_S1, 0, "S1fx.conversation-trace.json", false), entry(TRACE_S2, 1, "S2fx.conversation-trace.json", true)],
  }));
  return dir;
}

const servers: EncounterServer[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});

// Probe assertion (1): a fresh TCP connect to a closed listener fails
// ECONNREFUSED. The probe socket is never destroyed or unrefed here: on the
// expected error path the unconnected socket is already dead, and on the
// unexpected connect path the test fails and the worker is torn down.
function expectTcpRefused(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      reject(new Error(`port ${port} still accepts TCP after close()`));
    });
    socket.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ECONNREFUSED") resolve();
      else reject(error);
    });
  });
}

type Branch = "live" | "replay";

// Probe assertion (2): a child process that boots the same branch,
// optionally leaves one ws client connected, awaits close(), and then
// returns must exit by itself with code 0 inside CHILD_TIMEOUT_MS. A leaked
// listener (or any leaked handle) keeps the child alive past the ceiling and
// fails the test. The kill below only fires on that failure path, to keep a
// hung child from hanging the suite; passing runs never touch it.
function expectChildExits(branch: Branch, withClient: boolean, replayDir: string): Promise<void> {
  const childSource = `import { connect } from ${JSON.stringify(CLIENT_SRC)};
import { createEncounterServer } from ${JSON.stringify(SERVER_SRC)};
async function main(): Promise<void> {
  const branch = process.argv[1] as "live" | "replay";
  const withClient = process.argv[2] === "with-client";
  const replayDir = process.argv[3] === "-" ? undefined : process.argv[3];
  const server = await createEncounterServer(branch === "replay" ? { replayDir, replayStepMs: ${STEP_MS} } : {});
  if (withClient) {
    await connect(server.url, branch === "replay" ? { roomOptions: { replayStationId: "station-1" } } : {});
  }
  await server.close();
}
void main();
`;
  const childFile = join(mkdtempSync(join(tmpdir(), "xr-sync-close-child-")), "close-child.mts");
  writeFileSync(childFile, childSource);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", TSX_ESM_LOADER, childFile, branch, withClient ? "with-client" : "no-client", branch === "replay" ? replayDir : "-"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`child (${branch}, ${withClient ? "with-client" : "no-client"}) still alive after close() + ${CHILD_TIMEOUT_MS} ms; output: ${output.slice(0, 2000)}`));
    }, CHILD_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`child (${branch}, ${withClient ? "with-client" : "no-client"}) exited with code ${code}; output: ${output.slice(0, 2000)}`));
    });
  });
}

async function bootBranch(branch: Branch, replayDir: string): Promise<EncounterServer> {
  const server = await createEncounterServer(branch === "replay" ? { replayDir, replayStepMs: STEP_MS } : {});
  servers.push(server);
  return server;
}

describe("close() releases the listener", () => {
  it("live server, no client: port refuses TCP and a child exits by itself", async () => {
    const server = await bootBranch("live", "");
    const port = server.port;
    await server.close();
    await expectTcpRefused(port);
    await expectChildExits("live", false, "");
  }, 60000);

  it("live server, one ws client left connected: port refuses TCP and a child exits by itself", async () => {
    const server = await bootBranch("live", "");
    await connect(server.url);
    const port = server.port;
    await server.close();
    await expectTcpRefused(port);
    await expectChildExits("live", true, "");
  }, 60000);

  it("replay server, no client: port refuses TCP and a child exits by itself", async () => {
    const replayDir = writeReplayDir();
    const server = await bootBranch("replay", replayDir);
    const port = server.port;
    await server.close();
    await expectTcpRefused(port);
    await expectChildExits("replay", false, replayDir);
  }, 60000);

  it("replay server, one ws client left connected: port refuses TCP and a child exits by itself", async () => {
    const replayDir = writeReplayDir();
    const server = await bootBranch("replay", replayDir);
    await connect(server.url, { roomOptions: { replayStationId: "station-1" } });
    const port = server.port;
    await server.close();
    await expectTcpRefused(port);
    await expectChildExits("replay", true, replayDir);
  }, 60000);
});
