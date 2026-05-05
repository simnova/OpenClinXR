import { describe, expect, it } from "vitest";
import {
  browserSnapshotExpression,
  buildQuestSmokeEvidenceCheck,
  buildReport,
  type CdpPage,
  enterVrCompletionExpression,
  enterVrButtonRectExpression,
  frameSampleExpression,
  interactionExpression,
  pageMatchesRequestedUrl,
  parseArgs,
  selectQuestPage,
  staleQuestSmokePageIds,
} from "./quest-cdp-smoke.js";

function healthyBrowserRuntimeEvidence(): Record<string, unknown> {
  return {
    textPanelEvidence: {
      panelCount: 3,
      panels: [
        {
          name: "openclinxr.ed-chest-pain.in-vr-clinical-panel",
          lineCount: 4,
          readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
        },
        {
          name: "openclinxr.ed-chest-pain.in-vr-dialogue-panel",
          lineCount: 2,
          readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
        },
        {
          name: "openclinxr.ed-chest-pain.in-vr-input-panel",
          lineCount: 3,
          readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
        },
      ],
    },
    inputEvidence: {
      activeLocomotionSource: "none",
      inputSourceCount: 2,
      inputSourceKinds: ["xr_hand"],
      keyboardVector: { forward: 0, strafe: 0, turn: 0 },
      xrVector: { forward: 0, strafe: 0, turn: 0 },
    },
    frameStats: {
      framesObserved: 120,
      qualitySource: "webxr_animation_loop",
      renderLoopMode: "webxr_animation_loop_with_preview_fallback",
      latestFrameDeltaMs: 16.7,
      longFrameRatio: 0.02,
    },
  };
}

function healthyFrameSampleRuntimeEvidence(): Record<string, unknown> {
  return {
    timedOut: false,
    avgFrameMs: 13.5,
    latestFrameAgeMs: 25,
    framesObservedDuringProbe: 120,
    qualitySource: "webxr_animation_loop",
    renderLoopMode: "webxr_animation_loop_with_preview_fallback",
    latestFrameDeltaMs: 16.7,
    longFrameRatio: 0.02,
  };
}

