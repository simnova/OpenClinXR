import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EncounterRuntimeSelectionReviewPacket } from "./encounter-runtime-selection-review-packet.js";

export type EncounterRuntimeRealismEvidenceInputDraft = {
  schemaVersion: "openclinxr.encounter-runtime-realism-evidence-input-draft.v1";
  generatedAt: string;
  source: "encounter_runtime_selection_review_packet";
  selectedScenarioId: string;
  selectedEncounterId: string;
  selectedStationId: string;
  selectedRuntimeAssetBundleId: string;
  status: "draft_inputs_required_not_attached";
  runtimeActorEvidenceInputs: Array<{
    inputKind: "runtime_realism_signal_input";
    evidenceInputId: string;
    actorId: string;
    actorRole: string;
    requiredSignalCount: number;
    sourceEvidenceRef: string;
    requiredEvidenceStatus: "required_not_attached";
    reviewerAction: "attach_runtime_realism_evidence_metadata_before_guarded_runtime_selection";
    providerExecutionStatus: "metadata_only_not_executed";
    claimBoundary: "runtime_realism_evidence_input_metadata_only_not_runtime_readiness";
  }>;
  visualQaEvidenceInputs: Array<{
    inputKind: "visual_qa_review_input";
    evidenceInputId: string;
    targetId: string;
    targetKind: string;
    requiredReviewFocus: string[];
    sourceEvidenceRef: string;
    requiredEvidenceStatus: "required_not_attached";
    reviewerAction: "attach_visual_qa_evidence_metadata_before_learner_launch_review";
    providerExecutionStatus: "metadata_only_not_executed";
    claimBoundary: "visual_qa_evidence_input_metadata_only_not_visual_quality_evidence";
  }>;
  gateBoundary: {
    providerExecutionAllowed: false;
    providerExecutionPerformed: false;
    runtimeExecutionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    productionAssetReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
    claimBoundary: "runtime_realism_evidence_inputs_do_not_clear_launch_gates";
  };
  blockers: string[];
  recommendedNextActions: string[];
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
] as const;

