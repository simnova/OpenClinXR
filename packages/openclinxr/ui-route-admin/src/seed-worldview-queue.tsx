import { useCallback, useState, type ReactElement } from "react";
import type { CompileEdge } from "@openclinxr/ui-shared/admin-compile-graph-canvas";
import type { FacultyCompileLockRow } from "./faculty-compile-lock.js";
import { resolveCompileEdgeConnection, validateCompileEdge } from "./compile-edge-port-types.js";
import {
  EnvironmentGenerationQueuePanel,
  type EnvironmentGenerationQueuePanelProps,
} from "./environment-generation-queue-panel.js";
export type SeedWorldviewCompileGraph = {
  compileNodes: unknown[];
  facultyLocks: EnvironmentGenerationQueuePanelProps["facultyCompileLockRows"];
  stationPayloads?: Partial<Record<string, Record<string, unknown>>>;
};

export type SeedWorldviewQueueProps = Omit<
  EnvironmentGenerationQueuePanelProps,
  "onAddActor" | "onBindEquipmentFixtureSlot" | "onAddTrellisModel" | "onCompileEncounter" | "onConnectNodes"
> & {
  onCompileEncounter?: (scenarioId: string, graph: SeedWorldviewCompileGraph) => void;
};

/**
 * Seed exam worldview queue: owns add-actor / fixture-slot / canvas node
 * mutations and merges them into the lock table + compile graph the panel
 * already renders. SeedBlueprintWorkbench mounts this, not the raw panel.
 */
export function SeedWorldviewQueue({
  onCompileEncounter,
  compileEdges = [],
  facultyCompileLockRows = [],
  ...panelProps
}: SeedWorldviewQueueProps): ReactElement {
  const worldview = useWorldviewCompileGraph();
  const mergedEdges = mergeWorldviewCompileEdges(compileEdges, worldview.state);
  const mergedLocks = mergeWorldviewLockRows(facultyCompileLockRows, worldview.state);
  return (
    <EnvironmentGenerationQueuePanel
      {...panelProps}
      compileEdges={mergedEdges}
      facultyCompileLockRows={mergedLocks}
      onAddActor={worldview.onAddActor}
      onBindEquipmentFixtureSlot={worldview.onBindEquipmentFixtureSlot}
      onAddTrellisModel={worldview.onAddTrellisModel}
      onStationApply={worldview.onApplyStation}
      onAddNode={worldview.onAddNode}
      onRemoveNode={worldview.onRemoveNode}
      onConnectNodes={worldview.onConnectNodes}
      {...(worldview.state.lastConnectionAttempt ? { connectionAttempt: worldview.state.lastConnectionAttempt } : {})}
      {...(onCompileEncounter
        ? {
            onCompileEncounter: (scenarioId: string) =>
              onCompileEncounter(scenarioId, {
                compileNodes: [...mergedEdges, ...worldview.state.actors],
                facultyLocks: mergedLocks,
                ...(Object.keys(worldview.state.stationPayloads).length > 0
                  ? { stationPayloads: worldview.state.stationPayloads }
                  : {}),
              }),
          }
        : {})}
    />
  );
}

export type WorldviewActorDraft = {
  actorId: string;
  compileNodeKind: "ActorVariant";
};

export type WorldviewEquipmentBind = {
  equipmentId: string;
  fixtureSlot: string;
};

export type WorldviewTrellisModel = {
  modelId: string;
  subjectId: string;
  packId: string;
};

/**
 * Result of the most recent "connect nodes" worldview attempt (WCG typed-port gate).
 * Kept on state, not only as a return value, so the panel can show the operator what
 * happened to the connection they just tried, including a refusal reason.
 */
export type WorldviewConnectionAttempt =
  | { ok: true; edge: CompileEdge }
  | { ok: false; from: string; to: string; reason: string };

