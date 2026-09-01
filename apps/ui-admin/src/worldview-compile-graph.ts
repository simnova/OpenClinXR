import { useCallback, useState } from "react";
import type { CompileEdge } from "./CompileGraphCanvas.js";
import type { FacultyCompileLockRow } from "./faculty-compile-lock.js";

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

export type WorldviewCompileGraphState = {
  actors: WorldviewActorDraft[];
  equipmentBinds: WorldviewEquipmentBind[];
  trellisModels: WorldviewTrellisModel[];
  extraNodeIds: string[];
  removedNodeIds: string[];
};

export function emptyWorldviewCompileGraph(): WorldviewCompileGraphState {
  return { actors: [], equipmentBinds: [], trellisModels: [], extraNodeIds: [], removedNodeIds: [] };
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
  };
}

export function mergeWorldviewCompileEdges(
  base: readonly CompileEdge[],
  state: WorldviewCompileGraphState,
): CompileEdge[] {
  const extra: CompileEdge[] = [];
  for (const actor of state.actors) {
    extra.push({
      from: `actor:${actor.actorId}:body`,
      to: `actor:${actor.actorId}:wardrobe`,
      kind: actor.compileNodeKind,
    });
  }
  for (const bind of state.equipmentBinds) {
    extra.push({
      from: `equip:${bind.equipmentId}`,
      to: `fixture:${bind.fixtureSlot}`,
      kind: "fixtureSlot",
    });
  }
  for (const model of state.trellisModels) {
    extra.push({
      from: `trellis:${model.modelId}`,
      to: `room:equipment`,
      kind: "trellisBake",
    });
  }
  for (const nodeId of state.extraNodeIds) {
    extra.push({ from: nodeId, to: nodeId, kind: "authored" });
  }
  return [...base, ...extra].filter(
    (edge) => !state.removedNodeIds.includes(edge.from) && !state.removedNodeIds.includes(edge.to),
  );
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
  onAddNode: (nodeId: string) => void;
  onRemoveNode: (nodeId: string) => void;
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
  const onAddNode = useCallback((nodeId: string) => {
    setState((current) => reduceWorldviewAddNode(current, nodeId));
  }, []);
  const onRemoveNode = useCallback((nodeId: string) => {
    setState((current) => reduceWorldviewRemoveNode(current, nodeId));
  }, []);
  return { state, onAddActor, onBindEquipmentFixtureSlot, onAddTrellisModel, onAddNode, onRemoveNode };
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
