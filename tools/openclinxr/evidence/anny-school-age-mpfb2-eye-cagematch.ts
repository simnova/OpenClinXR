import { execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  validateModelVettingReport,
  type ModelVettingReport,
} from "../../../packages/openclinxr/arena/model-vetting/src/index.js";
import { buildCagematchOutputHome, ensureCagematchOutputHome } from "./generated-output-home.js";

type CliOptions = {
  lane: string;
  runId: string;
  inputGlbPath: string;
  sourceReportPath: string;
  sourceCandidateId: string;
  outputGlbName: string;
  captureViews: Array<"front" | "three_quarter" | "body_motion_probe" | "viseme_timeline">;
  dialogueText: string;
  port: number;
  durationMs: number;
  skipMpfb2Stage: boolean;
  skipCapture: boolean;
};

const NOT_EVIDENCE_FOR = [
  "mpfb_standard_rig_success",
  "b_plus_visual_realism_gate",
  "scene_placement_readiness",
  "quest_readiness",
  "production_asset_readiness",
  "learner_readiness",
  "clinical_validity",
  "scoring_validity",
];

const DEFAULT_INPUT_GLB =
  ".openclinxr/asset-production/anny-school-age/2026-06-07-school-aged-patient-warmer-skin-v1/peds_patient_child.glb";
const DEFAULT_SOURCE_REPORT =
  "apps/arena/model-vetting-studio/public/cagematch/anny-school-age/2026-06-07-school-aged-patient-scalp-hair-v3/model-vetting-report.json";
