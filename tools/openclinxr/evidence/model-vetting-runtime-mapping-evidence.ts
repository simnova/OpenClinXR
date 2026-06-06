import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { globFiles, readJson } from "../../agent-factory/lib.js";
import {
  validateModelVettingCaptureManifest,
  type ModelVettingCaptureManifest,
  type ModelVettingCaptureManifestCandidate,
} from "./model-vetting-capture-manifest.js";
import { validateModelVettingReport, type ModelVettingCandidate, type ModelVettingReport } from "../../../packages/openclinxr/arena/model-vetting/src/index.js";

const defaultOutputPath = `docs/openclinxr/model-vetting-runtime-mapping-evidence-peds-asthma-parent-anxiety-${new Date().toISOString().slice(0, 10)}.json`;

export type ModelVettingRuntimeMappingEvidence = {
  schemaVersion: "openclinxr.model-vetting-runtime-mapping-evidence.v1";
  generatedAt: string;
  sourceReportPath: string;
  sourceCaptureManifestPath: string;
  claimScope: "isolated_capture_to_runtime_mapping_gap_analysis_only";
  actors: ModelVettingRuntimeMappingActor[];
  decision: {
    isolatedCaptureSetComplete: boolean;
    runtimeActorMappingReady: false;
    scenePlacementEvidenceAllowed: false;
    runtimePromotionAllowed: false;
    productionManifestPromotionAllowed: false;
    nextSafeStep: string;
  };
  providerBoundary: ModelVettingCaptureManifest["providerBoundary"];
  notEvidenceFor: ModelVettingCaptureManifest["notEvidenceFor"];
};

export type ModelVettingRuntimeMappingActor = {
  candidateId: string;
  actorId: string;
  actorDisplayRole: string;
  sourceFidelity: {
    sourceGlbPath: string;
    provenancePath: string | null;
    sha256: string | null;
    vertexCount: number | null;
    materialCount: number | null;
    animationCount: number | null;
    morphTargets: number | null;
    realismGrade: string;
    promotionStatus: string;
  };
  roleAnimationHandoff?: ModelVettingCandidate["roleAnimationHandoff"];
  turnMappings: Array<{
    traceTag: string;
    text: string;
    emotion: string;
    intensity: number;
    transitionMs: number;
    gazeTargetKind: string;
    evidenceArtifactPaths: string[];
    requiredRuntimeBindings: string[];
    blockers: string[];
  }>;
  capturedSlotCount: number;
  missingSlotCount: number;
  mappingChecks: Array<{
    checkId:
      | "speech_viseme_timeline_binding"
      | "emotion_transition_state_binding"
      | "gaze_blink_runtime_binding"
      | "posture_locomotion_runtime_binding";
    status: "blocked" | "metadata_only";
    evidence: string[];
    blockers: string[];
  }>;
};

type CliOptions = {
  outputPath?: string;
  sourceReportPath?: string;
  sourceCaptureManifestPath?: string;
  validateLatest: boolean;
  validatePath?: string;
};

