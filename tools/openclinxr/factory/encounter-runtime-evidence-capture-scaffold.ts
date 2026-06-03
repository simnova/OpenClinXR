import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EncounterRuntimeRealismEvidenceInputDraft } from "./encounter-runtime-realism-evidence-input-draft.js";

export type RuntimeEvidenceCaptureScaffoldAttachment = {
  actionId: "attach_runtime_realism_evidence_refs" | "attach_visual_qa_evidence_refs";
  inputId: string;
  inputKind: "runtime_realism_signal_input" | "visual_qa_review_input";
  evidenceRef: string;
  localArtifactPath: string;
  reviewerId: "runtime_evidence_capture_scaffold";
  attachmentStatus: "attached_metadata_only";
  comments: string;
  attachedAt: string;
};

export type RuntimeEvidenceCaptureScaffoldCandidate = RuntimeEvidenceCaptureScaffoldAttachment & {
  sourceEvidenceRef: string;
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: "metadata_only_runtime_evidence_capture_candidate_not_submitted";
  notEvidenceFor: RuntimeEvidenceCaptureScaffold["notEvidenceFor"];
};

export type RuntimeEvidenceCaptureScaffold = {
  schemaVersion: "openclinxr.encounter-runtime-evidence-capture-scaffold.v1";
  generatedAt: string;
  source: "encounter_runtime_realism_evidence_input_draft";
  selectedScenarioId: string;
  selectedEncounterId: string;
  selectedStationId: string;
  selectedRuntimeAssetBundleId: string;
  status: "metadata_only_attachment_candidates_not_submitted";
  runtimeEvidenceCandidateCount: number;
  visualQaEvidenceCandidateCount: number;
  attachmentCandidates: RuntimeEvidenceCaptureScaffoldCandidate[];
  submitRuntimeVisualEvidenceAttachmentInput: {
    scenarioId: string;
    attachments: RuntimeEvidenceCaptureScaffoldAttachment[];
  };
  gateBoundary: {
    providerExecutionAllowed: false;
    runtimeExecutionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    productionAssetReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
    claimBoundary: "runtime_evidence_capture_scaffold_does_not_clear_launch_gates";
  };
  blockers: string[];
  recommendedNextActions: string[];
  claimBoundary: "metadata_only_runtime_evidence_capture_scaffold_not_runtime_or_visual_evidence";
  notEvidenceFor: [
    "provider_availability",
    "runtime_readiness",
    "production_asset_readiness",
    "quest_readiness",
    "clinical_validity",
    "scoring_validity",
    "learner_launch_readiness",
  ];
};

const NOT_EVIDENCE_FOR = [
  "provider_availability",
  "runtime_readiness",
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
  "learner_launch_readiness",
] as const satisfies RuntimeEvidenceCaptureScaffold["notEvidenceFor"];

