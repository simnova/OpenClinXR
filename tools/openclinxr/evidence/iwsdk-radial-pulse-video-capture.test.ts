import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildRadialPulseCaptureReport,
  parseRadialPulseCaptureArgs,
} from "./iwsdk-radial-pulse-video-capture.js";

const phases = ["ready", "approaching", "contacting", "holding", "released"] as const;

describe("IWSDK radial pulse video capture", () => {
  it("requires user output paths and at least one full seven-second cycle", () => {
    expect(parseRadialPulseCaptureArgs(["--video", "pulse.webm", "--report", "pulse.json"])).toEqual({
      videoPath: "pulse.webm",
      reportPath: "pulse.json",
      durationMs: 8_000,
    });
    expect(() => parseRadialPulseCaptureArgs(["--video", "pulse.webm", "--report", "pulse.json", "--duration-ms", "6999"])).toThrow("at least 7000");
    expect(() => parseRadialPulseCaptureArgs(["--video", "pulse.webm"])).toThrow("--report");
  });

  it("accepts all phases and readiness while preserving every prohibited claim", () => {
    const report = buildRadialPulseCaptureReport({
      runtimeUrl: "http://127.0.0.1:54321/?radialPulseDemo=true&iwerEvidenceView=wide",
      videoPath: "pulse.webm",
      durationMs: 8_000,
      snapshots: phases.map((phase) => ({
        phase,
        readyForIwerInteractionEvidence: phase === "released",
        patientAssetName: "mpfb-street-adult-male.glb",
        patientAssetLoadStatus: "loaded",
        wristBoneName: "wrist.R",
        targetAttachedToWrist: true,
        patientPresentationPose: "consented_right_wrist_presentation",
      })),
      consoleErrors: [],
      pageErrors: [],
    });
    expect(report.observedPhases).toEqual(phases);
    expect(report.readyForIwerInteractionEvidenceObserved).toBe(true);
    expect(report.patient).toEqual({
      assetName: "mpfb-street-adult-male.glb",
      wristBoneName: "wrist.R",
      targetAttachedToWrist: true,
      presentationPose: "consented_right_wrist_presentation",
    });
    expect(report.capture).toMatchObject({ frameRate: 30, mimeType: "video/webm;codecs=vp9" });
    expect(report).toMatchObject({
      readyForPhysicalQuestClaim: false,
      physicalQuestHapticsClaimed: false,
      clinicalValidityClaimed: false,
      scoringClaimed: false,
      productionReadinessClaimed: false,
    });
  });

  it("fails on missing evidence phases, readiness, console errors, or page errors", () => {
    expect(() => buildRadialPulseCaptureReport({
      runtimeUrl: "http://127.0.0.1:54321/",
      videoPath: "pulse.webm",
      durationMs: 8_000,
      snapshots: [{ phase: "ready", readyForIwerInteractionEvidence: false }],
      consoleErrors: ["console failed"],
      pageErrors: ["page failed"],
    })).toThrow(/missing phases.*readyForIwerInteractionEvidence.*console failed.*page failed/);
  });

  it("is exposed through the root package script", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["iwsdk:radial-pulse:capture"]).toBe(
      "tsx tools/openclinxr/evidence/iwsdk-radial-pulse-video-capture.ts",
    );
  });

  it("uses the portless helper, required demo URL, VP9 canvas recording, and awaited teardown", async () => {
    const source = await readFile(
      "tools/openclinxr/evidence/iwsdk-radial-pulse-video-capture.ts",
      "utf8",
    );
    expect(source).toContain("spawnPortlessDevServer({ filter: \"@openclinxr/ui-xr-iwsdk-spike\" })");
    expect(source).toContain("?radialPulseDemo=true&iwerEvidenceView=wide");
    expect(source).toContain("canvas.captureStream(30)");
    expect(source).toContain('const mimeType = "video/webm;codecs=vp9"');
    expect(source).toMatch(/finally \{[\s\S]*await stopPortlessDevServer\(server\?\.proc\)/u);
  });
});
