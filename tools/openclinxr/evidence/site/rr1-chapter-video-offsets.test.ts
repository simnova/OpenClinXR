import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCh5StillSource,
  assertFacultyLayoutLog,
  assertFacultySignoffFrameSeries,
  assertPublishedChapterEndMargin,
  assessFacultySignoffTextExtent,
  facultyIwerReleaseAfterFinalize,
  firstFramePtsAtOrAfter,
  learnerChapterOffsetSeconds,
  learnerHeaderWindow,
  observedOffsetSeconds,
  parseFramePeriodSeconds,
  selectChapterByContentTransition,
  writeVideoFramePng,
} from "../xr-sync/rr1-run.mjs";
import {
  currentRr1RunSelection,
  publishedRr1Run,
  requireRunArtifact,
  resolveRr1RunSelection,
  rr1RunUnderTest,
} from "./rr1-run-selection";
import {
  createRr1FrameClassifier,
  frameAt,
  imageCrop,
  relativeCropMatches,
  rightmostTextColumn,
  signoffFrameSeries,
} from "./rr1-video-classifier.mjs";

const HISTORY_RUN_6 = "/Volumes/files/openclinxr-assets/store/site-reimagine/rr1/run-6";
const SCRATCH_RUN_17 = "/Volumes/files/openclinxr-assets/scratch/rr1-ackts/run-17";
const SCRATCH_RUN_18 = "/Volumes/files/openclinxr-assets/scratch/rr1-ackts/run-18";
const CLASSIFIER_FIXTURES = join(process.cwd(), "tools/openclinxr/evidence/site/fixtures/rr1-video-classifier");
const FPS = 25;

let runSelection: ReturnType<typeof currentRr1RunSelection> | undefined;
let runSelectionError: unknown;
try {
  runSelection = currentRr1RunSelection();
} catch (error) {
  runSelectionError = error;
}
if (runSelection?.kind === "skip") console.log(`[rr1-chapter-video-offsets] SKIP ${runSelection.reason}`);

type Chapter = {
  endMarginMs?: number;
  id: string;
  skewSeconds?: number;
  markVideoTimeSeconds?: number;
  nextStateFramePtsSeconds?: number | null;
  offsetSeconds: number;
  observedWallMs?: number;
  phase?: string;
  previousFramePtsSeconds?: number | null;
  previousStateFramePtsSeconds?: number | null;
  recording?: string;
  serverMs?: number;
  stationIndex?: number;
};
type RecordingClock = {
  framePeriodSeconds?: number;
  recordingOriginWallMs?: number;
  recordingStopWallMs?: number;
  timelineStartSeconds?: number;
  trimReason?: string;
  trimInpointSeconds?: number;
};

function framePtsSeconds(video: string): number[] {
  return execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time", "-of", "csv=p=0", video,
  ], { encoding: "utf8" }).split(/\r?\n/u).filter(Boolean).map(Number);
}

function videoFramePeriod(video: string): { framePeriodSeconds: number; source: string } {
  const source = execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "default=noprint_wrappers=1:nokey=1", video,
  ], { encoding: "utf8" }).trim();
  return { framePeriodSeconds: parseFramePeriodSeconds(source), source };
}

function classifier(run: string, preload = false): { chapters: Chapter[]; readsMarkedState: (id: string, seconds: number) => boolean } {
  const video = requireRunArtifact(run, "rr1-min.webm");
  const chapters = (JSON.parse(readFileSync(requireRunArtifact(run, "chapters.json"), "utf8")) as { chapters: Chapter[] }).chapters;
  const historyRun6 = run === HISTORY_RUN_6;
  return {
    chapters,
    readsMarkedState: createRr1FrameClassifier({
      video,
      doorwayPanel: requireRunArtifact(run, "panels/rot-doorway-runtime-panel.png"),
      encounterPanel: requireRunArtifact(run, "panels/ch2-runtime-panel.png"),
      ch5FinalizedCrop: join(CLASSIFIER_FIXTURES, historyRun6 ? "run-6-ch5-finalized-54.88.png" : "run-18-ch5-finalized-80.00.png"),
      ch5OpenCrop: join(CLASSIFIER_FIXTURES, historyRun6 ? "run-6-ch5-open-54.72.png" : "run-18-ch5-open-65.84.png"),
      framePtsSeconds: preload ? framePtsSeconds(video) : undefined,
    }),
  };
}

