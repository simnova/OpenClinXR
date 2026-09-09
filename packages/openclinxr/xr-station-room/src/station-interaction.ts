import { Vector3 } from "three";
import type { Mesh, PerspectiveCamera, WebGLRenderer } from "three";

/**
 * Everything the desktop pointer ray needs. `clinicalTouchRegionTargets` is an ACCESSOR because
 * the app pushes to that list as touch regions mount, after this wiring runs; a value captured
 * here would be the empty array forever.
 */
/** The trace sources a clinical touch can be attributed to. */
export type StationClinicalTouchSource =
  | "dom_click_trace_button"
  | "xr_controller_select"
  | "xr_hand_select";

export interface StationPointerInteractionContext {
  readonly renderer: WebGLRenderer;
  readonly camera: PerspectiveCamera;
  /** Fires a clinical touch when the ray hits a body region; a miss does nothing. */
  readonly tryClinicalTouchFromNdc: (
    camera: PerspectiveCamera,
    ndcX: number,
    ndcY: number,
    source: StationClinicalTouchSource,
  ) => unknown;
  readonly clinicalTouchRegionTargets: () => readonly Mesh[];
}

/**
 * Wires the desktop pointer ray and the headless projection hook for the interaction stage.
 *
 * The hook lets the clinical-touch gate click the REAL canvas at the REAL pixel a region
 * projects to, so the headless path exercises the same raycast a learner does rather than a
 * parallel one that could drift from it.
 */
export function wireStationPointerInteraction(ctx: StationPointerInteractionContext): void {
  const { renderer, camera } = ctx;
  renderer.domElement.addEventListener("pointerdown", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    ctx.tryClinicalTouchFromNdc(camera, ndcX, ndcY, "dom_click_trace_button");
  });
  (
    window as unknown as {
      __openClinXrProjectTouchRegionToScreen?: (regionId: string) => { x: number; y: number } | null;
    }
  ).__openClinXrProjectTouchRegionToScreen = (regionId) => {
    const mesh = ctx
      .clinicalTouchRegionTargets()
      .find((target) => target.userData["openClinXrTouchRegionId"] === regionId);
    if (!mesh) return null;
    mesh.updateWorldMatrix(true, false);
    const ndc = new Vector3().setFromMatrixPosition(mesh.matrixWorld).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((ndc.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - ndc.y) / 2) * rect.height,
    };
  };
}