export type WorldviewCompileGraphState = {
  actors: WorldviewActorDraft[];
  equipmentBinds: WorldviewEquipmentBind[];
  trellisModels: WorldviewTrellisModel[];
  extraNodeIds: string[];
  removedNodeIds: string[];
  stationPayloads: Partial<Record<string, Record<string, unknown>>>;
  /** Edges accepted through the "connect nodes" typed-port gate (`reduceWorldviewConnectNodes`). */
  manualEdges: CompileEdge[];
  lastConnectionAttempt?: WorldviewConnectionAttempt;
};

export function emptyWorldviewCompileGraph(): WorldviewCompileGraphState {
  return {
    actors: [],
    equipmentBinds: [],
    trellisModels: [],
    extraNodeIds: [],
    removedNodeIds: [],
    stationPayloads: {},
    manualEdges: [],
  };
}

export function reduceWorldviewAddActor(
  state: WorldviewCompileGraphState,
  payload: WorldviewActorDraft,
): WorldviewCompileGraphState {
  if (state.actors.some((actor) => actor.actorId === payload.actorId)) {
    return state;
  }
  return { ...state, actors: [...state.actors, payload] };
}

export function reduceWorldviewBindEquipment(
  state: WorldviewCompileGraphState,
  payload: WorldviewEquipmentBind,
): WorldviewCompileGraphState {
  const without = state.equipmentBinds.filter((bind) => bind.equipmentId !== payload.equipmentId);
  return { ...state, equipmentBinds: [...without, payload] };
}

export function reduceWorldviewApplyStation(
  state: WorldviewCompileGraphState,
  stationId: string,
  value: Record<string, unknown>,
): WorldviewCompileGraphState {
  return { ...state, stationPayloads: { ...state.stationPayloads, [stationId]: value } };
}

export function reduceWorldviewAddTrellisModel(
  state: WorldviewCompileGraphState,
  payload: WorldviewTrellisModel,
): WorldviewCompileGraphState {
  if (state.trellisModels.some((model) => model.modelId === payload.modelId)) {
    return state;
  }
  return { ...state, trellisModels: [...state.trellisModels, payload] };
}

export function reduceWorldviewAddNode(
  state: WorldviewCompileGraphState,
  nodeId: string,
): WorldviewCompileGraphState {
  if (state.extraNodeIds.includes(nodeId)) {
    return state;
  }
  return {
    ...state,
    extraNodeIds: [...state.extraNodeIds, nodeId],
    removedNodeIds: state.removedNodeIds.filter((id) => id !== nodeId),
  };
}

export function reduceWorldviewRemoveNode(
  state: WorldviewCompileGraphState,
  nodeId: string,
): WorldviewCompileGraphState {
  const actorId = actorIdFromCompileNode(nodeId);
  const equipmentId = nodeId.startsWith("equip:") ? nodeId.slice("equip:".length) : undefined;
  const trellisId = nodeId.startsWith("trellis:") ? nodeId.slice("trellis:".length) : undefined;
  return {
    actors: actorId === undefined ? state.actors : state.actors.filter((actor) => actor.actorId !== actorId),
    equipmentBinds:
      equipmentId === undefined ? state.equipmentBinds : state.equipmentBinds.filter((bind) => bind.equipmentId !== equipmentId),
    trellisModels:
      trellisId === undefined ? state.trellisModels : state.trellisModels.filter((model) => model.modelId !== trellisId),
    extraNodeIds: state.extraNodeIds.filter((id) => id !== nodeId),
    removedNodeIds: state.removedNodeIds.includes(nodeId) ? state.removedNodeIds : [...state.removedNodeIds, nodeId],
    stationPayloads: state.stationPayloads,
    manualEdges: state.manualEdges,
  };
}

/**
 * The "connect nodes" worldview action: a user picks two existing compile-graph node
 * ids and asks for a connection. `resolveCompileEdgeConnection` (WCG typed-port gate)
 * infers the one closed-vocabulary edge kind those two port types could form and
 * REFUSES the connection when the output type does not match the input type. A
 * refused attempt is recorded (`lastConnectionAttempt`) but no edge is added; an
 * accepted attempt appends the edge to `manualEdges` for `mergeWorldviewCompileEdges`.
 */
