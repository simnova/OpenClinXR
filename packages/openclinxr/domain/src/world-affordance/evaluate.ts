/**
 * Case-defined world affordance graph (internal). Not on the package entrypoint.
 *
 * A reviewed case yields inspect, use, move, request-exam, and observe-result
 * actions bound to station, bundle, actor, and equipment identities. Execution
 * is deterministic. Unavailable or stale actions fail closed.
 */

export const WORLD_AFFORDANCE_KINDS = [
  "inspect",
  "use",
  "move",
  "request-exam",
  "observe-result",
] as const;

export type WorldAffordanceKind = (typeof WORLD_AFFORDANCE_KINDS)[number];
export type WorldAffordancePhase = "doorway" | "encounter" | "note" | "review";

export const WORLD_AFFORDANCE_CLAIM_SCOPE = "case_defined_world_affordance" as const;

export const WORLD_AFFORDANCE_NOT_EVIDENCE_FOR = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "assessment_validity",
  "learner_readiness",
  "quest_readiness",
  "production_deployment",
] as const;

export type AuthoredWorldAffordance = {
  affordanceId: string;
  kind: WorldAffordanceKind;
  stationId: string;
  bundleId: string;
  actorId?: string;
  equipmentId?: string;
  scenarioId?: string;
  opensAtSecond: number;
  closesAtSecond?: number;
  availableInPhases?: readonly WorldAffordancePhase[];
  requiresPriorAffordanceIds?: readonly string[];
  consequence: Readonly<{ eventType: string; traceTag: string; detail: string }>;
};

export type WorldAffordanceGraph = {
  scenarioId: string;
  stationId: string;
  reviewed: boolean;
  actorIds: readonly string[];
  equipmentIds: readonly string[];
  affordances: readonly AuthoredWorldAffordance[];
};

export type AvailableWorldAffordance = {
  affordanceId: string;
  kind: WorldAffordanceKind;
  stationId: string;
  bundleId: string;
  actorId?: string;
  equipmentId?: string;
  opensAtSecond: number;
  closesAtSecond?: number;
};

export type ExecuteWorldAffordanceAction = {
  affordanceId: string;
  kind: WorldAffordanceKind;
  atSecond: number;
  stationId: string;
  bundleId: string;
  actorId?: string;
  equipmentId?: string;
  examRunId?: string;
  stationOrder?: number;
};

export type AffordanceFollowed = {
  eventType: string;
  traceTag: string;
  detail: string;
};

export type BoundSessionIdentities = {
  scenarioId: string;
  stationId: string;
  phase: WorldAffordancePhase;
  examRunId?: string;
  stationOrder?: number;
};

const KIND_SET = new Set<string>(WORLD_AFFORDANCE_KINDS);
const PHASE_SET = new Set<string>(["doorway", "encounter", "note", "review"]);
const CLINICAL_KINDS = new Set<WorldAffordanceKind>(["use", "request-exam", "observe-result"]);
const ONE_SHOT_KINDS = new Set<WorldAffordanceKind>(["use", "move", "request-exam", "observe-result"]);

export function caseIsReviewed(scenario: {
  status?: string;
  review?: { clinical?: string; psychometric?: string; legal?: string; simulationQa?: string };
}): boolean {
  const review = scenario.review;
  return (
    scenario.status === "approved" &&
    review?.clinical === "approved" &&
    review?.psychometric === "approved" &&
    review?.legal === "approved" &&
    review?.simulationQa === "approved"
  );
}

export function actorIdsFromCase(scenario: { actors?: readonly { actorId?: string }[] }): readonly string[] {
  const ids: string[] = [];
  for (const actor of scenario.actors ?? []) {
    if (typeof actor.actorId === "string" && actor.actorId.trim().length > 0) {
      ids.push(actor.actorId);
    }
  }
  return Object.freeze(ids);
}

