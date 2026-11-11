import { describe, expect, it } from "vitest";
import {
  assertPanelLumaFrames,
  assertSceneReadyCh1Trim,
  assertSceneReadyObserved,
  learnerChapterOffsetSeconds,
  learnerPanelPaintTrim,
  learnerSceneReadyPaintTrim,
  learnerSyncedPaintTrim,
  parseFramePeriodSeconds,
  sceneHumanoidAssetsReady,
} from "./rr1-run.mjs";

const leadingFlatFrames = [
  { ptsTime: 0.00, yMin: 235, yMax: 236 },
  { ptsTime: 0.04, yMin: 235, yMax: 236 },
  { ptsTime: 0.08, yMin: 235, yMax: 236 },
  { ptsTime: 0.12, yMin: 235, yMax: 236 },
  { ptsTime: 0.16, yMin: 235, yMax: 236 },
  { ptsTime: 0.20, yMin: 235, yMax: 236 },
  { ptsTime: 0.24, yMin: 36, yMax: 36 },
];
const paintedFrame = { ptsTime: 0.28, yMin: 36, yMax: 180 };

describe("RR1 learner leading-flat trim", () => {
  it("trims seven leading flat panel frames to the first painted frame", () => {
    expect(learnerPanelPaintTrim([...leadingFlatFrames, paintedFrame], 1, 0.04)).toMatchObject({
      inpointSeconds: 0.28,
      blankFrames: 7,
    });
  });

  it("keeps a painted frame zero at inpoint zero", () => {
    expect(learnerPanelPaintTrim([{ ...paintedFrame, ptsTime: 0 }], 1, 0.04)).toMatchObject({
      inpointSeconds: 0,
      blankFrames: 0,
    });
  });

  it("removes only the leading flats and still rejects a flat frame at 10 seconds", () => {
    const frames = [...leadingFlatFrames, paintedFrame, { ptsTime: 10, yMin: 36, yMax: 36 }];
    const trim = learnerPanelPaintTrim(frames, 1, 0.04);
    const trimmedFrames = frames.filter((frame) => frame.ptsTime >= trim.inpointSeconds);

    expect(trim.inpointSeconds).toBe(0.28);
    expect(() => assertPanelLumaFrames(trimmedFrames)).toThrow("panel luma gate failed at 10.00 s");
  });

  it("selects syncStart when sync render is later than paint and painted when it is earlier", () => {
    const frames = [...leadingFlatFrames, paintedFrame, { ptsTime: 0.4, yMin: 36, yMax: 180 }];

    expect(learnerSyncedPaintTrim(frames, 0.3, 1, 0.04)).toMatchObject({
      inpointSeconds: 0.4,
      trimReason: "syncStart",
      paintedInpointSeconds: 0.28,
      syncedInpointSeconds: 0.4,
    });
    expect(learnerSyncedPaintTrim(frames, 0.1, 1, 0.04)).toMatchObject({
      inpointSeconds: 0.28,
      trimReason: "painted",
      paintedInpointSeconds: 0.28,
      syncedInpointSeconds: 0.12,
    });
  });

  it("rejects ch1 observed at least one measured frame period before trim", () => {
    const frames = [...leadingFlatFrames, paintedFrame, { ptsTime: 0.4, yMin: 36, yMax: 180 }];
    expect(() => learnerSyncedPaintTrim(frames, 0.3, 0.359, 0.04))
      .toThrow("learner trim 0.4 s exceeds ch1 untrimmed offset 0.359 s by at least frame period 0.04 s");
  });

  it("publishes scratch-8 ch1 at zero when it is only 15 ms before trim", () => {
    expect(learnerChapterOffsetSeconds("ch1", 0.505, 0.52, 0.04, true)).toBe(0);
  });

  it("rejects any later learner chapter before trim and names that chapter", () => {
    expect(() => learnerChapterOffsetSeconds("ch2", 0.5, 0.52, 0.04, false))
      .toThrow("learner chapter ch2 untrimmed offset 0.5 s is before trim 0.52 s");
  });

  it("parses ffprobe rational frame rates", () => {
    expect(parseFramePeriodSeconds("25/1")).toBe(0.04);
    expect(parseFramePeriodSeconds("30000/1001")).toBeCloseTo(0.033367, 6);
  });

  it("selects the first frame at or after scene readiness without weakening the published ch1 clamp", () => {
    const frames = [...leadingFlatFrames, paintedFrame, { ptsTime: 0.4, yMin: 36, yMax: 180 }, { ptsTime: 0.8, yMin: 36, yMax: 180 }];
    const trim = learnerSceneReadyPaintTrim(frames, 0.3, 0.7, 0.505, 0.04);
    expect(trim).toMatchObject({ inpointSeconds: 0.8, trimReason: "sceneReady", sceneReadyInpointSeconds: 0.8 });
    expect(learnerChapterOffsetSeconds("ch1", 0.505, trim.inpointSeconds, 0.04, true, trim.trimReason)).toBe(0);
  });

  it("derives syncStart from the winning candidate and retains the one-frame ch1 rule", () => {
    const frames = [...leadingFlatFrames, paintedFrame, { ptsTime: 0.4, yMin: 36, yMax: 180 }, { ptsTime: 0.8, yMin: 36, yMax: 180 }];
    const trim = learnerSceneReadyPaintTrim(frames, 0.7, 0.3, 1, 0.04);

    expect(trim).toMatchObject({
      inpointSeconds: 0.8,
      trimReason: "syncStart",
      syncedInpointSeconds: 0.8,
      sceneReadyInpointSeconds: 0.4,
    });
    expect(() => learnerChapterOffsetSeconds("ch1", 0.759, trim.inpointSeconds, 0.04, true, trim.trimReason))
      .toThrow("learner trim 0.8 s exceeds ch1 untrimmed offset 0.759 s by at least frame period 0.04 s");
  });

  it("rejects a scene-ready trim after a ch1 header transition and names both timestamps", () => {
    expect(() => assertSceneReadyCh1Trim({
      headerLog: [
        { wallMs: 1000, eyebrow: "Doorway", station: "Station 1 of 3" },
        { wallMs: 1400, eyebrow: "Encounter", station: "Station 1 of 3" },
      ],
      ch1ObservedWallMs: 1000,
      trimWallMs: 1500,
      phase: "doorway",
      station: "Station 1 of 3",
      artifacts: [{ artifact: "frames/ch1.png", markedWindow: { endWallMs: 2000 } }],
    })).toThrow(/scene-ready trim 1500 ms .* observed at 1000 ms; transition=.*"wallMs":1400/u);
  });

  it("accepts exactly 100 ms scene-ready end margin and rejects 99 ms", () => {
    const input = {
      headerLog: [
        { wallMs: 1000, eyebrow: "Doorway", station: "Station 1 of 3" },
        { wallMs: 2000, eyebrow: "Encounter", station: "Station 1 of 3" },
      ],
      ch1ObservedWallMs: 1000,
      trimWallMs: 1500,
      phase: "doorway",
      station: "Station 1 of 3",
      artifacts: [{ artifact: "frames/ch1.png", markedWindow: { endWallMs: 1600 } }],
    };
    expect(assertSceneReadyCh1Trim(input)).toMatchObject({
      margins: [{ artifact: "frames/ch1.png", endMarginMs: 100 }],
    });
    expect(() => assertSceneReadyCh1Trim({
      ...input,
      artifacts: [{ artifact: "frames/ch1.png", markedWindow: { endWallMs: 1599 } }],
    })).toThrow("end margin 99 ms is below 100 ms");
  });

  it("requires every expected scene asset loaded cleanly", () => {
    expect(sceneHumanoidAssetsReady({ expectedAssetCount: 3, loadedCount: 2, failedCount: 0, fallbackActiveCount: 0 })).toBe(false);
    expect(sceneHumanoidAssetsReady({ expectedAssetCount: 3, loadedCount: 3, failedCount: 0, fallbackActiveCount: 1 })).toBe(false);
    expect(sceneHumanoidAssetsReady({ expectedAssetCount: 3, loadedCount: 3, failedCount: 0, fallbackActiveCount: 0 })).toBe(true);
    expect(sceneHumanoidAssetsReady({ expectedAssetCount: 0, loadedCount: 0, failedCount: 0, fallbackActiveCount: 0 })).toBe(false);
    expect(sceneHumanoidAssetsReady({ expectedAssetCount: 3, loadedCount: 3, failedCount: 1, fallbackActiveCount: 0 })).toBe(false);
  });

  it("names sceneReady and the last aggregate counts when readiness is never observed", () => {
    expect(() => assertSceneReadyObserved(null, {
      expectedAssetCount: 3,
      loadedCount: 2,
      failedCount: 0,
      fallbackActiveCount: 1,
    })).toThrow("sceneReady was never observed; last evidence loadedCount=2 expectedAssetCount=3 failedCount=0 fallbackActiveCount=1");
  });
});
