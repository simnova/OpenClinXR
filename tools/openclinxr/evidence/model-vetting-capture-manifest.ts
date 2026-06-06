import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  validateModelVettingReport,
  type ModelVettingCandidate,
  type ModelVettingReport,
} from "../../../packages/openclinxr/arena/model-vetting/src/index.js";
import { globFiles, readJson } from "../../agent-factory/lib.js";

const defaultOutputPath = `docs/openclinxr/model-vetting-capture-manifest-peds-asthma-parent-anxiety-${new Date().toISOString().slice(0, 10)}.json`;
const defaultOverviewScreenshotPath = "docs/openclinxr/model-vetting-studio-peds-asthma-parent-anxiety-2026-06-05.png";

export type ModelVettingCaptureManifest = {
  schemaVersion: "openclinxr.model-vetting-capture-manifest.v1";
  generatedAt: string;
  sourceReportPath: string;
  claimScope: "isolated_model_vetting_capture_manifest_only";
  studioEvidence: {
    overviewScreenshotPath: string | null;
    overviewScreenshotPresent: boolean;
    overviewScreenshotClaim: "studio_ui_smoke_only_not_fixed_camera_or_video_slot_evidence";
  };
  candidates: ModelVettingCaptureManifestCandidate[];
  decision: {
    isolatedLabCaptureComplete: boolean;
    scenePlacementEvidenceAllowed: false;
    runtimePromotionAllowed: false;
    productionManifestPromotionAllowed: false;
    nextSafeStep: string;
  };
  providerBoundary: ModelVettingReport["providerBoundary"];
  notEvidenceFor: ModelVettingReport["notEvidenceFor"];
};

export type ModelVettingCaptureManifestCandidate = {
  candidateId: string;
  actorId: string;
  actorDisplayRole: string;
  sourceGlbPath: string;
  gateResult: ModelVettingCandidate["gateResult"];
  slots: ModelVettingCaptureManifestSlot[];
};

export type ModelVettingCaptureManifestSlot = {
  slotId:
    | "front_screenshot"
    | "side_screenshot"
    | "three_quarter_screenshot"
    | "turntable_video"
    | "viseme_timeline_video"
    | "emotion_transition_video";
  mediaKind: "screenshot" | "video";
  requiredView: string;
  status: "missing" | "captured";
  artifactPath: string | null;
  evidenceClaim: "not_captured" | "isolated_lab_slot_artifact_only";
};

export type ModelVettingCaptureArtifactMap = {
  schemaVersion: "openclinxr.model-vetting-capture-artifact-map.v1";
  artifacts: Array<{
    candidateId: string;
    slotId: ModelVettingCaptureManifestSlot["slotId"];
    artifactPath: string;
  }>;
};

type CliOptions = {
  outputPath?: string;
  sourceReportPath?: string;
  overviewScreenshotPath?: string;
  slotArtifactsPath?: string;
  validateLatest: boolean;
  validatePath?: string;
};

