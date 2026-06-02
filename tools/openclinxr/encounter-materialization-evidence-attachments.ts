import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EncounterMaterializationAttachmentPlan } from "./encounter-materialization-attachment-plan.js";

type AttachmentArtifactKind =
  | "actor_specific_humanoid_glb"
  | "actor_materialization_review_packet"
  | "humanoid_visual_qa_reference"
  | "equipment_specific_glb_or_prefab"
  | "equipment_scale_placement_review_packet"
  | "clinical_affordance_review_packet";

export type MaterializationEvidenceAttachmentInput = {
  attachmentSlotId: string;
  evidenceRef: string;
  artifactKind: AttachmentArtifactKind;
  localArtifactPath: string;
  reviewStatus: "reviewed_metadata_only" | "held_metadata_only";
  provenanceRef: string;
  providerExecutionPerformed: false;
  runtimeReadinessClaimed: false;
  questReadinessClaimed: false;
  productionAssetReadinessClaimed: false;
  claimBoundary: "local_materialization_evidence_ref_not_runtime_readiness";
};

type MaterializationEvidenceAttachmentRecord = {
  attachmentSlotId: string;
  workOrderInputId: string;
  requiredCueId: string;
  requiredEvidenceRef: string;
  expectedArtifactKinds: AttachmentArtifactKind[];
  evidenceAttachmentStatus: "attached_metadata_only" | "missing_evidence" | "held_or_invalid_evidence";
  slotSatisfiedByEvidence: boolean;
  attachedEvidenceRefs: string[];
  localArtifactPaths: string[];
  unsatisfiedReasonIds: string[];
  providerExecutionAllowed: false;
  runtimeSelectionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  claimBoundary: "materialization_evidence_attachment_record_not_runtime_readiness";
};

export type EncounterMaterializationEvidenceAttachmentRecords = {
  schemaVersion: "openclinxr.encounter-materialization-evidence-attachments.v1";
  generatedAt: string;
  source: "encounter_materialization_attachment_plan";
  scenarioId: string | null;
  status: "no_slots_attached" | "partial_slots_attached_runtime_blocked" | "all_slots_attached_pending_review_gate";
  actorAttachmentRecords: Array<MaterializationEvidenceAttachmentRecord & {
    actorId: string;
    actorRole: string;
    variantSemanticKey: string;
  }>;
  equipmentAttachmentRecords: Array<MaterializationEvidenceAttachmentRecord & {
    equipmentId: string;
    variantSemanticKey: string;
  }>;
  attachmentCompleteness: {
    totalRequiredSlotCount: number;
    attachedSlotCount: number;
    missingSlotCount: number;
    heldOrInvalidAttachmentCount: number;
    allRequiredSlotsSatisfied: boolean;
    runtimeSelectionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    claimBoundary: "materialization_evidence_attachment_completeness_not_runtime_readiness";
  };
  blockers: string[];
  recommendedNextActions: string[];
  claimBoundary: "materialization_evidence_attachments_not_provider_or_runtime_execution";
  notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"];
};

const NOT_EVIDENCE_FOR = ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"] as const;

