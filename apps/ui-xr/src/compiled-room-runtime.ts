/**
 * Compiled-room consumer with an explicit readiness boundary.
 *
 * Loads the compiled GLB, evaluates authored anchors/bounds, and falls back to
 * the parametric primitive room when the compiled scene is not ready. Never
 * presents a blank or partially interactive compiled shell.
 *
 * claimScope: simulated_actor_or_factory_behavior
 * notEvidenceFor: clinical validity, licensure, exam equivalence, Quest readiness
 */

import type { Group } from "three";
import {
  evaluateCompiledRoomReadiness,
  stampCompiledRoomReadinessUserData,
  type CompiledRoomReadinessDiagnostic,
  type CompiledRoomReadinessResult,
  type CompiledRoomResolvedAnchor,
  type CompiledRoomBounds,
} from "./compiled-room-readiness.js";
import { hasCompiledRoomAssetUrl, loadCompiledRoomShell } from "./compiled-room-loader.js";
import { resolveStationEnvironment } from "./station-environment.js";

export type MountCompiledRoomReadyInput = {
  environmentId: string;
  compiledRoomAssetUrl?: string;
  compileNodeId?: string;
  /** Authored sidecar. If omitted, read `scene.userData.openClinXrCompiledRoomMetadata`. */
  metadata?: unknown;
  loadGltf?: (url: string) => Promise<Group>;
};

export type MountCompiledRoomReadyResult = {
  root: Group;
  mode: "compiled_ready" | "primitive_fallback";
  diagnostics: CompiledRoomReadinessDiagnostic[];
  resolvedAnchors: CompiledRoomResolvedAnchor[];
  collisionBounds: CompiledRoomBounds | null;
  walkableBounds: CompiledRoomBounds | null;
};

async function primitiveFallback(input: {
  environmentId: string;
  diagnostics: CompiledRoomReadinessDiagnostic[];
  resolvedAnchors?: CompiledRoomResolvedAnchor[];
  collisionBounds?: CompiledRoomBounds | null;
  walkableBounds?: CompiledRoomBounds | null;
  compileNodeIdAttempted?: string;
  loadFailed?: boolean;
}): Promise<MountCompiledRoomReadyResult> {
  const root = await resolveStationEnvironment({ environmentId: input.environmentId });
  const notReady: CompiledRoomReadinessResult = {
    ready: false,
    diagnostics: input.diagnostics,
    resolvedAnchors: input.resolvedAnchors ?? [],
    collisionBounds: input.collisionBounds ?? null,
    walkableBounds: input.walkableBounds ?? null,
    metadata: null,
  };
  stampCompiledRoomReadinessUserData(root, notReady);
  root.userData.openClinXrCompiledRoomFallback = true;
  if (input.compileNodeIdAttempted) {
    root.userData.compileNodeIdAttempted = input.compileNodeIdAttempted;
  }
  if (input.loadFailed) {
    root.userData.openClinXrCompiledRoomLoadFailed = true;
  }
  return {
    root,
    mode: "primitive_fallback",
    diagnostics: input.diagnostics,
    resolvedAnchors: notReady.resolvedAnchors,
    collisionBounds: notReady.collisionBounds,
    walkableBounds: notReady.walkableBounds,
  };
}

/**
 * Mount a compiled room only when anchors and bounds are ready.
 * Otherwise return the existing parametric primitive shell.
 */
export async function mountCompiledRoomReady(
  input: MountCompiledRoomReadyInput,
): Promise<MountCompiledRoomReadyResult> {
  const environmentId = input.environmentId;
  const compiledRoomAssetUrl = input.compiledRoomAssetUrl?.trim() ?? "";
  const compileNodeId = input.compileNodeId?.trim() ?? "";

  if (!hasCompiledRoomAssetUrl({ compiledRoomAssetUrl, compileNodeId })) {
    return primitiveFallback({
      environmentId,
      diagnostics: [{
        code: "compiled_asset_absent",
        message: "compiled room URL or compileNodeId absent; using primitive room",
      }],
    });
  }

  let compiled: Group;
  try {
    compiled = await loadCompiledRoomShell({
      environmentId,
      compiledRoomAssetUrl,
      compileNodeId,
      ...(input.loadGltf ? { loadGltf: input.loadGltf } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "compiled room load failed";
    return primitiveFallback({
      environmentId,
      compileNodeIdAttempted: compileNodeId,
      loadFailed: true,
      diagnostics: [{
        code: "load_failure",
        message,
      }],
    });
  }

  const metadata = input.metadata ?? compiled.userData.openClinXrCompiledRoomMetadata;
  const readiness = evaluateCompiledRoomReadiness({ scene: compiled, metadata });
  if (!readiness.ready) {
    return primitiveFallback({
      environmentId,
      compileNodeIdAttempted: compileNodeId,
      diagnostics: readiness.diagnostics,
      resolvedAnchors: readiness.resolvedAnchors,
      collisionBounds: readiness.collisionBounds,
      walkableBounds: readiness.walkableBounds,
    });
  }

  stampCompiledRoomReadinessUserData(compiled, readiness);
  compiled.userData.openClinXrCompiledRoomFallback = false;
  return {
    root: compiled,
    mode: "compiled_ready",
    diagnostics: [],
    resolvedAnchors: readiness.resolvedAnchors,
    collisionBounds: readiness.collisionBounds,
    walkableBounds: readiness.walkableBounds,
  };
}
