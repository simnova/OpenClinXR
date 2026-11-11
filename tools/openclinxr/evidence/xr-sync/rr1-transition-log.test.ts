import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  artifactCaptureMargins,
  assertArtifactWithinMarkedWindow,
  assertCh5RecordedStop,
  selectObservedWallMs,
  writeEvidenceBeforeDeferredErrors,
} from "./rr1-run.mjs";

const doorway = { eyebrow: "DOORWAY", station: "STATION 1 OF 3" };
const encounter = { eyebrow: "ENCOUNTER", station: "STATION 1 OF 3" };

describe("RR1 recorded-page transition selection", () => {
  it("skips a stale matching header entry before phaseServerMs", () => {
    const log = [
      { ...doorway, wallMs: 900 },
      { ...encounter, wallMs: 1_000 },
      { ...doorway, wallMs: 1_100 },
    ];
    expect(selectObservedWallMs(log, "doorway", "Station 1 of 3", 1_000)).toBe(1_100);
  });

  it("keeps a three-second visible state after the page has moved on", () => {
    const log = [
      { ...doorway, wallMs: 1_100 },
      { ...encounter, wallMs: 4_100 },
    ];
    expect(selectObservedWallMs(log, "doorway", "Station 1 of 3", 1_000)).toBe(1_100);
  });

  it("names the last three entries when no transition matches", () => {
    const log = [
      { ...encounter, wallMs: 1_000 },
      { eyebrow: "NOTE", station: "STATION 1 OF 3", wallMs: 2_000 },
      { eyebrow: "DOORWAY", station: "STATION 2 OF 3", wallMs: 3_000 },
      { eyebrow: "ENCOUNTER", station: "STATION 2 OF 3", wallMs: 4_000 },
    ];
    expect(() => selectObservedWallMs(log, "doorway", "Station 1 of 3", 1_000))
      .toThrow(`last 3 entries: ${JSON.stringify(log.slice(-3))}`);
  });

  it("rejects a still captured after the next phase begins and names its time and window end", () => {
    const log = [
      { ...doorway, wallMs: 1_100 },
      { ...encounter, wallMs: 4_100 },
    ];
    expect(() => assertArtifactWithinMarkedWindow({
      artifact: "frames/ch1.png",
      captureStartedWallMs: 4_200,
      captureEndedWallMs: 4_250,
      log,
      phase: "doorway",
      station: "Station 1 of 3",
      phaseServerMs: 1_000,
    })).toThrow("frames/ch1.png capture [4200, 4250] is outside marked window [1100, 4100)");
  });

  it("accepts a still wholly inside the marked state window", () => {
    const log = [
      { ...doorway, wallMs: 1_100 },
      { ...encounter, wallMs: 4_100 },
    ];
    expect(assertArtifactWithinMarkedWindow({
      artifact: "panels/ch1-runtime-panel.png",
      captureStartedWallMs: 2_000,
      captureEndedWallMs: 2_050,
      log,
      phase: "doorway",
      station: "Station 1 of 3",
      phaseServerMs: 1_000,
    })).toEqual({ startWallMs: 1_100, endWallMs: 4_100 });
  });

  it("computes artifact margins and flags an end margin under 100 ms", () => {
    const log = [
      { ...doorway, wallMs: 1_100 },
      { ...encounter, wallMs: 4_100 },
    ];
    const capture = {
      artifact: "panels/ch1-runtime-panel.png",
      captureStartedWallMs: 1_200,
      captureEndedWallMs: 4_050,
      log,
      phase: "doorway",
      station: "Station 1 of 3",
      phaseServerMs: 1_000,
    };
    const window = assertArtifactWithinMarkedWindow(capture);
    expect(artifactCaptureMargins({ ...capture, window })).toEqual({
      startMarginMs: 100,
      endMarginMs: 50,
      endMarginLow: true,
    });
  });

  it("rejects a capture-complete-style recorded stop with zero margin", () => {
    expect(() => assertCh5RecordedStop({
      recordedState: "signoff:finalized",
      captureStartedWallMs: 2_000,
      captureEndedWallMs: 2_300,
      windowStartWallMs: 1_900,
      stopWallMs: 2_300,
    })).toThrow("ch5 recorded-stop end margin 0 ms is below 100 ms");
  });

  it("accepts exactly 100 ms recorded-stop margin and rejects 99 ms", () => {
    const base = {
      recordedState: "signoff:finalized",
      captureStartedWallMs: 2_000,
      captureEndedWallMs: 2_300,
      windowStartWallMs: 1_900,
    };
    expect(assertCh5RecordedStop({ ...base, stopWallMs: 2_400 })).toMatchObject({ endMarginMs: 100 });
    expect(() => assertCh5RecordedStop({ ...base, stopWallMs: 2_399 }))
      .toThrow("ch5 recorded-stop end margin 99 ms is below 100 ms");
  });

  it("rejects a recorded page whose state changed before stop and names it", () => {
    expect(() => assertCh5RecordedStop({
      recordedState: "signoff:open",
      captureStartedWallMs: 2_000,
      captureEndedWallMs: 2_300,
      windowStartWallMs: 1_900,
      stopWallMs: 2_500,
    })).toThrow('state="signoff:open"');
  });

  it("rejects a still ending after the recorded-page stop", () => {
    expect(() => assertCh5RecordedStop({
      recordedState: "signoff:finalized",
      captureStartedWallMs: 2_000,
      captureEndedWallMs: 2_501,
      windowStartWallMs: 1_900,
      stopWallMs: 2_500,
    })).toThrow("ch5 still capture ended 2501 after recorded faculty stop 2500");
  });

  it("writes evidence before raising a deferred window error", () => {
    const directory = mkdtempSync(join(tmpdir(), "rr1-deferred-evidence-"));
    const evidence = join(directory, "capture.json");
    expect(() => writeEvidenceBeforeDeferredErrors(
      () => writeFileSync(evidence, "{}\n"),
      ["frames/ch5.png capture is outside its window"],
    )).toThrow("deferred RR1 capture assertions failed after evidence write");
    expect(existsSync(evidence)).toBe(true);
  });
});
