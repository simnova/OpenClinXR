import { mkdtempSync } from "node:fs";
import { createServer, type Server as NetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// Root RED (2026-10-30): createEncounterServer bound the wildcard address while its url dials 127.0.0.1.
// On macOS a second process could then bind 127.0.0.1:<same port> and take every client connection,
// which surfaced as MatchMakeError "Method Not Allowed" (another lane's HTTP server answered the join).
// Contract: the server owns 127.0.0.1:<port>, so a later loopback bind of that port fails EADDRINUSE.

const servers: EncounterServer[] = [];
const probes: NetServer[] = [];
afterEach(async () => {
  while (probes.length > 0) {
    const probe = probes.pop();
    if (probe?.listening) await new Promise<void>((resolve) => probe.close(() => resolve()));
  }
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});

function bindLoopback(port: number): Promise<string> {
  return new Promise((resolve) => {
    const probe = createServer();
    probes.push(probe);
    probe.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "unknown-error"));
    probe.listen(port, "127.0.0.1", () => resolve("bound"));
  });
}

describe("xr-sync-server loopback bind", () => {
  it("live server: a second 127.0.0.1 bind of its port fails EADDRINUSE", async () => {
    const server = await createEncounterServer();
    servers.push(server);
    expect(server.url).toBe(`ws://127.0.0.1:${server.port}`);
    expect(await bindLoopback(server.port)).toBe("EADDRINUSE");
  });

  it("replay server: a second 127.0.0.1 bind of its port fails EADDRINUSE", async () => {
    const replayDir = mkdtempSync(join(tmpdir(), "xr-sync-loopback-replay-"));
    const server = await createEncounterServer({ replayDir });
    servers.push(server);
    expect(await bindLoopback(server.port)).toBe("EADDRINUSE");
  });

  it("known-good: a free loopback port binds", async () => {
    expect(await bindLoopback(0)).toBe("bound");
  });
});
