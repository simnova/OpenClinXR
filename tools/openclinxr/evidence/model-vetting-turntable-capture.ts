import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { ModelVettingReport } from "../../../packages/openclinxr/arena/model-vetting/src/index.js";
import type { ModelVettingCaptureArtifactMap } from "./model-vetting-capture-manifest.js";

type CliOptions = {
  sourceReportPath: string;
  existingArtifactMapPath: string;
  outputArtifactMapPath: string;
  outputDir: string;
  captureViews: CandidateCaptureView[];
  port: number;
  durationMs: number;
  reportUrl?: string;
};

const defaultDate = new Date().toISOString().slice(0, 10);
type TemporalCaptureView = "turntable" | "viseme_timeline" | "emotion_transition";
type BodyRigTemporalCaptureView = "body_motion_probe";
type FixedCameraView = "front" | "side" | "three_quarter";
type CandidateCaptureView = FixedCameraView | TemporalCaptureView | BodyRigTemporalCaptureView;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = JSON.parse(await readFile(options.sourceReportPath, "utf8")) as ModelVettingReport;
  const artifactMap = await readArtifactMap(options.existingArtifactMapPath);
  await mkdir(options.outputDir, { recursive: true });

  const server = spawn("pnpm", ["--filter", "@openclinxr/model-vetting-studio", "dev:portless"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(options.port) },
    stdio: "pipe",
  });
  try {
    await waitForStudio(options.port, server);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const candidate of report.candidates) {
        for (const captureView of options.captureViews) {
          const artifactPath = path.join(options.outputDir, `${captureStem(candidate.sourceGlbPath)}_${captureView}_${defaultDate}.${isFixedCameraView(captureView) ? "png" : "webm"}`);
          const context = await browser.newContext({
            viewport: { width: 1280, height: 1280 },
          });
          const page = await context.newPage();
          const url = `http://127.0.0.1:${options.port}/?captureCandidateId=${encodeURIComponent(candidate.candidateId)}&captureView=${captureView}${options.reportUrl ? `&reportUrl=${encodeURIComponent(options.reportUrl)}` : ""}`;
          await page.goto(url, { waitUntil: "networkidle" });
          await page.waitForFunction((expectedView) => {
            const evidence = window.__openClinXrModelVettingCandidateCaptureEvidence;
            return evidence?.captureView === expectedView
              && typeof evidence.captureClaim === "string"
              && evidence.captureClaim.startsWith("isolated_model_")
              && (evidence.captureClaim.endsWith("_video_only") || evidence.captureClaim.endsWith("_screenshot_only"))
              && typeof evidence.meshCount === "number"
              && evidence.meshCount > 0
              && evidence.scenePlacementEvidenceAllowed === false
              && evidence.productionReadinessClaimAllowed === false;
          }, captureView);
          await page.waitForTimeout(300);
          if (isFixedCameraView(captureView)) await page.screenshot({ path: artifactPath });
          else await writeFile(artifactPath, Buffer.from(await recordModelCanvasVideo(page, options.durationMs)));
          await page.close();
          await context.close();
          upsertArtifact(artifactMap, {
            candidateId: candidate.candidateId,
            slotId: slotIdForCaptureView(captureView),
            artifactPath,
          });
        }
      }
    } finally {
      await browser.close();
    }

    artifactMap.artifacts.sort((left, right) => `${left.candidateId}:${left.slotId}`.localeCompare(`${right.candidateId}:${right.slotId}`));
    await writeFile(options.outputArtifactMapPath, `${JSON.stringify(artifactMap, null, 2)}\n`, "utf8");
    console.log(`Wrote ${options.outputArtifactMapPath}`);
  } finally {
    stopServer(server);
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    sourceReportPath: "docs/openclinxr/model-vetting-report-peds-asthma-parent-anxiety-2026-06-05.json",
    existingArtifactMapPath: "docs/openclinxr/model-vetting-capture-artifact-map-peds-asthma-parent-anxiety-2026-06-05.json",
    outputArtifactMapPath: "docs/openclinxr/model-vetting-capture-artifact-map-peds-asthma-parent-anxiety-2026-06-05.json",
    outputDir: "docs/openclinxr/model-vetting-captures",
    captureViews: ["turntable"],
    port: 5185,
    durationMs: 3200,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--source-report") options.sourceReportPath = requireNext(args, ++index, arg);
    else if (arg === "--existing-artifact-map") options.existingArtifactMapPath = requireNext(args, ++index, arg);
    else if (arg === "--output-artifact-map") options.outputArtifactMapPath = requireNext(args, ++index, arg);
    else if (arg === "--output-dir") options.outputDir = requireNext(args, ++index, arg);
    else if (arg === "--capture-views") options.captureViews = parseCaptureViews(requireNext(args, ++index, arg));
    else if (arg === "--port") options.port = Number(requireNext(args, ++index, arg));
    else if (arg === "--duration-ms") options.durationMs = Number(requireNext(args, ++index, arg));
    else if (arg === "--report-url") options.reportUrl = requireNext(args, ++index, arg);
  }
  return options;
}

