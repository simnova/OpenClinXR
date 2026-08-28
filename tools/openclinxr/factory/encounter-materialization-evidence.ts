import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GeneratedEdStationRuntimeBundleReport } from "./generated-ed-station-runtime-bundle.js";

/** Phase 0 World Compile Graph nodes. Actor+equipment only — no room/garment/physics families. */
export const COMPILE_NODE_FAMILIES = ["ActorVariant", "EquipVariant"] as const;
export type CompileNodeFamily = (typeof COMPILE_NODE_FAMILIES)[number];

/**
 * WCG-4 (world-compile-graph-brief-2026-08-27.md Phase 4): baker split at the
 * OBJ/Blender boundary. Phase 0 emitter keeps `unsplit_character`; callers that
 * want lock-granularity per stage map each ActorVariant node through
 * `splitCharacterBakers()` to get `body_character` + `wardrobe_character`.
 */
export const CHARACTER_BAKER_IDS = ["unsplit_character", "unsplit_equipment", "body_character", "wardrobe_character"] as const;
export type CharacterBakerId = (typeof CHARACTER_BAKER_IDS)[number];

export type CompileGraphLock = {
  locked: boolean;
  lockKind?: string;
  lockedAt?: string;
  lockedCacheKey?: string | null;
  lockedContentHash?: string | null;
};

export type CompileGraphNode = {
  nodeId: string;
  family: CompileNodeFamily;
  bakerId: CharacterBakerId;
  spec: {
    scenarioId: string | null;
    actorId?: string;
    equipmentId?: string;
    variantSemanticKey: string;
    sourceBlobName: string;
  };
  parents: string[];
  cacheKey: string | null;
  contentHash: string | null;
  lock: CompileGraphLock;
  status: "planned_unsplit" | "planned_split";
  overridePatch?: { op: "replace" | "remove"; path: string; value?: unknown };
};

export type EncounterMaterializationEvidenceReport = {
  schemaVersion: "openclinxr.encounter-materialization-evidence.v1";
  generatedAt: string;
  source: "generated_station_runtime_bundle_materialization_contracts";
  scenarioId: string | null;
  status: "blocked_missing_actor_or_equipment_specific_evidence" | "attachable";
  attachableToRuntimeSelection: boolean;
  actorEvidence: Array<{
    actorId: string;
    actorRole: string;
    variantSemanticKey: string;
    sourceBlobName: string;
    requiredEvidenceRefs: string[];
    blockers: string[];
  }>;
  equipmentEvidence: Array<{
    equipmentId: string;
    variantSemanticKey: string;
    sourceBlobName: string;
    requiredEvidenceRefs: string[];
    blockers: string[];
  }>;
  blockers: string[];
  recommendedNextActions: string[];
  claimBoundary: "materialization_evidence_attachment_contract_not_runtime_readiness";
  notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"];
  /** Phase 1 WCG — optional. Absent on 2026-05-28 dated JSON. */
  caseDefVersion?: number;
  compileVersion?: number;
  compileEdges?: Array<{ from: string; to: string; kind: string }>;
  compileNodes?: CompileGraphNode[];
};

const NOT_EVIDENCE_FOR = ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"] as const;

/**
 * Emit unsplit compile nodes from current evidence.v1 rows.
 * Copies prior lock/contentHash by nodeId. Invents no room/garment/physics nodes.
 */
export function emitCompileNodes(
  report: EncounterMaterializationEvidenceReport,
  prior: CompileGraphNode[] = [],
): CompileGraphNode[] {
  const priorById = new Map(prior.map((n) => [n.nodeId, n]));
  const scenarioId = report.scenarioId;
  const actorNodes: CompileGraphNode[] = report.actorEvidence.map((row) => {
    const nodeId = `actor:${row.actorId}`;
    const prev = priorById.get(nodeId);
    return {
      nodeId,
      family: "ActorVariant",
      bakerId: "unsplit_character",
      spec: {
        scenarioId,
        actorId: row.actorId,
        variantSemanticKey: row.variantSemanticKey,
        sourceBlobName: row.sourceBlobName,
      },
      parents: [],
      cacheKey: null,
      contentHash: prev?.contentHash ?? null,
      lock: prev?.lock ?? { locked: false },
      status: "planned_unsplit",
    };
  });
  const equipNodes: CompileGraphNode[] = report.equipmentEvidence.map((row) => {
    const nodeId = `equip:${row.equipmentId}`;
    const prev = priorById.get(nodeId);
    return {
      nodeId,
      family: "EquipVariant",
      bakerId: "unsplit_equipment",
      spec: {
        scenarioId,
        equipmentId: row.equipmentId,
        variantSemanticKey: row.variantSemanticKey,
        sourceBlobName: row.sourceBlobName,
      },
      parents: [],
      cacheKey: null,
      contentHash: prev?.contentHash ?? null,
      lock: prev?.lock ?? { locked: false },
      status: "planned_unsplit",
    };
  });
  return [...actorNodes, ...equipNodes];
}