export async function buildModelVettingCaptureManifest(input: {
  generatedAt?: string;
  sourceReportPath: string;
  sourceReport: ModelVettingReport;
  overviewScreenshotPath?: string;
  slotArtifacts?: ModelVettingCaptureArtifactMap;
}): Promise<ModelVettingCaptureManifest> {
  const validation = validateModelVettingReport(input.sourceReport);
  if (!validation.ok) throw new Error(`Invalid model-vetting report: ${validation.errors.join("; ")}`);
  const overviewScreenshotPath = input.overviewScreenshotPath ?? null;
  const overviewScreenshotPresent = overviewScreenshotPath ? await fileExists(overviewScreenshotPath) : false;
  const slotArtifacts = buildSlotArtifactLookup(input.slotArtifacts);
  await assertSlotArtifactsExist(slotArtifacts);
  const candidates = await Promise.all(input.sourceReport.candidates.map((candidate) => buildManifestCandidate(candidate, slotArtifacts)));
  const isolatedLabCaptureComplete = candidates.every((candidate) => candidate.slots.every((slot) => slot.status === "captured"));

  return {
    schemaVersion: "openclinxr.model-vetting-capture-manifest.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceReportPath: input.sourceReportPath,
    claimScope: "isolated_model_vetting_capture_manifest_only",
    studioEvidence: {
      overviewScreenshotPath,
      overviewScreenshotPresent,
      overviewScreenshotClaim: "studio_ui_smoke_only_not_fixed_camera_or_video_slot_evidence",
    },
    candidates,
    decision: {
      isolatedLabCaptureComplete,
      scenePlacementEvidenceAllowed: false,
      runtimePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
      nextSafeStep: isolatedLabCaptureComplete
        ? "Run Visual Realism Adversary review before using isolated lab evidence for scene-placement planning."
        : "Capture missing fixed-camera screenshots and turntable, viseme, and emotion-transition videos in the isolated studio.",
    },
    providerBoundary: input.sourceReport.providerBoundary,
    notEvidenceFor: input.sourceReport.notEvidenceFor,
  };
}

