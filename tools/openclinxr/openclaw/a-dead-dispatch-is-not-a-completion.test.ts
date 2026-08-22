import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetCoordinationRootCache } from "./coordination-root.js";
import { dispatch, readSessions } from "./dispatch-worker.js";

/**
 * OBSERVABLE: a reader of the dispatch ledger can tell a dispatch that RAN from one that died
 * before its worker ever took a turn.
 *
 * MEASURED 2026-08-22, not inferred. Three dispatches of issue-560:
 *   deepseek-v4-pro  -> 402 Payment Required: Insufficient Balance   (worker never started)
 *   ox-alpha         -> 401 after 7s, credential absent from the env (worker never started)
 *   ox-alpha         -> ran
 * All three wrote `phase: "completed"`. dispatch-worker.ts:1501 sets that field unconditionally and
 * :1510 THEN throws, under a comment that says in as many words "a missing end event is never a
 * completed dispatch". The code already knows; the ledger does not record it.
 *
 * CONSEQUENCE, measured on the live ledger for the hour containing those dispatches:
 *   completions_1h = 4, of which 2 are the dead dispatches above
 *   pass_rate_1h   = 1.00, because proofsOk is null on a dead row and it lands in neither
 *                    the passed nor the failed count
 * factory-pulse.ts:55 and campaign-track.ts:48 both select on `phase === "completed"`, so the
 * owner's progress metric reported a perfect hour that contained two provider failures.
 *
 * `phase` currently admits only "spawned" | "completed" (dispatch-worker.ts:231). A third value is
 * one way to satisfy this; it is not the only one, and picking it is not my job.
 *
 * claimScope: what the ledger records for a child that exits without an end event.
 * notEvidenceFor: why any particular dispatch died, provider health, or whether the pulse's other
 *   metrics are correct (its row-vs-session double count is a separate defect, recorded on #562).
 */

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn() };
});

vi.mock("./board-cli.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./board-cli.js")>();
  return {
    ...actual,
    setFactoryField: vi.fn(() => ({ ok: true, issueNumber: 0, itemId: "PVTI_test", stage: "Dispatched", plans: [] })),
  };
});

const spawnMock = vi.mocked(spawn);
const TEST_ROLE = "xr-systems-architect";

/** Same shape as dispatch-worker.test.ts's helper — a child that emits output then closes. */
function fakeChild(output: string, stderr = "", code = 0): ReturnType<typeof spawn> {
  const stdout = new EventEmitter();
  const stderrBus = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  child.stdout = stdout;
  child.stderr = stderrBus;
  setImmediate(() => {
    stdout.emit("data", Buffer.from(output));
    stderrBus.emit("data", Buffer.from(stderr));
    child.emit("close", code);
  });
  return child as unknown as ReturnType<typeof spawn>;
}

function seedRole(root: string): void {
  const roleDir = join(root, "agents/core", TEST_ROLE);
  mkdirSync(roleDir, { recursive: true });
  writeFileSync(join(roleDir, "charter.md"), "## Persona\nplaceholder");
  writeFileSync(join(roleDir, "memory.md"), "placeholder memory");
  writeFileSync(join(roleDir, "index.json"), "{}");
}

/** A 402 from the provider: the child prints an error to stderr and exits with no end event. */
const PROVIDER_402 = JSON.stringify({
  message: "API error (status 402 Payment Required): unknown_error: Insufficient Balance",
  http_status: 402,
});

async function dispatchExpectingDeath(root: string, slice: string): Promise<void> {
  await expect(dispatch(root, {
    prompt: "do the thing",
    role: TEST_ROLE,
    streaming: true,
    slice,
    contract: "none",
    contractReason: "measures what the ledger records when the child dies before its first turn",
  })).rejects.toThrow(/died before emitting an end event/);
}

afterEach(() => {
  resetCoordinationRootCache();
  delete process.env["OPENCLINXR_COORDINATION_ROOT"];
});