function leftOverlayLuma(video: string, seconds: number): { backgroundMax: number; overlayMax: number } {
  const width = 8;
  const overlay = frameAt(video, seconds, { x: 0, y: 0, width, height: 200 });
  const background = frameAt(video, seconds, { x: 0, y: 200, width, height: 61 });
  const maxLuma = (pixels: Buffer): number => {
    let maximum = 0;
    for (let index = 0; index < pixels.length; index += 3) {
      const luma = 0.2126 * (pixels[index] ?? 0) + 0.7152 * (pixels[index + 1] ?? 0) + 0.0722 * (pixels[index + 2] ?? 0);
      maximum = Math.max(maximum, luma);
    }
    return maximum;
  };
  return { backgroundMax: maxLuma(background), overlayMax: maxLuma(overlay) };
}

describe.runIf(existsSync(join(HISTORY_RUN_6, "rr1-min.webm")))("HISTORY run-6 (pre-fix PTS record): chapter/video alignment", () => {
  const { chapters, readsMarkedState } = classifier(HISTORY_RUN_6);

  it("RED fixture: today's published offsets expose the CH5 mismatch", () => {
    expect(chapters.map((chapter) => [chapter.id, readsMarkedState(chapter.id, chapter.offsetSeconds)]))
      .toEqual([
        ["ch1", true],
        ["ch2", true],
        ["rot-doorway", true],
        ["rot-encounter", true],
        ["ch5", false],
      ]);
  }, 120_000);

  it("the measured first matching 25 fps frame reads every marked state", () => {
    const firstMatchingVideoFrame = new Map<string, number>([
      ["ch1", 0.52],
      ["ch2", 4.24],
      ["rot-doorway", 16.48],
      ["rot-encounter", 20.32],
      ["ch5", 54.88],
    ]);
    expect(chapters.map((chapter) => [chapter.id, readsMarkedState(chapter.id, firstMatchingVideoFrame.get(chapter.id) ?? -1)]))
      .toEqual(chapters.map((chapter) => [chapter.id, true]));
    expect([...firstMatchingVideoFrame.values()].every((seconds) => seconds * FPS === Math.round(seconds * FPS))).toBe(true);
  }, 120_000);

  it("maps an observed state through its recording segment's measured wall-clock origin", () => {
    expect(observedOffsetSeconds({ observedWallMs: 10_520, recordingOriginWallMs: 10_000 })).toBe(0.52);
    expect(observedOffsetSeconds({
      observedWallMs: 20_520,
      recordingOriginWallMs: 20_000,
      timelineStartSeconds: 49.64,
      trimInpointSeconds: 0.28,
    })).toBeCloseTo(49.88);
  });
});

describe.runIf(existsSync(join(HISTORY_RUN_6, "rr1-min.webm")))("HISTORY run-6 (pre-fix PTS record): clipped CH5 overlay", () => {
  it("records the clipped left edge in the run-6 CH5 overlay", () => {
    const chapters = (JSON.parse(readFileSync(join(HISTORY_RUN_6, "chapters.json"), "utf8")) as { chapters: Chapter[] }).chapters;
    const ch5 = chapters.find((chapter) => chapter.id === "ch5");
    if (ch5 === undefined) throw new Error("run-6 chapters.json is missing ch5");
    const measured = leftOverlayLuma(join(HISTORY_RUN_6, "rr1-min.webm"), ch5.offsetSeconds);
    expect(measured.overlayMax, `run-6 CH5 background max ${measured.backgroundMax.toFixed(3)}, overlay max ${measured.overlayMax.toFixed(3)}, margin 8`)
      .toBeGreaterThan(measured.backgroundMax + 8);
  }, 120_000);
});

