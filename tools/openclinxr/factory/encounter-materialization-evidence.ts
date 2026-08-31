import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { findScenarioFixtureById } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import type { GeneratedEdStationRuntimeBundleReport } from "./generated-ed-station-runtime-bundle.js";

/**
 * World Compile Graph node families. A family must EXIST before faculty can lock one, so
 * this list is broader than what `emitCompileNodes` can currently emit.
 *
 * MEASURED 2026-08-29 over the live bank (14 scenarios, all resolvable through
 * `findScenarioFixtureById`), by reading the scenario OBJECTS rather than grepping fixture
 * source — a text grep got two of these four rows wrong:
 *
 *   Room           environment.environmentId            14/14  emitted
 *   DialoguePolicy actors[].communicationProfile        14/14  emitted
 *   Lighting       environment.lighting                  0/14  NOT emitted
 *   Placement      (nothing authored it)                  0/14  NOT emitted
 *
 * UPDATED 2026-08-29 (W11, tsk_250729c006996e58). Placement now HAS a source:
 * ActorCard.placement landed in W11s (b5ef5225) with supportSurface stretcher|chair|none,
 * and this emitter reads it through CompileCaseDescriptor. It still emits nothing for an
 * actor without placement, and the 14 bank scenarios are deliberately NOT backfilled — so
 * the row above stays 0/14 until a human authors staging. Empty is legal.
 *
 * Lighting remains unemitted and that is now permanent rather than pending: W12
 * (f0510aa4) moved lighting authoring to the compile OVERRIDE path (/wallColor,
 * /keyLightIntensity and friends in COMPILE_OVERRIDE_PATHS), not onto the case. There is
 * nothing on a scenario for a Lighting node to derive from, by design.
 *
 * The principle both rows share: a lockable node standing for data the case never authored
 * is worse than no node, and inventing one is the hand-authoring the factory exists to avoid.
 */
export const COMPILE_NODE_FAMILIES = [
  "ActorVariant",
  "EquipVariant",
  "Room",
  "Placement",
  "Lighting",
  "DialoguePolicy",
] as const;
export type CompileNodeFamily = (typeof COMPILE_NODE_FAMILIES)[number];

/**
 * WCG-4 (world-compile-graph-brief-2026-08-27.md Phase 4): baker split at the
 * OBJ/Blender boundary. Phase 0 emitter keeps `unsplit_character`; callers that
 * want lock-granularity per stage map each ActorVariant node through
 * `splitCharacterBakers()` to get `body_character` + `wardrobe_character`.
 */
export const CHARACTER_BAKER_IDS = [
  "unsplit_character",
  "unsplit_equipment",
  "body_character",
  "wardrobe_character",
  /** Room and DialoguePolicy are planned-only today; no baker runs them yet. */
  "room_environment",
  "dialogue_policy",
  "actor_placement",
] as const;
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
    /** Room nodes: the case's authored environment. */
    environmentId?: string;
    /** Placement nodes: what the case says this actor is on. */
    supportSurface?: string;
    variantSemanticKey: string;
    sourceBlobName: string;
  };
  parents: string[];
  cacheKey: string | null;
  contentHash: string | null;
  lock: CompileGraphLock;
  status: "planned_unsplit" | "planned_split";
  overridePatch?: { op: "replace" | "remove"; path: string; value?: unknown };
  /**
   * W5 (tsk_4100343a0be0b471): a faculty-removed node is NOT spliced out of
   * the graph — it is marked. The node stays in compileNodes with a tombstone
   * so the delete is a compile event the next compile sees via the copy-prior
   * rule. Locked nodes are never tombstoned (a lock is not a delete; lock
   * wins).
   */
  tombstone?: CompileNodeTombstone;
};

/**
 * W5 (tsk_4100343a0be0b471): tombstone marker for a faculty-removed compile
 * node. `removedNodeId` is the id the authoring form removed; an unsplit id
 * (actor:X) also tombstones its split children (actor:X:body, actor:X:wardrobe).
 */
export type CompileNodeTombstone = {
  /** When the faculty removed the node from the authoring form. */
  deletedAt: string;
  removedBy: "faculty_remove";
  removedNodeId: string;
};

/**
 * W5 (tsk_4100343a0be0b471): per-compile delete/stale ledger. A delete is a
 * compile event, not a silent array splice: node_tombstoned records the node
 * the compile tombstoned; descendant_staled records a node whose parent was
 * tombstoned. Locked nodes refuse a delete — no node_tombstoned event is
 * emitted for a lock.
 */