export function buildEncounterMaterializationEvidenceAttachmentRecords(input: {
  attachmentPlan: EncounterMaterializationAttachmentPlan;
  attachments?: MaterializationEvidenceAttachmentInput[];
  generatedAt?: string;
}): EncounterMaterializationEvidenceAttachmentRecords {
  const attachmentsBySlot = groupAttachmentsBySlot(input.attachments ?? []);
  const actorAttachmentRecords = input.attachmentPlan.actorAttachmentSlots.map((slot) => {
    const record = buildSlotRecord({
      slotId: slot.attachmentSlotId,
      workOrderInputId: slot.workOrderInputId,
      requiredCueId: slot.requiredCueId,
      requiredEvidenceRef: slot.requiredEvidenceRef,
      expectedArtifactKinds: [...slot.expectedArtifactKinds],
      attachments: attachmentsBySlot.get(slot.attachmentSlotId) ?? [],
    });
    return {
      ...record,
      actorId: slot.actorId,
      actorRole: slot.actorRole,
      variantSemanticKey: slot.variantSemanticKey,
    };
  });
  const equipmentAttachmentRecords = input.attachmentPlan.equipmentAttachmentSlots.map((slot) => {
    const record = buildSlotRecord({
      slotId: slot.attachmentSlotId,
      workOrderInputId: slot.workOrderInputId,
      requiredCueId: slot.requiredCueId,
      requiredEvidenceRef: slot.requiredEvidenceRef,
      expectedArtifactKinds: [...slot.expectedArtifactKinds],
      attachments: attachmentsBySlot.get(slot.attachmentSlotId) ?? [],
    });
    return {
      ...record,
      equipmentId: slot.equipmentId,
      variantSemanticKey: slot.variantSemanticKey,
    };
  });
  const records = [...actorAttachmentRecords, ...equipmentAttachmentRecords];
  const attachedSlotCount = records.filter((record) => record.slotSatisfiedByEvidence).length;
  const heldOrInvalidAttachmentCount = records.filter((record) => record.evidenceAttachmentStatus === "held_or_invalid_evidence").length;
  const missingSlotCount = records.length - attachedSlotCount;
  const allRequiredSlotsSatisfied = records.length > 0 && attachedSlotCount === records.length;

  return {
    schemaVersion: "openclinxr.encounter-materialization-evidence-attachments.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: "encounter_materialization_attachment_plan",
    scenarioId: input.attachmentPlan.scenarioId,
    status: attachedSlotCount === 0 ? "no_slots_attached" : allRequiredSlotsSatisfied ? "all_slots_attached_pending_review_gate" : "partial_slots_attached_runtime_blocked",
    actorAttachmentRecords,
    equipmentAttachmentRecords,
    attachmentCompleteness: {
      totalRequiredSlotCount: records.length,
      attachedSlotCount,
      missingSlotCount,
      heldOrInvalidAttachmentCount,
      allRequiredSlotsSatisfied,
      runtimeSelectionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "materialization_evidence_attachment_completeness_not_runtime_readiness",
    },
    blockers: uniqueStrings(records.flatMap((record) => record.unsatisfiedReasonIds)),
    recommendedNextActions: uniqueStrings([
      ...input.attachmentPlan.recommendedNextActions,
      "attach reviewed local evidence refs for every actor/equipment materialization slot before runtime-selection blockers can be reconsidered",
      "keep provider/runtime/learner/Quest gates disabled until attachment completeness and downstream review gates pass",
    ]),
    claimBoundary: "materialization_evidence_attachments_not_provider_or_runtime_execution",
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

export function validateEncounterMaterializationEvidenceAttachmentRecords(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.encounter-materialization-evidence-attachments.v1", "/schemaVersion", errors);
  requireLiteral(value.source, "encounter_materialization_attachment_plan", "/source", errors);
  requireArray(value.actorAttachmentRecords, "/actorAttachmentRecords", errors);
  requireArray(value.equipmentAttachmentRecords, "/equipmentAttachmentRecords", errors);
  validateRecords(value.actorAttachmentRecords, "/actorAttachmentRecords", errors);
  validateRecords(value.equipmentAttachmentRecords, "/equipmentAttachmentRecords", errors);
  validateCompleteness(value.attachmentCompleteness, errors);
  requireArray(value.blockers, "/blockers", errors);
  requireArray(value.recommendedNextActions, "/recommendedNextActions", errors);
  requireLiteral(value.claimBoundary, "materialization_evidence_attachments_not_provider_or_runtime_execution", "/claimBoundary", errors);
  requireArray(value.notEvidenceFor, "/notEvidenceFor", errors);
  return { ok: errors.length === 0, errors };
}

async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.validatePath) {
    const validation = validateEncounterMaterializationEvidenceAttachmentRecords(JSON.parse(await readFile(options.validatePath, "utf8")) as unknown);
    if (!validation.ok) {
      process.stderr.write(`Encounter materialization evidence attachment records validation failed:\n${validation.errors.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`Validated ${options.validatePath}`);
    return;
  }
  const attachmentPlan = JSON.parse(await readFile(options.attachmentPlanPath, "utf8")) as EncounterMaterializationAttachmentPlan;
  const attachments = options.attachmentsPath ? (JSON.parse(await readFile(options.attachmentsPath, "utf8")) as MaterializationEvidenceAttachmentInput[]) : [];
  const records = buildEncounterMaterializationEvidenceAttachmentRecords({ attachmentPlan, attachments });
  await writeFile(options.outputPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.outputPath}`);
}

function buildSlotRecord(input: {
  slotId: string;
  workOrderInputId: string;
  requiredCueId: string;
  requiredEvidenceRef: string;
  expectedArtifactKinds: AttachmentArtifactKind[];
  attachments: MaterializationEvidenceAttachmentInput[];
}): MaterializationEvidenceAttachmentRecord {
  const validAttachments = input.attachments.filter((attachment) => isSatisfyingAttachment(input, attachment));
  const attachedEvidenceRefs = uniqueStrings(validAttachments.map((attachment) => attachment.evidenceRef));
  const localArtifactPaths = uniqueStrings(validAttachments.map((attachment) => attachment.localArtifactPath));
  const hasAnyAttachment = input.attachments.length > 0;
  const slotSatisfiedByEvidence = validAttachments.length > 0;
  return {
    attachmentSlotId: input.slotId,
    workOrderInputId: input.workOrderInputId,
    requiredCueId: input.requiredCueId,
    requiredEvidenceRef: input.requiredEvidenceRef,
    expectedArtifactKinds: input.expectedArtifactKinds,
    evidenceAttachmentStatus: slotSatisfiedByEvidence ? "attached_metadata_only" : hasAnyAttachment ? "held_or_invalid_evidence" : "missing_evidence",
    slotSatisfiedByEvidence,
    attachedEvidenceRefs,
    localArtifactPaths,
    unsatisfiedReasonIds: slotSatisfiedByEvidence ? [] : [`materialization_evidence_attachment_missing:${input.slotId}`],
    providerExecutionAllowed: false,
    runtimeSelectionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    claimBoundary: "materialization_evidence_attachment_record_not_runtime_readiness",
  };
}

function isSatisfyingAttachment(
  slot: { requiredEvidenceRef: string; expectedArtifactKinds: AttachmentArtifactKind[] },
  attachment: MaterializationEvidenceAttachmentInput,
): boolean {
  return (
    attachment.evidenceRef === slot.requiredEvidenceRef &&
    slot.expectedArtifactKinds.includes(attachment.artifactKind) &&
    attachment.reviewStatus === "reviewed_metadata_only" &&
    isLocalEvidencePath(attachment.localArtifactPath) &&
    attachment.providerExecutionPerformed === false &&
    attachment.runtimeReadinessClaimed === false &&
    attachment.questReadinessClaimed === false &&
    attachment.productionAssetReadinessClaimed === false &&
    attachment.claimBoundary === "local_materialization_evidence_ref_not_runtime_readiness"
  );
}

function isLocalEvidencePath(value: string): boolean {
  return value.startsWith("docs/openclinxr/") || value.startsWith(".openclinxr/");
}

function validateRecords(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((record, index) => {
    const recordPath = `${pathName}/${index}`;
    if (!isRecord(record)) {
      errors.push(`${recordPath} must be object`);
      return;
    }
    requireString(record.attachmentSlotId, `${recordPath}/attachmentSlotId`, errors);
    requireString(record.workOrderInputId, `${recordPath}/workOrderInputId`, errors);
    requireString(record.requiredCueId, `${recordPath}/requiredCueId`, errors);
    requireString(record.requiredEvidenceRef, `${recordPath}/requiredEvidenceRef`, errors);
    requireArray(record.expectedArtifactKinds, `${recordPath}/expectedArtifactKinds`, errors);
    requireArray(record.attachedEvidenceRefs, `${recordPath}/attachedEvidenceRefs`, errors);
    requireArray(record.localArtifactPaths, `${recordPath}/localArtifactPaths`, errors);
    requireArray(record.unsatisfiedReasonIds, `${recordPath}/unsatisfiedReasonIds`, errors);
    requireLiteral(record.providerExecutionAllowed, false, `${recordPath}/providerExecutionAllowed`, errors);
    requireLiteral(record.runtimeSelectionAllowed, false, `${recordPath}/runtimeSelectionAllowed`, errors);
    requireLiteral(record.learnerLaunchAllowed, false, `${recordPath}/learnerLaunchAllowed`, errors);
    requireLiteral(record.questEvidenceRefreshAllowed, false, `${recordPath}/questEvidenceRefreshAllowed`, errors);
    requireLiteral(record.claimBoundary, "materialization_evidence_attachment_record_not_runtime_readiness", `${recordPath}/claimBoundary`, errors);
  });
}

function validateCompleteness(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("/attachmentCompleteness must be object");
    return;
  }
  for (const key of ["runtimeSelectionAllowed", "learnerLaunchAllowed", "questEvidenceRefreshAllowed"]) {
    requireLiteral(value[key], false, `/attachmentCompleteness/${key}`, errors);
  }
  requireLiteral(value.claimBoundary, "materialization_evidence_attachment_completeness_not_runtime_readiness", "/attachmentCompleteness/claimBoundary", errors);
}

function parseCliOptions(args: string[]): { attachmentPlanPath: string; attachmentsPath: string | null; outputPath: string; validatePath: string | null } {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  let attachmentPlanPath = "docs/openclinxr/encounter-materialization-attachment-plan-peds-asthma-parent-anxiety-2026-05-28.json";
  let attachmentsPath: string | null = null;
  let outputPath = path.join("docs/openclinxr", `encounter-materialization-evidence-attachments-${new Date().toISOString().slice(0, 10)}.json`);
  let validatePath: string | null = null;
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    const next = normalizedArgs[index + 1];
    if (arg === "--attachment-plan" && next) {
      attachmentPlanPath = next;
      index += 1;
    } else if (arg === "--attachments" && next) {
      attachmentsPath = next;
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
  return { attachmentPlanPath, attachmentsPath, outputPath, validatePath };
}

function groupAttachmentsBySlot(attachments: MaterializationEvidenceAttachmentInput[]): Map<string, MaterializationEvidenceAttachmentInput[]> {
  const grouped = new Map<string, MaterializationEvidenceAttachmentInput[]>();
  for (const attachment of attachments) {
    const existing = grouped.get(attachment.attachmentSlotId) ?? [];
    existing.push(attachment);
    grouped.set(attachment.attachmentSlotId, existing);
  }
  return grouped;
}

function requireLiteral<T>(value: unknown, expected: T, pathName: string, errors: string[]): void {
  if (value !== expected) errors.push(`${pathName} must be ${JSON.stringify(expected)}`);
}

function requireArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) errors.push(`${pathName} must be array`);
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${pathName} must be non-empty string`);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
