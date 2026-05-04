import { describe, expect, it } from "vitest";
import {
  browserSnapshotExpression,
  buildQuestSmokeEvidenceCheck,
  buildReport,
  type CdpPage,
  frameSampleExpression,
  interactionExpression,
  pageMatchesRequestedUrl,
  parseArgs,
  selectQuestPage,
  staleQuestSmokePageIds,
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
      mode: "run",
      inputPattern: "docs/openclinxr/quest-cdp-smoke-[0-9]*.json",
    });

    expect(parseArgs([
      "--url",
      "http://localhost:5174/quest?smoke=1",
      "--target",
      "iwsdk-sidecar",
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
      mode: "run",
      url: "http://localhost:5174/quest?smoke=1",
      target: "iwsdk-sidecar",
      appPort: 5174,
      cdpPort: 9333,
      outputPath: "docs/openclinxr/quest-smoke.json",
      frameSampleCount: 12,
      frameTimeoutMs: 900,
      skipLaunch: true,
    });

    expect(parseArgs([
      "--validate-latest",
      "docs/openclinxr/quest-cdp-smoke-fixture-*.json",
      "--output",
      ".agent-factory/quest-cdp-smoke-check.json",
    ])).toMatchObject({
      mode: "validate",
      inputPattern: "docs/openclinxr/quest-cdp-smoke-fixture-*.json",
      outputPath: ".agent-factory/quest-cdp-smoke-check.json",
    });

    expect(parseArgs([
      "--validate-latest",
      "--",
      "--output",
      ".agent-factory/quest-cdp-smoke-check.json",
    ])).toMatchObject({
      mode: "validate",
      inputPattern: "docs/openclinxr/quest-cdp-smoke-[0-9]*.json",
      outputPath: ".agent-factory/quest-cdp-smoke-check.json",
    });

    expect(parseArgs(["--input", "docs/openclinxr/quest-cdp-smoke-2026-05-04.json"])).toMatchObject({
      mode: "validate",
      inputPath: "docs/openclinxr/quest-cdp-smoke-2026-05-04.json",
    });
  });

  it("rejects unknown, missing, and non-positive CLI values", () => {
    expect(() => parseArgs(["--surprise"])).toThrow("Unknown argument");
    expect(() => parseArgs(["--url"])).toThrow("--url requires a value");
    expect(() => parseArgs(["--target", "unknown"])).toThrow("--target must be one of");
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

  it("prefers the exact Quest page and identifies stale same-path smoke pages", () => {
    const pages = [
      { id: "ui", title: "Browser UI", type: "other", url: "chrome://panel-app-nav/" },
      {
        id: "old",
        title: "OpenClinXR IWSDK Spike",
        type: "page",
        url: "http://localhost:5183/?questSmoke=old",
        webSocketDebuggerUrl: "ws://old",
      },
      {
        id: "exact",
        title: "OpenClinXR IWSDK Spike",
        type: "page",
        url: "http://localhost:5183/?questSmoke=fresh",
        webSocketDebuggerUrl: "ws://fresh",
      },
      {
        id: "other",
        title: "OpenClinXR Station Runtime",
        type: "page",
        url: "http://localhost:5173/?questSmoke=fresh",
        webSocketDebuggerUrl: "ws://other",
      },
    ] satisfies CdpPage[];

    expect(selectQuestPage(pages, "http://localhost:5183/?questSmoke=fresh")?.id).toBe("exact");
    expect(staleQuestSmokePageIds(pages, "http://localhost:5183/?questSmoke=fresh", "exact")).toEqual(["old"]);
  });

  it("generates browser, interaction, and frame-sampling expressions with station targets", () => {
    expect(browserSnapshotExpression()).toContain("window.__openClinXrFrameStats");
    expect(browserSnapshotExpression()).toContain("window.__openClinXrInputEvidence");
    expect(browserSnapshotExpression()).toContain("window.__openClinXrBootEvidence");
    expect(browserSnapshotExpression()).toContain("window.__openClinXrIwsdkSidecarEvidence");
    expect(browserSnapshotExpression()).toContain("ED Chest Pain");
    expect(interactionExpression()).toContain("ecg request");
    expect(interactionExpression()).toContain("urgent escalation");
    expect(interactionExpression()).toContain("Trace Actions");
    expect(frameSampleExpression(12, 900)).toContain("sampleCount >= 12");
    expect(frameSampleExpression(12, 900)).toContain("performance.now() - started < 900");
    expect(frameSampleExpression(12, 900)).toContain("window.__openClinXrFrameStats");
    expect(frameSampleExpression(12, 900)).toContain("window.__openClinXrIwsdkSidecarEvidence");
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
    expect(report.target).toBe("station");
  });

  it("builds a passing sidecar report with the IWSDK shell title and sidecar trace denominator", () => {
    const report = buildReport({
      options: parseArgs([
        "--url",
        "http://localhost:5183/?questSmoke=1",
        "--target",
        "iwsdk-sidecar",
      ]),
      adbVersion: "Android Debug Bridge version 1.0.41",
      deviceLine: "1234 device product:quest3",
      reverseList: "1234 tcp:5183 tcp:5183",
      browser: {
        title: "OpenClinXR IWSDK Spike",
        bodyHasEdChestPain: true,
        hasViteOverlay: false,
        hidden: false,
        visibilityState: "visible",
        canvas: { dataUrlLength: 4096 },
      },
      interaction: {
        beforeTrace: "Trace 0/6",
        afterTrace: "Trace 2/6",
        traceActionsAdvancedBy: 2,
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
    expect(report.target).toBe("iwsdk-sidecar");
  });

  it("classifies a foreground-ready Quest smoke report for leadership evidence", () => {
    const report = buildReport({
      options: parseArgs(["--url", "http://localhost:5173/?questSmoke=1"]),
      adbVersion: "Android Debug Bridge version 1.0.41",
      deviceLine: "1234 device product:quest3",
      reverseList: "1234 tcp:5173 tcp:5173",
      browser: {
        title: "OpenClinXR Station Runtime",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64; Quest 3) OculusBrowser/146.0.0",
        bodyHasEdChestPain: true,
        hasViteOverlay: false,
        hidden: false,
        visibilityState: "visible",
        canvas: { dataUrlLength: 4096 },
        frameStats: { framesObserved: 120 },
      },
      interaction: {
        afterTrace: "Trace 2/10",
        clickedEcg: true,
        clickedUrgent: true,
      },
      frameSample: {
        timedOut: false,
        avgFrameMs: 13.5,
        latestFrameAgeMs: 25,
        framesObservedDuringProbe: 120,
      },
    });

    const check = buildQuestSmokeEvidenceCheck("quest.json", {
      ...report,
      generatedAt: "2026-05-04T00:00:00.000Z",
    });

    expect(check).toEqual(expect.objectContaining({
      inputFile: "quest.json",
      readyForForegroundQuestClaim: true,
      classification: "foreground_ready",
      blockers: [],
      satisfiedConditions: expect.arrayContaining([
        "quest_shell_loaded",
        "quest_trace_interaction_advanced",
        "quest_page_visible",
        "quest_cdp_frame_sample_complete",
        "quest_latest_frame_fresh",
        "quest_frames_advanced_during_probe",
      ]),
    }));
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

  it("classifies the known hidden Quest browser state without promoting frame-pacing claims", () => {
    const report = buildReport({
      options: parseArgs([]),
      adbVersion: "Android Debug Bridge version 1.0.41",
      deviceLine: "1234 device product:quest3",
      reverseList: "1234 tcp:5173 tcp:5173",
      browser: {
        title: "OpenClinXR Station Runtime",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64; Quest 3) OculusBrowser/146.0.0",
        bodyHasEdChestPain: true,
        hasViteOverlay: false,
        hidden: true,
        visibilityState: "hidden",
        canvas: { dataUrlLength: 4096 },
        frameStats: { framesObserved: 1 },
      },
      interaction: {
        afterTrace: "Trace 2/10",
        clickedEcg: true,
        clickedUrgent: true,
      },
      frameSample: {
        framesObservedDuringProbe: 0,
        timedOut: true,
        avgFrameMs: null,
        latestFrameAgeMs: 9450.2,
      },
    });

    const check = buildQuestSmokeEvidenceCheck("docs/openclinxr/quest-cdp-smoke-2026-05-04.json", {
      ...report,
      generatedAt: "2026-05-04T00:00:00.000Z",
    });

    expect(check.readyForForegroundQuestClaim).toBe(false);
    expect(check.classification).toBe("shell_interaction_only_hidden_page");
    expect(check.blockers).toEqual(expect.arrayContaining([
      "quest_page_hidden_or_inactive",
      "quest_cdp_frame_sample_incomplete",
      "quest_cdp_frame_sample_timed_out",
      "quest_no_frames_observed_during_probe",
      "quest_latest_frame_stale_over_1000ms",
    ]));
    expect(check.satisfiedConditions).toEqual(expect.arrayContaining([
      "quest_shell_loaded",
      "quest_trace_interaction_advanced",
      "quest_frame_stats_present",
    ]));
    expect(check.satisfiedConditions).not.toContain("quest_page_visible");
  });

  it("keeps missing Quest smoke evidence as an explicit offline validation blocker", () => {
    expect(buildQuestSmokeEvidenceCheck(undefined, undefined)).toEqual(expect.objectContaining({
      inputFile: null,
      readyForForegroundQuestClaim: false,
      classification: "missing",
      satisfiedConditions: [],
      blockers: ["missing_quest_cdp_smoke_report"],
    }));
  });
});
