import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentClipHeight } from "../xr-sync/harness-lib.mjs";
import {
  assessRecordedTurn,
  audioLineAlignment,
  c14HostReviewUrl,
  firstPaintTrim,
  measuredAudioDelayMs,
  phaseDisagreement,
} from "../xr-sync/rr1-run.mjs";
import { currentRr1RunSelection, requireRunArtifact, rr1RunUnderTest } from "./rr1-run-selection";

let runSelection: ReturnType<typeof currentRr1RunSelection> | undefined;
let runSelectionError: unknown;
try {
  runSelection = currentRr1RunSelection();
} catch (error) {
  runSelectionError = error;
}
if (runSelection?.kind === "skip") console.log(`[rr1-min-run] SKIP ${runSelection.reason}`);
const storeIt = runSelection?.kind === "skip" ? it.skip : it;

type ClockEntry = { stationIndex: number; phase?: string; event?: string; serverMs: number };
type Mark = ClockEntry & { id: string; offsetSeconds: number };

function selectedRun(...artifacts: string[]): string {
  if (runSelectionError !== undefined) throw runSelectionError;
  if (runSelection === undefined) throw new Error("RR1 run selection did not initialize");
  const run = rr1RunUnderTest(runSelection);
  for (const artifact of artifacts) requireRunArtifact(run, artifact);
  return run;
}

function readJson<T>(dir: string, name: string): T {
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
}

function keyOf(value: ClockEntry): string {
  return `${value.stationIndex}|${value.phase === undefined ? `event:${value.event}` : `phase:${value.phase}`}`;
}

function validateClock(clock: ClockEntry[], marks: Mark[]): void {
  const encounter0 = clock.find((entry) => entry.stationIndex === 0 && entry.phase === "encounter");
  const encounter1 = clock.find((entry) => entry.stationIndex === 1 && entry.phase === "encounter");
  if (encounter0 === undefined || encounter1 === undefined || encounter0.serverMs === encounter1.serverMs) {
    throw new Error("G3 requires distinct station 0 and station 1 encounter clock entries");
  }
  const expected = [
    ["ch1", 0, "phase", "doorway"],
    ["ch2", 0, "phase", "encounter"],
    ["rot-doorway", 1, "phase", "doorway"],
    ["rot-encounter", 1, "phase", "encounter"],
    ["ch5", 0, "event", "finalize-review-ack"],
  ] as const;
  const byClockKey = new Map(clock.map((entry) => [keyOf(entry), entry]));
  let previous = -Infinity;
  for (const [id, stationIndex, kind, value] of expected) {
    const mark = marks.find((entry) => entry.id === id);
    if (mark === undefined) throw new Error(`G4 missing mark ${id}`);
    const wantedKey = `${stationIndex}|${kind}:${value}`;
    if (keyOf(mark) !== wantedKey) throw new Error(`G4 ${id} has ${keyOf(mark)}, want ${wantedKey}`);
    const clockEntry = byClockKey.get(wantedKey);
    if (clockEntry === undefined || mark.serverMs !== clockEntry.serverMs) {
      throw new Error(`G4 ${id} serverMs differs from server-clock entry ${wantedKey}`);
    }
    if (mark.serverMs <= previous) throw new Error(`G4 ${id} serverMs is not strictly increasing`);
    previous = mark.serverMs;
  }
}

