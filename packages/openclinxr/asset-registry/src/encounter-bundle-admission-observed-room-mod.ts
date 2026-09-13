const GENERATED_ENVIRONMENT_SOURCE = "infinigen-generated-room";

function visitSceneUserData(scene: unknown, visit: (userData: Record<string, unknown>) => void): void {
  const seen = new Set<Record<string, unknown>>();
  const take = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const userData = (node as { userData?: unknown }).userData;
    if (userData === null || typeof userData !== "object" || Array.isArray(userData)) return;
    const bag = userData as Record<string, unknown>;
    if (seen.has(bag)) return;
    seen.add(bag);
    visit(bag);
  };
  take(scene);
  const traverse = (scene as { traverse?: (callback: (node: unknown) => void) => void }).traverse;
  if (typeof traverse === "function") {
    traverse.call(scene, take);
  }
}

/**
 * The generated hull is the room only after `loadInfinigenEnvironmentIntoStation` stamps
 * `openClinXrEnvironmentSource === "infinigen-generated-room"`. Until then the observed graph is
 * the parametric shell (~937 ms on the 2026-09-13 sc-05 capture). Judging that shell refuses a
 * correct freeze and the refusal latches.
 *
 * Unmapped / compiled-room paths never enter `pending` and never grow that stamp: the
 * procedural box is then the room and is judged immediately.
 *
 * A `failed` load is different: the procedural box is NOT the room the plan was frozen against
 * (the freeze captured the hull-reanchored room). Judging the box would refuse a correct freeze
 * and latch permanently with no recovery. We therefore DEFER on `failed` — the admission logic
 * in `admitFrozenScenePlanForObservedScene` detects `failed` and refuses with a specific reason
 * ("generated_room_load_failed") that the runtime can surface, rather than silently refusing on
 * a geometry mismatch against the wrong room.
 */
export function observedRoomIsReadyToJudge(scene: unknown): boolean {
  let generatedPresent = false;
  let pending = false;
  let failed = false;
  visitSceneUserData(scene, (userData) => {
    if (userData["openClinXrEnvironmentSource"] === GENERATED_ENVIRONMENT_SOURCE) {
      generatedPresent = true;
    }
    const status = userData["openClinXrInfinigenEnvironmentStatus"];
    if (status !== null && typeof status === "object" && !Array.isArray(status)) {
      const state = (status as { state?: unknown }).state;
      if (state === "pending") pending = true;
      else if (state === "failed") failed = true;
    }
  });
  if (generatedPresent) return true;
  if (failed) return false; // defer — admission will refuse with "generated_room_load_failed"
  return !pending;
}

/**
 * Detects if the Infinigen room load has failed.
 * Returns the error message if failed, null otherwise.
 * Reuses the same traversal logic as `observedRoomIsReadyToJudge`.
 */
export function observedRoomLoadFailure(scene: unknown): { error?: string } | null {
  let failedError: string | undefined;
  visitSceneUserData(scene, (userData) => {
    const status = userData["openClinXrInfinigenEnvironmentStatus"];
    if (status !== null && typeof status === "object" && !Array.isArray(status)) {
      const state = (status as { state?: unknown; error?: string }).state;
      if (state === "failed") {
        failedError = (status as { error?: string }).error;
      }
    }
  });
  if (failedError !== undefined) {
    return { error: failedError };
  }
  return null;
}