/**
 * WCG-4 Phase 4: split ONE unsplit ActorVariant node into body + wardrobe bakers
 * so a faculty lock can skip a single stage's rebake (a lock on an unsplit node
 * still recooks the whole character — the defect Phase 4 removes).
 *
 * - body node     -> `body_character` baker: generate_mesh / BodyAnnyRef
 * - wardrobe node -> `wardrobe_character` baker: automate_blender / BlenderDress
 *                    on the body output (parents = [body node])
 *
 * emitCompileNodes stays unsplit (Phase 0). Both children inherit the source
 * node's lock / contentHash / overridePatch (the WCG-0 copy-prior rule); a
 * caller that wants to lock only the wardrobe sets that child's lock.
 * Throws when handed an EquipVariant or already-split node — a split is never a
 * no-op, so a one-node DAG over requestedStages cannot be produced by mistake.
 */
export function splitCharacterBakers(node: CompileGraphNode): [CompileGraphNode, CompileGraphNode] {
  if (node.family !== "ActorVariant" || node.bakerId !== "unsplit_character") {
    throw new Error(
      `splitCharacterBakers expects an unsplit ActorVariant node (got family=${node.family} bakerId=${node.bakerId}); ` +
      "equipment and already-split nodes are not splittable",
    );
  }
  const actorId = node.spec.actorId ?? "actor";
  const bodyNode: CompileGraphNode = {
    ...node,
    nodeId: `actor:${actorId}:body`,
    bakerId: "body_character",
    parents: [],
    status: "planned_split",
  };
  const wardrobeNode: CompileGraphNode = {
    ...node,
    nodeId: `actor:${actorId}:wardrobe`,
    bakerId: "wardrobe_character",
    parents: [bodyNode.nodeId],
    status: "planned_split",
  };
  return [bodyNode, wardrobeNode];
}

export type WardrobeBakeDecision = {
  bake: boolean;
  stale: boolean;
  reason: "first_bake" | "cache_hit" | "body_changed" | "locked_skip" | "locked_stale";
};

/**
 * WCG-4 Phase 4 control/treatment: does the wardrobe (BlenderDress) baker have to
 * run for one actor? Mirrors the WCG brief Q3 compile rule restricted to the
 * wardrobe stage:
 *   locked + baked + body unchanged -> locked_skip (NEVER rebake a locked node)
 *   locked + baked + body changed   -> locked_stale (skip bake; faculty relocks)
 *   unlocked + baked + body changed -> body_changed (rebake)
 *   unlocked + baked + body same    -> cache_hit
 *   not baked at all                -> first_bake
 *
 * `bodyHashAtWardrobeBake` is the body output hash (artifact hash from the body
 * node's contentHash) the wardrobe was last baked against; `bodyHashNow` is the
 * current body output hash. null/unknown body hash counts as changed (WCG brief
 * dirty rule: "unknown edge = dirty").
 */
export function planWardrobeBake(
  wardrobe: CompileGraphNode,
  bodyHashAtWardrobeBake: string | null,
  bodyHashNow: string,
): WardrobeBakeDecision {
  const baked = wardrobe.contentHash !== null;
  if (!baked) {
    return { bake: true, reason: "first_bake", stale: false };
  }
  const bodyChanged = bodyHashAtWardrobeBake !== bodyHashNow;
  if (wardrobe.lock.locked) {
    if (bodyChanged) return { bake: false, reason: "locked_stale", stale: true };
    return { bake: false, reason: "locked_skip", stale: false };
  }
  if (bodyChanged) return { bake: true, reason: "body_changed", stale: false };
  return { bake: false, reason: "cache_hit", stale: false };
}

