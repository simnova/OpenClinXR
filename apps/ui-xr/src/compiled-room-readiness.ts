/**
 * Compiled-room runtime readiness: resolve authored actor/equipment anchors
 * against the loaded scene, derive collision/walkable bounds, and refuse
 * missing or duplicate anchors with typed diagnostics.
 *
 * A successful GLB fetch is not readiness. Fail-closed: malformed metadata,
 * unresolved anchors, or an empty compiled scene are not ready.
 *
 * claimScope: simulated_actor_or_factory_behavior
 * notEvidenceFor: clinical validity, licensure, exam equivalence, Quest readiness
 */

import type { Object3D } from "three";

export type CompiledRoomAnchorKind = "actor" | "equipment";

export type CompiledRoomVec3 = { x: number; y: number; z: number };

export type CompiledRoomBounds = {
  min: CompiledRoomVec3;
  max: CompiledRoomVec3;
};

export type CompiledRoomAnchorDeclaration = {
  id: string;
  kind: CompiledRoomAnchorKind;
  nodeName: string;
};

export type CompiledRoomAuthoredMetadata = {
  actorAnchors: CompiledRoomAnchorDeclaration[];
  equipmentAnchors: CompiledRoomAnchorDeclaration[];
  collisionBounds: CompiledRoomBounds;
  walkableBounds: CompiledRoomBounds;
};

export type CompiledRoomReadinessCode =
  | "ready"
  | "missing_anchor"
  | "duplicate_anchor"
  | "malformed_metadata"
  | "malformed_bounds"
  | "empty_scene"
  | "load_failure"
  | "compiled_asset_absent";

export type CompiledRoomReadinessDiagnostic = {
  code: Exclude<CompiledRoomReadinessCode, "ready">;
  message: string;
  anchorId?: string;
  nodeName?: string;
};

export type CompiledRoomResolvedAnchor = {
  id: string;
  kind: CompiledRoomAnchorKind;
  nodeName: string;
  position: CompiledRoomVec3;
};

export type CompiledRoomReadinessResult =
  | {
      ready: true;
      diagnostics: [];
      resolvedAnchors: CompiledRoomResolvedAnchor[];
      collisionBounds: CompiledRoomBounds;
      walkableBounds: CompiledRoomBounds;
      metadata: CompiledRoomAuthoredMetadata;
    }
  | {
      ready: false;
      diagnostics: CompiledRoomReadinessDiagnostic[];
      resolvedAnchors: CompiledRoomResolvedAnchor[];
      collisionBounds: CompiledRoomBounds | null;
      walkableBounds: CompiledRoomBounds | null;
      metadata: CompiledRoomAuthoredMetadata | null;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseVec3(value: unknown): CompiledRoomVec3 | null {
  if (!isRecord(value)) return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.z)) {
    return null;
  }
  return { x: value.x, y: value.y, z: value.z };
}

function parseBounds(value: unknown): CompiledRoomBounds | null {
  if (!isRecord(value)) return null;
  const min = parseVec3(value.min);
  const max = parseVec3(value.max);
  if (!min || !max) return null;
  if (min.x >= max.x || min.y >= max.y || min.z >= max.z) return null;
  return { min, max };
}

function parseAnchor(
  value: unknown,
  expectedKind: CompiledRoomAnchorKind,
): CompiledRoomAnchorDeclaration | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const nodeName = typeof value.nodeName === "string" ? value.nodeName.trim() : "";
  const kind = value.kind;
  if (!id || !nodeName) return null;
  if (kind !== expectedKind) return null;
  return { id, kind: expectedKind, nodeName };
}

function parseAnchorList(
  value: unknown,
  expectedKind: CompiledRoomAnchorKind,
): CompiledRoomAnchorDeclaration[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: CompiledRoomAnchorDeclaration[] = [];
  for (const item of value) {
    const anchor = parseAnchor(item, expectedKind);
    if (!anchor) return null;
    parsed.push(anchor);
  }
  return parsed;
}

export function parseCompiledRoomAuthoredMetadata(
  value: unknown,
): { metadata: CompiledRoomAuthoredMetadata } | { diagnostics: CompiledRoomReadinessDiagnostic[] } {
  if (!isRecord(value)) {
    return {
      diagnostics: [{
        code: "malformed_metadata",
        message: "compiled-room metadata must be an object",
      }],
    };
  }
  const actorAnchors = parseAnchorList(value.actorAnchors, "actor");
  const equipmentAnchors = parseAnchorList(value.equipmentAnchors, "equipment");
  if (!actorAnchors || !equipmentAnchors) {
    return {
      diagnostics: [{
        code: "malformed_metadata",
        message: "actorAnchors and equipmentAnchors must be arrays of {id, kind, nodeName}",
      }],
    };
  }
  const collisionBounds = parseBounds(value.collisionBounds);
  const walkableBounds = parseBounds(value.walkableBounds);
  if (!collisionBounds || !walkableBounds) {
    return {
      diagnostics: [{
        code: "malformed_bounds",
        message: "collisionBounds and walkableBounds require finite min < max on x,y,z",
      }],
    };
  }
  return {
    metadata: { actorAnchors, equipmentAnchors, collisionBounds, walkableBounds },
  };
}

