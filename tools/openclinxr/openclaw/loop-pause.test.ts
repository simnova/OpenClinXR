import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetCoordinationRootCache } from "./coordination-root.js";
import {
  debtDelta,
  evaluateTripwire,
  formatScorecard,
  type Scorecard,
  writeScorecardSnapshot,
} from "./delegation-scorecard.js";
import {
  assertLoopNotPaused,
  cliSignalsStillTrue,
  LOOP_PAUSE_HISTORY,
  LoopPausedError,
  MIN_ROOT_CAUSE_LENGTH,
  pauseLoop,
  readLoopPause,
  resumeLoop,
  type LoopPauseRecord,
  type TripwireSignal,
} from "./loop-pause.js";

function tempCoordRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  process.env["OPENCLINXR_COORDINATION_ROOT"] = root;
  resetCoordinationRootCache();
  return root;
}

function cardWithDebt(
  brokenReferenceCeilings: number,
  sizeFreezeEntries: number,
): Scorecard {
  return {
    totalDispatched: 0,
    landed: 0,
    reverted: 0,
    landRate: 0,
    durabilityRate: 0,
    medianTurns: undefined,
    byModel: {},
    debt: { brokenReferenceCeilings, sizeFreezeEntries },
    notes: [],
  };
}

const debtRoseSignal = (refs: number, size: number): TripwireSignal => ({
  id: "debt-rose",
  detail: `debt rose refs=${refs} size=${size}`,
  observed: { brokenReferenceCeilings: refs, sizeFreezeEntries: size },
});

afterEach(() => {
  resetCoordinationRootCache();
  delete process.env["OPENCLINXR_COORDINATION_ROOT"];
});

describe("loop-pause assertLoopNotPaused", () => {
  it("passes on a clean root, throws when paused with incidentId in the message", () => {
    const coord = tempCoordRoot("loop-pause-assert-");
    try {
      expect(() => assertLoopNotPaused(coord)).not.toThrow();

      const record = pauseLoop(coord, {
        reason: "probe halt",
        signals: [debtRoseSignal(1, 2)],
        setBy: "tripwire",
      });

      expect(() => assertLoopNotPaused(coord)).toThrow(LoopPausedError);
      try {
        assertLoopNotPaused(coord);
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(LoopPausedError);
        const msg = (err as Error).message;
        expect(msg).toContain(record.incidentId);
        expect(msg).toContain("probe halt");
      }
    } finally {
      rmSync(coord, { recursive: true, force: true });
    }
  });

  it("resolves the pause file through the SHARED coordination root (not private cwd)", () => {
    // Private-lease bug class: if pause were cwd-relative, worktree A and worktree B would
    // each see a different bit and the halt would never halt.
    const coord = tempCoordRoot("loop-pause-shared-");
    const cwdA = mkdtempSync(join(tmpdir(), "loop-pause-cwd-a-"));
    const cwdB = mkdtempSync(join(tmpdir(), "loop-pause-cwd-b-"));
    try {
      const record = pauseLoop(cwdA, {
        reason: "shared-root proof",
        signals: [],
        setBy: "human",
      });

      // Different cwd, same OPENCLINXR_COORDINATION_ROOT override → same pause bit.
      expect(readLoopPause(cwdB)?.incidentId).toBe(record.incidentId);
      expect(() => assertLoopNotPaused(cwdB)).toThrow(LoopPausedError);

      // And the file physically lives under the shared coordination root, not cwdA.
      const onDisk = readFileSync(
        join(coord, ".openclinxr/openclaw/LOOP-PAUSED.json"),
        "utf8",
      );
      expect(onDisk).toContain(record.incidentId);
    } finally {
      rmSync(coord, { recursive: true, force: true });
      rmSync(cwdA, { recursive: true, force: true });
      rmSync(cwdB, { recursive: true, force: true });
    }
  });
});

