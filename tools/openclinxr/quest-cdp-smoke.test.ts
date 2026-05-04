import { describe, expect, it } from "vitest";
import {
  browserSnapshotExpression,
  buildReport,
  frameSampleExpression,
  interactionExpression,
  pageMatchesRequestedUrl,
  parseArgs,
} from "./quest-cdp-smoke.js";

describe("Quest CDP smoke probe", () => {
  it("parses default and explicit CLI options", () => {
    expect(parseArgs([])).toMatchObject({
      url: "http://localhost:5173/",
      appPort: 5173,
      cdpPort: 9222,
      frameSampleCount: 90,
      frameTimeoutMs: 4000,
      skipLaunch: false,
    });

    expect(parseArgs([
      "--url",
      "http://localhost:5174/quest?smoke=1",
      "--cdp-port",
      "9333",
      "--output",
      "docs/openclinxr/quest-smoke.json",
      "--frame-sample-count",
      "12",
      "--frame-timeout-ms",
      "900",
      "--skip-launch",
    ])).toMatchObject({
      url: "http://localhost:5174/quest?smoke=1",
      appPort: 5174,
      cdpPort: 9333,
      outputPath: "docs/openclinxr/quest-smoke.json",
      frameSampleCount: 12,
      frameTimeoutMs: 900,
      skipLaunch: true,
    });
  });

  it("rejects unknown, missing, and non-positive CLI values", () => {
    expect(() => parseArgs(["--surprise"])).toThrow("Unknown argument");
    expect(() => parseArgs(["--url"])).toThrow("--url requires a value");
    expect(() => parseArgs(["--app-port", "0"])).toThrow("--app-port must be a positive number");
    expect(() => parseArgs(["--cdp-port", "0"])).toThrow("--cdp-port must be a positive number");
    expect(() => parseArgs(["--frame-sample-count", "0"])).toThrow("--frame-sample-count must be a positive number");
    expect(() => parseArgs(["--frame-timeout-ms", "0"])).toThrow("--frame-timeout-ms must be a positive number");
  });

  it("matches the requested Quest page while ignoring query-string differences", () => {
    expect(pageMatchesRequestedUrl("http://localhost:5173/?questSmoke=1", "http://localhost:5173/")).toBe(true);
    expect(pageMatchesRequestedUrl("http://localhost:5173/station?questSmoke=1", "http://localhost:5173/station")).toBe(true);
    expect(pageMatchesRequestedUrl("http://localhost:5173/other", "http://localhost:5173/station")).toBe(false);
    expect(pageMatchesRequestedUrl("not a url", "http://localhost:5173/station")).toBe(false);
  });

  it("generates browser, interaction, and frame-sampling expressions with station targets", () => {
    expect(browserSnapshotExpression()).toContain("window.__openClinXrFrameStats");
    expect(browserSnapshotExpression()).toContain("ED Chest Pain");
    expect(interactionExpression()).toContain("ecg request");
    expect(interactionExpression()).toContain("urgent escalation");
    expect(interactionExpression()).toContain("Trace Actions");
    expect(frameSampleExpression(12, 900)).toContain("sampleCount >= 12");
    expect(frameSampleExpression(12, 900)).toContain("performance.now() - started < 900");
    expect(frameSampleExpression(12, 900)).toContain("window.__openClinXrFrameStats");
  });

  it("builds a passing report when shell, interaction, visibility, and frame sample are healthy", () => {
    const report = buildReport({
      options: parseArgs(["--url", "http://localhost:5173/?questSmoke=1"]),
      adbVersion: "Android Debug Bridge version 1.0.41",
      deviceLine: "1234 device product:quest3",
      reverseList: "1234 tcp:5173 tcp:5173",
      browser: {
        title: "OpenClinXR Station Runtime",
        bodyHasEdChestPain: true,
        hasViteOverlay: false,
        hidden: false,
        visibilityState: "visible",
        canvas: { dataUrlLength: 4096 },
      },
      interaction: {
        afterTrace: "Trace 2/10",
        clickedEcg: true,
        clickedUrgent: true,
      },
      frameSample: {
        timedOut: false,
        avgFrameMs: 13.5,
      },
    });

    expect(report.verdict).toEqual({
      shellLoaded: true,
      interactionAdvanced: true,
      frameSampleComplete: true,
      blockers: [],
    });
  });

  it("keeps Quest readiness blockers explicit when probe evidence is incomplete", () => {
    const report = buildReport({
      options: parseArgs([]),
      adbVersion: "Android Debug Bridge version 1.0.41",
      deviceLine: "1234 device product:quest3",
      reverseList: "",
      browser: {
        title: "Vite error",
        bodyHasEdChestPain: false,
        hasViteOverlay: true,
        hidden: true,
        visibilityState: "hidden",
        canvas: null,
      },
      interaction: {
        afterTrace: "Trace 1/10",
        clickedEcg: false,
        clickedUrgent: false,
      },
      frameSample: {
        timedOut: true,
        avgFrameMs: null,
      },
    });

    expect(report.verdict).toEqual({
      shellLoaded: false,
      interactionAdvanced: false,
      frameSampleComplete: false,
      blockers: [
        "quest_shell_not_loaded",
        "quest_trace_interaction_not_advanced",
        "quest_page_hidden_or_inactive",
        "quest_cdp_frame_sample_incomplete",
      ],
    });
  });
});