const DEFAULT_SOURCE_CANDIDATE_ID = "peds_patient_child_anny_compatible_candidate";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.inputGlbPath)) {
    throw new Error(`Input GLB not found: ${options.inputGlbPath}`);
  }
  if (!existsSync(options.sourceReportPath)) {
    throw new Error(`Source model-vetting report not found: ${options.sourceReportPath}`);
  }

  const outputHome = buildCagematchOutputHome(options.lane, options.runId);
  await ensureCagematchOutputHome(outputHome);

  const outputGlbPath = path.join(outputHome.publicMirrorDir, options.outputGlbName);
  const mpfb2ReportPath = path.join(outputHome.localEvidenceDir, "mpfb2-eye-rig-report.json");
  const localArtifactGlb = path.join(outputHome.localArtifactDir, options.outputGlbName);

  await mkdir(path.dirname(outputGlbPath), { recursive: true });
  await mkdir(path.dirname(localArtifactGlb), { recursive: true });

  if (options.skipMpfb2Stage && existsSync(outputGlbPath)) {
    process.stdout.write(`Skipping MPFB2 stage; reusing ${outputGlbPath}\n`);
  } else if (options.skipMpfb2Stage) {
    throw new Error("--skip-mpfb2-stage requires an existing output GLB in the public mirror.");
  } else {
    execSync(
      [
        "blender",
        "--background",
        "--python",
        "tools/openclinxr/asset-pipeline/anny/add_mpfb2_eye_rig.py",
        "--",
        "--input-glb",
        options.inputGlbPath,
        "--output-glb",
        localArtifactGlb,
        "--report",
        mpfb2ReportPath,
      ].join(" "),
      { stdio: "inherit", encoding: "utf8" },
    );
    await copyFile(localArtifactGlb, outputGlbPath);
  }

  const mpfb2Report = JSON.parse(await readFile(mpfb2ReportPath, "utf8")) as {
    eyeRig?: {
      objectNames?: string[];
      poseProbe?: { targetMoved?: boolean; exportableActionNames?: string[] };
      exportedAnimationClip?: string;
    };
  };

  const publicMirrorUrlPath = `/${path.relative("apps/arena/model-vetting-studio/public", outputGlbPath).replaceAll(path.sep, "/")}`;
  const report = await buildMpfb2EyeReport({
    sourceReportPath: options.sourceReportPath,
    sourceCandidateId: options.sourceCandidateId,
    publicMirrorUrlPath,
    mpfb2ReportPath,
    mpfb2Report,
    outputHome,
  });

  const validation = validateModelVettingReport(report);
  if (!validation.ok) {
    throw new Error(`Invalid school-age MPFB2 eye model-vetting report: ${validation.errors.join("; ")}`);
  }

  const publicReportPath = path.join(outputHome.publicMirrorDir, "model-vetting-report.json");
  const localReportPath = path.join(outputHome.localEvidenceDir, "model-vetting-report.json");
  const summaryPath = path.join(outputHome.localEvidenceDir, "anny-school-age-mpfb2-eye-cagematch.json");

  await Promise.all([
    writeJson(publicReportPath, report),
    writeJson(localReportPath, report),
    writeJson(summaryPath, {
      schemaVersion: "openclinxr.anny-school-age-mpfb2-eye-cagematch.v1",
      generatedAt: report.generatedAt,
      claimScope: "school_age_anny_mpfb2_informed_eye_rig_factory_integration_no_promotion",
      lane: options.lane,
      runId: options.runId,
      inputGlbPath: options.inputGlbPath,
      outputGlbPath,
      publicMirrorUrlPath,
      mpfb2ReportPath,
      sourceReportPath: options.sourceReportPath,
      sourceCandidateId: options.sourceCandidateId,
      outputHome,
      captureViews: options.captureViews,
      providerBoundary: {
        localOnly: true,
        externalNetworkUsed: false,
        paidApiUsed: false,
        runtimePromotionAllowed: false,
        productionAssetReadinessClaimed: false,
      },
      notEvidenceFor: NOT_EVIDENCE_FOR,
    }),
  ]);

  const captureDir = path.join(outputHome.localEvidenceDir, "captures");
  let captureManifestPath: string | null = null;
  if (!options.skipCapture) {
    await mkdir(captureDir, { recursive: true });
    const reportUrl = `/${path.relative("apps/arena/model-vetting-studio/public", publicReportPath).replaceAll(path.sep, "/")}`;
    captureManifestPath = path.join(outputHome.localEvidenceDir, "capture-manifest.json");
    const artifacts = await captureStudioEvidence({
      report,
      reportUrl,
      captureViews: options.captureViews,
      captureDir,
      runId: options.runId,
      port: options.port,
      durationMs: options.durationMs,
      dialogueText: options.dialogueText,
    });
    await writeJson(captureManifestPath, {
      schemaVersion: "openclinxr.model-vetting-capture-manifest.v1",
      generatedAt: new Date().toISOString(),
      claimScope: "isolated_school_age_mpfb2_eye_capture_no_scene_promotion",
      reportUrl,
      artifacts,
      notEvidenceFor: NOT_EVIDENCE_FOR,
    });
  }

  const currentDir = path.join("apps/arena/model-vetting-studio/public/cagematch", options.lane, "current");
  const uiXrCurrentDir = path.join("apps/ui-xr/public/cagematch", options.lane, "current");
  await mkdir(currentDir, { recursive: true });
  await mkdir(uiXrCurrentDir, { recursive: true });
  await Promise.all([
    copyFile(outputGlbPath, path.join(currentDir, options.outputGlbName)),
    copyFile(publicReportPath, path.join(currentDir, "model-vetting-report.json")),
    copyFile(mpfb2ReportPath, path.join(currentDir, "mpfb2-eye-rig-report.json")),
    copyFile(outputGlbPath, path.join(uiXrCurrentDir, options.outputGlbName)),
    copyFile(publicReportPath, path.join(uiXrCurrentDir, "model-vetting-report.json")),
    copyFile(mpfb2ReportPath, path.join(uiXrCurrentDir, "mpfb2-eye-rig-report.json")),
  ]);

  process.stdout.write(
    `${JSON.stringify(
      {
        localReportPath,
        publicReportPath,
        summaryPath,
        publicMirrorUrlPath,
        mpfb2ReportPath,
        captureManifestPath,
        currentDir,
      },
      null,
      2,
    )}\n`,
  );
}