export function buildRuntimeEvidenceCaptureScaffold(input: {
  evidenceInputDraft: EncounterRuntimeRealismEvidenceInputDraft;
  generatedAt?: string;
}): RuntimeEvidenceCaptureScaffold {
  const generatedAt = input.generatedAt ?? input.evidenceInputDraft.generatedAt;
  const runtimeCandidates = input.evidenceInputDraft.runtimeActorEvidenceInputs.map((entry) =>
    buildCandidate({
      actionId: "attach_runtime_realism_evidence_refs",
      inputId: entry.evidenceInputId,
      inputKind: "runtime_realism_signal_input",
      evidenceRef: `runtime-evidence://metadata-only/local-capture-scaffold/${input.evidenceInputDraft.selectedScenarioId}/${entry.actorId}`,
      localArtifactPath: `runtime-evidence-capture-scaffold/${sanitizePathSegment(input.evidenceInputDraft.selectedScenarioId)}/${sanitizePathSegment(entry.actorId)}-runtime-realism.json`,
      sourceEvidenceRef: entry.sourceEvidenceRef,
      attachedAt: generatedAt,
      comments: `Metadata-only runtime-realism capture scaffold for ${entry.actorRole} ${entry.actorId}; reviewer/API submission is required before attachment records can update.`,
    })
  );
  const visualQaCandidates = input.evidenceInputDraft.visualQaEvidenceInputs.map((entry) =>
    buildCandidate({
      actionId: "attach_visual_qa_evidence_refs",
      inputId: entry.evidenceInputId,
      inputKind: "visual_qa_review_input",
      evidenceRef: `visual-qa-evidence://metadata-only/local-capture-scaffold/${input.evidenceInputDraft.selectedScenarioId}/${entry.targetId}`,
      localArtifactPath: `runtime-evidence-capture-scaffold/${sanitizePathSegment(input.evidenceInputDraft.selectedScenarioId)}/${sanitizePathSegment(entry.targetId)}-visual-qa.json`,
      sourceEvidenceRef: entry.sourceEvidenceRef,
      attachedAt: generatedAt,
      comments: `Metadata-only visual-QA capture scaffold for ${entry.targetKind} ${entry.targetId}; this is not visual quality evidence until reviewed and submitted.`,
    })
  );
  const attachmentCandidates = [...runtimeCandidates, ...visualQaCandidates];

  return {
    schemaVersion: "openclinxr.encounter-runtime-evidence-capture-scaffold.v1",
    generatedAt,
    source: "encounter_runtime_realism_evidence_input_draft",
    selectedScenarioId: input.evidenceInputDraft.selectedScenarioId,
    selectedEncounterId: input.evidenceInputDraft.selectedEncounterId,
    selectedStationId: input.evidenceInputDraft.selectedStationId,
    selectedRuntimeAssetBundleId: input.evidenceInputDraft.selectedRuntimeAssetBundleId,
    status: "metadata_only_attachment_candidates_not_submitted",
    runtimeEvidenceCandidateCount: runtimeCandidates.length,
    visualQaEvidenceCandidateCount: visualQaCandidates.length,
    attachmentCandidates,
    submitRuntimeVisualEvidenceAttachmentInput: {
      scenarioId: input.evidenceInputDraft.selectedScenarioId,
      attachments: attachmentCandidates.map(stripCandidateMetadata),
    },
    gateBoundary: {
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      claimBoundary: "runtime_evidence_capture_scaffold_does_not_clear_launch_gates",
    },
    blockers: [
      "runtime_evidence_capture_scaffold_not_submitted",
      "runtime_realism_evidence_requires_reviewer_attachment",
      "visual_qa_evidence_requires_reviewer_attachment",
    ],
    recommendedNextActions: [
      "submit metadata-only runtime evidence capture scaffold through the reviewed runtime visual evidence attachment route",
      "keep runtime, learner, Quest, production, clinical, and scoring gates blocked until reviewed evidence records attach",
    ],
    claimBoundary: "metadata_only_runtime_evidence_capture_scaffold_not_runtime_or_visual_evidence",
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

export function validateRuntimeEvidenceCaptureScaffold(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.encounter-runtime-evidence-capture-scaffold.v1", "/schemaVersion", errors);
  requireLiteral(value.source, "encounter_runtime_realism_evidence_input_draft", "/source", errors);
  requireLiteral(value.status, "metadata_only_attachment_candidates_not_submitted", "/status", errors);
  requireString(value.selectedScenarioId, "/selectedScenarioId", errors);
  requireNumber(value.runtimeEvidenceCandidateCount, "/runtimeEvidenceCandidateCount", errors);
  requireNumber(value.visualQaEvidenceCandidateCount, "/visualQaEvidenceCandidateCount", errors);
  requireArray(value.attachmentCandidates, "/attachmentCandidates", errors);
  validateCandidates(value.attachmentCandidates, errors);
  validateSubmitInput(value.submitRuntimeVisualEvidenceAttachmentInput, value.selectedScenarioId, errors);
  validateGateBoundary(value.gateBoundary, errors);
  requireLiteral(value.claimBoundary, "metadata_only_runtime_evidence_capture_scaffold_not_runtime_or_visual_evidence", "/claimBoundary", errors);
  requireArray(value.notEvidenceFor, "/notEvidenceFor", errors);
  for (const claim of NOT_EVIDENCE_FOR) {
    if (Array.isArray(value.notEvidenceFor) && !value.notEvidenceFor.includes(claim)) errors.push(`/notEvidenceFor must include ${claim}`);
  }
  if (Array.isArray(value.attachmentCandidates)) {
    const runtimeCount = value.attachmentCandidates.filter((entry) => isRecord(entry) && entry.inputKind === "runtime_realism_signal_input").length;
    const visualCount = value.attachmentCandidates.filter((entry) => isRecord(entry) && entry.inputKind === "visual_qa_review_input").length;
    if (value.runtimeEvidenceCandidateCount !== runtimeCount) errors.push("/runtimeEvidenceCandidateCount must match runtime attachment candidates");
    if (value.visualQaEvidenceCandidateCount !== visualCount) errors.push("/visualQaEvidenceCandidateCount must match visual QA attachment candidates");
  }
  return { ok: errors.length === 0, errors };
}

async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.validatePath) {
    const validation = validateRuntimeEvidenceCaptureScaffold(JSON.parse(await readFile(options.validatePath, "utf8")) as unknown);
    if (!validation.ok) {
      process.stderr.write(`Runtime evidence capture scaffold validation failed:\n${validation.errors.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`Validated ${options.validatePath}`);
    return;
  }
  const evidenceInputDraft = JSON.parse(await readFile(options.evidenceInputPath, "utf8")) as EncounterRuntimeRealismEvidenceInputDraft;
  const scaffold = buildRuntimeEvidenceCaptureScaffold({ evidenceInputDraft });
  await writeFile(options.outputPath, `${JSON.stringify(scaffold, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.outputPath}`);
}

function buildCandidate(input: Omit<
  RuntimeEvidenceCaptureScaffoldCandidate,
  | "reviewerId"
  | "attachmentStatus"
  | "providerExecutionAllowed"
  | "runtimeExecutionAllowed"
  | "learnerLaunchAllowed"
  | "questEvidenceRefreshAllowed"
  | "productionAssetReadinessClaimed"
  | "clinicalValidityClaimed"
  | "scoringValidityClaimed"
  | "claimBoundary"
  | "notEvidenceFor"
>): RuntimeEvidenceCaptureScaffoldCandidate {
  return {
    ...input,
    reviewerId: "runtime_evidence_capture_scaffold",
    attachmentStatus: "attached_metadata_only",
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    claimBoundary: "metadata_only_runtime_evidence_capture_candidate_not_submitted",
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

function stripCandidateMetadata(candidate: RuntimeEvidenceCaptureScaffoldCandidate): RuntimeEvidenceCaptureScaffoldAttachment {
  return {
    actionId: candidate.actionId,
    inputId: candidate.inputId,
    inputKind: candidate.inputKind,
    evidenceRef: candidate.evidenceRef,
    localArtifactPath: candidate.localArtifactPath,
    reviewerId: candidate.reviewerId,
    attachmentStatus: candidate.attachmentStatus,
    comments: candidate.comments,
    attachedAt: candidate.attachedAt,
  };
}

function validateCandidates(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((entry, index) => {
    const entryPath = `/attachmentCandidates/${index}`;
    if (!isRecord(entry)) {
      errors.push(`${entryPath} must be object`);
      return;
    }
    validateAttachment(entry, entryPath, errors);
    requireString(entry.sourceEvidenceRef, `${entryPath}/sourceEvidenceRef`, errors);
    for (const key of [
      "providerExecutionAllowed",
      "runtimeExecutionAllowed",
      "learnerLaunchAllowed",
      "questEvidenceRefreshAllowed",
      "productionAssetReadinessClaimed",
      "clinicalValidityClaimed",
      "scoringValidityClaimed",
    ]) {
      requireLiteral(entry[key], false, `${entryPath}/${key}`, errors);
    }
    requireLiteral(entry.claimBoundary, "metadata_only_runtime_evidence_capture_candidate_not_submitted", `${entryPath}/claimBoundary`, errors);
    requireArray(entry.notEvidenceFor, `${entryPath}/notEvidenceFor`, errors);
  });
}

function validateSubmitInput(value: unknown, scenarioId: unknown, errors: string[]): void {
  requireRecord(value, "/submitRuntimeVisualEvidenceAttachmentInput", errors);
  if (!isRecord(value)) return;
  requireLiteral(value.scenarioId, scenarioId, "/submitRuntimeVisualEvidenceAttachmentInput/scenarioId", errors);
  requireArray(value.attachments, "/submitRuntimeVisualEvidenceAttachmentInput/attachments", errors);
  if (!Array.isArray(value.attachments)) return;
  value.attachments.forEach((entry, index) => {
    validateAttachment(entry, `/submitRuntimeVisualEvidenceAttachmentInput/attachments/${index}`, errors);
  });
}

function validateAttachment(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName} must be object`);
    return;
  }
  if (value.actionId !== "attach_runtime_realism_evidence_refs" && value.actionId !== "attach_visual_qa_evidence_refs") {
    errors.push(`${pathName}/actionId must be a runtime visual evidence attachment action`);
  }
  if (value.inputKind !== "runtime_realism_signal_input" && value.inputKind !== "visual_qa_review_input") {
    errors.push(`${pathName}/inputKind must be runtime_realism_signal_input or visual_qa_review_input`);
  }
  if (value.actionId === "attach_runtime_realism_evidence_refs") requireLiteral(value.inputKind, "runtime_realism_signal_input", `${pathName}/inputKind`, errors);
  if (value.actionId === "attach_visual_qa_evidence_refs") requireLiteral(value.inputKind, "visual_qa_review_input", `${pathName}/inputKind`, errors);
  requireString(value.inputId, `${pathName}/inputId`, errors);
  requireString(value.evidenceRef, `${pathName}/evidenceRef`, errors);
  requireString(value.localArtifactPath, `${pathName}/localArtifactPath`, errors);
  requireLiteral(value.reviewerId, "runtime_evidence_capture_scaffold", `${pathName}/reviewerId`, errors);
  requireLiteral(value.attachmentStatus, "attached_metadata_only", `${pathName}/attachmentStatus`, errors);
  requireString(value.comments, `${pathName}/comments`, errors);
  requireString(value.attachedAt, `${pathName}/attachedAt`, errors);
}

function validateGateBoundary(value: unknown, errors: string[]): void {
  requireRecord(value, "/gateBoundary", errors);
  if (!isRecord(value)) return;
  for (const key of [
    "providerExecutionAllowed",
    "runtimeExecutionAllowed",
    "learnerLaunchAllowed",
    "questEvidenceRefreshAllowed",
    "productionAssetReadinessClaimed",
    "clinicalValidityClaimed",
    "scoringValidityClaimed",
  ]) {
    requireLiteral(value[key], false, `/gateBoundary/${key}`, errors);
  }
  requireLiteral(value.claimBoundary, "runtime_evidence_capture_scaffold_does_not_clear_launch_gates", "/gateBoundary/claimBoundary", errors);
}

function parseCliOptions(args: string[]): { evidenceInputPath: string; outputPath: string; validatePath: string | null } {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  let evidenceInputPath = "docs/openclinxr/encounter-runtime-realism-evidence-input-peds-asthma-parent-anxiety-2026-05-28.json";
  let outputPath = path.join("docs/openclinxr", "encounter-runtime-evidence-capture-scaffold-peds-asthma-parent-anxiety-2026-05-28.json");
  let validatePath: string | null = null;
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    const next = normalizedArgs[index + 1];
    if ((arg === "--evidence-input" || arg === "--input") && next) {
      evidenceInputPath = next;
      index += 1;
    } else if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
    } else if (arg === "--validate" && next) {
      validatePath = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg ?? ""}`);
    }
  }
  return { evidenceInputPath, outputPath, validatePath };
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]+/g, "_");
}

function requireLiteral<T>(value: unknown, expected: T, pathName: string, errors: string[]): void {
  if (value !== expected) errors.push(`${pathName} must be ${JSON.stringify(expected)}`);
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${pathName} must be non-empty string`);
}

function requireNumber(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${pathName} must be finite number`);
}

function requireArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) errors.push(`${pathName} must be array`);
}

function requireRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${pathName} must be object`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
