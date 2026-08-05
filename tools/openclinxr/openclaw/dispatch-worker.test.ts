import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeEnvironment,
  buildArgv,
  latestSessionFor,
  readSessions,
  recordSession,
} from "./dispatch-worker.js";

describe("dispatch-worker argv", () => {
  it("puts the prompt immediately after -p, because -p CONSUMES the next token", () => {
    // The 2026-08-05 incident: `-p --resume <id> "<prompt>"` made --resume the value of -p, and
    // grok aborted with "a value is required for '--single <PROMPT>'" while the wrapper exited 0.
    const argv = buildArgv({ prompt: "do the thing", resume: "019f-abc" });
    expect(argv[0]).toBe("-p");
    expect(argv[1]).toBe("do the thing");
    expect(argv.indexOf("--resume")).toBeGreaterThan(1);
  });

  it("defaults max-turns to a runaway backstop, not a budget", () => {
    // Caps in the 25-70 band killed real workers at the boundary; median success is 21 turns.
    const turns = Number(buildArgv({ prompt: "x" })[buildArgv({ prompt: "x" }).indexOf("--max-turns") + 1]);
    expect(turns).toBeGreaterThanOrEqual(150);
  });

  it("uses streaming-json when asked, so stalls are visible while the worker is alive", () => {
    expect(buildArgv({ prompt: "x", streaming: true })).toContain("streaming-json");
    expect(buildArgv({ prompt: "x" })).toContain("json");
  });

  it("defaults to the cheap model — frontier is opt-in per task", () => {
    expect(buildArgv({ prompt: "x" })).toContain("deepseek-v4-pro");
    expect(buildArgv({ prompt: "x", model: "grok-4.5" })).toContain("grok-4.5");
  });
});

describe("credential-leak guard", () => {
  it("refuses to dispatch when debug logging would leak the bearer token", () => {
    expect(() => assertSafeEnvironment({ RUST_LOG: "debug" })).toThrow(/REFUSING TO DISPATCH/);
    expect(() => assertSafeEnvironment({ GROK_DEBUG_FILE: "/tmp/x" })).toThrow(/REFUSING TO DISPATCH/);
  });

  it("allows a clean environment", () => {
    expect(() => assertSafeEnvironment({ PATH: "/usr/bin" })).not.toThrow();
  });
});

describe("session ledger", () => {
  it("survives the process that created it, so a dead worker stays resumable", () => {
    const root = mkdtempSync(join(tmpdir(), "dispatch-ledger-"));
    recordSession(root, { sessionId: "019f-one", slice: "s1", model: "m", at: "2026-08-05T00:00:00Z" });
    recordSession(root, { sessionId: "019f-two", slice: "s1", model: "m", at: "2026-08-05T01:00:00Z" });
    recordSession(root, { sessionId: "019f-other", slice: "s2", model: "m", at: "2026-08-05T02:00:00Z" });

    expect(readSessions(root)).toHaveLength(3);
    // Resuming a slice means resuming its MOST RECENT worker, not its first.
    expect(latestSessionFor(root, "s1")?.sessionId).toBe("019f-two");
    expect(latestSessionFor(root, "missing")).toBeUndefined();
  });

  it("tolerates a corrupt line rather than losing every other id", () => {
    const root = mkdtempSync(join(tmpdir(), "dispatch-ledger-"));
    recordSession(root, { sessionId: "019f-good", model: "m", at: "2026-08-05T00:00:00Z" });
    appendFileSync(join(root, ".openclinxr/openclaw/worker-sessions.jsonl"), "{ not json\n");
    recordSession(root, { sessionId: "019f-later", model: "m", at: "2026-08-05T03:00:00Z" });

    expect(readSessions(root).map((entry) => entry.sessionId)).toEqual(["019f-good", "019f-later"]);
  });
});