async function buildMpfb2EyeReport(input: {
  sourceReportPath: string;
  sourceCandidateId: string;
  publicMirrorUrlPath: string;
  mpfb2ReportPath: string;
  mpfb2Report: {
    eyeRig?: {
      objectNames?: string[];
      poseProbe?: { targetMoved?: boolean; exportableActionNames?: string[] };
      exportedAnimationClip?: string;
    };
  };
  outputHome: ReturnType<typeof buildCagematchOutputHome>;
}): Promise<ModelVettingReport> {
  const sourceReport = JSON.parse(await readFile(input.sourceReportPath, "utf8")) as ModelVettingReport;
  const sourceCandidate = sourceReport.candidates.find((c) => c.candidateId === input.sourceCandidateId);
  if (!sourceCandidate) {
    throw new Error(`Candidate ${input.sourceCandidateId} not found in ${input.sourceReportPath}`);
  }

  const eyeObjectNames = input.mpfb2Report.eyeRig?.objectNames ?? [];
  const gazeProbePresent = Boolean(
    input.mpfb2Report.eyeRig?.poseProbe?.targetMoved
      && (input.mpfb2Report.eyeRig?.poseProbe?.exportableActionNames?.length ?? 0) > 0,
  );

  const candidate = structuredClone(sourceCandidate);
  candidate.candidateId = "peds_patient_child_school_age_mpfb2_eye";
  candidate.sourceGlbPath = input.publicMirrorUrlPath;
  candidate.actorDisplayRole = "school-age pediatric asthma patient (MPFB2-informed seated eyes)";
  candidate.blockers = [
    ...new Set(
      sourceCandidate.blockers.filter(
        (blocker) => !blocker.includes("fixed_camera") && blocker !== "mpfb2_eye_rig_missing",
      ),
    ),
  ].sort();
  if (!gazeProbePresent) candidate.blockers.push("mpfb2_gaze_probe_export_missing");
  candidate.proceduralFaceDetailHandoff = {
    hairPlacementMode: "mesh_native_scalp_material_region",
    eyePlacementMode: "mpfb2_informed_low_poly_procedural_seated_eyes",
    featurePlacementMode: "no_detached_face_markers",
    hairObjectName: "mesh_native_scalp_region",
    coordinateBasis: "armature_head_bone_parented",
    eyeObjectNames,
    facialFeatureObjectNames: [],
    claimScope: "mpfb2_informed_eye_rig_on_school_age_anny_candidate_not_b_plus_or_readiness",
    notEvidenceFor: ["production_asset_readiness", "b_plus_visual_realism_gate", "scene_placement_readiness"],
  };
  candidate.captureArtifacts = {
    fixedCameraScreenshots: [],
    turntableVideo: null,
    morphVisemeTimelineCapture: null,
    emotionTransitionCapture: null,
  };

  return {
    ...sourceReport,
    generatedAt: new Date().toISOString(),
    claimScope: "isolated_model_vetting_metadata_structural_and_lab_contract_only",
    candidates: [candidate],
    decision: {
      ...sourceReport.decision,
      isolatedLabCaptureComplete: false,
      scenePlacementEvidenceAllowed: false,
      runtimePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
      nextSafeStep:
        "Review school-age Anny MPFB2-informed seated eyes in isolated Model Vetting Studio captures (front/three-quarter/body_motion) before UI-XR runtime mirror or bundle promotion.",
    },
    notEvidenceFor: NOT_EVIDENCE_FOR,
  };
}