export function equipmentIdsFromCase(scenario: {
  equipment?: readonly string[];
  assetNeeds?: readonly { assetId?: string; assetType?: string }[];
}): readonly string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    if (!seen.has(value)) {
      seen.add(value);
      ids.push(value);
    }
  };
  for (const equipment of scenario.equipment ?? []) {
    add(equipment);
    add(normalizeEquipmentId(equipment));
  }
  for (const need of scenario.assetNeeds ?? []) {
    if (need.assetType === "equipment" && typeof need.assetId === "string" && need.assetId.trim().length > 0) {
      add(need.assetId);
    }
  }
  return Object.freeze(ids);
}

export function authoredWorldAffordanceGraphFromCase(scenario: {
  scenarioId: string;
  status?: string;
  review?: { clinical?: string; psychometric?: string; legal?: string; simulationQa?: string };
  actors?: readonly { actorId?: string }[];
  equipment?: readonly string[];
  assetNeeds?: readonly { assetId?: string; assetType?: string }[];
  worldAffordances?: unknown;
}): WorldAffordanceGraph {
  const actorIds = actorIdsFromCase(scenario);
  const equipmentIds = equipmentIdsFromCase(scenario);
  const reviewed = caseIsReviewed(scenario);
  const raw = (scenario as { worldAffordances?: unknown }).worldAffordances;
  const parsed =
    raw === undefined
      ? Object.freeze([])
      : parseAuthoredAffordances(raw, scenario.scenarioId, actorIds, equipmentIds);
  return Object.freeze({
    scenarioId: scenario.scenarioId,
    stationId: scenario.scenarioId,
    reviewed,
    actorIds,
    equipmentIds,
    affordances: parsed,
  });
}

export function availableWorldAffordancesAt(input: {
  graph: WorldAffordanceGraph;
  phase: WorldAffordancePhase;
  atSecond: number;
  executedIds: ReadonlySet<string>;
  bound: BoundSessionIdentities;
}): readonly AvailableWorldAffordance[] {
  refuseStaleSessionBinding(input.graph, input.bound);
  if (!input.graph.reviewed) {
    return Object.freeze([]);
  }
  const available: AvailableWorldAffordance[] = [];
  for (const affordance of input.graph.affordances) {
    if (!affordanceIsOpen(affordance, input.phase, input.atSecond)) {
      continue;
    }
    if (ONE_SHOT_KINDS.has(affordance.kind) && input.executedIds.has(affordance.affordanceId)) {
      continue;
    }
    if (!prerequisitesMet(affordance, input.executedIds)) {
      continue;
    }
    available.push(freezeAvailable(affordance));
  }
  return Object.freeze(available);
}

export function requireExecutableAffordance(input: {
  graph: WorldAffordanceGraph;
  action: ExecuteWorldAffordanceAction;
  phase: WorldAffordancePhase;
  executedIds: ReadonlySet<string>;
  bound: BoundSessionIdentities;
}): AuthoredWorldAffordance {
  refuseStaleSessionBinding(input.graph, input.bound);
  const authored = input.graph.affordances.find((row) => row.affordanceId === input.action.affordanceId);
  if (!authored) {
    throw new Error("stale affordance identity");
  }
  refuseStaleActionBinding(authored, input.action, input.graph);
  if (!input.graph.reviewed && CLINICAL_KINDS.has(authored.kind)) {
    throw new Error("unreviewed clinical consequence");
  }
  if (!input.graph.reviewed) {
    throw new Error("unreviewed clinical consequence");
  }
  if (!affordanceIsOpen(authored, input.phase, input.action.atSecond)) {
    throw new Error("affordance is not available");
  }
  if (ONE_SHOT_KINDS.has(authored.kind) && input.executedIds.has(authored.affordanceId)) {
    throw new Error("affordance is not available");
  }
  if (!prerequisitesMet(authored, input.executedIds)) {
    throw new Error("affordance is not available");
  }
  return authored;
}