describe("loop-pause resumeLoop refusals and audit", () => {
  it("refuses on a mismatched incidentId", () => {
    const coord = tempCoordRoot("loop-pause-mismatch-");
    const evidence = join(coord, "evidence.txt");
    writeFileSync(evidence, "proof\n");
    try {
      const record = pauseLoop(coord, {
        reason: "mismatch probe",
        signals: [],
        setBy: "human",
      });
      const result = resumeLoop(
        coord,
        {
          incidentId: "lp-not-the-real-one",
          rootCause: "x".repeat(MIN_ROOT_CAUSE_LENGTH),
          evidencePaths: [evidence],
          clearedBy: "test",
          acknowledgeUncheckedSignals: true,
        },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes("incidentId mismatch"))).toBe(true);
        expect(result.errors.some((e) => e.includes(record.incidentId))).toBe(true);
      }
      // Pause bit must remain.
      expect(readLoopPause(coord)?.incidentId).toBe(record.incidentId);
    } finally {
      rmSync(coord, { recursive: true, force: true });
    }
  });

  it("refuses on empty rootCause and on evidencePaths that do not exist", () => {
    const coord = tempCoordRoot("loop-pause-ack-fields-");
    try {
      const record = pauseLoop(coord, {
        reason: "field probe",
        signals: [],
        setBy: "human",
      });
      const result = resumeLoop(coord, {
        incidentId: record.incidentId,
        rootCause: "",
        evidencePaths: [join(coord, "does-not-exist.txt")],
        clearedBy: "test",
        acknowledgeUncheckedSignals: true,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes("rootCause is empty"))).toBe(true);
        expect(result.errors.some((e) => e.includes("does not exist"))).toBe(true);
        // Also short rootCause alone:
      }

      const short = resumeLoop(coord, {
        incidentId: record.incidentId,
        rootCause: "too short",
        evidencePaths: [],
        clearedBy: "test",
        acknowledgeUncheckedSignals: true,
      });
      expect(short.ok).toBe(false);
      if (!short.ok) {
        expect(short.errors.some((e) => e.includes("rootCause too short"))).toBe(true);
        expect(short.errors.some((e) => e.includes("evidencePaths is empty"))).toBe(true);
      }
    } finally {
      rmSync(coord, { recursive: true, force: true });
    }
  });

  it("refuses when injected signalsStillTrue still returns the signal — and names it", () => {
    const coord = tempCoordRoot("loop-pause-signal-still-");
    const evidence = join(coord, "fix.md");
    writeFileSync(evidence, "fixed ceiling\n");
    try {
      const sig = debtRoseSignal(10, 20);
      const record = pauseLoop(coord, {
        reason: "debt rose on main",
        signals: [sig],
        setBy: "tripwire",
      });
      const result = resumeLoop(
        coord,
        {
          incidentId: record.incidentId,
          rootCause: "Raised a size freeze ceiling during probe; not yet reverted.",
          evidencePaths: [evidence],
          clearedBy: "test",
        },
        {
          signalsStillTrue: () => [sig],
        },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes("signal still true: debt-rose"))).toBe(
          true,
        );
      }
      expect(readLoopPause(coord)).not.toBeNull();
    } finally {
      rmSync(coord, { recursive: true, force: true });
    }
  });

  it("refuses when no signalsStillTrue callback is given and acknowledgeUncheckedSignals is not set", () => {
    const coord = tempCoordRoot("loop-pause-no-callback-");
    const evidence = join(coord, "e.txt");
    writeFileSync(evidence, "x\n");
    try {
      const record = pauseLoop(coord, {
        reason: "no-callback probe",
        signals: [debtRoseSignal(1, 1)],
        setBy: "tripwire",
      });
      const result = resumeLoop(coord, {
        incidentId: record.incidentId,
        rootCause: "Trying to resume without proving signals are clear.",
        evidencePaths: [evidence],
        clearedBy: "test",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.errors.some((e) => e.includes("acknowledgeUncheckedSignals")),
        ).toBe(true);
      }
    } finally {
      rmSync(coord, { recursive: true, force: true });
    }
  });

  it("successful resume removes the pause and appends history; refused resume also appends", () => {
    const coord = tempCoordRoot("loop-pause-history-");
    const evidence = join(coord, "ok.txt");
    writeFileSync(evidence, "reverted ceiling\n");
    try {
      const record = pauseLoop(coord, {
        reason: "history probe",
        signals: [],
        setBy: "human",
      });

      const refused = resumeLoop(coord, {
        incidentId: "wrong-id",
        rootCause: "x".repeat(MIN_ROOT_CAUSE_LENGTH),
        evidencePaths: [evidence],
        clearedBy: "test",
        acknowledgeUncheckedSignals: true,
      });
      expect(refused.ok).toBe(false);

      const ok = resumeLoop(
        coord,
        {
          incidentId: record.incidentId,
          rootCause: "Human pause for probe; clearing after capturing refusal audit line.",
          evidencePaths: [evidence],
          clearedBy: "test-runner",
        },
        { signalsStillTrue: () => [] },
      );
      expect(ok).toEqual({ ok: true });
      expect(readLoopPause(coord)).toBeNull();
      expect(() => assertLoopNotPaused(coord)).not.toThrow();

      const historyPath = join(coord, LOOP_PAUSE_HISTORY);
      const history = readFileSync(historyPath, "utf8").trim().split("\n");
      // pause + resume-refused + resume-ok
      expect(history.length).toBeGreaterThanOrEqual(3);
      const actions = history.map((line) => (JSON.parse(line) as { action: string }).action);
      expect(actions).toContain("pause");
      expect(actions).toContain("resume-refused");
      expect(actions).toContain("resume-ok");
    } finally {
      rmSync(coord, { recursive: true, force: true });
    }
  });
});

