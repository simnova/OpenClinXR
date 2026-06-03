import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EncounterMaterializationInputManifest } from "./encounter-materialization-input-manifest.js";

export type EncounterMaterializationAttachmentPlan = {
  schemaVersion: "openclinxr.encounter-materialization-attachment-plan.v1";
  generatedAt: string;
  source: "encounter_materialization_input_manifest";
  scenarioId: string | null;
  status: "attachment_slots_created_not_evidence_attached";
  attachableToRuntimeSelection: false;
  actorAttachmentSlots: Array<{
    attachmentSlotId: string;
    workOrderInputId: string;
    actorId: string;
    actorRole: string;
    variantSemanticKey: string;
    requiredCueId: string;
    requiredEvidenceRef: string;
    expectedArtifactKinds: Array<"actor_specific_humanoid_glb" | "actor_materialization_review_packet" | "humanoid_visual_qa_reference">;
    attachmentStatus: "missing_evidence";
    providerExecutionAllowed: false;
    runtimeSelectionAllowed: false;
    claimBoundary: "materialization_attachment_slot_not_runtime_readiness";
  }>;
  equipmentAttachmentSlots: Array<{
    attachmentSlotId: string;
    workOrderInputId: string;
    equipmentId: string;
    variantSemanticKey: string;
    requiredCueId: string;
    requiredEvidenceRef: string;
    expectedArtifactKinds: Array<"equipment_specific_glb_or_prefab" | "equipment_scale_placement_review_packet" | "clinical_affordance_review_packet">;
    attachmentStatus: "missing_evidence";
    providerExecutionAllowed: false;
    runtimeSelectionAllowed: false;
    claimBoundary: "materialization_attachment_slot_not_runtime_readiness";
  }>;
  attachmentBoundary: {
    providerExecutionPerformed: false;
    paidApisUsed: false;
    externalNetworkUsed: false;
    runtimeSelectionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    claimBoundary: "materialization_attachment_plan_metadata_only";
  };
  blockers: string[];
  recommendedNextActions: string[];
  claimBoundary: "materialization_attachment_plan_not_provider_or_runtime_execution";
  notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"];
};

const NOT_EVIDENCE_FOR = ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"] as const;