export function followedConsequence(affordance: AuthoredWorldAffordance): AffordanceFollowed {
  return Object.freeze({
    eventType: affordance.consequence.eventType,
    traceTag: affordance.consequence.traceTag,
    detail: affordance.consequence.detail,
  });
}

export function normalizeEquipmentId(equipment: string): string {
  const normalized = equipment
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  return normalized.endsWith("_equipment") ? normalized : `${normalized}_equipment`;
}

function refuseStaleSessionBinding(graph: WorldAffordanceGraph, bound: BoundSessionIdentities): void {
  if (bound.scenarioId !== graph.scenarioId || bound.stationId !== graph.stationId) {
    throw new Error("stale affordance identity");
  }
}

function refuseStaleActionBinding(
  authored: AuthoredWorldAffordance,
  action: ExecuteWorldAffordanceAction,
  graph: WorldAffordanceGraph,
): void {
  if (authored.kind !== action.kind) {
    throw new Error("stale affordance identity");
  }
  if (action.stationId !== authored.stationId || action.stationId !== graph.stationId) {
    throw new Error("stale affordance identity");
  }
  if (action.bundleId !== authored.bundleId) {
    throw new Error("stale affordance identity");
  }
  if ((authored.actorId ?? undefined) !== (action.actorId ?? undefined)) {
    throw new Error("stale affordance identity");
  }
  if ((authored.equipmentId ?? undefined) !== (action.equipmentId ?? undefined)) {
    throw new Error("stale affordance identity");
  }
}

function affordanceIsOpen(affordance: AuthoredWorldAffordance, phase: WorldAffordancePhase, atSecond: number): boolean {
  if (atSecond < affordance.opensAtSecond) {
    return false;
  }
  if (affordance.closesAtSecond !== undefined && atSecond > affordance.closesAtSecond) {
    return false;
  }
  if (affordance.availableInPhases !== undefined && !affordance.availableInPhases.includes(phase)) {
    return false;
  }
  return true;
}

function prerequisitesMet(affordance: AuthoredWorldAffordance, executedIds: ReadonlySet<string>): boolean {
  for (const priorId of affordance.requiresPriorAffordanceIds ?? []) {
    if (!executedIds.has(priorId)) {
      return false;
    }
  }
  return true;
}

function freezeAvailable(affordance: AuthoredWorldAffordance): AvailableWorldAffordance {
  const available: AvailableWorldAffordance = {
    affordanceId: affordance.affordanceId,
    kind: affordance.kind,
    stationId: affordance.stationId,
    bundleId: affordance.bundleId,
    opensAtSecond: affordance.opensAtSecond,
  };
  if (affordance.actorId !== undefined) {
    available.actorId = affordance.actorId;
  }
  if (affordance.equipmentId !== undefined) {
    available.equipmentId = affordance.equipmentId;
  }
  if (affordance.closesAtSecond !== undefined) {
    available.closesAtSecond = affordance.closesAtSecond;
  }
  return Object.freeze(available);
}

function parseAuthoredAffordances(
  raw: unknown,
  scenarioId: string,
  actorIds: readonly string[],
  equipmentIds: readonly string[],
): readonly AuthoredWorldAffordance[] {
  if (!Array.isArray(raw)) {
    throw new Error("worldAffordances must be an array");
  }
  const actorSet = new Set(actorIds);
  const equipmentSet = new Set(equipmentIds);
  const seenIds = new Set<string>();
  const parsed = raw.map((entry, index) =>
    parseAuthoredAffordance(entry, index, scenarioId, actorSet, equipmentSet, seenIds),
  );
  return Object.freeze(parsed);
}