export function reduceWorldviewConnectNodes(
  state: WorldviewCompileGraphState,
  fromNodeId: string,
  toNodeId: string,
): WorldviewCompileGraphState {
  const resolution = resolveCompileEdgeConnection(fromNodeId, toNodeId);
  if (!resolution.ok) {
    return {
      ...state,
      lastConnectionAttempt: { ok: false, from: fromNodeId, to: toNodeId, reason: resolution.reason },
    };
  }
  const alreadyPresent = state.manualEdges.some(
    (edge) => edge.from === resolution.edge.from && edge.to === resolution.edge.to && edge.kind === resolution.edge.kind,
  );
  return {
    ...state,
    manualEdges: alreadyPresent ? state.manualEdges : [...state.manualEdges, resolution.edge],
    lastConnectionAttempt: { ok: true, edge: resolution.edge },
  };
}

/**
 * WCG typed-port gate. Every worldview action below used to stamp an ad hoc,
 * unvalidated `kind` — `actor.compileNodeKind` (a node FAMILY name, "ActorVariant",
 * not an edge kind), `"fixtureSlot"`, `"trellisBake"`, `"authored"` — none of them
 * checked against a vocabulary or against what port type the endpoints actually are.
 * Each is now built with the CLOSED, port-checked kind from `compile-edge-port-types.ts`
 * (`body_to_clothing`, `equip_to_fixture_slot`, `trellis_model_to_room`,
 * `standalone_node_declared`), and `validateCompileEdge` runs over EVERY edge —
 * base, worldview-derived, and manually connected — before it reaches the canvas.
 * A candidate that fails validation is dropped, never silently rendered as a
 * type-incoherent dependency.
 */
export function mergeWorldviewCompileEdges(
  base: readonly CompileEdge[],
  state: WorldviewCompileGraphState,
): CompileEdge[] {
  const extra: CompileEdge[] = [];
  for (const actor of state.actors) {
    extra.push({
      from: `actor:${actor.actorId}:body`,
      to: `actor:${actor.actorId}:wardrobe`,
      kind: "body_to_clothing",
    });
  }
  for (const bind of state.equipmentBinds) {
    extra.push({
      from: `equip:${bind.equipmentId}`,
      to: `fixture:${bind.fixtureSlot}`,
      kind: "equip_to_fixture_slot",
    });
  }
  for (const model of state.trellisModels) {
    extra.push({
      from: `trellis:${model.modelId}`,
      to: `room:equipment`,
      kind: "trellis_model_to_room",
    });
  }
  for (const nodeId of state.extraNodeIds) {
    extra.push({ from: nodeId, to: nodeId, kind: "standalone_node_declared" });
  }
  const candidates = [...base, ...extra, ...state.manualEdges].filter(
    (edge) => !state.removedNodeIds.includes(edge.from) && !state.removedNodeIds.includes(edge.to),
  );
  return candidates.filter((edge) => validateCompileEdge(edge).ok);
}

export function mergeWorldviewLockRows(
  base: readonly FacultyCompileLockRow[],
  state: WorldviewCompileGraphState,
): FacultyCompileLockRow[] {
  const extra: FacultyCompileLockRow[] = [];
  for (const actor of state.actors) {
    extra.push({
      rowId: `lock:actor:${actor.actorId}`,
      kind: "actor",
      compileSubject: actor.actorId,
      locked: false,
      stale: false,
      llmProposed: actor.compileNodeKind,
      facultyAccepted: "proposed",
    });
  }
  for (const bind of state.equipmentBinds) {
    extra.push({
      rowId: `lock:equipment:${bind.equipmentId}`,
      kind: "equipment",
      compileSubject: bind.equipmentId,
      locked: false,
      stale: false,
      overrideValue: bind.fixtureSlot,
      llmProposed: bind.fixtureSlot,
      facultyAccepted: bind.fixtureSlot,
    });
  }
  for (const model of state.trellisModels) {
    extra.push({
      rowId: `lock:trellis:${model.modelId}`,
      kind: "equipment",
      compileSubject: model.modelId,
      locked: false,
      stale: false,
      overrideValue: model.packId,
      llmProposed: "trellisBake",
      facultyAccepted: model.subjectId,
    });
  }
  const seen = new Set(extra.map((row) => row.rowId));
  const kept = base.filter((row) => !seen.has(row.rowId) && !isRemovedLockRow(row, state));
  return [...kept, ...extra].map(annotateProposedVsAccepted);
}