describe("RR1 run-selection resolver", () => {
  it("returns a logged skip reason naming an absent machine-local store root", () => {
    const parent = mkdtempSync(join(tmpdir(), "rr1-selection-"));
    const absentRoot = join(parent, "absent-store");
    expect(resolveRr1RunSelection({ storeRoot: absentRoot }))
      .toEqual({ kind: "skip", reason: `RR1 store root is absent: ${absentRoot}`, storeRoot: absentRoot });
  });

  it("throws the missing artifact path when the shipped run directory is empty", () => {
    const storeRoot = mkdtempSync(join(tmpdir(), "rr1-selection-"));
    const run = join(storeRoot, publishedRr1Run());
    mkdirSync(run);
    expect(() => resolveRr1RunSelection({ storeRoot }))
      .toThrow(`selected RR1 run is missing rr1-min.webm: ${join(run, "rr1-min.webm")}`);
  });

  it("throws recordingClocks when a present fake run has capture.json without provenance", () => {
    const storeRoot = mkdtempSync(join(tmpdir(), "rr1-selection-"));
    const run = join(storeRoot, publishedRr1Run());
    mkdirSync(run);
    writeFileSync(join(run, "rr1-min.webm"), "fake");
    writeFileSync(join(run, "capture.json"), "{}\n");
    expect(() => resolveRr1RunSelection({ storeRoot }))
      .toThrow(`capture.json missing recordingClocks: ${join(run, "capture.json")}`);
  });
});