export type CompileEvent =
  | { kind: "node_tombstoned"; nodeId: string; deletedAt: string; removedBy: "faculty_remove" }
  | { kind: "descendant_staled"; nodeId: string; ancestorNodeId: string; deletedAt: string };

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
  /** W5 — per-compile delete/stale ledger; absent on pre-W5 JSON. */
  compileEvents?: CompileEvent[];
};

const NOT_EVIDENCE_FOR = ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"] as const;

/** The slice of a scenario fixture this emitter reads. Structural so tests can inject one. */
export type CompileCaseDescriptor = {
  environment?: { environmentId?: string; name?: string } | null;
  actors?: Array<{
    actorId: string;
    communicationProfile?: unknown;
    /**
     * ActorCard.placement (W11s, b5ef5225). Structural, not imported, so this module stays
     * free of the schema package. supportSurface is stretcher|chair|none, where "none" is an
     * authored standing decision rather than an absent value.
     */
    placement?: { supportSurface?: string } | null;
  }> | null;
};

/**
 * Emit unsplit compile nodes from current evidence.v1 rows.
 * Copies prior lock/contentHash by nodeId.
 *
 * Room and DialoguePolicy come from the CASE, which evidence.v1 does not carry — it holds
 * actorEvidence and equipmentEvidence only. Rather than widen that report (a second ledger
 * for the same facts), the case is resolved through `findScenarioFixtureById`, the lookup
 * four other factory modules already use. `caseDescriptor` overrides that lookup so this
 * stays a pure function under test.
 *
 * Emits NOTHING for Lighting or Placement. Neither is authored on any of the 14 bank
 * scenarios, so a node for either would be invented rather than derived. See the
 * COMPILE_NODE_FAMILIES header for the measurement.
 */
export function emitCompileNodes(
  report: EncounterMaterializationEvidenceReport,
  prior: CompileGraphNode[] = [],
  caseDescriptor?: CompileCaseDescriptor | null,
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
      tombstone: prev?.tombstone,
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
      tombstone: prev?.tombstone,
      status: "planned_unsplit",
    };
  });
  const caseDef = caseDescriptor ?? resolveCaseDescriptor(scenarioId);

  // Room: one node per case, from the authored environmentId. 14/14 on the live bank.
  const environmentId = caseDef?.environment?.environmentId;
  const roomNodes: CompileGraphNode[] = environmentId
    ? [
        {
          nodeId: `room:${environmentId}`,
          family: "Room",
          bakerId: "room_environment",
          spec: {
            scenarioId,
            environmentId,
            variantSemanticKey: environmentId,
            sourceBlobName: caseDef?.environment?.name ?? environmentId,
          },
          parents: [],
          cacheKey: null,
          contentHash: priorById.get(`room:${environmentId}`)?.contentHash ?? null,
          lock: priorById.get(`room:${environmentId}`)?.lock ?? { locked: false },
          tombstone: priorById.get(`room:${environmentId}`)?.tombstone,
          status: "planned_unsplit",
        },
      ]
    : [];

  // DialoguePolicy: one node per actor that authors a communicationProfile. 14/14 on the bank.
  const dialogueNodes: CompileGraphNode[] = (caseDef?.actors ?? [])
    .filter((actor) => Boolean(actor?.communicationProfile))
    .map((actor) => {
      const nodeId = `dialogue:${actor.actorId}`;
      const prev = priorById.get(nodeId);
      return {
        nodeId,
        family: "DialoguePolicy",
        bakerId: "dialogue_policy",
        spec: {
          scenarioId,
          actorId: actor.actorId,
          variantSemanticKey: `communication_profile:${actor.actorId}`,
          sourceBlobName: `case:${scenarioId ?? "scenario"}`,
        },
        parents: [],
        cacheKey: null,
        contentHash: prev?.contentHash ?? null,
        lock: prev?.lock ?? { locked: false },
        tombstone: prev?.tombstone,
        status: "planned_unsplit",
      } satisfies CompileGraphNode;
    });

  // No Lighting, no Placement: 0/14 authored. Declaring a family is not licence to invent a node.
  // Placement: one node per actor the CASE places. W3 declared this family and emitted
  // nothing because placement was unauthored on all 14 bank scenarios; W11s added
  // ActorCard.placement so there is now something to read. Still emits nothing for an actor
  // without it — empty is legal and the bank is deliberately not backfilled, so a station
  // with no authored staging produces no lockable node rather than an invented one.
  const placementNodes: CompileGraphNode[] = (caseDef?.actors ?? [])
    .filter((actor) => Boolean(actor?.placement?.supportSurface))
    .map((actor) => {
      const nodeId = `placement:${actor.actorId}`;
      const prev = priorById.get(nodeId);
      const supportSurface = actor.placement?.supportSurface ?? "none";
      return {
        nodeId,
        family: "Placement",
        bakerId: "actor_placement",
        spec: {
          scenarioId,
          actorId: actor.actorId,
          supportSurface,
          variantSemanticKey: `placement:${supportSurface}`,
          sourceBlobName: `case:${scenarioId ?? "scenario"}`,
        },
        parents: [],
        cacheKey: null,
        contentHash: prev?.contentHash ?? null,
        lock: prev?.lock ?? { locked: false },
        tombstone: prev?.tombstone,
        status: "planned_unsplit",
      } satisfies CompileGraphNode;
    });

  // Still no Lighting: 0/14 authored, and W12 moved that authoring to the compile override
  // rather than the case, so there is nothing here to emit from.
  return [...actorNodes, ...equipNodes, ...roomNodes, ...dialogueNodes, ...placementNodes];
}