export function buildEncounterRuntimeRealismEvidenceInputDraft(input: {
  reviewPacket: EncounterRuntimeSelectionReviewPacket;
  generatedAt?: string;
}): EncounterRuntimeRealismEvidenceInputDraft {
  const draftReview = input.reviewPacket.runtimeRealismEvidenceDraftReview;
  return {
    schemaVersion: "openclinxr.encounter-runtime-realism-evidence-input-draft.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: "encounter_runtime_selection_review_packet",
    selectedScenarioId: input.reviewPacket.selectedScenarioId,
    selectedEncounterId: input.reviewPacket.selectedEncounterId,
    selectedStationId: input.reviewPacket.selectedStationId,
    selectedRuntimeAssetBundleId: input.reviewPacket.selectedRuntimeAssetBundleId,
    status: "draft_inputs_required_not_attached",
    runtimeActorEvidenceInputs: draftReview.runtimeHookDrafts.map((draft) => ({
      evidenceInputId: `runtime-realism-evidence-input:${draft.actorId}`,
      inputKind: "runtime_realism_signal_input",
      actorId: draft.actorId,
      actorRole: draft.actorRole,
      requiredSignalCount: draft.requiredSignalCount,
      sourceEvidenceRef: draft.evidenceRef,
      requiredEvidenceStatus: "required_not_attached",
      reviewerAction: "attach_runtime_realism_evidence_metadata_before_guarded_runtime_selection",
      providerExecutionStatus: "metadata_only_not_executed",
      claimBoundary: "runtime_realism_evidence_input_metadata_only_not_runtime_readiness",
    })),
    visualQaEvidenceInputs: draftReview.visualQaHookDrafts.map((draft) => ({
      evidenceInputId: `visual-qa-evidence-input:${draft.targetId}`,
      inputKind: "visual_qa_review_input",
      targetId: draft.targetId,
      targetKind: draft.targetKind,
      requiredReviewFocus: [...draft.requiredReviewFocus],
      sourceEvidenceRef: draft.evidenceRef,
      requiredEvidenceStatus: "required_not_attached",
      reviewerAction: "attach_visual_qa_evidence_metadata_before_learner_launch_review",
      providerExecutionStatus: "metadata_only_not_executed",
      claimBoundary: "visual_qa_evidence_input_metadata_only_not_visual_quality_evidence",
    })),
    gateBoundary: {
      providerExecutionAllowed: false,
      providerExecutionPerformed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      claimBoundary: "runtime_realism_evidence_inputs_do_not_clear_launch_gates",
    },
    blockers: uniqueStrings([
      ...draftReview.blockerIds,
      ...(draftReview.runtimeHookDrafts.length > 0 ? ["runtime_realism_evidence_inputs_not_attached"] : ["runtime_realism_evidence_inputs_unavailable"]),
      ...(draftReview.visualQaHookDrafts.length > 0 ? ["visual_qa_evidence_inputs_not_attached"] : ["visual_qa_evidence_inputs_unavailable"]),
    ]),
    recommendedNextActions: uniqueStrings([
      ...draftReview.recommendedNextActions,
      "attach reviewer-supplied runtime realism evidence metadata for each actor before guarded runtime selection is reconsidered",
      "attach reviewer-supplied visual QA evidence metadata for each actor/equipment target before learner launch review is reconsidered",
    ]),
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

export function validateEncounterRuntimeRealismEvidenceInputDraft(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.encounter-runtime-realism-evidence-input-draft.v1", "/schemaVersion", errors);
  requireLiteral(value.source, "encounter_runtime_selection_review_packet", "/source", errors);
  requireLiteral(value.status, "draft_inputs_required_not_attached", "/status", errors);
  requireArray(value.runtimeActorEvidenceInputs, "/runtimeActorEvidenceInputs", errors);
  requireArray(value.visualQaEvidenceInputs, "/visualQaEvidenceInputs", errors);
  validateRuntimeActorInputs(value.runtimeActorEvidenceInputs, errors);
  validateVisualQaInputs(value.visualQaEvidenceInputs, errors);
  validateGateBoundary(value.gateBoundary, errors);
  requireArray(value.blockers, "/blockers", errors);
  requireArray(value.recommendedNextActions, "/recommendedNextActions", errors);
  requireArray(value.notEvidenceFor, "/notEvidenceFor", errors);
  for (const claim of NOT_EVIDENCE_FOR) {
    if (Array.isArray(value.notEvidenceFor) && !value.notEvidenceFor.includes(claim)) errors.push(`/notEvidenceFor must include ${claim}`);
  }
  return { ok: errors.length === 0, errors };
}

async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.validatePath) {
    const validation = validateEncounterRuntimeRealismEvidenceInputDraft(JSON.parse(await readFile(options.validatePath, "utf8")) as unknown);
    if (!validation.ok) {
      process.stderr.write(`Encounter runtime realism evidence input draft validation failed:\n${validation.errors.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`Validated ${options.validatePath}`);
    return;
  }
  const reviewPacket = JSON.parse(await readFile(options.reviewPacketPath, "utf8")) as EncounterRuntimeSelectionReviewPacket;
  const draft = buildEncounterRuntimeRealismEvidenceInputDraft({ reviewPacket });
  await writeFile(options.outputPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.outputPath}`);
}

function validateGateBoundary(value: unknown, errors: string[]): void {
  requireRecord(value, "/gateBoundary", errors);
  if (!isRecord(value)) return;
  for (const key of [
    "providerExecutionPerformed",
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
  requireLiteral(value.claimBoundary, "runtime_realism_evidence_inputs_do_not_clear_launch_gates", "/gateBoundary/claimBoundary", errors);
}

function validateRuntimeActorInputs(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((entry, index) => {
    const entryPath = `/runtimeActorEvidenceInputs/${index}`;
    if (!isRecord(entry)) {
      errors.push(`${entryPath} must be object`);
      return;
    }
    requireString(entry.evidenceInputId, `${entryPath}/evidenceInputId`, errors);
    requireLiteral(entry.inputKind, "runtime_realism_signal_input", `${entryPath}/inputKind`, errors);
    requireString(entry.actorId, `${entryPath}/actorId`, errors);
    requireString(entry.actorRole, `${entryPath}/actorRole`, errors);
    requireNumber(entry.requiredSignalCount, `${entryPath}/requiredSignalCount`, errors);
    requireString(entry.sourceEvidenceRef, `${entryPath}/sourceEvidenceRef`, errors);
    requireLiteral(entry.requiredEvidenceStatus, "required_not_attached", `${entryPath}/requiredEvidenceStatus`, errors);
    requireLiteral(entry.reviewerAction, "attach_runtime_realism_evidence_metadata_before_guarded_runtime_selection", `${entryPath}/reviewerAction`, errors);
    requireLiteral(entry.providerExecutionStatus, "metadata_only_not_executed", `${entryPath}/providerExecutionStatus`, errors);
    requireLiteral(entry.claimBoundary, "runtime_realism_evidence_input_metadata_only_not_runtime_readiness", `${entryPath}/claimBoundary`, errors);
  });
}

function validateVisualQaInputs(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((entry, index) => {
    const entryPath = `/visualQaEvidenceInputs/${index}`;
    if (!isRecord(entry)) {
      errors.push(`${entryPath} must be object`);
      return;
    }
    requireString(entry.evidenceInputId, `${entryPath}/evidenceInputId`, errors);
    requireLiteral(entry.inputKind, "visual_qa_review_input", `${entryPath}/inputKind`, errors);
    requireString(entry.targetId, `${entryPath}/targetId`, errors);
    requireString(entry.targetKind, `${entryPath}/targetKind`, errors);
    requireArray(entry.requiredReviewFocus, `${entryPath}/requiredReviewFocus`, errors);
    requireString(entry.sourceEvidenceRef, `${entryPath}/sourceEvidenceRef`, errors);
    requireLiteral(entry.requiredEvidenceStatus, "required_not_attached", `${entryPath}/requiredEvidenceStatus`, errors);
    requireLiteral(entry.reviewerAction, "attach_visual_qa_evidence_metadata_before_learner_launch_review", `${entryPath}/reviewerAction`, errors);
    requireLiteral(entry.providerExecutionStatus, "metadata_only_not_executed", `${entryPath}/providerExecutionStatus`, errors);
    requireLiteral(entry.claimBoundary, "visual_qa_evidence_input_metadata_only_not_visual_quality_evidence", `${entryPath}/claimBoundary`, errors);
  });
}

function parseCliOptions(args: string[]): { reviewPacketPath: string; outputPath: string; validatePath: string | null } {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  let reviewPacketPath = "docs/openclinxr/encounter-runtime-selection-review-packet-peds-asthma-parent-anxiety-2026-05-28.json";
  let outputPath = path.join("docs/openclinxr", `encounter-runtime-realism-evidence-input-draft-${new Date().toISOString().slice(0, 10)}.json`);
  let validatePath: string | null = null;
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    const next = normalizedArgs[index + 1];
    if (arg === "--review-packet" && next) {
      reviewPacketPath = next;
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
  return { reviewPacketPath, outputPath, validatePath };
}

function requireLiteral<T>(value: unknown, expected: T, pathName: string, errors: string[]): void {
  if (value !== expected) errors.push(`${pathName} must be ${JSON.stringify(expected)}`);
}

function requireRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${pathName} must be object`);
}

function requireArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) errors.push(`${pathName} must be array`);
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${pathName} must be non-empty string`);
}

function requireNumber(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${pathName} must be number`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