describe("a dead dispatch is not a completion", () => {
  it.fails("(1) RED: a child that dies before any turn does not record phase 'completed'", async () => {
    const root = mkdtempSync(join(tmpdir(), "dead-dispatch-"));
    seedRole(root);
    spawnMock.mockReturnValue(fakeChild("", PROVIDER_402, 1));

    await dispatchExpectingDeath(root, "issue-560-dead");

    const rows = readSessions(root).filter((r) => r.slice === "issue-560-dead");
    const completed = rows.filter((r) => r.phase === "completed");
    expect(
      completed,
      "the child emitted no end event and took no turns; recording it as completed makes a "
        + "provider failure indistinguishable from a fast success for every ledger reader",
    ).toEqual([]);
  });

  it("(2) KNOWN-GOOD COLUMN: a child that DOES emit an end event still records completed with its turns", async () => {
    // Pins the behaviour that works today. A fix that stops writing a completed row at all, or that
    // drops turns, fails here.
    const root = mkdtempSync(join(tmpdir(), "live-dispatch-"));
    seedRole(root);
    const ndjson = [
      JSON.stringify({ type: "text", data: "done" }),
      JSON.stringify({ type: "end", stopReason: "end_turn", sessionId: "019f-alive", num_turns: 7 }),
    ].join("\n");
    spawnMock.mockReturnValue(fakeChild(ndjson));

    const entry = await dispatch(root, {
      prompt: "do the thing",
      role: TEST_ROLE,
      streaming: true,
      slice: "issue-560-alive",
      contract: "none",
      contractReason: "known-good column: a real end event must still record a completion",
    });

    expect(entry.turns).toBe(7);
    const completed = readSessions(root)
      .filter((r) => r.slice === "issue-560-alive" && r.phase === "completed");
    expect(completed.length, "a dispatch that ran must still record exactly one completion").toBe(1);
    expect(completed[0]?.turns).toBe(7);
  });

  it("(3) COUNTERWEIGHT: the dead dispatch is still in the ledger and still carries its session id", async () => {
    // Refuses the cheap fix - dropping the row. dispatch-worker.ts:1512 depends on the id being
    // recorded before the throw so the child "has a name and can be resumed directly", and #439
    // landed that deliberately. Silence is not an improvement on a wrong label.
    const root = mkdtempSync(join(tmpdir(), "dead-resumable-"));
    seedRole(root);
    spawnMock.mockReturnValue(fakeChild("", PROVIDER_402, 1));

    await dispatchExpectingDeath(root, "issue-560-resumable");

    const rows = readSessions(root).filter((r) => r.slice === "issue-560-resumable");
    const terminal = rows.filter((r) => r.phase !== "spawned");
    // The `spawned` row is written before the child starts, so "a row exists" is satisfied by a
    // dispatch that is still RUNNING. Only a TERMINAL row distinguishes died from in-flight, and
    // dropping the write entirely leaves the ledger claiming this dispatch never finished.
    expect(
      terminal.length,
      "a dead dispatch must leave a terminal row; with only the pre-spawn row a reader cannot "
        + "tell it from a worker that is still running",
    ).toBeGreaterThan(0);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(
      terminal.every((r) => uuid.test(String(r.sessionId ?? ""))),
      "the terminal row must still carry a resumable session id (dispatch-worker.ts:1512, #439)",
    ).toBe(true);
  });

  it("(4) COUNTERWEIGHT: a dispatch that RAN and failed its proofs is still a completion", async () => {
    // Refuses over-correction - treating any absent proofsOk as death. A worker that ran and failed
    // is a completion with a bad result, and the pass-rate denominator needs it.
    const root = mkdtempSync(join(tmpdir(), "ran-and-failed-"));
    seedRole(root);
    const ndjson = [
      JSON.stringify({ type: "end", stopReason: "max_turns", sessionId: "019f-maxturns", num_turns: 150 }),
    ].join("\n");
    spawnMock.mockReturnValue(fakeChild(ndjson));

    const entry = await dispatch(root, {
      prompt: "do the thing",
      role: TEST_ROLE,
      streaming: true,
      slice: "issue-560-maxturns",
      contract: "none",
      contractReason: "a worker that exhausted its turns still ran; it is a completion",
    });

    expect(entry.turns).toBe(150);
    expect(entry.stopReason).toBe("max_turns");
    const completed = readSessions(root)
      .filter((r) => r.slice === "issue-560-maxturns" && r.phase === "completed");
    expect(completed.length, "hitting maxTurns is a completed dispatch, not a dead one").toBe(1);
  });
});