describe("RR1 published learner offset rule", () => {
  it("accepts a clamped ch1 offset when untrimmed minus trim is -0.012", () => {
    const recomputed = learnerChapterOffsetSeconds("ch1", 0.508, 0.52, 0.04, true);
    expect(Math.abs(0 - recomputed)).toBeLessThanOrEqual(0.001);
  });

  it("rejects published zero when untrimmed minus trim is +0.012", () => {
    const recomputed = learnerChapterOffsetSeconds("ch1", 0.532, 0.52, 0.04, true);
    expect(Math.abs(0 - recomputed)).toBeGreaterThan(0.001);
  });

  it("keeps run-14's one-frame-early published offsets failing T2 under content selection", () => {
    const run14 = [
      { id: "ch2", published: 1.299, frames: [{ pts: 1.28, state: "previous" }, { pts: 1.32, state: "marked" }] },
      { id: "rot-doorway", published: 13.388, frames: [{ pts: 13.36, state: "previous" }, { pts: 13.4, state: "marked" }] },
      { id: "rot-encounter", published: 17.386, frames: [{ pts: 17.36, state: "previous" }, { pts: 17.4, state: "marked" }] },
    ];
    const stateAtOffset = (frames: Array<{ pts: number; state: string }>, offset: number) => frames.filter((frame) => frame.pts <= offset).at(-1)?.state;
    expect(run14.map((entry) => [entry.id, stateAtOffset(entry.frames, entry.published) === "marked"]))
      .toEqual(run14.map((entry) => [entry.id, false]));
    expect(run14.map((entry) => {
      const selected = selectChapterByContentTransition({
        chapterId: entry.id,
        framePtsSeconds: entry.frames.map((frame) => frame.pts),
        searchStartSeconds: entry.frames[0]?.pts ?? 0,
        readsCurrentState: (pts: number) => stateAtOffset(entry.frames, pts) === "marked",
      });
      return [entry.id, entry.published === selected.offsetSeconds, selected.offsetSeconds];
    }))
      .toEqual([
        ["ch2", false, 1.32],
        ["rot-doorway", false, 13.4],
        ["rot-encounter", false, 17.4],
      ]);
  });

  it("classifies run-17's settled CLOSED / STATION 1 OF 3 crop as unknown, not as a blend", () => {
    const fixtureRoot = join(process.cwd(), "tools/openclinxr/evidence/site/fixtures/rr1-video-classifier");
    const phaseCrop = { x: 0, y: 0, width: 160, height: 22 };
    const stationCrop = { x: 0, y: 22, width: 160, height: 24 };
    const transition = join(fixtureRoot, "run-17-rot-doorway-transition-13.68.png");
    const doorway = join(fixtureRoot, "run-17-doorway-station-2-target.png");
    const encounter = join(fixtureRoot, "run-17-encounter-station-1-target.png");
    const phase = imageCrop(transition, phaseCrop);
    const station = imageCrop(transition, stationCrop);
    const doorwayPhase = relativeCropMatches(phase, imageCrop(doorway, phaseCrop), imageCrop(encounter, phaseCrop));
    const encounterPhase = relativeCropMatches(phase, imageCrop(encounter, phaseCrop), imageCrop(doorway, phaseCrop));
    const station2 = relativeCropMatches(station, imageCrop(doorway, stationCrop), imageCrop(encounter, stationCrop));
    const station1 = relativeCropMatches(station, imageCrop(encounter, stationCrop), imageCrop(doorway, stationCrop));
    expect({ doorway: doorwayPhase.matches && station2.matches, encounter: encounterPhase.matches && station1.matches })
      .toEqual({ doorway: false, encounter: false });
    expect(doorwayPhase.targetError).toBeGreaterThanOrEqual(10);
    expect(encounterPhase.targetError).toBeGreaterThanOrEqual(10);
    expect(station1.targetError).toBeLessThan(station2.targetError);
  });

  it("classifies the synthetic 50/50 reference blend as unknown while both references remain marked", () => {
    const fixtureRoot = join(process.cwd(), "tools/openclinxr/evidence/site/fixtures/rr1-video-classifier");
    const phaseCrop = { x: 0, y: 0, width: 160, height: 22 };
    const stationCrop = { x: 0, y: 22, width: 160, height: 24 };
    const doorway = join(fixtureRoot, "run-17-doorway-station-2-target.png");
    const encounter = join(fixtureRoot, "run-17-encounter-station-1-target.png");
    const blend = join(fixtureRoot, "synthetic-blend-50-50.png");
    const classifications = (actual: string) => {
      const phase = imageCrop(actual, phaseCrop);
      const station = imageCrop(actual, stationCrop);
      return {
        doorway: relativeCropMatches(phase, imageCrop(doorway, phaseCrop), imageCrop(encounter, phaseCrop)).matches
          && relativeCropMatches(station, imageCrop(doorway, stationCrop), imageCrop(encounter, stationCrop)).matches,
        encounter: relativeCropMatches(phase, imageCrop(encounter, phaseCrop), imageCrop(doorway, phaseCrop)).matches
          && relativeCropMatches(station, imageCrop(encounter, stationCrop), imageCrop(doorway, stationCrop)).matches,
      };
    };
    expect(classifications(blend)).toEqual({ doorway: false, encounter: false });
    expect(classifications(doorway)).toEqual({ doorway: true, encounter: false });
    expect(classifications(encounter)).toEqual({ doorway: false, encounter: true });
  });

  it("rejects run-18's open ch5 crop while run-18 and run-17 finalized crops remain marked", () => {
    const crop = { x: 0, y: 0, width: 250, height: 26 };
    const fullFrameCrop = { x: 0, y: 82, width: 250, height: 26 };
    const open = imageCrop(join(CLASSIFIER_FIXTURES, "run-18-ch5-open-65.84.png"), crop);
    const finalized = imageCrop(join(CLASSIFIER_FIXTURES, "run-18-ch5-finalized-80.00.png"), crop);
    const run17Finalized = imageCrop(join(CLASSIFIER_FIXTURES, "run-17-ch5-finalized-target.png"), fullFrameCrop);
    expect(relativeCropMatches(open, finalized, open).matches).toBe(false);
    expect(relativeCropMatches(finalized, finalized, open).matches).toBe(true);
    expect(relativeCropMatches(run17Finalized, finalized, open).matches).toBe(true);
  });

  it("rejects an offset one frame later than the first measured frame with no slack", () => {
    const expected = firstFramePtsAtOrAfter([1.28, 1.32, 1.36], 1.299);
    expect(expected).toBe(1.32);
    expect(1.36).not.toBe(expected);
  });

  it("recomputes the phase end margin from the published frame offset", () => {
    expect(assertPublishedChapterEndMargin("ch2", 1.32, 1.42)).toBe(100);
    expect(() => assertPublishedChapterEndMargin("ch2", 1.32, 1.419))
      .toThrow("chapter ch2 published-frame end margin 99 ms is below 100 ms");
  });

  it("selects a run-17-like marked frame before its wall-clock mark", () => {
    const selected = selectChapterByContentTransition({
      chapterId: "ch2",
      previousChapterId: "ch1",
      nextChapterId: "rot-doorway",
      framePtsSeconds: [1.52, 1.56, 1.6],
      searchStartSeconds: 1.52,
      readsPreviousState: (pts: number) => pts === 1.52,
      readsCurrentState: (pts: number) => pts >= 1.56,
      readsNextState: () => false,
    });
    expect(selected).toMatchObject({ offsetSeconds: 1.56, previousPts: 1.52, previousStatePts: 1.52 });
    expect(selected.offsetSeconds - 1.577).toBeCloseTo(-0.017);
  });

  it("rejects two chapters with no previous-state frame between them", () => {
    expect(() => selectChapterByContentTransition({
      chapterId: "rot-doorway",
      previousChapterId: "ch2",
      nextChapterId: "rot-encounter",
      framePtsSeconds: [1.56, 1.6, 13.72],
      searchStartSeconds: 1.56,
      readsPreviousState: () => false,
      readsCurrentState: (pts: number) => pts === 13.72,
      readsNextState: () => false,
    })).toThrow("chapter rot-doorway has no ch2 previous-state frame after 1.56 s and before rot-encounter");
  });

  it("rejects a chosen frame that already reads the next chapter state", () => {
    expect(() => selectChapterByContentTransition({
      chapterId: "ch2",
      previousChapterId: "ch1",
      nextChapterId: "rot-doorway",
      framePtsSeconds: [1.52, 1.56],
      searchStartSeconds: 1.52,
      readsPreviousState: (pts: number) => pts === 1.52,
      readsCurrentState: (pts: number) => pts === 1.56,
      readsNextState: (pts: number) => pts === 1.56,
    })).toThrow("chapter ch2 chosen frame 1.56 s already reads next chapter rot-doorway state");
  });
});

