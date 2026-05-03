import { scoreWeights, globFiles, readJson, type ScoreDimension } from "./lib.js";

type Failure = {
  file: string;
  message: string;
};

type MemoryEntry = {
  id: string;
  agentId: string;
  topic: string;
  status: string;
};

type WorkOrder = {
  id: string;
  stage: string;
  assignedAgentIds: string[];
  dimensions: string[];
  memoryTopics: string[];
  dependsOnStages: string[];
};

type NextAction = {
  id: string;
  actionType: string;
  owner: string;
  summary: string;
  dimensions: string[];
};

type DispatchPacket = {
  workOrderId: string;
  stage: string;
  assignedAgentIds: string[];
  dimensions: string[];
  dependsOnStages: string[];
  retrievedMemoryEntries: MemoryEntry[];
  nextActions: NextAction[];
};

type AgentLoopArtifact = {
  iterationId: string;
  rosterVersion: string;
  memoryIndex: {
    activeEntries: MemoryEntry[];
    byTopic: Record<string, MemoryEntry[]>;
    byAgent: Record<string, MemoryEntry[]>;
  };
  workOrders: WorkOrder[];
  nextActions: NextAction[];
  leadershipGate: {
    ready: boolean;
    blockers: string[];
  };
  dispatchPackets: DispatchPacket[];
  memoryRetrieval?: {
    activeEntryCount: number;
    topics: string[];
  };
};

const validStages = new Set([
  "core_revision",
  "physician_specialty_review",
  "legal_governance_review",
  "adversarial_counterplan",
  "leadership_review",
  "leadership_preflight",
]);

const validActionTypes = new Set([
  "close_evidence_debt",
  "resolve_decision_debt",
  "mitigate_critical_risk",
  "raise_score_dimension",
]);

const validDimensions = new Set(Object.keys(scoreWeights) as ScoreDimension[]);

async function main(): Promise<void> {
  const files = await globFiles("iterations/**/09-agent-loop-plan.json");
  const failures: Failure[] = [];

  for (const file of files.sort()) {
    try {
      validateArtifact(file, await readJson<unknown>(file), failures);
    } catch (error) {
      failures.push({
        file,
        message: error instanceof Error ? error.message : "Unable to read agent loop artifact",
      });
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`${failure.file}: ${failure.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Checked ${files.length} generated agent loop artifact${files.length === 1 ? "" : "s"}.`);
}

function validateArtifact(file: string, value: unknown, failures: Failure[]): void {
  if (!isAgentLoopArtifact(value)) {
    failures.push({ file, message: "agent loop artifact is missing required top-level fields" });
    return;
  }

  const memoryIds = new Set(value.memoryIndex.activeEntries.map((entry) => entry.id));
  const workOrderIds = value.workOrders.map((order) => order.id);
  const workOrderStages = value.workOrders.map((order) => order.stage);
  const nextActionIds = value.nextActions.map((action) => action.id);
  const workOrderStageSet = new Set(workOrderStages);
  const nextActionIdSet = new Set(nextActionIds);

  requireUnique(file, "memoryIndex.activeEntries[].id", value.memoryIndex.activeEntries.map((entry) => entry.id), failures);
  requireUnique(file, "workOrders[].id", workOrderIds, failures);
  requireUnique(file, "workOrders[].stage", workOrderStages, failures);
  requireUnique(file, "nextActions[].id", nextActionIds, failures);

  for (const entry of value.memoryIndex.activeEntries) {
    if (entry.status !== "active") {
      failures.push({ file, message: `memory entry ${entry.id} must be active in generated memoryIndex.activeEntries` });
    }
    if (!containsMemoryEntry(value.memoryIndex.byTopic[entry.topic], entry.id)) {
      failures.push({ file, message: `memory entry ${entry.id} is missing from memoryIndex.byTopic.${entry.topic}` });
    }
    if (!containsMemoryEntry(value.memoryIndex.byAgent[entry.agentId], entry.id)) {
      failures.push({ file, message: `memory entry ${entry.id} is missing from memoryIndex.byAgent.${entry.agentId}` });
    }
  }

  for (const order of value.workOrders) {
    if (!validStages.has(order.stage)) {
      failures.push({ file, message: `work order ${order.id} has unknown stage ${order.stage}` });
    }
    requireNonEmptyStrings(file, `work order ${order.id} assignedAgentIds`, order.assignedAgentIds, failures);
    requireValidDimensions(file, `work order ${order.id}`, order.dimensions, failures);
    requireNonEmptyStrings(file, `work order ${order.id} memoryTopics`, order.memoryTopics, failures);
    for (const stage of order.dependsOnStages) {
      if (!workOrderStageSet.has(stage)) {
        failures.push({ file, message: `work order ${order.id} depends on missing stage ${stage}` });
      }
    }
  }

  for (const action of value.nextActions) {
    if (!validActionTypes.has(action.actionType)) {
      failures.push({ file, message: `next action ${action.id} has unknown actionType ${action.actionType}` });
    }
    if (action.owner.length === 0 || action.summary.length === 0) {
      failures.push({ file, message: `next action ${action.id} must include owner and summary` });
    }
    requireValidDimensions(file, `next action ${action.id}`, action.dimensions, failures);
  }

  if (value.dispatchPackets.length !== value.workOrders.length) {
    failures.push({
      file,
      message: `dispatchPackets length ${value.dispatchPackets.length} does not match workOrders length ${value.workOrders.length}`,
    });
  }

  for (const packet of value.dispatchPackets) {
    const order = value.workOrders.find((candidate) => candidate.id === packet.workOrderId);
    if (!order) {
      failures.push({ file, message: `dispatch packet ${packet.workOrderId} does not match a work order` });
      continue;
    }
    if (packet.stage !== order.stage) {
      failures.push({ file, message: `dispatch packet ${packet.workOrderId} stage does not match its work order` });
    }
    if (!sameSet(packet.assignedAgentIds, order.assignedAgentIds)) {
      failures.push({ file, message: `dispatch packet ${packet.workOrderId} assigned agents drifted from its work order` });
    }
    if (!sameSet(packet.dimensions, order.dimensions)) {
      failures.push({ file, message: `dispatch packet ${packet.workOrderId} dimensions drifted from its work order` });
    }
    if (!sameSet(packet.dependsOnStages, order.dependsOnStages)) {
      failures.push({ file, message: `dispatch packet ${packet.workOrderId} dependencies drifted from its work order` });
    }
    for (const memoryEntry of packet.retrievedMemoryEntries) {
      if (!memoryIds.has(memoryEntry.id)) {
        failures.push({ file, message: `dispatch packet ${packet.workOrderId} references unknown memory ${memoryEntry.id}` });
      }
    }
    for (const action of packet.nextActions) {
      if (!nextActionIdSet.has(action.id)) {
        failures.push({ file, message: `dispatch packet ${packet.workOrderId} references unknown next action ${action.id}` });
      }
    }
  }

  if (value.memoryRetrieval) {
    if (value.memoryRetrieval.activeEntryCount !== value.memoryIndex.activeEntries.length) {
      failures.push({ file, message: "memoryRetrieval.activeEntryCount does not match memoryIndex.activeEntries length" });
    }
    if (!sameSet(value.memoryRetrieval.topics, Object.keys(value.memoryIndex.byTopic))) {
      failures.push({ file, message: "memoryRetrieval.topics does not match memoryIndex.byTopic keys" });
    }
  }
}

function isAgentLoopArtifact(value: unknown): value is AgentLoopArtifact {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.iterationId !== "string" || typeof value.rosterVersion !== "string") {
    return false;
  }
  if (!isRecord(value.memoryIndex) || !Array.isArray(value.memoryIndex.activeEntries)) {
    return false;
  }
  if (!isMemoryRecord(value.memoryIndex.byTopic) || !isMemoryRecord(value.memoryIndex.byAgent)) {
    return false;
  }
  if (!Array.isArray(value.workOrders) || !value.workOrders.every(isWorkOrder)) {
    return false;
  }
  if (!Array.isArray(value.nextActions) || !value.nextActions.every(isNextAction)) {
    return false;
  }
  if (!isRecord(value.leadershipGate) || typeof value.leadershipGate.ready !== "boolean" || !isStringArray(value.leadershipGate.blockers)) {
    return false;
  }
  return Array.isArray(value.dispatchPackets) && value.dispatchPackets.every(isDispatchPacket);
}

