/**
 * #249 — contact shadows for the CAPTURE renderer only.
 *
 * The capture renderer had no shadow mapping, so correctly grounded figures read as floating
 * in every pixel grade (measured in #247: lowest skinned vertices y ∈ [−0.011, +0.009], floor
 * top y = 0, foot-to-floor gap 0.5–1.8 px at 1440×900, `castShadow` nowhere in the renderer).
 * A contact shadow is the single cue that tells a viewer an object rests on a surface; without
 * it no grader — human or model — can distinguish "grounded" from "hovering 2 cm" at station
 * framing distance.
 *
 * This is a GRADING INSTRUMENT, deliberately capture-path-only: it activates when the URL
 * carries `capture` / `openclinxrCaptureMode` (i.e. selectedCaptureMode() !== ""). The learner
 * runtime renders with no capture param, so shadows stay off there — a lighting change to the
 * product to fix a grading instrument would be the wrong trade.
 *
 * claimScope: contact shadows visible in capture screenshots only; the shadow ortho frustum
 * (±6 m) covers the 7 m × 3.45 m parametric floor around origin.
 * notEvidenceFor: learner-runtime lighting, clinical staging, Quest readiness.
 */
import {
  DirectionalLight,
  Mesh,
  type Object3D,
  PCFSoftShadowMap,
  type Scene,
  type WebGLRenderer,
} from "three";

/** True when the running page is a capture (URL carries capture/openclinxrCaptureMode). */
export function isCaptureShadowPath(captureMode: string): boolean {
  return captureMode.length > 0;
}

/**
 * Enable shadow mapping on the capture renderer. Must run before the first render.
 * PCFSoft gives the soft contact shadow a pixel grade needs; hard shadows alias badly.
 */
export function enableCaptureRendererShadowMap(renderer: WebGLRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
}

/**
 * Create the scene's key light and add it (plus its shadow-camera target) to the scene.
 * In the capture path the key light casts a contact shadow sized to the station floor.
 */
export function createCaptureKeyLight(input: {
  name: string;
  scene: Scene;
  active: boolean;
}): DirectionalLight {
  // Ward clinic_day rebalance (stage1-albedo job 2026-09-29): 2.5 -> 1.0.
  // The world-fixed key blasts the door wall (+22 diffuse on pose-01,
  // zero on pose-02 -- measured key-off probe) while the v2 reference is
  // balanced across both views. Pose-02 is key-independent (0.0 drop), so
  // this knob cannot regress it by construction. Swept 2.5/1.0/0.5;
  // shadows still cast above zero (contact-shadow role kept).
  const key = new DirectionalLight(0xffffff, 1.0);
  // Retarget (0,0,0) -> (0.2,-2.2,2.8): the to-light direction goes from
  // (3,5,4)/8.06 (door-wall incidence 0.50, floor 0.62) to
  // (0.35,0.9,0.15) (door wall 0.15, floor 0.90). The door-wall blast drops
  // ~70% while floor key holds (both floors need it: ref floor gap is
  // 16 units and floors share albedo/orientation). Target is always added:
  // an unparented target never updates matrixWorld and the aim silently
  // stays at the origin.
  key.target.position.set(0.2, -2.2, 2.8);
  input.scene.add(key.target);
  key.name = input.name;
  key.position.set(3, 5, 4);
  if (input.active) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 25;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    input.scene.add(key.target);
  }
  input.scene.add(key);
  return key;
}

/** Capture path only: the floor receives contact shadows (floor top is y = 0). */
export function markFloorReceiveShadow(floor: Mesh): void {
  floor.receiveShadow = true;
}

/** Capture path only: every mesh of a loaded humanoid casts a contact shadow. */
export function markActorCastShadow(root: Object3D): void {
  root.traverse((object) => {
    if (object instanceof Mesh) {
      object.castShadow = true;
      object.userData.openClinXrCaptureShadowPolicy =
        "cast_shadow_for_capture_path_contact_shadows";
    }
  });
}