describe("debtDelta and evaluateTripwire", () => {
  it("debtDelta with no snapshot -> rose: false and writes a baseline", () => {
    const coord = tempCoordRoot("debt-delta-baseline-");
    try {
      const card = cardWithDebt(100, 50);
      const delta = debtDelta(coord, card);
      expect(delta.rose).toBe(false);
      expect(delta.brokenReferenceCeilings).toBe(0);
      expect(delta.sizeFreezeEntries).toBe(0);
      // Baseline on disk under shared root.
      const snap = readFileSync(
        join(coord, ".openclinxr/openclaw/scorecard-snapshot.json"),
        "utf8",
      );
      expect(snap).toContain('"brokenReferenceCeilings": 100');
      expect(snap).toContain('"sizeFreezeEntries": 50');
    } finally {
      rmSync(coord, { recursive: true, force: true });
    }
  });

  it("debtDelta after debt increases -> rose: true with the right per-figure deltas", () => {
    const coord = tempCoordRoot("debt-delta-up-");
    try {
      writeScorecardSnapshot(coord, cardWithDebt(100, 50));
      const delta = debtDelta(coord, cardWithDebt(103, 52));
      expect(delta.rose).toBe(true);
      expect(delta.brokenReferenceCeilings).toBe(3);
      expect(delta.sizeFreezeEntries).toBe(2);
    } finally {
      rmSync(coord, { recursive: true, force: true });
    }
  });

  it("debtDelta after debt decreases -> rose: false", () => {
    const coord = tempCoordRoot("debt-delta-down-");
    try {
      writeScorecardSnapshot(coord, cardWithDebt(100, 50));
      const delta = debtDelta(coord, cardWithDebt(90, 40));
      expect(delta.rose).toBe(false);
      expect(delta.brokenReferenceCeilings).toBe(-10);
      expect(delta.sizeFreezeEntries).toBe(-10);
    } finally {
      rmSync(coord, { recursive: true, force: true });
    }
  });

  it("evaluateTripwire emits exactly one debt-rose when debt rises and none when it falls", () => {
    const coord = tempCoordRoot("eval-tripwire-");
    try {
      writeScorecardSnapshot(coord, cardWithDebt(10, 10));
      const up = evaluateTripwire(coord, cardWithDebt(11, 10));
      expect(up).toHaveLength(1);
      expect(up[0]?.id).toBe("debt-rose");

      // Fall: re-baseline then decrease so rose is false.
      writeScorecardSnapshot(coord, cardWithDebt(11, 10));
      const down = evaluateTripwire(coord, cardWithDebt(10, 10));
      expect(down).toHaveLength(0);
    } finally {
      rmSync(coord, { recursive: true, force: true });
    }
  });

  it("existing scorecard format still works without debtDelta opts", () => {
    // Regression guard for formatScorecard(card) callers.
    const formatted = formatScorecard(cardWithDebt(1, 1));
    expect(formatted).toMatch(/ratchet debt/);
    expect(formatted).not.toMatch(/debt delta/);

    const withDelta = formatScorecard(cardWithDebt(1, 1), {
      debtDelta: { brokenReferenceCeilings: 0, sizeFreezeEntries: 1, rose: true },
    });
    expect(withDelta).toMatch(/debt delta/);
    expect(withDelta).toMatch(/rose=true/);
  });
});