export function buildModelVettingRuntimeMappingEvidence(input: {
  generatedAt?: string;
  sourceCaptureManifestPath: string;
  captureManifest: ModelVettingCaptureManifest;
  sourceReportPath: string;
  sourceReport: ModelVettingReport;
}): ModelVettingRuntimeMappingEvidence {
  const validation = validateModelVettingCaptureManifest(input.captureManifest);
  if (!validation.ok) throw new Error(`Invalid model-vetting capture manifest: ${validation.errors.join("; ")}`);
  const reportValidation = validateModelVettingReport(input.sourceReport);
  if (!reportValidation.ok) throw new Error(`Invalid model-vetting report: ${reportValidation.errors.join("; ")}`);
  const reportCandidates = new Map(input.sourceReport.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const isolatedCaptureSetComplete = input.captureManifest.decision.isolatedLabCaptureComplete;
  return {
    schemaVersion: "openclinxr.model-vetting-runtime-mapping-evidence.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceReportPath: input.sourceReportPath,
    sourceCaptureManifestPath: input.sourceCaptureManifestPath,
    claimScope: "isolated_capture_to_runtime_mapping_gap_analysis_only",
    actors: input.captureManifest.candidates.map((candidate) => buildActorMapping(candidate, reportCandidates.get(candidate.candidateId))),
    decision: {
      isolatedCaptureSetComplete,
      runtimeActorMappingReady: false,
      scenePlacementEvidenceAllowed: false,
      runtimePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
      nextSafeStep: "Bind case-defined actor turns, viseme cues, gaze/blink cues, emotion state transitions, and posture hooks to runtime evidence before scene-placement planning.",
    },
    providerBoundary: input.captureManifest.providerBoundary,
    notEvidenceFor: input.captureManifest.notEvidenceFor,
  };
}

export function validateModelVettingRuntimeMappingEvidence(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value["schemaVersion"], "openclinxr.model-vetting-runtime-mapping-evidence.v1", "/schemaVersion", errors);
  requireLiteral(value["claimScope"], "isolated_capture_to_runtime_mapping_gap_analysis_only", "/claimScope", errors);
  requireString(value["sourceReportPath"], "/sourceReportPath", errors);
  requireString(value["sourceCaptureManifestPath"], "/sourceCaptureManifestPath", errors);
  const actors = value["actors"];
  if (!Array.isArray(actors) || actors.length === 0) errors.push("/actors must be nonempty array");
  if (Array.isArray(actors)) {
    for (const [actorIndex, actor] of actors.entries()) validateActor(actor, `/actors/${actorIndex}`, errors);
  }
  const decision = value["decision"];
  requireRecord(decision, "/decision", errors);
  if (isRecord(decision)) {
    requireLiteral(decision["runtimeActorMappingReady"], false, "/decision/runtimeActorMappingReady", errors);
    requireLiteral(decision["scenePlacementEvidenceAllowed"], false, "/decision/scenePlacementEvidenceAllowed", errors);
    requireLiteral(decision["runtimePromotionAllowed"], false, "/decision/runtimePromotionAllowed", errors);
    requireLiteral(decision["productionManifestPromotionAllowed"], false, "/decision/productionManifestPromotionAllowed", errors);
  }
  requireStringArrayIncludes(value["notEvidenceFor"], "quest_readiness", "/notEvidenceFor", errors);
  requireStringArrayIncludes(value["notEvidenceFor"], "clinical_validity", "/notEvidenceFor", errors);
  requireStringArrayIncludes(value["notEvidenceFor"], "scoring_validity", "/notEvidenceFor", errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/model-vetting-runtime-mapping-evidence-*.json");
    if (!validatePath) throw new Error("Missing model-vetting runtime mapping evidence to validate.");
    const validation = validateModelVettingRuntimeMappingEvidence(await readJson<unknown>(validatePath));
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
  const sourceCaptureManifestPath = options.sourceCaptureManifestPath
    ?? await latestPath("docs/openclinxr/model-vetting-capture-manifest-*.json");
  if (!sourceCaptureManifestPath) throw new Error("Missing model-vetting capture manifest source.");
  const evidence = buildModelVettingRuntimeMappingEvidence({
    sourceReportPath,
    sourceReport: await readJson<ModelVettingReport>(sourceReportPath),
    sourceCaptureManifestPath,
    captureManifest: await readJson<ModelVettingCaptureManifest>(sourceCaptureManifestPath),
  });
  const outputPath = options.outputPath ?? defaultOutputPath;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
}

function buildActorMapping(candidate: ModelVettingCaptureManifestCandidate, reportCandidate: ModelVettingCandidate | undefined): ModelVettingRuntimeMappingActor {
  const capturedSlots = candidate.slots.filter((slot) => slot.status === "captured");
  const missingSlots = candidate.slots.filter((slot) => slot.status === "missing");
  const slotEvidence = capturedSlots.map((slot) => `${slot.slotId}:${slot.artifactPath ?? "missing"}`);
  const provenanceMetadata = reportCandidate?.provenance as Record<string, unknown> | undefined;
  return {
    candidateId: candidate.candidateId,
    actorId: candidate.actorId,
    actorDisplayRole: candidate.actorDisplayRole,
    sourceFidelity: {
      sourceGlbPath: candidate.sourceGlbPath,
      provenancePath: reportCandidate?.provenance.provenancePath ?? null,
      sha256: reportCandidate?.structuralMetrics.sha256 ?? null,
      vertexCount: reportCandidate?.structuralMetrics.vertexCount ?? null,
      materialCount: reportCandidate?.structuralMetrics.materialCount ?? null,
      animationCount: reportCandidate?.structuralMetrics.animationCount ?? null,
      morphTargets: reportCandidate?.structuralMetrics.morphTargetPrimitiveCount ?? null,
      realismGrade: typeof provenanceMetadata?.["realismGrade"] === "string" ? provenanceMetadata["realismGrade"] : "unknown",
      promotionStatus: typeof provenanceMetadata?.["promotionStatus"] === "string" ? provenanceMetadata["promotionStatus"] : "unknown",
    },
    ...(reportCandidate?.roleAnimationHandoff ? { roleAnimationHandoff: reportCandidate.roleAnimationHandoff } : {}),
    turnMappings: buildTurnMappings(candidate.actorId, slotEvidence),
    capturedSlotCount: capturedSlots.length,
    missingSlotCount: missingSlots.length,
    mappingChecks: [
      {
        checkId: "speech_viseme_timeline_binding",
        status: "blocked",
        evidence: slotEvidence.filter((item) => item.startsWith("viseme_timeline_video:")),
        blockers: ["case_turn_text_not_bound_to_viseme_timeline", "audio_to_face_runtime_mapping_not_verified"],
      },
      {
        checkId: "emotion_transition_state_binding",
        status: "blocked",
        evidence: slotEvidence.filter((item) => item.startsWith("emotion_transition_video:")),
        blockers: ["case_emotion_state_not_bound_to_runtime_expression_curve", "emotion_transition_not_verified_in_scene_runtime"],
      },
      {
        checkId: "gaze_blink_runtime_binding",
        status: "blocked",
        evidence: slotEvidence.filter((item) => item.includes("turntable_video")),
        blockers: ["gaze_target_policy_not_bound_to_actor_turns", "blink_cadence_not_verified_with_dialogue"],
      },
      {
        checkId: "posture_locomotion_runtime_binding",
        status: "metadata_only",
        evidence: slotEvidence,
        blockers: ["locomotion_hooks_not_verified_in_scene_runtime", "clinical_posture_changes_not_bound_to_case_events"],
      },
    ],
  };
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { validateLatest: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
    else if (arg === "--source-report") options.sourceReportPath = requireNext(args, ++index, arg);
    else if (arg === "--source-capture-manifest") options.sourceCaptureManifestPath = requireNext(args, ++index, arg);
    else if (arg === "--validate") options.validatePath = requireNext(args, ++index, arg);
    else if (arg === "--validate-latest") options.validateLatest = true;
  }
  return options;
}

function validateActor(value: unknown, path: string, errors: string[]): void {
  requireRecord(value, path, errors);
  if (!isRecord(value)) return;
  requireString(value["candidateId"], `${path}/candidateId`, errors);
  requireRecord(value["sourceFidelity"], `${path}/sourceFidelity`, errors);
  const roleAnimationHandoff = value["roleAnimationHandoff"];
  if (roleAnimationHandoff !== undefined) {
    requireRecord(roleAnimationHandoff, `${path}/roleAnimationHandoff`, errors);
    if (isRecord(roleAnimationHandoff)) {
      if (!Array.isArray(roleAnimationHandoff["roleSpecificClipNames"]) || roleAnimationHandoff["roleSpecificClipNames"].length === 0) {
        errors.push(`${path}/roleAnimationHandoff/roleSpecificClipNames must be nonempty array`);
      }
      requireStringArrayIncludes(roleAnimationHandoff["notEvidenceFor"], "production_asset_readiness", `${path}/roleAnimationHandoff/notEvidenceFor`, errors);
    }
  }
  if (typeof value["capturedSlotCount"] !== "number") errors.push(`${path}/capturedSlotCount must be number`);
  if (typeof value["missingSlotCount"] !== "number") errors.push(`${path}/missingSlotCount must be number`);
  if (!Array.isArray(value["turnMappings"]) || value["turnMappings"].length === 0) errors.push(`${path}/turnMappings must be nonempty array`);
  const mappingChecks = value["mappingChecks"];
  if (!Array.isArray(mappingChecks) || mappingChecks.length !== 4) errors.push(`${path}/mappingChecks must include four checks`);
}

function buildTurnMappings(actorId: string, slotEvidence: string[]): ModelVettingRuntimeMappingActor["turnMappings"] {
  const actorProfile = actorId.includes("nurse")
    ? {
        traceTag: "nurse_work_of_breathing_assessment",
        text: "I am watching her breathing effort and will call out any change.",
        emotion: "focused_concern",
        intensity: 0.58,
        gazeTargetKind: "child_patient_then_clinician",
      }
    : actorId.includes("parent")
      ? {
        traceTag: "parent_anxiety_initial_concern",
        text: "I am really worried about Maya's breathing.",
        emotion: "anxious_concern",
        intensity: 0.78,
        gazeTargetKind: "child_patient_then_clinician",
      }
      : {
        traceTag: "patient_dyspnea_short_answer",
        text: "It feels tight when I breathe.",
        emotion: "dyspnea_discomfort",
        intensity: 0.62,
        gazeTargetKind: "clinician_with_parent_glance",
      };
  return [
    {
      ...actorProfile,
      transitionMs: 900,
      evidenceArtifactPaths: slotEvidence,
      requiredRuntimeBindings: [
        "emotion_aligned_expression_transition_cue",
        "dialogue_viseme_and_gaze_mapping",
        "gaze_blink_runtime_binding",
      ],
      blockers: [
        "case_turn_text_not_bound_to_runtime_actor_policy",
        "viseme_curve_not_generated_from_actual_audio",
        "emotion_curve_not_verified_in_scene_runtime",
      ],
    },
  ];
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const paths = await globFiles(pattern);
  return paths.sort().at(-1);
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function requireRecord(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${path} must be object`);
}

function requireString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${path} must be nonempty string`);
}

function requireLiteral<T extends boolean | string>(value: unknown, expected: T, path: string, errors: string[]): void {
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
