/**
 * Freeze-bound wall-anchor restore and read-only admission telemetry.
 *
 * The SC-06 freeze runs `buildStationEnvironment` only. The shipped runtime then loads the
 * Infinigen hull and slides `door_leaf` / `wall_board` (measured 2026-09-13: +1.465 m / −1.465 m,
 * digest geom-v1-c45e274d-7 → geom-v1-cdaa4a22-7). Comparison stays strict; fixtures return to
 * the freeze positions before the digest is measured. Telemetry does not write scene state.
 */

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type WallAnchorSceneRoot = {
  traverse: (
    callback: (node: { position: { x: number; z: number }; userData: Record<string, unknown> }) => void,
  ) => void;
  updateMatrixWorld: (force?: boolean) => void;
};

export function restoreWallAnchorsMovedByGeneratedRoom(root: WallAnchorSceneRoot): number {
  let restored = 0;
  root.traverse((node) => {
    const rec = node.userData["openClinXrWallAnchorReanchored"];
    if (!isRecordObject(rec) || rec["frozenPlanRestored"] === true) return;
    rec["frozenPlanRestored"] = true;
    const moved = rec["movedMeters"];
    const anchor = node.userData["openClinXrWallAnchor"];
    if (typeof moved !== "number" || moved === 0 || !isRecordObject(anchor)) return;
    const wall = anchor["wall"];
    if (wall === "+x" || wall === "-x") node.position.x -= moved;
    else node.position.z -= moved;
    restored += 1;
  });
  root.updateMatrixWorld(true);
  return restored;
}

export function prepareObservedSceneForAdmission(scene: unknown): void {
  if (
    isRecordObject(scene)
    && typeof scene["traverse"] === "function"
    && typeof scene["updateMatrixWorld"] === "function"
  ) {
    restoreWallAnchorsMovedByGeneratedRoom(scene as unknown as WallAnchorSceneRoot);
  }
}

export function publishFrozenScenePlanAdmission(admission: {
  status: string;
  reproduced?: unknown;
  reason?: string;
  detail?: string;
  observedGeometryRevision?: string;
}): void {
  const host = (globalThis as unknown as { window?: Record<string, unknown> }).window
    ?? (globalThis as unknown as Record<string, unknown>);
  host["__openClinXrFrozenScenePlanAdmission"] = {
    source: "window.__openClinXrFrozenScenePlanAdmission",
    status: admission.status,
    reproduced: admission.status === "admitted" && admission.reproduced !== null && admission.reproduced !== undefined,
    reason: admission.status === "refused" ? (admission.reason ?? null) : null,
    detail: admission.status === "refused" ? (admission.detail ?? null) : null,
    observedGeometryRevision:
      admission.status === "no_plan_carried" ? null : (admission.observedGeometryRevision ?? null),
  };
}