describe("Quest CDP smoke probe", () => {
  it("parses default and explicit CLI options", () => {
    expect(parseArgs([])).toMatchObject({
      url: "http://localhost:5173/",
      appPort: 5173,
      cdpPort: 9222,
      frameSampleCount: 90,
      frameTimeoutMs: 4000,
      skipLaunch: false,
      reuseOpenPage: false,
      enterVr: false,
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
      "--reuse-open-page",
      "--enter-vr",
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
      reuseOpenPage: true,
      enterVr: true,
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

  it("reuses exactly one open HTTP page only when explicitly requested", () => {
    const pages = [
      { id: "ui", title: "Browser UI", type: "other", url: "chrome://panel-app-nav/" },
      {
        id: "stale-sidecar",
        title: "OpenClinXR IWSDK Spike",
        type: "page",
        url: "http://localhost:5183/?questSmoke=old",
        webSocketDebuggerUrl: "ws://stale-sidecar",
      },
    ] satisfies CdpPage[];

    expect(selectQuestPage(pages, "http://localhost:5173/?questSmoke=fresh")).toBeUndefined();
    expect(selectQuestPage(pages, "http://localhost:5173/?questSmoke=fresh", { reuseOpenPage: true })?.id)
      .toBe("stale-sidecar");
  });

  it("does not guess between multiple reusable open pages", () => {
    const pages = [
      {
        id: "station",
        title: "OpenClinXR Station Runtime",
        type: "page",
        url: "http://localhost:5173/?questSmoke=old",
        webSocketDebuggerUrl: "ws://station",
      },
      {
        id: "sidecar",
        title: "OpenClinXR IWSDK Spike",
        type: "page",
        url: "http://localhost:5183/?questSmoke=old",
        webSocketDebuggerUrl: "ws://sidecar",
      },
    ] satisfies CdpPage[];

    expect(selectQuestPage(pages, "http://localhost:5173/?questSmoke=fresh", { reuseOpenPage: true })?.id)
      .toBe("station");
    expect(selectQuestPage(pages, "http://localhost:5174/?questSmoke=fresh", { reuseOpenPage: true }))
      .toBeUndefined();
  });

  it("generates browser, interaction, and frame-sampling expressions with station targets", () => {
    expect(browserSnapshotExpression()).toContain("window.__openClinXrFrameStats");
    expect(browserSnapshotExpression()).toContain("window.__openClinXrInputEvidence");
    expect(browserSnapshotExpression()).toContain("window.__openClinXrBootEvidence");
    expect(browserSnapshotExpression()).toContain("window.__openClinXrTraceLatencyEvidence");
    expect(browserSnapshotExpression()).toContain("window.__openClinXrIwsdkSidecarEvidence");
    expect(browserSnapshotExpression()).toContain("window.__openClinXrXrEntryEvidence");
    expect(browserSnapshotExpression()).toContain("window.__openClinXrTextPanelEvidence");
    expect(browserSnapshotExpression()).toContain("ED Chest Pain");
    expect(interactionExpression()).toContain("ecg request");
    expect(interactionExpression()).toContain("urgent escalation");
    expect(interactionExpression()).toContain("Trace Actions");
    expect(interactionExpression()).toContain("traceLatencyEvidence");
    expect(frameSampleExpression(12, 900)).not.toContain("sampleCount >= 12");
    expect(frameSampleExpression(12, 900)).toContain("framesObservedDuringProbe >= 12");
    expect(frameSampleExpression(12, 900)).toContain("performance.now() - started < 900");
    expect(frameSampleExpression(12, 900)).toContain("window.__openClinXrFrameStats");
    expect(frameSampleExpression(12, 900)).toContain("window.__openClinXrIwsdkSidecarEvidence");
    expect(frameSampleExpression(12, 900)).toContain("qualitySource");
    expect(frameSampleExpression(12, 900)).toContain("longFrameRatio");
    expect(frameSampleExpression(12, 900)).toContain("previewFramesObserved");
    expect(frameSampleExpression(12, 900)).toContain("immersiveFramesObserved");
    expect(enterVrButtonRectExpression()).toContain("enter-xr-button");
    expect(enterVrCompletionExpression(3000)).toContain("xr-status");
    expect(enterVrCompletionExpression(3000)).toContain("window.__openClinXrManualPerformanceDraft");
    expect(enterVrCompletionExpression(3000)).toContain("window.__openClinXrXrEntryEvidence");
    expect(enterVrCompletionExpression(3000)).toContain('xrStatusAfter === "In Full VR" && immersiveSessionStarted');
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
      immersiveEntryOutcome: "not_requested",
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
      immersiveEntryOutcome: "not_requested",
      blockers: [],
    });
    expect(report.target).toBe("iwsdk-sidecar");
  });

  it("adds an immersive session blocker only when the smoke explicitly asks to enter VR", () => {
    const report = buildReport({
      options: parseArgs(["--enter-vr"]),
      adbVersion: "Android Debug Bridge version 1.0.41",
      deviceLine: "1234 device product:quest3",
      reverseList: "1234 tcp:5173 tcp:5173",
      browser: {
        title: "OpenClinXR Station Runtime",
        bodyHasEdChestPain: true,
        hasViteOverlay: false,
        hidden: false,
        visibilityState: "visible",
        xrStatus: "WebXR entry blocked",
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
      immersive: {
        clickedEnterVr: true,
        immersiveSessionStarted: false,
        xrStatusAfter: "WebXR entry blocked",
        xrEntryEvidence: {
          attempts: 1,
          lastStatus: "failed",
          lastError: "NotAllowedError: simulated",
        },
      },
    });

    expect(report.immersive).toMatchObject({
      clickedEnterVr: true,
      immersiveSessionStarted: false,
    });
    expect(report.verdict.immersiveEntryOutcome).toBe("app_request_failed");
    expect(report.verdict.blockers).toContain("quest_immersive_session_not_started");
  });

  it("separates remote activation misses from app-level immersive request failures", () => {
    const report = buildReport({
      options: parseArgs(["--enter-vr"]),
      adbVersion: "Android Debug Bridge version 1.0.41",
      deviceLine: "1234 device product:quest3",
      reverseList: "1234 tcp:5173 tcp:5173",
      browser: {
        title: "OpenClinXR Station Runtime",
        bodyHasEdChestPain: true,
        hasViteOverlay: false,
        hidden: false,
        visibilityState: "visible",
        xrStatus: "Full VR ready",
        canvas: { dataUrlLength: 4096 },
        xrEntryEvidence: {
          attempts: 0,
          lastStatus: "not_requested",
          lastError: null,
        },
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
      immersive: {
        clickedEnterVr: true,
        immersiveSessionStarted: false,
        xrStatusAfter: "Full VR ready",
        xrEntryEvidence: {
          attempts: 0,
          lastStatus: "not_requested",
          lastError: null,
        },
      },
    });

    expect(report.verdict.immersiveEntryOutcome).toBe("activation_missed");
    expect(report.verdict.blockers).toEqual(expect.arrayContaining([
      "quest_immersive_entry_activation_not_received",
      "quest_immersive_session_not_started",
    ]));
  });

  it("marks immersive entry as session_started when Full VR entry succeeds", () => {
    const report = buildReport({
      options: parseArgs(["--enter-vr"]),
      adbVersion: "Android Debug Bridge version 1.0.41",
      deviceLine: "1234 device product:quest3",
      reverseList: "1234 tcp:5173 tcp:5173",
      browser: {
        title: "OpenClinXR Station Runtime",
        bodyHasEdChestPain: true,
        hasViteOverlay: false,
        hidden: false,
        visibilityState: "visible",
        xrStatus: "In Full VR",
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
      immersive: {
        clickedEnterVr: true,
        immersiveSessionStarted: true,
        xrStatusAfter: "In Full VR",
        xrEntryEvidence: {
          attempts: 1,
          lastStatus: "started",
          lastError: null,
        },
      },
    });

    expect(report.verdict.immersiveEntryOutcome).toBe("session_started");
    expect(report.verdict.blockers).not.toContain("quest_immersive_session_not_started");
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
        ...healthyBrowserRuntimeEvidence(),
      },
      interaction: {
        afterTrace: "Trace 2/10",
        clickedEcg: true,
        clickedUrgent: true,
      },
      frameSample: healthyFrameSampleRuntimeEvidence(),
    });

    const check = buildQuestSmokeEvidenceCheck("quest.json", {
      ...report,
      generatedAt: "2026-05-04T00:00:00.000Z",
    });

    expect(check).toEqual(expect.objectContaining({
      inputFile: "quest.json",
      readyForForegroundQuestClaim: true,
      classification: "foreground_ready",
      immersiveEntryOutcome: "not_requested",
      blockers: [],
      satisfiedConditions: expect.arrayContaining([
        "quest_shell_loaded",
        "quest_trace_interaction_advanced",
        "quest_page_visible",
        "quest_cdp_frame_sample_complete",
        "quest_text_panel_metadata_present",
        "quest_input_evidence_shape_present",
        "quest_frame_quality_evidence_present",
        "quest_latest_frame_fresh",
        "quest_frames_advanced_during_probe",
      ]),
    }));
  });

  it("separates Quest smoke readiness into device, shell, immersive, frame, and station lanes", () => {
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
        ...healthyBrowserRuntimeEvidence(),
      },
      interaction: {
        afterTrace: "Trace 2/10",
        clickedEcg: true,
        clickedUrgent: true,
      },
      frameSample: healthyFrameSampleRuntimeEvidence(),
    });

    const check = buildQuestSmokeEvidenceCheck("quest-ready.json", report);

    expect(check.readinessMatrix).toEqual({
      foregroundDevice: {
        status: "ready",
        satisfiedConditions: [
          "quest_cdp_adb_device_recorded",
          "quest_cdp_adb_quest_device_recorded",
          "quest_cdp_user_agent_recorded",
          "quest_cdp_browser_quest_user_agent_recorded",
          "quest_page_visible",
        ],
        blockers: [],
      },
      shellInteraction: {
        status: "ready",
        satisfiedConditions: [
          "quest_shell_loaded",
          "quest_trace_interaction_advanced",
        ],
        blockers: [],
      },
      immersiveEntry: {
        status: "not_requested",
        outcome: "not_requested",
        satisfiedConditions: ["quest_immersive_entry_not_requested"],
        blockers: [],
      },
      framePacingSample: {
        status: "ready",
        satisfiedConditions: [
          "quest_cdp_frame_sample_complete",
          "quest_latest_frame_fresh",
          "quest_frames_advanced_during_probe",
          "quest_frame_quality_evidence_present",
        ],
        blockers: [],
      },
      stationRuntimeEvidence: {
        status: "ready",
        satisfiedConditions: [
          "quest_text_panel_metadata_present",
          "quest_input_evidence_shape_present",
          "quest_frame_quality_evidence_present",
        ],
        blockers: [],
      },
    });
  });

  it("blocks foreground-ready classification when ADB and browser identity are not Quest-specific", () => {
    const report = buildReport({
      options: parseArgs(["--url", "http://localhost:5173/?questSmoke=1"]),
      adbVersion: "Android Debug Bridge version 1.0.41",
      deviceLine: "1234 device product:generic model:Pixel",
      reverseList: "1234 tcp:5173 tcp:5173",
      browser: {
        title: "OpenClinXR Station Runtime",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/147.0.0.0 Safari/537.36",
        bodyHasEdChestPain: true,
        hasViteOverlay: false,
        hidden: false,
        visibilityState: "visible",
        canvas: { dataUrlLength: 4096 },
        ...healthyBrowserRuntimeEvidence(),
      },
      interaction: {
        afterTrace: "Trace 2/10",
        clickedEcg: true,
        clickedUrgent: true,
      },
      frameSample: healthyFrameSampleRuntimeEvidence(),
    });

    const check = buildQuestSmokeEvidenceCheck("desktop-shaped.json", report);

    expect(check.readyForForegroundQuestClaim).toBe(false);
    expect(check.classification).toBe("blocked");
    expect(check.blockers).toEqual(expect.arrayContaining([
      "quest_cdp_adb_quest_device_missing",
      "quest_cdp_browser_quest_user_agent_missing",
    ]));
    expect(check.satisfiedConditions).not.toContain("quest_cdp_adb_quest_device_recorded");
    expect(check.satisfiedConditions).not.toContain("quest_cdp_browser_quest_user_agent_recorded");
    expect(check.readinessMatrix?.foregroundDevice).toEqual(expect.objectContaining({
      status: "blocked",
      blockers: expect.arrayContaining([
        "quest_cdp_adb_quest_device_missing",
        "quest_cdp_browser_quest_user_agent_missing",
      ]),
    }));
  });

  it("propagates immersive-entry outcome into evidence checks", () => {
    const report = buildReport({
      options: parseArgs(["--enter-vr"]),
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
        xrStatus: "WebXR entry blocked",
        canvas: { dataUrlLength: 4096 },
        ...healthyBrowserRuntimeEvidence(),
      },
      interaction: {
        afterTrace: "Trace 2/10",
        clickedEcg: true,
        clickedUrgent: true,
      },
      frameSample: healthyFrameSampleRuntimeEvidence(),
      immersive: {
        clickedEnterVr: true,
        immersiveSessionStarted: false,
        xrStatusAfter: "WebXR entry blocked",
        xrEntryEvidence: {
          attempts: 1,
          lastStatus: "failed",
          lastError: "NotAllowedError: simulated",
        },
      },
    });

    const check = buildQuestSmokeEvidenceCheck("quest-vr.json", report);
    expect(check.immersiveEntryOutcome).toBe("app_request_failed");
    expect(check.blockers).toContain("quest_immersive_app_request_failed");
    expect(check.blockers).toContain("quest_immersive_session_not_started");
  });

  it("keeps legacy non-immersive reports compatible when they lack an immersive-entry verdict", () => {
    const report = {
      ...buildReport({
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
          ...healthyBrowserRuntimeEvidence(),
        },
        interaction: {
          afterTrace: "Trace 2/10",
          clickedEcg: true,
          clickedUrgent: true,
        },
        frameSample: healthyFrameSampleRuntimeEvidence(),
      }),
    };
    delete (report.verdict as Partial<typeof report.verdict>).immersiveEntryOutcome;

    const check = buildQuestSmokeEvidenceCheck("legacy-quest.json", report);

    expect(check.immersiveEntryOutcome).toBe("not_requested");
    expect(check.blockers).not.toContain("quest_immersive_session_not_started");
    expect(check.readyForForegroundQuestClaim).toBe(true);
  });

  it("blocks foreground claims when runtime text, input, or frame-quality evidence is absent", () => {
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

    const check = buildQuestSmokeEvidenceCheck("quest-runtime-gap.json", report);

    expect(check.readyForForegroundQuestClaim).toBe(false);
    expect(check.blockers).toEqual(expect.arrayContaining([
      "quest_text_panel_metadata_missing",
      "quest_input_evidence_shape_missing",
      "quest_frame_quality_evidence_missing",
    ]));
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
      immersiveEntryOutcome: "not_requested",
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
    expect(check.immersiveEntryOutcome).toBe("not_requested");
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
    expect(check.readinessMatrix).toEqual(expect.objectContaining({
      foregroundDevice: expect.objectContaining({
        status: "blocked",
        blockers: ["quest_page_hidden_or_inactive"],
      }),
      framePacingSample: expect.objectContaining({
        status: "blocked",
        blockers: expect.arrayContaining([
          "quest_cdp_frame_sample_incomplete",
          "quest_cdp_frame_sample_timed_out",
          "quest_no_frames_observed_during_probe",
          "quest_latest_frame_stale_over_1000ms",
        ]),
      }),
      shellInteraction: expect.objectContaining({
        status: "ready",
        blockers: [],
      }),
      immersiveEntry: expect.objectContaining({
        status: "not_requested",
        outcome: "not_requested",
      }),
    }));
  });

  it("keeps missing Quest smoke evidence as an explicit offline validation blocker", () => {
    expect(buildQuestSmokeEvidenceCheck(undefined, undefined)).toEqual(expect.objectContaining({
      inputFile: null,
      readyForForegroundQuestClaim: false,
      classification: "missing",
      immersiveEntryOutcome: "not_requested",
      satisfiedConditions: [],
      blockers: ["missing_quest_cdp_smoke_report"],
    }));
  });
});