export function buildEncounterMaterializationAttachmentPlan(input: {
  inputManifest: EncounterMaterializationInputManifest;
  generatedAt?: string;
}): EncounterMaterializationAttachmentPlan {
  const actorAttachmentSlots = input.inputManifest.actorWorkOrderInputs.flatMap((workOrderInput) =>
    workOrderInput.requiredEvidenceRefs.map((requiredEvidenceRef, index) => {
      const requiredCueId = workOrderInput.requiredCueIds[index] ?? lastPathSegment(requiredEvidenceRef);
      return {
        attachmentSlotId: `actor-materialization-attachment:${workOrderInput.actorId}:${requiredCueId}`,
        workOrderInputId: workOrderInput.workOrderInputId,
        actorId: workOrderInput.actorId,
        actorRole: workOrderInput.actorRole,
        variantSemanticKey: workOrderInput.variantSemanticKey,
        requiredCueId,
        requiredEvidenceRef,
        expectedArtifactKinds: ["actor_specific_humanoid_glb", "actor_materialization_review_packet", "humanoid_visual_qa_reference"] as const,
        attachmentStatus: "missing_evidence" as const,
        providerExecutionAllowed: false as const,
        runtimeSelectionAllowed: false as const,
        claimBoundary: "materialization_attachment_slot_not_runtime_readiness" as const,
      };
    })
  );
  const equipmentAttachmentSlots = input.inputManifest.equipmentWorkOrderInputs.flatMap((workOrderInput) =>
    workOrderInput.requiredEvidenceRefs.map((requiredEvidenceRef, index) => {
      const requiredCueId = workOrderInput.requiredCueIds[index] ?? lastPathSegment(requiredEvidenceRef);
      return {
        attachmentSlotId: `equipment-materialization-attachment:${workOrderInput.equipmentId}:${requiredCueId}`,
        workOrderInputId: workOrderInput.workOrderInputId,
        equipmentId: workOrderInput.equipmentId,
        variantSemanticKey: workOrderInput.variantSemanticKey,
        requiredCueId,
        requiredEvidenceRef,
        expectedArtifactKinds: ["equipment_specific_glb_or_prefab", "equipment_scale_placement_review_packet", "clinical_affordance_review_packet"] as const,
        attachmentStatus: "missing_evidence" as const,
        providerExecutionAllowed: false as const,
        runtimeSelectionAllowed: false as const,
        claimBoundary: "materialization_attachment_slot_not_runtime_readiness" as const,
      };
    })
  );

  return {
    schemaVersion: "openclinxr.encounter-materialization-attachment-plan.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: "encounter_materialization_input_manifest",
    scenarioId: input.inputManifest.scenarioId,
    status: "attachment_slots_created_not_evidence_attached",
    attachableToRuntimeSelection: false,
    actorAttachmentSlots,
    equipmentAttachmentSlots,
    attachmentBoundary: {
      providerExecutionPerformed: false,
      paidApisUsed: false,
      externalNetworkUsed: false,
      runtimeSelectionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "materialization_attachment_plan_metadata_only",
    },
    blockers: uniqueStrings([
      ...input.inputManifest.blockers,
      ...actorAttachmentSlots.map((slot) => `actor_materialization_attachment_missing:${slot.actorId}:${slot.requiredCueId}`),
      ...equipmentAttachmentSlots.map((slot) => `equipment_materialization_attachment_missing:${slot.equipmentId}:${slot.requiredCueId}`),
    ]),
    recommendedNextActions: uniqueStrings([
      ...input.inputManifest.recommendedNextActions,
      "attach actor-specific humanoid GLB plus review/visual-QA evidence to every actor materialization slot before runtime selection can clear",
      "attach equipment-specific GLB or prefab plus scale/placement/affordance evidence to every equipment materialization slot before runtime selection can clear",
    ]),
    claimBoundary: "materialization_attachment_plan_not_provider_or_runtime_execution",
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

export function validateEncounterMaterializationAttachmentPlan(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.encounter-materialization-attachment-plan.v1", "/schemaVersion", errors);
  requireLiteral(value.source, "encounter_materialization_input_manifest", "/source", errors);
  requireLiteral(value.status, "attachment_slots_created_not_evidence_attached", "/status", errors);
  requireLiteral(value.attachableToRuntimeSelection, false, "/attachableToRuntimeSelection", errors);
  requireArray(value.actorAttachmentSlots, "/actorAttachmentSlots", errors);
  requireArray(value.equipmentAttachmentSlots, "/equipmentAttachmentSlots", errors);
  validateAttachmentSlots(value.actorAttachmentSlots, "/actorAttachmentSlots", errors);
  validateAttachmentSlots(value.equipmentAttachmentSlots, "/equipmentAttachmentSlots", errors);
  validateAttachmentBoundary(value.attachmentBoundary, errors);
  requireArray(value.blockers, "/blockers", errors);
  requireArray(value.recommendedNextActions, "/recommendedNextActions", errors);
  requireLiteral(value.claimBoundary, "materialization_attachment_plan_not_provider_or_runtime_execution", "/claimBoundary", errors);
  requireArray(value.notEvidenceFor, "/notEvidenceFor", errors);
  return { ok: errors.length === 0, errors };
}

async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.validatePath) {
    const validation = validateEncounterMaterializationAttachmentPlan(JSON.parse(await readFile(options.validatePath, "utf8")) as unknown);
    if (!validation.ok) {
      process.stderr.write(`Encounter materialization attachment plan validation failed:\n${validation.errors.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`Validated ${options.validatePath}`);
    return;
  }
  const inputManifest = JSON.parse(await readFile(options.inputManifestPath, "utf8")) as EncounterMaterializationInputManifest;
  const attachmentPlan = buildEncounterMaterializationAttachmentPlan({ inputManifest });
  await writeFile(options.outputPath, `${JSON.stringify(attachmentPlan, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.outputPath}`);
}

function validateAttachmentBoundary(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("/attachmentBoundary must be object");
    return;
  }
  for (const key of ["providerExecutionPerformed", "paidApisUsed", "externalNetworkUsed", "runtimeSelectionAllowed", "learnerLaunchAllowed", "questEvidenceRefreshAllowed"]) {
    requireLiteral(value[key], false, `/attachmentBoundary/${key}`, errors);
  }
  requireLiteral(value.claimBoundary, "materialization_attachment_plan_metadata_only", "/attachmentBoundary/claimBoundary", errors);
}

function validateAttachmentSlots(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((slot, index) => {
    const slotPath = `${pathName}/${index}`;
    if (!isRecord(slot)) {
      errors.push(`${slotPath} must be object`);
      return;
    }
    requireString(slot.attachmentSlotId, `${slotPath}/attachmentSlotId`, errors);
    requireString(slot.workOrderInputId, `${slotPath}/workOrderInputId`, errors);
    requireString(slot.variantSemanticKey, `${slotPath}/variantSemanticKey`, errors);
    requireString(slot.requiredCueId, `${slotPath}/requiredCueId`, errors);
    requireString(slot.requiredEvidenceRef, `${slotPath}/requiredEvidenceRef`, errors);
    requireArray(slot.expectedArtifactKinds, `${slotPath}/expectedArtifactKinds`, errors);
    requireLiteral(slot.attachmentStatus, "missing_evidence", `${slotPath}/attachmentStatus`, errors);
    requireLiteral(slot.providerExecutionAllowed, false, `${slotPath}/providerExecutionAllowed`, errors);
    requireLiteral(slot.runtimeSelectionAllowed, false, `${slotPath}/runtimeSelectionAllowed`, errors);
    requireLiteral(slot.claimBoundary, "materialization_attachment_slot_not_runtime_readiness", `${slotPath}/claimBoundary`, errors);
  });
}

function parseCliOptions(args: string[]): { inputManifestPath: string; outputPath: string; validatePath: string | null } {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  let inputManifestPath = "docs/openclinxr/encounter-materialization-input-manifest-peds-asthma-parent-anxiety-2026-05-28.json";
  let outputPath = path.join("docs/openclinxr", `encounter-materialization-attachment-plan-${new Date().toISOString().slice(0, 10)}.json`);
  let validatePath: string | null = null;
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    const next = normalizedArgs[index + 1];
    if (arg === "--input-manifest" && next) {
      inputManifestPath = next;
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
  return { inputManifestPath, outputPath, validatePath };
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

function lastPathSegment(value: string): string {
  return value.split("/").at(-1) ?? value;
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