/**
 * Resolve the case behind a scenarioId through the fixture bank. Returns null rather than
 * throwing: an unknown or absent scenarioId simply emits no Room or DialoguePolicy node,
 * which keeps this emitter total for reports the bank does not cover.
 */
function resolveCaseDescriptor(scenarioId: string | null): CompileCaseDescriptor | null {
  if (!scenarioId) return null;
  try {
    return (findScenarioFixtureById(scenarioId) as CompileCaseDescriptor | undefined) ?? null;
  } catch {
    return null;
  }
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
  reason:
    | "first_bake"
    | "cache_hit"
    | "body_changed"
    | "locked_skip"
    | "locked_stale"
    | "tombstoned"
    | "parent_tombstoned";
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
 *   node tombstoned                 -> tombstoned (W5: a removed node refuses bake)
 *   parent tombstoned               -> parent_tombstoned (W5: descendant goes stale)
 *
 * `bodyHashAtWardrobeBake` is the body output hash (artifact hash from the body
 * node's contentHash) the wardrobe was last baked against; `bodyHashNow` is the
 * current body output hash. null/unknown body hash counts as changed (WCG brief
 * dirty rule: "unknown edge = dirty").
 *
 * A lock is not a delete: the compile refuses to tombstone a locked node, so a
 * node that somehow carries BOTH keeps the lock's skip semantics — locked_stale
 * — never a delete.
 */
export function planWardrobeBake(
  wardrobe: CompileGraphNode,
  bodyHashAtWardrobeBake: string | null,
  bodyHashNow: string | null,
  parentTombstoned = false,
): WardrobeBakeDecision {
  if (wardrobe.tombstone) {
    if (wardrobe.lock.locked) return { bake: false, reason: "locked_stale", stale: true };
    return { bake: false, reason: "tombstoned", stale: true };
  }
  if (parentTombstoned) {
    return { bake: false, reason: "parent_tombstoned", stale: true };
  }
  const baked = wardrobe.contentHash !== null;
  if (!baked) {
    return { bake: true, reason: "first_bake", stale: false };
  }
  if (bodyHashNow === null) {
    // WCG dirty rule: unknown edge = dirty. A body hash we cannot resolve is
    // treated as changed, so a baked unlocked wardrobe rebakes.
    if (wardrobe.lock.locked) return { bake: false, reason: "locked_stale", stale: true };
    return { bake: true, reason: "body_changed", stale: false };
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
        pushTombstoneErrors(errors, node.tombstone, `/compileNodes/${i}/tombstone`);
        if (node.cacheKey !== undefined && node.cacheKey !== null && typeof node.cacheKey !== "string") {
          errors.push(`/compileNodes/${i}/cacheKey must be string or null when present`);
        }
      }
    }
  }
  if (value.compileEvents !== undefined) {
    if (!Array.isArray(value.compileEvents)) errors.push("/compileEvents must be an array when present");
    else {
      for (const [i, event] of value.compileEvents.entries()) {
        if (!isRecord(event)) {
          errors.push(`/compileEvents/${i} must be an object`);
          continue;
        }
        if (event.kind === "node_tombstoned") {
          if (typeof event.nodeId !== "string") errors.push(`/compileEvents/${i}/nodeId must be string`);
          if (typeof event.deletedAt !== "string") errors.push(`/compileEvents/${i}/deletedAt must be string`);
          if (event.removedBy !== "faculty_remove") errors.push(`/compileEvents/${i}/removedBy must be faculty_remove`);
        } else if (event.kind === "descendant_staled") {
          if (typeof event.nodeId !== "string") errors.push(`/compileEvents/${i}/nodeId must be string`);
          if (typeof event.ancestorNodeId !== "string") errors.push(`/compileEvents/${i}/ancestorNodeId must be string`);
          if (typeof event.deletedAt !== "string") errors.push(`/compileEvents/${i}/deletedAt must be string`);
        } else {
          errors.push(`/compileEvents/${i}/kind must be node_tombstoned|descendant_staled`);
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

/** ActorVariant overrides. Faculty phenotype pointers; unchanged by W12. */
const ACTOR_PHENOTYPE_OVERRIDE_PATHS = new Set([
  "/garmentLayers",
  "/clothing_style",
  "/wardrobeRole",
  "/fabricPalette",
]);

/**
 * Lighting overrides (W12, tsk_de6cae5304badfa6). Environment descriptors carry these as
 * READ-ONLY facts; a Lighting node's overridePatch is how faculty write them onto the
 * compile instead. Names match EnvironmentDescriptor in
 * packages/openclinxr/asset-registry/src/environment-descriptors.ts:93-97.
 */
const LIGHTING_OVERRIDE_PATHS = new Set([
  "/wallColor",
  "/ambientHemisphereSky",
  "/ambientHemisphereGround",
  "/keyLightIntensity",
]);

/**
 * Every pointer an overridePatch may target, across families. This is deliberately a union
 * and not a widening of the actor set: an actor node must not gain a lighting pointer.
 *
 * Widening this is a real behaviour change, not bookkeeping. encounter-materialization-compile.ts
 * :93-99 applies the patch to node.spec and :77-89 folds the patched spec into the recipe
 * cacheKey, so an admitted pointer changes what bakes and what is cache-skipped.
 *
 * Must stay aligned with FACULTY_LOCK_OVERRIDE_PATHS in encounter-materialization-faculty-locks.ts.
 */
/**
 * Placement overrides (W11, tsk_250729c006996e58). ActorCard.placement is the authored
 * intent; these pointers are how faculty override it on one compile without editing the case.
 */
const PLACEMENT_OVERRIDE_PATHS = new Set(["/supportSurface", "/plantOffsetMeters"]);

const COMPILE_OVERRIDE_PATHS = new Set([
  ...ACTOR_PHENOTYPE_OVERRIDE_PATHS,
  ...LIGHTING_OVERRIDE_PATHS,
  ...PLACEMENT_OVERRIDE_PATHS,
]);

function pushLockErrors(errors: string[], lock: unknown, prefix: string): void {
  if (lock === undefined) return;
  if (!isRecord(lock)) {
    errors.push(`${prefix} must be an object when present`);
    return;
  }
  if (typeof lock.locked !== "boolean") errors.push(`${prefix}/locked must be boolean`);
}

function pushTombstoneErrors(errors: string[], tombstone: unknown, prefix: string): void {
  if (tombstone === undefined) return;
  if (!isRecord(tombstone)) {
    errors.push(`${prefix} must be an object when present`);
    return;
  }
  if (typeof tombstone.deletedAt !== "string") errors.push(`${prefix}/deletedAt must be string`);
  if (tombstone.removedBy !== "faculty_remove") errors.push(`${prefix}/removedBy must be faculty_remove`);
  if (typeof tombstone.removedNodeId !== "string") errors.push(`${prefix}/removedNodeId must be string`);
}

function pushOverridePatchErrors(errors: string[], patch: unknown, prefix: string): void {
  if (patch === undefined) return;
  if (!isRecord(patch)) {
    errors.push(`${prefix} must be an object when present`);
    return;
  }
  if (patch.op !== "replace" && patch.op !== "remove") errors.push(`${prefix}/op must be replace|remove`);
  if (typeof patch.path !== "string" || !COMPILE_OVERRIDE_PATHS.has(patch.path)) {
    errors.push(`${prefix}/path must be an allowed compile override pointer`);
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