describe.runIf(existsSync(join(SCRATCH_RUN_17, "rr1-min.webm")))("RR1 run-17 relative classifier counterweights", () => {
  it("pins each chosen frame as marked and its immediate predecessor as not marked", () => {
    const video = join(SCRATCH_RUN_17, "rr1-min.webm");
    const framePts = framePtsSeconds(video);
    const readsMarkedState = createRr1FrameClassifier({
      video,
      doorwayPanel: join(SCRATCH_RUN_17, "panels/rot-doorway-runtime-panel.png"),
      encounterPanel: join(SCRATCH_RUN_17, "panels/ch2-runtime-panel.png"),
      ch5FinalizedCrop: join(CLASSIFIER_FIXTURES, "run-18-ch5-finalized-80.00.png"),
      ch5OpenCrop: join(CLASSIFIER_FIXTURES, "run-18-ch5-open-65.84.png"),
      framePtsSeconds: framePts,
    });
    const transitions = [
      { id: "ch1", previous: null, chosen: 0 },
      { id: "ch2", previous: 1.52, chosen: 1.56 },
      { id: "rot-doorway", previous: 13.68, chosen: 13.72 },
      { id: "rot-encounter", previous: 17.6, chosen: 17.64 },
      { id: "ch5", previous: 69.32, chosen: 69.36 },
    ];
    for (const transition of transitions) {
      if (transition.previous !== null) {
        expect(readsMarkedState(transition.id, transition.previous), `${transition.id} predecessor must not classify as marked`).toBe(false);
      }
      expect(readsMarkedState(transition.id, transition.chosen), `${transition.id} chosen frame must classify as marked`).toBe(true);
    }
  }, 120_000);
});

describe.runIf(existsSync(join(SCRATCH_RUN_18, "rr1-min.webm")))("RR1 run-18 ch5 classifier regression", () => {
  it("rejects the open chosen frame and accepts the first finalized frame with decoded neighbours", () => {
    const video = join(SCRATCH_RUN_18, "rr1-min.webm");
    const framePts = framePtsSeconds(video);
    const readsMarkedState = createRr1FrameClassifier({
      video,
      doorwayPanel: join(SCRATCH_RUN_18, "panels/rot-doorway-runtime-panel.png"),
      encounterPanel: join(SCRATCH_RUN_18, "panels/ch2-runtime-panel.png"),
      ch5FinalizedCrop: join(CLASSIFIER_FIXTURES, "run-18-ch5-finalized-80.00.png"),
      ch5OpenCrop: join(CLASSIFIER_FIXTURES, "run-18-ch5-open-65.84.png"),
      framePtsSeconds: framePts,
    });
    expect(readsMarkedState("ch5", 65.8)).toBe(false);
    expect(readsMarkedState("ch5", 65.84)).toBe(false);
    expect(readsMarkedState("ch5", 65.88)).toBe(false);
    expect(readsMarkedState("ch5", 70.04)).toBe(false);
    expect(readsMarkedState("ch5", 70.08)).toBe(true);
    expect(readsMarkedState("ch5", 70.12)).toBe(true);
  }, 120_000);

  it("writes the published video frame as a native-size PNG", () => {
    const video = join(SCRATCH_RUN_18, "rr1-min.webm");
    const output = join(mkdtempSync(join(tmpdir(), "rr1-ch5-video-frame-")), "ch5.png");
    writeVideoFramePng(video, 70.08, output);
    const dimensions = (path: string) => execFileSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path,
    ], { encoding: "utf8" }).trim();
    expect(dimensions(output)).toBe(dimensions(video));
  });
});