async function readArtifactMap(filePath: string): Promise<ModelVettingCaptureArtifactMap> {
  if (!existsSync(filePath)) {
    return { schemaVersion: "openclinxr.model-vetting-capture-artifact-map.v1", artifacts: [] };
  }
  const artifactMap = JSON.parse(await readFile(filePath, "utf8")) as ModelVettingCaptureArtifactMap;
  if (artifactMap.schemaVersion !== "openclinxr.model-vetting-capture-artifact-map.v1") {
    throw new Error(`Unexpected artifact map schemaVersion in ${filePath}`);
  }
  return artifactMap;
}

async function recordModelCanvasVideo(page: import("playwright").Page, durationMs: number): Promise<number[]> {
  return page.evaluate(async (recordingDurationMs) => {
    const canvas = document.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Model-vetting capture canvas not found");
    const stream = canvas.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.addEventListener("error", () => reject(new Error("Model-vetting canvas recording failed")), { once: true });
    });
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, recordingDurationMs));
    recorder.stop();
    await stopped;
    for (const track of stream.getTracks()) track.stop();
    const blob = new Blob(chunks, { type: mimeType });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, durationMs);
}

function upsertArtifact(
  artifactMap: ModelVettingCaptureArtifactMap,
  artifact: ModelVettingCaptureArtifactMap["artifacts"][number],
): void {
  const index = artifactMap.artifacts.findIndex((item) => item.candidateId === artifact.candidateId && item.slotId === artifact.slotId);
  if (index >= 0) artifactMap.artifacts[index] = artifact;
  else artifactMap.artifacts.push(artifact);
}

function captureStem(sourceGlbPath: string): string {
  return path.basename(sourceGlbPath, ".glb").replaceAll(/[^a-zA-Z0-9_-]/gu, "_");
}

function parseCaptureViews(value: string): CandidateCaptureView[] {
  const views = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (views.length === 0) throw new Error("--capture-views must include at least one view");
  for (const view of views) {
    if (!isCandidateCaptureView(view)) {
      throw new Error(`Unsupported capture view: ${view}`);
    }
  }
  return views as CandidateCaptureView[];
}

function slotIdForCaptureView(view: CandidateCaptureView): ModelVettingCaptureArtifactMap["artifacts"][number]["slotId"] {
  if (view === "front") return "front_screenshot";
  if (view === "side") return "side_screenshot";
  if (view === "three_quarter") return "three_quarter_screenshot";
  if (view === "viseme_timeline") return "viseme_timeline_video";
  if (view === "emotion_transition") return "emotion_transition_video";
  if (view === "body_motion_probe") return "body_motion_probe_video";
  return "turntable_video";
}

function isCandidateCaptureView(value: string): value is CandidateCaptureView {
  return isFixedCameraView(value) || value === "turntable" || value === "viseme_timeline" || value === "emotion_transition" || value === "body_motion_probe";
}

function isFixedCameraView(value: string): value is FixedCameraView {
  return value === "front" || value === "side" || value === "three_quarter";
}

async function waitForStudio(port: number, server: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Model-vetting studio server exited before capture started: ${server.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for model-vetting studio on port ${port}: ${lastError}`);
}

function stopServer(server: ChildProcessWithoutNullStreams): void {
  if (server.exitCode === null) server.kill("SIGTERM");
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

declare global {
  interface Window {
    __openClinXrModelVettingCandidateCaptureEvidence?: {
      captureView?: string;
      captureClaim?: string;
      meshCount?: number;
      scenePlacementEvidenceAllowed?: boolean;
      productionReadinessClaimAllowed?: boolean;
    };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