async function captureStudioEvidence(input: {
  report: ModelVettingReport;
  reportUrl: string;
  captureViews: CliOptions["captureViews"];
  captureDir: string;
  runId: string;
  port: number;
  durationMs: number;
  dialogueText: string;
}): Promise<Array<{ candidateId: string; slotId: string; artifactPath: string }>> {
  const candidate = input.report.candidates[0];
  const server = spawn("pnpm", ["--filter", "@openclinxr/model-vetting-studio", "dev:portless"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(input.port) },
    stdio: "pipe",
  });

  const artifacts: Array<{ candidateId: string; slotId: string; artifactPath: string }> = [];
  try {
    await waitForStudio(input.port, server);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const captureView of input.captureViews) {
        const ext = captureView === "body_motion_probe" || captureView === "viseme_timeline" ? "webm" : "png";
        const artifactPath = path.join(
          input.captureDir,
          `${path.basename(candidate.sourceGlbPath, ".glb")}_${captureView}_${input.runId}.${ext}`,
        );
        const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
        const dialogueQuery = captureView === "viseme_timeline"
          ? `&captureDialogueText=${encodeURIComponent(input.dialogueText)}`
          : "";
        const url =
          `http://127.0.0.1:${input.port}/?captureCandidateId=${encodeURIComponent(candidate.candidateId)}` +
          `&captureView=${captureView}&reportUrl=${encodeURIComponent(input.reportUrl)}${dialogueQuery}`;
        await page.goto(url, { waitUntil: "networkidle" });
        await page.waitForFunction(
          (expectedView) => {
            const evidence = window.__openClinXrModelVettingCandidateCaptureEvidence;
            const baseReady = (
              evidence?.captureView === expectedView
              && typeof evidence.captureClaim === "string"
              && evidence.captureClaim.startsWith("isolated_model_")
              && (evidence.captureClaim.endsWith("_video_only") || evidence.captureClaim.endsWith("_screenshot_only"))
              && typeof evidence.meshCount === "number"
              && evidence.meshCount > 0
            );
            if (expectedView === "viseme_timeline") {
              return baseReady
                && evidence?.visemeTimelineEvidence?.morphTargetPlaybackMode === "glb_morph_target_timeline_from_bundle_dialogue"
                && (evidence.visemeTimelineEvidence.appliedTargetCount ?? 0) > 0;
            }
            return baseReady;
          },
          captureView,
          { timeout: 120_000 },
        );
        await page.waitForTimeout(captureView === "viseme_timeline" ? 1200 : 400);
        if (captureView === "body_motion_probe" || captureView === "viseme_timeline") {
          const recordingDurationMs = captureView === "viseme_timeline" ? Math.max(input.durationMs, 4500) : input.durationMs;
          await writeFile(artifactPath, Buffer.from(await recordModelCanvasVideo(page, recordingDurationMs)));
        } else {
          await page.screenshot({ path: artifactPath });
        }
        await page.close();
        artifacts.push({
          candidateId: candidate.candidateId,
          slotId: slotIdForCaptureView(captureView),
          artifactPath,
        });
      }
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(server);
  }
  return artifacts;
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

function slotIdForCaptureView(view: CliOptions["captureViews"][number]): string {
  if (view === "front") return "front_screenshot";
  if (view === "three_quarter") return "three_quarter_screenshot";
  if (view === "viseme_timeline") return "viseme_timeline_video";
  return "body_motion_probe_video";
}

async function waitForStudio(port: number, server: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {
      // retry
    }
    if (server.exitCode !== null) throw new Error("Model-vetting studio dev server exited before ready.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Model-vetting studio not ready on port ${port}`);
}

function stopServer(server: ChildProcessWithoutNullStreams): void {
  if (server.exitCode === null) server.kill("SIGTERM");
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    lane: "anny-school-age",
    runId: "2026-06-07-school-aged-patient-mpfb2-eye-v1",
    inputGlbPath: DEFAULT_INPUT_GLB,
    sourceReportPath: DEFAULT_SOURCE_REPORT,
    sourceCandidateId: DEFAULT_SOURCE_CANDIDATE_ID,
    outputGlbName: "peds_patient_child_mpfb2_eye.glb",
    captureViews: ["front", "three_quarter", "body_motion_probe", "viseme_timeline"],
    dialogueText: "Maya Johnson: It is hard to breathe and my chest feels tight.",
    port: 5192,
    durationMs: 5000,
    skipMpfb2Stage: false,
    skipCapture: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--lane") options.lane = requireNext(args, ++index, arg);
    else if (arg === "--run-id") options.runId = requireNext(args, ++index, arg);
    else if (arg === "--input-glb") options.inputGlbPath = requireNext(args, ++index, arg);
    else if (arg === "--source-report") options.sourceReportPath = requireNext(args, ++index, arg);
    else if (arg === "--source-candidate-id") options.sourceCandidateId = requireNext(args, ++index, arg);
    else if (arg === "--output-glb-name") options.outputGlbName = requireNext(args, ++index, arg);
    else if (arg === "--capture-views") {
      options.captureViews = requireNext(args, ++index, arg).split(",").map((v) => v.trim()) as CliOptions["captureViews"];
    } else if (arg === "--port") options.port = Number(requireNext(args, ++index, arg));
    else if (arg === "--duration-ms") options.durationMs = Number(requireNext(args, ++index, arg));
    else if (arg === "--dialogue-text") options.dialogueText = requireNext(args, ++index, arg);
    else if (arg === "--skip-mpfb2-stage") options.skipMpfb2Stage = true;
    else if (arg === "--skip-capture") options.skipCapture = true;
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}