function parseAuthoredAffordance(
  entry: unknown,
  index: number,
  scenarioId: string,
  actorSet: ReadonlySet<string>,
  equipmentSet: ReadonlySet<string>,
  seenIds: Set<string>,
): AuthoredWorldAffordance {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`worldAffordances[${index}] is not an object`);
  }
  const fields = entry as Record<string, unknown>;
  const affordanceId = requiredString(fields["affordanceId"], `worldAffordances[${index}].affordanceId`);
  if (seenIds.has(affordanceId)) {
    throw new Error("stale affordance identity");
  }
  seenIds.add(affordanceId);
  const kindRaw = requiredString(fields["kind"], `worldAffordances[${index}].kind`);
  if (!KIND_SET.has(kindRaw)) {
    throw new Error(`worldAffordances[${index}].kind is not a world affordance`);
  }
  const stationId = requiredString(fields["stationId"], `worldAffordances[${index}].stationId`);
  if (stationId !== scenarioId) {
    throw new Error("stale affordance identity");
  }
  const bundleId = requiredString(fields["bundleId"], `worldAffordances[${index}].bundleId`);
  const opensAtSecond = requiredSecond(fields["opensAtSecond"], `worldAffordances[${index}].opensAtSecond`);
  const consequence = parseConsequence(fields["consequence"], index);
  const affordance: AuthoredWorldAffordance = {
    affordanceId,
    kind: kindRaw as WorldAffordanceKind,
    stationId,
    bundleId,
    opensAtSecond,
    consequence,
  };
  if (typeof fields["actorId"] === "string") {
    if (!actorSet.has(fields["actorId"])) {
      throw new Error("stale affordance identity");
    }
    affordance.actorId = fields["actorId"];
  }
  if (typeof fields["equipmentId"] === "string") {
    if (!equipmentSet.has(fields["equipmentId"])) {
      throw new Error("stale affordance identity");
    }
    affordance.equipmentId = fields["equipmentId"];
  }
  if (typeof fields["scenarioId"] === "string") {
    affordance.scenarioId = fields["scenarioId"];
    if (affordance.scenarioId !== scenarioId) {
      throw new Error("stale affordance identity");
    }
  }
  if (fields["closesAtSecond"] !== undefined) {
    affordance.closesAtSecond = requiredSecond(fields["closesAtSecond"], `worldAffordances[${index}].closesAtSecond`);
  }
  if (fields["availableInPhases"] !== undefined) {
    affordance.availableInPhases = parsePhases(fields["availableInPhases"], index);
  }
  if (fields["requiresPriorAffordanceIds"] !== undefined) {
    affordance.requiresPriorAffordanceIds = parsePriorIds(fields["requiresPriorAffordanceIds"], index);
  }
  return Object.freeze(affordance);
}

function parseConsequence(
  value: unknown,
  index: number,
): AuthoredWorldAffordance["consequence"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`worldAffordances[${index}].consequence must be an object`);
  }
  const fields = value as Record<string, unknown>;
  return Object.freeze({
    eventType: requiredString(fields["eventType"], `worldAffordances[${index}].consequence.eventType`),
    traceTag: requiredString(fields["traceTag"], `worldAffordances[${index}].consequence.traceTag`),
    detail: requiredString(fields["detail"], `worldAffordances[${index}].consequence.detail`),
  });
}

function parsePhases(value: unknown, index: number): readonly WorldAffordancePhase[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`worldAffordances[${index}].availableInPhases must be a non-empty array`);
  }
  const phases: WorldAffordancePhase[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !PHASE_SET.has(entry)) {
      throw new Error(`worldAffordances[${index}].availableInPhases contains an unknown phase`);
    }
    phases.push(entry as WorldAffordancePhase);
  }
  return Object.freeze(phases);
}

function parsePriorIds(value: unknown, index: number): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`worldAffordances[${index}].requiresPriorAffordanceIds must be a non-empty array`);
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`worldAffordances[${index}].requiresPriorAffordanceIds contains a blank id`);
    }
    ids.push(entry);
  }
  return Object.freeze(ids);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function requiredSecond(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}