function isMemoryRecord(value: unknown): value is Record<string, MemoryEntry[]> {
  return isRecord(value) && Object.values(value).every((entries) => Array.isArray(entries) && entries.every(isMemoryEntry));
}

function isMemoryEntry(value: unknown): value is MemoryEntry {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.agentId === "string"
    && typeof value.topic === "string"
    && typeof value.status === "string";
}

function isWorkOrder(value: unknown): value is WorkOrder {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.stage === "string"
    && isStringArray(value.assignedAgentIds)
    && isStringArray(value.dimensions)
    && isStringArray(value.memoryTopics)
    && isStringArray(value.dependsOnStages);
}

function isNextAction(value: unknown): value is NextAction {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.actionType === "string"
    && typeof value.owner === "string"
    && typeof value.summary === "string"
    && isStringArray(value.dimensions);
}

function isDispatchPacket(value: unknown): value is DispatchPacket {
  return isRecord(value)
    && typeof value.workOrderId === "string"
    && typeof value.stage === "string"
    && isStringArray(value.assignedAgentIds)
    && isStringArray(value.dimensions)
    && isStringArray(value.dependsOnStages)
    && Array.isArray(value.retrievedMemoryEntries)
    && value.retrievedMemoryEntries.every(isMemoryEntry)
    && Array.isArray(value.nextActions)
    && value.nextActions.every(isNextAction);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function containsMemoryEntry(entries: MemoryEntry[] | undefined, id: string): boolean {
  return entries?.some((entry) => entry.id === id) ?? false;
}

function requireUnique(file: string, label: string, values: string[], failures: Failure[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  if (duplicates.size > 0) {
    failures.push({ file, message: `${label} has duplicate values: ${[...duplicates].sort().join(", ")}` });
  }
}

function requireNonEmptyStrings(file: string, label: string, values: string[], failures: Failure[]): void {
  if (values.length === 0 || values.some((value) => value.length === 0)) {
    failures.push({ file, message: `${label} must contain non-empty strings` });
  }
}

function requireValidDimensions(file: string, label: string, dimensions: string[], failures: Failure[]): void {
  requireNonEmptyStrings(file, `${label} dimensions`, dimensions, failures);
  for (const dimension of dimensions) {
    if (!validDimensions.has(dimension as ScoreDimension)) {
      failures.push({ file, message: `${label} has unknown score dimension ${dimension}` });
    }
  }
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

await main();