/**
 * REGRESSION (2026-08-06). The CLI's real signal detector was never exercised: every other test
 * INJECTS `signalsStillTrue`, so a broken detector could not fail a single assertion. It was
 * broken — a lazy require blew up inside the module, the catch held the signal, and the loop
 * could not be resumed even with debt back at baseline. Fail-closed, but a deadlock whose only
 * escape was `--ack-unchecked-signals`: the flag that skips the check. A control satisfiable only
 * by bypassing it decays into a no-op by habit.
 *
 * These tests call the detector the CLI actually uses, so that class of breakage fails here first.
 */
describe("cliSignalsStillTrue — the detector the CLI really calls", () => {
  const record = (signals: TripwireSignal[]): LoopPauseRecord => ({
    schemaVersion: "openclinxr.loop-pause.v1",
    paused: true,
    incidentId: "lp-test",
    reason: "test",
    signals,
    setAt: new Date().toISOString(),
    setBy: "tripwire",
  });

  const debtSignal: TripwireSignal = {
    id: "debt-rose",
    detail: "debt rose",
    observed: { sizeFreezeEntries: 1 },
  };

  it("clears debt-rose when the scorecard says debt did NOT rise", () => {
    // The deadlock case: this returned [sig] forever, so resume was impossible after a real fix.
    const root = mkdtempSync(join(tmpdir(), "loop-pause-cli-"));
    process.env["OPENCLINXR_COORDINATION_ROOT"] = root;
    resetCoordinationRootCache();
    try {
      // No freeze maps in a temp root -> debt reads as 0, and the first debtDelta writes the
      // baseline, so nothing has risen.
      expect(cliSignalsStillTrue(root, record([debtSignal]))).toEqual([]);
    } finally {
      delete process.env["OPENCLINXR_COORDINATION_ROOT"];
      resetCoordinationRootCache();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("holds a signal id it has no detector for, rather than assuming it is clear", () => {
    const root = mkdtempSync(join(tmpdir(), "loop-pause-cli2-"));
    process.env["OPENCLINXR_COORDINATION_ROOT"] = root;
    resetCoordinationRootCache();
    try {
      const still = cliSignalsStillTrue(
        root,
        record([{ id: "isolation-leak", detail: "leak", observed: {} }]),
      );
      expect(still).toHaveLength(1);
      expect(still[0]?.detail).toMatch(/no CLI detector/);
    } finally {
      delete process.env["OPENCLINXR_COORDINATION_ROOT"];
      resetCoordinationRootCache();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