describe("RR1-min server-clocked capture", () => {
  it("R1/R2 advances by turn count and accepts the recorded opening when its rendered line equals the pre-question line", () => {
    const recordedRun3Fixture = {
      turnsBefore: 0,
      previousLine: "Robert Hayes: It feels heavy, like someone is sitting on my chest.",
      displayedLine: "Robert Hayes: It feels heavy, like someone is sitting on my chest.",
      turnsAfter: [{
        replyId: "patient_robert_hayes_v1:opening",
        planCaption: "Robert Hayes: It feels heavy, like someone is sitting on my chest.",
      }],
    };
    const result = assessRecordedTurn(recordedRun3Fixture);
    expect(recordedRun3Fixture.displayedLine).toBe(recordedRun3Fixture.previousLine);
    expect(result).toMatchObject({ advanced: true, renderedLineMatches: true });
    expect(result.turn?.replyId).toBe("patient_robert_hayes_v1:opening");
  });

  it("R6 trims measured leading blank frames and leaves an already-painted segment unchanged", () => {
    const recordedFacultyLoad = [
      { ptsTime: 0, yMin: 16, yMax: 16 },
      { ptsTime: 0.04, yMin: 16, yMax: 16 },
      { ptsTime: 0.08, yMin: 16, yMax: 16 },
      { ptsTime: 0.12, yMin: 16, yMax: 16 },
      { ptsTime: 0.16, yMin: 16, yMax: 16 },
      { ptsTime: 0.2, yMin: 16, yMax: 16 },
      { ptsTime: 0.24, yMin: 16, yMax: 210 },
      { ptsTime: 0.28, yMin: 16, yMax: 215 },
    ];
    expect(firstPaintTrim(recordedFacultyLoad)).toMatchObject({ blankFrames: 6, inpointSeconds: 0.24 });
    expect(firstPaintTrim(recordedFacultyLoad.slice(6))).toMatchObject({ blankFrames: 0, inpointSeconds: 0 });
  });

  it("R5 crops the recorded 849 px panel fixture to its measured 600 px content", () => {
    expect(contentClipHeight(849, 576, 24)).toBe(600);
    expect(contentClipHeight(600, 849, 24)).toBe(600);
  });

  it("R4 computes exact disagreement spans from every-change DOM records", () => {
    const recorded = [
      { atMs: 100, eyebrow: "Doorway", phaseRow: "Doorway" },
      { atMs: 200, eyebrow: "Encounter", phaseRow: "Doorway" },
      { atMs: 240, eyebrow: "Encounter", phaseRow: "Encounter" },
    ];
    expect(phaseDisagreement(recorded, 300)).toEqual({
      maxDisagreementMs: 40,
      spans: [{ startMs: 200, endMs: 240, durationMs: 40, eyebrow: "Encounter", phaseRow: "Doorway" }],
    });
    expect(phaseDisagreement(recorded.filter((entry) => entry.eyebrow === entry.phaseRow), 300).maxDisagreementMs).toBe(0);
  });

  it("R7 derives audio delay from measured line/source onset and enforces the 120 ms limit", () => {
    expect(measuredAudioDelayMs(8.84, 0.17)).toBe(8670);
    const aligned = audioLineAlignment(8.88, 8.84);
    expect(aligned.differenceSeconds).toBeCloseTo(0.04);
    expect(aligned.pass).toBe(true);
    expect(audioLineAlignment(8.68, 8.84)).toMatchObject({ pass: false });
  });

  it("V2 loads the actual C14 host-review route, not the autostart-off diagnostic placeholder", () => {
    const url = new URL(c14HostReviewUrl("http://127.0.0.1:8000/sync-probe.html", "ws://127.0.0.1:9000", [{ id: "hpi", label: "Asked onset" }]));
    expect(url.pathname).toBe("/sync-probe.html");
    expect(url.searchParams.get("script")).toBe("c14");
    expect(url.searchParams.get("autostart")).toBe("1");
  });

  storeIt("G3/G4 keeps both encounter clocks and binds every ordered mark to its exact server entry", () => {
    const run = selectedRun("server-clock.json", "chapters.json");
    const clock = readJson<ClockEntry[]>(run, "server-clock.json");
    const chapters = readJson<{ chapters: Mark[] }>(run, "chapters.json");
    expect(() => validateClock(clock, chapters.chapters)).not.toThrow();
  });

  storeIt("G5 keeps every server-derived chapter offset inside the ffprobe video duration", () => {
    const run = selectedRun("chapters.json", "video.json");
    const chapters = readJson<{ clock: string; chapters: Mark[] }>(run, "chapters.json");
    const video = readJson<{ format?: { duration?: string } }>(run, "video.json");
    const duration = Number(video.format?.duration);
    expect([
      "host Date.now, one process",
      "host Date.now observations mapped to each recording segment's page-creation wall-clock origin",
    ]).toContain(chapters.clock);
    expect(Number.isFinite(duration) && duration > 0).toBe(true);
    expect(chapters.chapters.every((chapter) => chapter.offsetSeconds >= 0 && chapter.offsetSeconds <= duration)).toBe(true);
  });

  storeIt("G6 proves the station-2 doorway mark from visible runtime-panel DOM text", () => {
    const run = selectedRun("capture.json");
    const capture = readJson<{ panelEvidence: Array<{ id: string; innerText: string; height?: number; originalHeight?: number; croppedToContent?: boolean; eyebrow?: string }> }>(run, "capture.json");
    const rotation = capture.panelEvidence.find((entry) => entry.id === "rot-doorway");
    expect(rotation?.innerText).toMatch(/station 2 of 3/iu);
    expect(rotation?.innerText).not.toMatch(/station 1 of 3/iu);
    for (const entry of capture.panelEvidence.filter((row) => row.id !== "ch5" && row.eyebrow !== undefined)) {
      const expectedPhase = entry.id === "ch1" || entry.id === "rot-doorway" ? "doorway" : "encounter";
      expect(entry.eyebrow?.toLowerCase()).toBe(expectedPhase);
      expect(entry.height).toBeLessThanOrEqual(entry.originalHeight ?? 0);
      expect(entry.height).toBeLessThanOrEqual(600);
    }
  });

  storeIt("keeps every recorded frame's panel region non-uniform and includes the CH2 TTS audio stream", () => {
    const run = selectedRun("capture.json", "rr1-min.webm");
    const capture = readJson<{
      panelLumaGate: { frameCount: number; minimumRange: number; threshold: number; metric: string };
      panelEvidence: Array<{ id: string; innerText: string }>;
      ttsTap: { text: string };
      facultyProbe: { error: string | null; c13: { scoreAcked: boolean; returnAcked: boolean } };
      facultyCamera: { route: string };
    }>(run, "capture.json");
    expect(capture.panelLumaGate.metric).toContain("YMAX-YMIN");
    expect(capture.panelLumaGate.frameCount).toBeGreaterThan(0);
    expect(capture.panelLumaGate.minimumRange).toBeGreaterThanOrEqual(capture.panelLumaGate.threshold);
    expect(capture.panelEvidence.find((entry) => entry.id === "ch2")?.innerText).toContain(capture.ttsTap.text);
    expect(capture.panelEvidence.find((entry) => entry.id === "ch5")?.innerText).toContain("signoff:finalized");
    expect(capture.facultyProbe).toMatchObject({ error: null, c13: { scoreAcked: true, returnAcked: true } });
    const facultyRoute = new URL(capture.facultyCamera.route);
    expect(facultyRoute.searchParams.get("script")).toBe("c14");
    expect(facultyRoute.searchParams.get("autostart")).toBe("1");
    const media = JSON.parse(execFileSync("ffprobe", [
      "-v", "error", "-show_streams", "-show_format", "-of", "json", join(run, "rr1-min.webm"),
    ], { encoding: "utf8" })) as { streams?: Array<{ codec_type?: string; duration?: string }>; format?: { duration?: string } };
    expect(media.streams?.some((stream) => stream.codec_type === "video")).toBe(true);
    expect(media.streams?.some((stream) => stream.codec_type === "audio")).toBe(true);
    expect(Number(media.format?.duration)).toBeGreaterThan(0);
  });

  storeIt("refuses a chapter fixture whose serverMs does not equal its station-phase clock entry", () => {
    const run = selectedRun("server-clock.json", "chapters.json");
    const clock = readJson<ClockEntry[]>(run, "server-clock.json");
    const chapters = readJson<{ chapters: Mark[] }>(run, "chapters.json");
    const forged = chapters.chapters.map((entry) => entry.id === "ch2" ? { ...entry, serverMs: entry.serverMs + 1 } : entry);
    expect(() => validateClock(clock, forged)).toThrow(/serverMs differs/u);
  });

  storeIt("refuses an end-of-run clock fixture where station 1 overwrote station 0", () => {
    const run = selectedRun("server-clock.json", "chapters.json");
    const clock = readJson<ClockEntry[]>(run, "server-clock.json").filter(
      (entry) => !(entry.stationIndex === 0 && entry.phase === "encounter"),
    );
    const chapters = readJson<{ chapters: Mark[] }>(run, "chapters.json");
    expect(() => validateClock(clock, chapters.chapters)).toThrow(/G3 requires distinct/u);
  });
});