function indexSceneNodes(root: Object3D): Map<string, Object3D[]> {
  const byName = new Map<string, Object3D[]>();
  root.traverse((node: Object3D) => {
    const name = node.name?.trim() ?? "";
    if (!name) return;
    const list = byName.get(name);
    if (list) list.push(node);
    else byName.set(name, [node]);
  });
  return byName;
}

function sceneHasContent(root: Object3D): boolean {
  return root.children.length > 0;
}

function positionOf(node: Object3D): CompiledRoomVec3 {
  return { x: node.position.x, y: node.position.y, z: node.position.z };
}

/**
 * Evaluate authored compiled-room metadata against a loaded scene graph.
 * Does not load assets and does not spawn the parametric fallback.
 */
export function evaluateCompiledRoomReadiness(input: {
  scene: Object3D;
  metadata: unknown;
}): CompiledRoomReadinessResult {
  const parsed = parseCompiledRoomAuthoredMetadata(input.metadata);
  if ("diagnostics" in parsed) {
    return {
      ready: false,
      diagnostics: parsed.diagnostics,
      resolvedAnchors: [],
      collisionBounds: null,
      walkableBounds: null,
      metadata: null,
    };
  }
  const { metadata } = parsed;
  if (!sceneHasContent(input.scene)) {
    return {
      ready: false,
      diagnostics: [{
        code: "empty_scene",
        message: "compiled room scene has no children; refusing a blank encounter",
      }],
      resolvedAnchors: [],
      collisionBounds: metadata.collisionBounds,
      walkableBounds: metadata.walkableBounds,
      metadata,
    };
  }

  const declarations = [...metadata.actorAnchors, ...metadata.equipmentAnchors];
  const diagnostics: CompiledRoomReadinessDiagnostic[] = [];
  const seenIds = new Set<string>();
  const seenNodeNames = new Set<string>();
  for (const decl of declarations) {
    if (seenIds.has(decl.id)) {
      diagnostics.push({
        code: "duplicate_anchor",
        message: `duplicate anchor id "${decl.id}"`,
        anchorId: decl.id,
        nodeName: decl.nodeName,
      });
    }
    seenIds.add(decl.id);
    if (seenNodeNames.has(decl.nodeName)) {
      diagnostics.push({
        code: "duplicate_anchor",
        message: `duplicate anchor nodeName "${decl.nodeName}"`,
        anchorId: decl.id,
        nodeName: decl.nodeName,
      });
    }
    seenNodeNames.add(decl.nodeName);
  }

  const nodes = indexSceneNodes(input.scene);
  const resolvedAnchors: CompiledRoomResolvedAnchor[] = [];
  for (const decl of declarations) {
    const matches = nodes.get(decl.nodeName) ?? [];
    if (matches.length === 0) {
      diagnostics.push({
        code: "missing_anchor",
        message: `anchor "${decl.id}" node "${decl.nodeName}" is missing from the compiled scene`,
        anchorId: decl.id,
        nodeName: decl.nodeName,
      });
      continue;
    }
    if (matches.length > 1) {
      diagnostics.push({
        code: "duplicate_anchor",
        message: `anchor "${decl.id}" node "${decl.nodeName}" appears ${matches.length} times`,
        anchorId: decl.id,
        nodeName: decl.nodeName,
      });
      continue;
    }
    const node = matches[0];
    if (!node) {
      diagnostics.push({
        code: "missing_anchor",
        message: `anchor "${decl.id}" node "${decl.nodeName}" is missing from the compiled scene`,
        anchorId: decl.id,
        nodeName: decl.nodeName,
      });
      continue;
    }
    resolvedAnchors.push({
      id: decl.id,
      kind: decl.kind,
      nodeName: decl.nodeName,
      position: positionOf(node),
    });
  }

  if (diagnostics.length > 0) {
    return {
      ready: false,
      diagnostics,
      resolvedAnchors,
      collisionBounds: metadata.collisionBounds,
      walkableBounds: metadata.walkableBounds,
      metadata,
    };
  }

  return {
    ready: true,
    diagnostics: [],
    resolvedAnchors,
    collisionBounds: metadata.collisionBounds,
    walkableBounds: metadata.walkableBounds,
    metadata,
  };
}

export function stampCompiledRoomReadinessUserData(
  root: Object3D,
  result: CompiledRoomReadinessResult,
): void {
  root.userData.openClinXrCompiledRoomReadiness = result.ready ? "ready" : "fallback";
  root.userData.openClinXrCompiledRoomDiagnostics = result.diagnostics;
  root.userData.openClinXrCompiledRoomResolvedAnchors = result.resolvedAnchors;
  root.userData.openClinXrCompiledRoomCollisionBounds = result.collisionBounds;
  root.userData.openClinXrCompiledRoomWalkableBounds = result.walkableBounds;
}
