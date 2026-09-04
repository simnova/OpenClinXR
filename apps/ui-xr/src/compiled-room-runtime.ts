/**
 * Readiness glue for the existing compiled-room runtime mount.
 *
 * Absence of authored metadata preserves PR #789 (compiled GLB from a
 * successful fetch). When metadata is present, missing/duplicate anchors or
 * malformed bounds refuse the compiled shell and fall back to the parametric
 * room. This is not a second mount API — `mountStationEnvironmentForRuntime`
 * is the learner entry.
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
} from "./compiled-room-readiness.js";
import { resolveStationEnvironment } from "./station-environment.js";

export async function fallbackPrimitiveStationShell(input: {
  environmentId: string;
  diagnostics: CompiledRoomReadinessDiagnostic[];
  compileNodeIdAttempted?: string;
  loadFailed?: boolean;
}): Promise<Group> {
  const root = await resolveStationEnvironment({ environmentId: input.environmentId });
  const notReady: CompiledRoomReadinessResult = {
    ready: false,
    diagnostics: input.diagnostics,
    resolvedAnchors: [],
    collisionBounds: null,
    walkableBounds: null,
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
  return root;
}

/**
 * After a compiled GLB load, apply authored-metadata readiness or keep #789.
 * Metadata comes from `compiled.userData.openClinXrCompiledRoomMetadata`.
 */
export async function applyCompiledRoomReadinessOrFallback(input: {
  compiled: Group;
  environmentId: string;
  compileNodeId: string;
}): Promise<Group> {
  const metadata = input.compiled.userData.openClinXrCompiledRoomMetadata;
  if (metadata === undefined || metadata === null) {
    return input.compiled;
  }
  const readiness = evaluateCompiledRoomReadiness({
    scene: input.compiled,
    metadata,
  });
  if (readiness.ready) {
    stampCompiledRoomReadinessUserData(input.compiled, readiness);
    input.compiled.userData.openClinXrCompiledRoomFallback = false;
    return input.compiled;
  }
  return fallbackPrimitiveStationShell({
    environmentId: input.environmentId,
    compileNodeIdAttempted: input.compileNodeId,
    diagnostics: readiness.diagnostics,
  });
}

export async function fallbackCompiledRoomLoadFailure(input: {
  environmentId: string;
  compileNodeId: string;
  message: string;
}): Promise<Group> {
  return fallbackPrimitiveStationShell({
    environmentId: input.environmentId,
    compileNodeIdAttempted: input.compileNodeId,
    loadFailed: true,
    diagnostics: [{ code: "load_failure", message: input.message }],
  });
}
