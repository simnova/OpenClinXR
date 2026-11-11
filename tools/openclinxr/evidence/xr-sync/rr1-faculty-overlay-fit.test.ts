import { describe, expect, it } from "vitest";
import {
  assertCh5EndMargin,
  assertCh5StillSource,
  assertFacultyLayoutLog,
  assertFacultySignoffFrameSeries,
  assertFacultySignoffPointHits,
  assessFacultyOverlayFit,
  assessFacultySignoffTextExtent,
  facultyIwerReleaseAfterFinalize,
} from "./rr1-run.mjs";

describe("RR1 recorded faculty overlay fit", () => {
  it("rejects a run-10-like narrow overlay line", () => {
    expect(assessFacultyOverlayFit({
      viewportWidth: 960,
      overlayBoxRight: 960,
      lines: [{ id: "sync-probe-c14", scrollWidth: 128, clientWidth: 90, boxRight: 90 }],
    })).toMatchObject({ pass: false, rightEdgeInside: true });
  });

  it("accepts full-width lines whose content and box fit the viewport", () => {
    expect(assessFacultyOverlayFit({
      viewportWidth: 960,
      overlayBoxRight: 960,
      lines: [
        { id: "sync-probe-c14", scrollWidth: 960, clientWidth: 960, boxRight: 960 },
        { id: "sync-probe-status", scrollWidth: 960, clientWidth: 960, boxRight: 960 },
      ],
    })).toMatchObject({ pass: true, rightEdgeInside: true, overflowingLines: [] });
  });

  it("rejects a run-14-like clipped signoff edge against the DOM text extent", () => {
    expect(() => assessFacultySignoffTextExtent(80, 126, "video", 2))
      .toThrow("faculty signoff video rightmost text column 80 is left of DOM text extent 126 with 2 px anti-alias allowance");
  });

  it("accepts a signoff edge that reaches the DOM text extent allowance", () => {
    expect(assessFacultySignoffTextExtent(124, 126, "still", 2)).toEqual({
      rightmostTextColumn: 124,
      domTextRight: 126,
      antiAliasAllowancePx: 2,
      pass: true,
    });
  });

  it("rejects a missing DOM text extent by name", () => {
    expect(() => assessFacultySignoffTextExtent(126, undefined, "still", 2))
      .toThrow("faculty signoff still DOM text extent is missing");
  });

  it("rejects an elementFromPoint canvas hit and names it", () => {
    expect(() => assertFacultySignoffPointHits({
      points: [
        { x: 20, tagName: "DIV", id: "sync-probe-iwer-container", isTargetOrDescendant: false },
        { x: 100, tagName: "CANVAS", id: "sync-probe-canvas", isTargetOrDescendant: false },
        { x: 123, tagName: "CANVAS", id: "sync-probe-canvas", isTargetOrDescendant: false },
      ],
    }, "scratch-15 still")).toThrow(/sync-probe-iwer-container.*sync-probe-canvas/u);
  });

  it("supersedes rubric equality by rejecting a non-video ch5 still source", () => {
    expect(() => assertCh5StillSource("driven-c14-context"))
      .toThrow(/reinstate the nine-line still\/recorded equality if a non-video still source returns/u);
  });

  it("supersedes status equality by rejecting a missing ch5 still source", () => {
    expect(() => assertCh5StillSource(undefined))
      .toThrow(/ch5 still source is undefined/u);
  });

  it("accepts the by-construction video-frame ch5 still source", () => {
    expect(assertCh5StillSource("video-frame")).toEqual({ pass: true, stillSource: "video-frame" });
  });

  it("rejects the first run-15-like occluded faculty frame by PTS", () => {
    expect(() => assertFacultySignoffFrameSeries([
      { pts: 5.36, rightmostTextColumn: 79 },
      { pts: 6.72, rightmostTextColumn: 79 },
      { pts: 6.76, rightmostTextColumn: 126 },
    ], 127.16, 2)).toThrow("first fails at PTS 5.36 s: rightmost text column 79 < DOM text extent 127.16 - 2 px");
  });

  it("accepts a faculty frame series whose signoff reaches the DOM extent allowance", () => {
    expect(assertFacultySignoffFrameSeries([
      { pts: 5.36, rightmostTextColumn: 126 },
      { pts: 5.4, rightmostTextColumn: 126 },
    ], 127.16, 2)).toMatchObject({ pass: true, frameCount: 2 });
  });

  it("measures scratch-15's IWER release 1277 ms after the finalize observation", () => {
    expect(facultyIwerReleaseAfterFinalize({
      occlusionMeasurements: [{ kind: "recorded:ch5-offset", wallMs: 1_794_431_784_739 }],
      events: [{ kind: "window-resize", wallMs: 1_794_431_786_016 }],
    })).toEqual({
      finalizeWallMs: 1_794_431_784_739,
      releaseWallMs: 1_794_431_786_016,
      releaseAfterFinalizeMs: 1_277,
    });
  });

  it("requires a numeric ch5 end margin", () => {
    expect(assertCh5EndMargin(0)).toBe(0);
    expect(() => assertCh5EndMargin(null)).toThrow("ch5 artifact endMarginMs is null");
  });

  it("rejects the first run-12-like overflow sample by faculty-local time", () => {
    expect(() => assertFacultyLayoutLog({
      facultyRecordingOriginWallMs: 1000,
      facultyTrimInpointSeconds: 0.1,
      events: [{ kind: "container:load", tagName: "DIV", id: "sync-probe-iwer-container" }],
      animationFrames: [{ wallMs: 1247, overlayBoxRight: 984, innerWidth: 960 }],
    })).toThrow("faculty layout first exceeds innerWidth at faculty-local 147 ms: overlayBoxRight=984 innerWidth=960");
  });

  it("accepts all-960 samples for the identified IWER container", () => {
    expect(assertFacultyLayoutLog({
      facultyRecordingOriginWallMs: 1000,
      facultyTrimInpointSeconds: 0.1,
      events: [{ kind: "container:load", tagName: "DIV", id: "sync-probe-iwer-container" }],
      animationFrames: [
        { wallMs: 1247, overlayBoxRight: 960, innerWidth: 960 },
        { wallMs: 1300, overlayBoxRight: 960, innerWidth: 960 },
      ],
    })).toMatchObject({ pass: true, sampleCount: 2 });
  });

  it("rejects a different load container identity", () => {
    expect(() => assertFacultyLayoutLog({
      facultyRecordingOriginWallMs: 1000,
      facultyTrimInpointSeconds: 0,
      events: [{ kind: "container:load", tagName: "DIV", id: "different-container" }],
      animationFrames: [{ wallMs: 1100, overlayBoxRight: 960, innerWidth: 960 }],
    })).toThrow("does not equal DIV#sync-probe-iwer-container");
  });
});