describe.skipIf(runSelection?.kind === "skip")("RR1_RUN_UNDER_TEST published-run gate", () => {
  function selectedRun(): string {
    if (runSelectionError !== undefined) throw runSelectionError;
    if (runSelection === undefined) throw new Error("RR1 run selection did not initialize");
    return rr1RunUnderTest(runSelection);
  }

  it("T1 reads every chapter's marked phase and station at offsetSeconds", () => {
    const run = selectedRun();
    const { chapters, readsMarkedState } = classifier(run);
    expect(chapters.map((chapter) => [chapter.id, readsMarkedState(chapter.id, chapter.offsetSeconds)]))
      .toEqual(chapters.map((chapter) => [chapter.id, true]));
  }, 120_000);

  it("T2 recomputes every offset on the muxed video's measured frame grid with no slack", () => {
    const run = selectedRun();
    const video = requireRunArtifact(run, "rr1-min.webm");
    const framePts = framePtsSeconds(video);
    videoFramePeriod(video);
    const { readsMarkedState } = classifier(run, true);
    const capture = JSON.parse(readFileSync(requireRunArtifact(run, "capture.json"), "utf8")) as {
      learnerHeaderLog?: Array<{ eyebrow: string; station: string; wallMs: number }>;
      marks?: Chapter[];
      recordingClocks?: Record<string, RecordingClock>;
    };
    const chapters = (JSON.parse(readFileSync(requireRunArtifact(run, "chapters.json"), "utf8")) as { chapters: Chapter[] }).chapters;
    if (capture.recordingClocks === undefined) throw new Error("capture.json missing recordingClocks");
    if (capture.marks === undefined) throw new Error("capture.json missing marks");
    const recomputeMark = (chapter: Chapter): { clock: RecordingClock & { recordingOriginWallMs: number }; mark: Chapter; markVideoTime: number } => {
      const mark = capture.marks?.find((entry) => entry.id === chapter.id);
      if (mark === undefined) throw new Error(`capture.json missing marks[] entry ${chapter.id}`);
      if (mark.observedWallMs === undefined) throw new Error(`capture.json marks[${chapter.id}].observedWallMs is missing`);
      if (mark.recording === undefined) throw new Error(`capture.json marks[${chapter.id}].recording is missing`);
      const clock = capture.recordingClocks?.[mark.recording];
      if (clock === undefined) throw new Error(`capture.json recordingClocks.${mark.recording} is missing`);
      if (clock.recordingOriginWallMs === undefined) throw new Error(`capture.json recordingClocks.${mark.recording}.recordingOriginWallMs is missing`);
      if (mark.recording === "learner" && clock.framePeriodSeconds === undefined) throw new Error("capture.json recordingClocks.learner.framePeriodSeconds is missing");
      if (mark.recording === "learner" && clock.trimReason === undefined) throw new Error("capture.json recordingClocks.learner.trimReason is missing");
      const untrimmed = observedOffsetSeconds({
        observedWallMs: mark.observedWallMs,
        recordingOriginWallMs: clock.recordingOriginWallMs,
        timelineStartSeconds: clock.timelineStartSeconds,
        trimInpointSeconds: 0,
      });
      const markVideoTime = mark.recording === "learner"
        ? learnerChapterOffsetSeconds(chapter.id, untrimmed, clock.trimInpointSeconds ?? 0, clock.framePeriodSeconds ?? Number.NaN, chapter.id === "ch1", clock.trimReason)
        : observedOffsetSeconds({ observedWallMs: mark.observedWallMs, recordingOriginWallMs: clock.recordingOriginWallMs, timelineStartSeconds: clock.timelineStartSeconds, trimInpointSeconds: clock.trimInpointSeconds });
      return { clock: { ...clock, recordingOriginWallMs: clock.recordingOriginWallMs }, mark, markVideoTime };
    };
    const recomputedMarks = chapters.map((chapter) => recomputeMark(chapter));
    const endMarginChecks: Array<{ chapter: Chapter; recomputedEndMarginMs: number }> = [];
    const metadataChecks: Array<{ chapter: Chapter; markVideoTime: number; selectedFrame: ReturnType<typeof selectChapterByContentTransition> }> = [];
    let previousPublishedOffset = 0;
    for (const [chapterIndex, chapter] of chapters.entries()) {
      const { clock, mark, markVideoTime } = recomputedMarks[chapterIndex];
      const previousChapter = chapters[chapterIndex - 1];
      const nextChapter = chapters[chapterIndex + 1];
      const selectedFrame = selectChapterByContentTransition({
        chapterId: chapter.id,
        previousChapterId: previousChapter?.id ?? null,
        nextChapterId: nextChapter?.id ?? null,
        framePtsSeconds: framePts,
        searchStartSeconds: previousPublishedOffset,
        readsCurrentState: (seconds: number) => readsMarkedState(chapter.id, seconds),
        readsPreviousState: previousChapter === undefined ? null : (seconds: number) => readsMarkedState(previousChapter.id, seconds),
        readsNextState: nextChapter === undefined ? null : (seconds: number) => readsMarkedState(nextChapter.id, seconds),
      });
      const recomputed = selectedFrame.offsetSeconds;
      expect(chapter.offsetSeconds, `${chapter.id} offsetSeconds differs from frame-grid D4 recomputation`).toBe(recomputed);
      metadataChecks.push({ chapter, markVideoTime, selectedFrame });
      if (selectedFrame.previousPts !== null) {
        expect(readsMarkedState(chapter.id, selectedFrame.previousPts), `${chapter.id} frame before chosen already reads marked`).toBe(false);
      }
      if (previousChapter !== undefined) {
        expect(selectedFrame.previousStatePts, `${chapter.id} has no ${previousChapter.id} previous-state proof`).not.toBeNull();
        expect(readsMarkedState(previousChapter.id, selectedFrame.previousStatePts ?? -1), `${chapter.id} previous-state proof does not read ${previousChapter.id}`).toBe(true);
      }
      if (nextChapter !== undefined) {
        expect(selectedFrame.nextStatePts, `${chapter.id} has no ${nextChapter.id} next-state content bound`).not.toBeNull();
        expect(recomputed, `${chapter.id} chosen frame reaches ${nextChapter.id}`).toBeLessThan(selectedFrame.nextStatePts ?? -1);
      }
      previousPublishedOffset = recomputed;

      let windowEndWallMs: number | undefined;
      if (mark.recording === "learner") {
        if (capture.learnerHeaderLog === undefined) throw new Error("capture.json learnerHeaderLog is missing");
        if (mark.phase === undefined || mark.stationIndex === undefined || mark.serverMs === undefined) {
          throw new Error(`capture.json marks[${chapter.id}] is missing learner window fields`);
        }
        windowEndWallMs = learnerHeaderWindow(
          capture.learnerHeaderLog,
          mark.phase,
          `Station ${mark.stationIndex + 1} of 3`,
          mark.serverMs,
        ).endWallMs ?? undefined;
      } else {
        windowEndWallMs = capture.recordingClocks.faculty?.recordingStopWallMs;
      }
      if (windowEndWallMs === undefined) throw new Error(`${chapter.id} marked window end is missing`);
      const windowEndVideoTime = observedOffsetSeconds({
        observedWallMs: windowEndWallMs,
        recordingOriginWallMs: clock.recordingOriginWallMs,
        timelineStartSeconds: clock.timelineStartSeconds,
        trimInpointSeconds: clock.trimInpointSeconds,
      });
      const recomputedEndMarginMs = assertPublishedChapterEndMargin(chapter.id, recomputed, windowEndVideoTime);
      endMarginChecks.push({ chapter, recomputedEndMarginMs });
    }
    for (const { chapter, markVideoTime, selectedFrame } of metadataChecks) {
      expect(chapter.skewSeconds, `${chapter.id} signed skew differs`).toBe(selectedFrame.offsetSeconds - markVideoTime);
      expect(chapter.previousFramePtsSeconds, `${chapter.id} predecessor PTS differs`).toBe(selectedFrame.previousPts);
      expect(chapter.previousStateFramePtsSeconds, `${chapter.id} previous-state PTS differs`).toBe(selectedFrame.previousStatePts);
      expect(chapter.nextStateFramePtsSeconds, `${chapter.id} next-state content bound differs`).toBe(selectedFrame.nextStatePts);
    }
    for (const { chapter, recomputedEndMarginMs } of endMarginChecks) {
      expect(chapter.endMarginMs, `${chapter.id} published-frame end margin differs`).toBe(recomputedEndMarginMs);
    }
  });

  it("T4 keeps the left 8 px column free of CH5 overlay text", () => {
    const run = selectedRun();
    const video = requireRunArtifact(run, "rr1-min.webm");
    const chapters = (JSON.parse(readFileSync(requireRunArtifact(run, "chapters.json"), "utf8")) as { chapters: Chapter[] }).chapters;
    const ch5 = chapters.find((chapter) => chapter.id === "ch5");
    if (ch5 === undefined) throw new Error("chapters.json is missing ch5");
    const measured = leftOverlayLuma(video, ch5.offsetSeconds);
    expect(measured.overlayMax, `CH5 background max ${measured.backgroundMax.toFixed(3)}, overlay max ${measured.overlayMax.toFixed(3)}, VP8 margin 8`)
      .toBeLessThanOrEqual(measured.backgroundMax + 8);
  }, 120_000);

  it("keeps decoded CH5 signoff text within 2 px of each page's measured DOM text extent", () => {
    const run = selectedRun();
    const video = requireRunArtifact(run, "rr1-min.webm");
    const still = requireRunArtifact(run, "frames/ch5.png");
    const chapters = (JSON.parse(readFileSync(requireRunArtifact(run, "chapters.json"), "utf8")) as { chapters: Chapter[] }).chapters;
    const ch5 = chapters.find((chapter) => chapter.id === "ch5");
    if (ch5 === undefined) throw new Error("chapters.json is missing ch5");
    const layoutLog = JSON.parse(readFileSync(requireRunArtifact(run, "faculty-layout-log.json"), "utf8")) as {
      occlusionMeasurements?: Array<{
        kind: string;
        points: Array<{ isTargetOrDescendant?: boolean }>;
        textExtent?: { right?: number };
      }>;
    };
    const recordedMeasurement = layoutLog.occlusionMeasurements?.find((entry) => entry.kind === "recorded:ch5-offset");
    const signoffLineCrop = { x: 0, y: 92, width: 250, height: 20 };
    const videoFrames = signoffFrameSeries(video, framePtsSeconds(video), ch5.offsetSeconds, signoffLineCrop);
    const stillRightmostColumn = rightmostTextColumn(imageCrop(still, signoffLineCrop), signoffLineCrop);
    // Two pixels allow glyph-edge anti-aliasing without permitting a clipped character.
    expect(assertFacultySignoffFrameSeries(videoFrames, recordedMeasurement?.textExtent?.right, 2)).toMatchObject({ pass: true });
    expect(assessFacultySignoffTextExtent(stillRightmostColumn, recordedMeasurement?.textExtent?.right, "still", 2)).toMatchObject({ pass: true });
  }, 120_000);

  it("keeps the CH5 still sourced from its published video frame", () => {
    const run = selectedRun();
    const capture = JSON.parse(readFileSync(requireRunArtifact(run, "capture.json"), "utf8")) as {
      facultyStillSourceGuard?: { source?: string };
    };
    expect(assertCh5StillSource(capture.facultyStillSourceGuard?.source)).toMatchObject({ pass: true });
  });

  it("records the IWER release lag after the CH5 finalize observation", () => {
    const run = selectedRun();
    const layoutLog = JSON.parse(readFileSync(requireRunArtifact(run, "faculty-layout-log.json"), "utf8"));
    expect(facultyIwerReleaseAfterFinalize(layoutLog)).toEqual(layoutLog.iwerRelease);
    expect(layoutLog.iwerRelease.releaseAfterFinalizeMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps every recorded faculty layout sample inside the viewport for the identified IWER container", () => {
    const run = selectedRun();
    const layoutLog = JSON.parse(readFileSync(requireRunArtifact(run, "faculty-layout-log.json"), "utf8")) as Parameters<typeof assertFacultyLayoutLog>[0];
    expect(assertFacultyLayoutLog(layoutLog)).toMatchObject({ pass: true });
  });
});
