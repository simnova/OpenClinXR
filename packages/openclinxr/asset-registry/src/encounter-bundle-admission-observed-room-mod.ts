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
 * Unmapped / failed / compiled-room paths never enter `pending` and never grow that stamp: the
 * procedural box is then the room and is judged immediately.
 */
export function observedRoomIsReadyToJudge(scene: unknown): boolean {
  let generatedPresent = false;
  let pending = false;
  visitSceneUserData(scene, (userData) => {
    if (userData["openClinXrEnvironmentSource"] === GENERATED_ENVIRONMENT_SOURCE) {
      generatedPresent = true;
    }
    const status = userData["openClinXrInfinigenEnvironmentStatus"];
    if (status !== null && typeof status === "object" && !Array.isArray(status)) {
      if ((status as { state?: unknown }).state === "pending") pending = true;
    }
  });
  if (generatedPresent) return true;
  return !pending;
}