export function buildEncounterMaterializationEvidenceReport(input: {
  bundleReport: GeneratedEdStationRuntimeBundleReport;
  generatedAt?: string;
}): EncounterMaterializationEvidenceReport {
  const actorContract = input.bundleReport.actorHumanoidMaterializationContract;
  const equipmentContract = input.bundleReport.equipmentMaterializationContract;
  const actorEvidence = (actorContract?.actorVariants ?? []).map((variant) => {
    const blockers = [
      ...(actorContract?.sharedNeutralMeshReuseActorIds.includes(variant.actorId) ? ["shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness"] : []),
      ...variant.requiredMaterializationCueIds.map((cueId) => `actor_materialization_evidence_missing:${variant.actorId}:${cueId}`),
    ];
    return {
      actorId: variant.actorId,
      actorRole: variant.actorRole,
      variantSemanticKey: variant.variantSemanticKey,
      sourceBlobName: variant.sourceBlobName,
      requiredEvidenceRefs: variant.requiredMaterializationCueIds.map((cueId) => `actor-materialization-evidence://${variant.variantSemanticKey}/${cueId}`),
      blockers,
    };
  });
  const equipmentEvidence = (equipmentContract?.equipmentVariants ?? []).map((variant) => {
    const blockers = [
      ...(equipmentContract?.genericEquipmentReuseDetected ? ["generic_equipment_reuse_blocks_equipment_specific_asset_readiness"] : []),
      ...variant.requiredEvidenceRefs.map((refId) => `equipment_materialization_evidence_missing:${variant.equipmentId}:${refId}`),
    ];
    return {
      equipmentId: variant.equipmentId,
      variantSemanticKey: variant.variantSemanticKey,
      sourceBlobName: variant.sourceBlobName,
      requiredEvidenceRefs: variant.requiredEvidenceRefs.map((refId) => `equipment-materialization-evidence://${variant.variantSemanticKey}/${refId}`),
      blockers,
    };
  });
  const blockers = uniqueStrings([
    ...(actorContract ? [] : ["actor_humanoid_materialization_contract_not_attached"]),
    ...(equipmentContract ? [] : ["equipment_materialization_contract_not_attached"]),
    ...(actorContract?.materializationBlockers ?? []),
    ...(equipmentContract?.materializationBlockers ?? []),
    ...actorEvidence.flatMap((entry) => entry.blockers),
    ...equipmentEvidence.flatMap((entry) => entry.blockers),
  ]);
  return {
    schemaVersion: "openclinxr.encounter-materialization-evidence.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: "generated_station_runtime_bundle_materialization_contracts",
    scenarioId: actorContract?.scenarioId ?? equipmentContract?.scenarioId ?? input.bundleReport.learnerBundle?.scenarioId ?? null,
    status: blockers.length === 0 ? "attachable" : "blocked_missing_actor_or_equipment_specific_evidence",
    attachableToRuntimeSelection: blockers.length === 0,
    actorEvidence,
    equipmentEvidence,
    blockers,
    recommendedNextActions: uniqueStrings([
      actorContract?.recommendedNextAction,
      equipmentContract?.recommendedNextAction,
      "attach this report to publication/local-launch/runtime-selection only after every actor and equipment evidence ref resolves",
    ].filter((action): action is string => Boolean(action))),
    claimBoundary: "materialization_evidence_attachment_contract_not_runtime_readiness",
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

export function validateEncounterMaterializationEvidenceReport(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be an object"] };
  }
  if (value.schemaVersion !== "openclinxr.encounter-materialization-evidence.v1") errors.push("/schemaVersion invalid");
  if (value.source !== "generated_station_runtime_bundle_materialization_contracts") errors.push("/source invalid");
  if (value.claimBoundary !== "materialization_evidence_attachment_contract_not_runtime_readiness") errors.push("/claimBoundary invalid");
  if (typeof value.attachableToRuntimeSelection !== "boolean") errors.push("/attachableToRuntimeSelection must be boolean");
  if (!Array.isArray(value.actorEvidence)) errors.push("/actorEvidence must be an array");
  if (!Array.isArray(value.equipmentEvidence)) errors.push("/equipmentEvidence must be an array");
  if (!Array.isArray(value.blockers)) errors.push("/blockers must be an array");
  if (value.status === "attachable" && value.attachableToRuntimeSelection !== true) errors.push("/attachable status requires attachableToRuntimeSelection true");
  if (value.status === "blocked_missing_actor_or_equipment_specific_evidence" && value.attachableToRuntimeSelection !== false) errors.push("/blocked status requires attachableToRuntimeSelection false");
  if (value.caseDefVersion !== undefined && typeof value.caseDefVersion !== "number") errors.push("/caseDefVersion must be number when present");
  if (value.compileVersion !== undefined && typeof value.compileVersion !== "number") errors.push("/compileVersion must be number when present");
  if (value.compileEdges !== undefined) {
    if (!Array.isArray(value.compileEdges)) errors.push("/compileEdges must be an array when present");
  }
  if (value.compileNodes !== undefined) {
    if (!Array.isArray(value.compileNodes)) errors.push("/compileNodes must be an array when present");
    else {
      for (const [i, node] of value.compileNodes.entries()) {
        if (!isRecord(node)) {
          errors.push(`/compileNodes/${i} must be an object`);
          continue;
        }
        pushLockErrors(errors, node.lock, `/compileNodes/${i}/lock`);
        pushOverridePatchErrors(errors, node.overridePatch, `/compileNodes/${i}/overridePatch`);
        if (node.cacheKey !== undefined && node.cacheKey !== null && typeof node.cacheKey !== "string") {
          errors.push(`/compileNodes/${i}/cacheKey must be string or null when present`);
        }
      }
    }
  }
  for (const [i, row] of (Array.isArray(value.actorEvidence) ? value.actorEvidence : []).entries()) {
    if (!isRecord(row)) continue;
    pushLockErrors(errors, row.lock, `/actorEvidence/${i}/lock`);
    pushOverridePatchErrors(errors, row.overridePatch, `/actorEvidence/${i}/overridePatch`);
  }
  for (const [i, row] of (Array.isArray(value.equipmentEvidence) ? value.equipmentEvidence : []).entries()) {
    if (!isRecord(row)) continue;
    pushLockErrors(errors, row.lock, `/equipmentEvidence/${i}/lock`);
    pushOverridePatchErrors(errors, row.overridePatch, `/equipmentEvidence/${i}/overridePatch`);
  }
  pushLockErrors(errors, value.lock, "/lock");
  return { ok: errors.length === 0, errors };
}

const ACTOR_PHENOTYPE_OVERRIDE_PATHS = new Set([
  "/garmentLayers",
  "/clothing_style",
  "/wardrobeRole",
  "/fabricPalette",
]);

function pushLockErrors(errors: string[], lock: unknown, prefix: string): void {
  if (lock === undefined) return;
  if (!isRecord(lock)) {
    errors.push(`${prefix} must be an object when present`);
    return;
  }
  if (typeof lock.locked !== "boolean") errors.push(`${prefix}/locked must be boolean`);
}

function pushOverridePatchErrors(errors: string[], patch: unknown, prefix: string): void {
  if (patch === undefined) return;
  if (!isRecord(patch)) {
    errors.push(`${prefix} must be an object when present`);
    return;
  }
  if (patch.op !== "replace" && patch.op !== "remove") errors.push(`${prefix}/op must be replace|remove`);
  if (typeof patch.path !== "string" || !ACTOR_PHENOTYPE_OVERRIDE_PATHS.has(patch.path)) {
    errors.push(`${prefix}/path must be an ActorPhenotypeSchema pointer`);
  }
}

async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.validatePath) {
    const report = JSON.parse(await readFile(options.validatePath, "utf8")) as unknown;
    const validation = validateEncounterMaterializationEvidenceReport(report);
    if (!validation.ok) {
      process.stderr.write(`Encounter materialization evidence validation failed:\n${validation.errors.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`Validated ${options.validatePath}`);
    return;
  }
  const bundleReport = JSON.parse(await readFile(options.bundleReportPath, "utf8")) as GeneratedEdStationRuntimeBundleReport;
  const report = buildEncounterMaterializationEvidenceReport({ bundleReport });
  await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.outputPath}`);
}

function parseCliOptions(args: string[]): { bundleReportPath: string; outputPath: string; validatePath: string | null } {
  let bundleReportPath = "docs/openclinxr/generated-ed-station-runtime-bundle-2026-05-28.json";
  let outputPath = path.join("docs/openclinxr", `encounter-materialization-evidence-${new Date().toISOString().slice(0, 10)}.json`);
  let validatePath: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--bundle-report" && next) {
      bundleReportPath = next;
      index += 1;
    } else if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
    } else if (arg === "--validate" && next) {
      validatePath = next;
      index += 1;
    }
  }
  return { bundleReportPath, outputPath, validatePath };
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
