import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// LIBRARY-LIMITATION GUARD (tsk_66a51553fc1d28b8, super-ceo-cap20 ruling
// 2026-11-11): two servers OPEN at once in one process share @colyseus/core
// 0.18.10's module-global matchMaker. The first close() sets
// matchMaker.state = SHUTTING_DOWN (MatchMaker.mjs:388), so the second
// close() returns early (Server.mjs:175-177) and never reaches
// transport.shutdown() (Server.mjs:181): the second listener stays open.
// No caller in tree holds two servers open (census, jobs/c6one/RESULT.md
// O0a); this guard pins the library behaviour so an upgrade surfaces itself.
//
// Counterweight: sequential A create -> A close ->
// B create -> B close in one process works, and both ports refuse TCP after
// close. One Colyseus server per process at a time releases its listener
// (close-releases-the-listener.test.ts, 4 passed); the O1 RED showed only
// the overlapping case (A still open when B is created) leaks B's listener.
// No process.exit, no server.unref, no socket destroy, no direct
// httpServer/transport close here: close() itself releases the listener.

const servers: EncounterServer[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});

// Probe assertion: a fresh TCP connect to a closed listener fails
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

describe("sequential servers in one process release each listener", () => {
  it("A create -> A close -> B create -> B close: both ports refuse TCP", async () => {
    const a = await createEncounterServer({});
    servers.push(a);
    const portA = a.port;
    await a.close();
    servers.splice(servers.indexOf(a), 1);
    await expectTcpRefused(portA);

    const b = await createEncounterServer({});
    servers.push(b);
    const portB = b.port;
    await b.close();
    servers.splice(servers.indexOf(b), 1);
    await expectTcpRefused(portB);

    expect(portA).toBeGreaterThan(0);
    expect(portB).toBeGreaterThan(0);
  }, 60000);
});

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX_BIN = join(HERE, "..", "..", "..", "..", "node_modules", ".bin", "tsx");
const SERVER_SRC = join(HERE, "index.ts");
// Same fail-fast child ceiling as close-releases-the-listener.test.ts.
const CHILD_TIMEOUT_MS = 15000;

// The child opens A and B, closes both, then probes B and prints one verdict
// line. On the current library it stays alive on B's leaked listener, so the
// parent kills it once the verdict is read: that kill is cleanup of the
// documented leak, not a pass condition.
function concurrentCloseVerdict(): Promise<string> {
  const childSource = `import { connect } from "node:net";
import { createEncounterServer } from ${JSON.stringify(SERVER_SRC)};
const a = await createEncounterServer({});
const b = await createEncounterServer({});
await a.close();
await b.close();
const socket = connect({ port: b.port, host: "127.0.0.1" });
socket.once("connect", () => { console.log("VERDICT:b-accepts"); socket.end(); });
socket.once("error", (error) => { console.log(error.code === "ECONNREFUSED" ? "VERDICT:b-refuses" : "VERDICT:other:" + error.code); });
`;
  const childFile = join(mkdtempSync(join(tmpdir(), "xr-sync-concurrent-child-")), "concurrent-child.mts");
  writeFileSync(childFile, childSource);
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [childFile], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const finish = (verdict: string): void => {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve(verdict);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = /VERDICT:(\S+)/.exec(output);
      if (match?.[1] !== undefined) finish(match[1]);
    });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`no verdict within ${CHILD_TIMEOUT_MS} ms; output: ${output.slice(0, 2000)}`));
    }, CHILD_TIMEOUT_MS);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

describe("@colyseus/core 0.18.10 limitation: concurrent servers in one process", () => {
  it("A and B open at once, both closed: B's port still accepts TCP (current library behaviour)", async () => {
    const verdict = await concurrentCloseVerdict();
    expect(
      verdict,
      "library fixed the concurrent shutdown: delete this guard and consider the throw (tsk_66a51553fc1d28b8 O1/O4; c18-cast-trace-replay and c34-dev-speech hold servers open concurrently)",
    ).toBe("b-accepts");
  }, 30000);
});