export function validateModelVettingCaptureManifest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value["schemaVersion"], "openclinxr.model-vetting-capture-manifest.v1", "/schemaVersion", errors);
  requireLiteral(value["claimScope"], "isolated_model_vetting_capture_manifest_only", "/claimScope", errors);
  const studioEvidence = value["studioEvidence"];
  requireRecord(studioEvidence, "/studioEvidence", errors);
  if (isRecord(studioEvidence)) {
    requireLiteral(studioEvidence["overviewScreenshotClaim"], "studio_ui_smoke_only_not_fixed_camera_or_video_slot_evidence", "/studioEvidence/overviewScreenshotClaim", errors);
    if (typeof studioEvidence["overviewScreenshotPresent"] !== "boolean") errors.push("/studioEvidence/overviewScreenshotPresent must be boolean");
  }
  const candidates = value["candidates"];
  if (!Array.isArray(candidates) || candidates.length === 0) errors.push("/candidates must be nonempty array");
  if (Array.isArray(candidates)) {
    for (const [candidateIndex, candidate] of candidates.entries()) validateManifestCandidate(candidate, `/candidates/${candidateIndex}`, errors);
  }
  const decision = value["decision"];
  requireRecord(decision, "/decision", errors);
  if (isRecord(decision)) {
    requireLiteral(decision["scenePlacementEvidenceAllowed"], false, "/decision/scenePlacementEvidenceAllowed", errors);
    requireLiteral(decision["runtimePromotionAllowed"], false, "/decision/runtimePromotionAllowed", errors);
    requireLiteral(decision["productionManifestPromotionAllowed"], false, "/decision/productionManifestPromotionAllowed", errors);
    if (typeof decision["isolatedLabCaptureComplete"] !== "boolean") errors.push("/decision/isolatedLabCaptureComplete must be boolean");
  }
  validateProviderBoundary(value["providerBoundary"], "/providerBoundary", errors);
  requireStringArrayIncludes(value["notEvidenceFor"], "b_plus_visual_realism_gate", "/notEvidenceFor", errors);
  requireStringArrayIncludes(value["notEvidenceFor"], "scene_placement_readiness", "/notEvidenceFor", errors);
  requireStringArrayIncludes(value["notEvidenceFor"], "quest_readiness", "/notEvidenceFor", errors);
  requireStringArrayIncludes(value["notEvidenceFor"], "clinical_validity", "/notEvidenceFor", errors);
  requireStringArrayIncludes(value["notEvidenceFor"], "scoring_validity", "/notEvidenceFor", errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/model-vetting-capture-manifest-*.json");
    if (!validatePath) throw new Error("Missing model-vetting capture manifest to validate.");
    const validation = validateModelVettingCaptureManifest(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const sourceReportPath = options.sourceReportPath
    ?? await latestPath("docs/openclinxr/model-vetting-report-*.json");
  if (!sourceReportPath) throw new Error("Missing model-vetting report source.");
  const manifest = await buildModelVettingCaptureManifest({
    sourceReportPath,
    sourceReport: await readJson<ModelVettingReport>(sourceReportPath),
    overviewScreenshotPath: options.overviewScreenshotPath ?? defaultOverviewScreenshotPath,
    slotArtifacts: options.slotArtifactsPath ? await readJson<ModelVettingCaptureArtifactMap>(options.slotArtifactsPath) : undefined,
  });
  const outputPath = options.outputPath ?? defaultOutputPath;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
}

async function buildManifestCandidate(
  candidate: ModelVettingCandidate,
  slotArtifacts: Map<string, string>,
): Promise<ModelVettingCaptureManifestCandidate> {
  const screenshots = candidate.captureArtifacts.fixedCameraScreenshots;
  return {
    candidateId: candidate.candidateId,
    actorId: candidate.actorId,
    actorDisplayRole: candidate.actorDisplayRole,
    sourceGlbPath: candidate.sourceGlbPath,
    gateResult: candidate.gateResult,
    slots: [
      slot("front_screenshot", "screenshot", "front", slotArtifacts.get(slotKey(candidate.candidateId, "front_screenshot")) ?? screenshots[0] ?? null),
      slot("side_screenshot", "screenshot", "side", slotArtifacts.get(slotKey(candidate.candidateId, "side_screenshot")) ?? screenshots[1] ?? null),
      slot("three_quarter_screenshot", "screenshot", "three_quarter", slotArtifacts.get(slotKey(candidate.candidateId, "three_quarter_screenshot")) ?? screenshots[2] ?? null),
      slot("turntable_video", "video", "turntable", slotArtifacts.get(slotKey(candidate.candidateId, "turntable_video")) ?? candidate.captureArtifacts.turntableVideo ?? null),
      slot("viseme_timeline_video", "video", "viseme_timeline", slotArtifacts.get(slotKey(candidate.candidateId, "viseme_timeline_video")) ?? candidate.captureArtifacts.morphVisemeTimelineCapture ?? null),
      slot("emotion_transition_video", "video", "emotion_transition", slotArtifacts.get(slotKey(candidate.candidateId, "emotion_transition_video")) ?? candidate.captureArtifacts.emotionTransitionCapture ?? null),
    ],
  };
}

function slot(
  slotId: ModelVettingCaptureManifestSlot["slotId"],
  mediaKind: ModelVettingCaptureManifestSlot["mediaKind"],
  requiredView: string,
  artifactPath: string | null,
): ModelVettingCaptureManifestSlot {
  return {
    slotId,
    mediaKind,
    requiredView,
    status: artifactPath ? "captured" : "missing",
    artifactPath,
    evidenceClaim: artifactPath ? "isolated_lab_slot_artifact_only" : "not_captured",
  };
}

function validateManifestCandidate(value: unknown, path: string, errors: string[]): void {
  requireRecord(value, path, errors);
  if (!isRecord(value)) return;
  requireString(value["candidateId"], `${path}/candidateId`, errors);
  const slots = value["slots"];
  const requiredSlotIds: ModelVettingCaptureManifestSlot["slotId"][] = [
    "front_screenshot",
    "side_screenshot",
    "three_quarter_screenshot",
    "turntable_video",
    "viseme_timeline_video",
    "emotion_transition_video",
  ];
  if (!Array.isArray(slots) || slots.length !== requiredSlotIds.length) errors.push(`${path}/slots must include exactly six capture slots`);
  if (Array.isArray(slots)) {
    const slotIds = slots.map((candidateSlot) => isRecord(candidateSlot) ? String(candidateSlot["slotId"]) : "");
    for (const slotId of requiredSlotIds) {
      if (!slotIds.includes(slotId)) errors.push(`${path}/slots must include ${slotId}`);
    }
    for (const [slotIndex, candidateSlot] of slots.entries()) {
      if (!isRecord(candidateSlot)) {
        errors.push(`${path}/slots/${slotIndex} must be object`);
        continue;
      }
      if (!["missing", "captured"].includes(String(candidateSlot["status"]))) errors.push(`${path}/slots/${slotIndex}/status must be missing or captured`);
      if (candidateSlot["status"] === "missing") requireLiteral(candidateSlot["artifactPath"], null, `${path}/slots/${slotIndex}/artifactPath`, errors);
      if (candidateSlot["status"] === "missing") requireLiteral(candidateSlot["evidenceClaim"], "not_captured", `${path}/slots/${slotIndex}/evidenceClaim`, errors);
    }
  }
}

function validateProviderBoundary(value: unknown, path: string, errors: string[]): void {
  requireRecord(value, path, errors);
  if (!isRecord(value)) return;
  requireLiteral(value["providerId"], "anny_local_or_anny_compatible_import", `${path}/providerId`, errors);
  requireLiteral(value["policyMode"], "local_metadata_only", `${path}/policyMode`, errors);
  requireLiteral(value["approvalStatus"], "not_required_for_metadata_only", `${path}/approvalStatus`, errors);
  requireLiteral(value["localOnly"], true, `${path}/localOnly`, errors);
  requireLiteral(value["providerExecutionEnabled"], false, `${path}/providerExecutionEnabled`, errors);
  requireLiteral(value["externalNetworkUsed"], false, `${path}/externalNetworkUsed`, errors);
  requireLiteral(value["paidApiUsed"], false, `${path}/paidApiUsed`, errors);
  requireLiteral(value["credentialsRequired"], false, `${path}/credentialsRequired`, errors);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { validateLatest: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
    else if (arg === "--source-report") options.sourceReportPath = requireNext(args, ++index, arg);
    else if (arg === "--overview-screenshot") options.overviewScreenshotPath = requireNext(args, ++index, arg);
    else if (arg === "--slot-artifacts") options.slotArtifactsPath = requireNext(args, ++index, arg);
    else if (arg === "--validate") options.validatePath = requireNext(args, ++index, arg);
    else if (arg === "--validate-latest") options.validateLatest = true;
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const paths = await globFiles(pattern);
  return paths.sort().at(-1);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildSlotArtifactLookup(slotArtifacts: ModelVettingCaptureArtifactMap | undefined): Map<string, string> {
  const lookup = new Map<string, string>();
  if (!slotArtifacts) return lookup;
  if (slotArtifacts.schemaVersion !== "openclinxr.model-vetting-capture-artifact-map.v1") {
    throw new Error("Slot artifact map schemaVersion must be openclinxr.model-vetting-capture-artifact-map.v1");
  }
  for (const artifact of slotArtifacts.artifacts) {
    if (!artifact.candidateId || !artifact.slotId || !artifact.artifactPath) throw new Error("Slot artifact entries require candidateId, slotId, and artifactPath");
    const key = slotKey(artifact.candidateId, artifact.slotId);
    if (lookup.has(key)) throw new Error(`Duplicate slot artifact entry for ${key}`);
    lookup.set(key, artifact.artifactPath);
  }
  return lookup;
}

async function assertSlotArtifactsExist(slotArtifacts: Map<string, string>): Promise<void> {
  for (const [key, artifactPath] of slotArtifacts) {
    if (!await fileExists(artifactPath)) throw new Error(`Slot artifact for ${key} does not exist: ${artifactPath}`);
  }
}

function slotKey(candidateId: string, slotId: ModelVettingCaptureManifestSlot["slotId"]): string {
  return `${candidateId}:${slotId}`;
}

function requireRecord(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${path} must be object`);
}

function requireString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${path} must be nonempty string`);
}

function requireLiteral<T extends boolean | string | null>(value: unknown, expected: T, path: string, errors: string[]): void {
  if (value !== expected) errors.push(`${path} must be ${String(expected)}`);
}

function requireStringArrayIncludes(value: unknown, expected: string, path: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string") || !value.includes(expected)) {
    errors.push(`${path} must include ${expected}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