export function annotateProposedVsAccepted(row: FacultyCompileLockRow): FacultyCompileLockRow {
  const llmProposed = row.llmProposed ?? row.compileSubject;
  const facultyAccepted = row.locked ? String(row.overrideValue ?? "accepted") : (row.facultyAccepted ?? "proposed");
  return { ...row, llmProposed, facultyAccepted };
}

export function useWorldviewCompileGraph(): {
  state: WorldviewCompileGraphState;
  onAddActor: (payload: WorldviewActorDraft) => void;
  onBindEquipmentFixtureSlot: (payload: WorldviewEquipmentBind) => void;
  onAddTrellisModel: (payload: WorldviewTrellisModel) => void;
  onApplyStation: (stationId: string, value: Record<string, unknown>) => void;
  onAddNode: (nodeId: string) => void;
  onRemoveNode: (nodeId: string) => void;
  /** Typed-port "connect nodes" action (WCG). Refuses a mismatched pair; see reduceWorldviewConnectNodes. */
  onConnectNodes: (fromNodeId: string, toNodeId: string) => void;
} {
  const [state, setState] = useState(emptyWorldviewCompileGraph);
  const onAddActor = useCallback((payload: WorldviewActorDraft) => {
    setState((current) => reduceWorldviewAddActor(current, payload));
  }, []);
  const onBindEquipmentFixtureSlot = useCallback((payload: WorldviewEquipmentBind) => {
    setState((current) => reduceWorldviewBindEquipment(current, payload));
  }, []);
  const onAddTrellisModel = useCallback((payload: WorldviewTrellisModel) => {
    setState((current) => reduceWorldviewAddTrellisModel(current, payload));
  }, []);
  const onApplyStation = useCallback((stationId: string, value: Record<string, unknown>) => {
    setState((current) => reduceWorldviewApplyStation(current, stationId, value));
  }, []);
  const onAddNode = useCallback((nodeId: string) => {
    setState((current) => reduceWorldviewAddNode(current, nodeId));
  }, []);
  const onRemoveNode = useCallback((nodeId: string) => {
    setState((current) => reduceWorldviewRemoveNode(current, nodeId));
  }, []);
  const onConnectNodes = useCallback((fromNodeId: string, toNodeId: string) => {
    setState((current) => reduceWorldviewConnectNodes(current, fromNodeId, toNodeId));
  }, []);
  return {
    state,
    onAddActor,
    onBindEquipmentFixtureSlot,
    onAddTrellisModel,
    onApplyStation,
    onAddNode,
    onRemoveNode,
    onConnectNodes,
  };
}

function actorIdFromCompileNode(nodeId: string): string | undefined {
  if (!nodeId.startsWith("actor:")) {
    return undefined;
  }
  if (nodeId.endsWith(":body")) {
    return nodeId.slice("actor:".length, -":body".length);
  }
  if (nodeId.endsWith(":wardrobe")) {
    return nodeId.slice("actor:".length, -":wardrobe".length);
  }
  return nodeId.slice("actor:".length);
}

function isRemovedLockRow(row: FacultyCompileLockRow, state: WorldviewCompileGraphState): boolean {
  if (row.kind === "actor") {
    return (
      state.removedNodeIds.includes(`actor:${row.compileSubject}:body`) ||
      state.removedNodeIds.includes(`actor:${row.compileSubject}:wardrobe`)
    );
  }
  return (
    state.removedNodeIds.includes(`equip:${row.compileSubject}`) ||
    state.removedNodeIds.includes(`trellis:${row.compileSubject}`)
  );
}
