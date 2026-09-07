/**
 * ED-bay-visible + deterministic-capture + comparator camera block.
 * Extracted from main.ts (shrink-only SIZE_FREEZE ceiling).
 */
import type { Object3D, PerspectiveCamera } from "three";
import { Vector3 } from "three";
import { computeMeshBounds, frameCamera } from "@openclinxr/xr-scene";

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    /** Deterministic ED-bay-visible capture: authored comparator camera pose readback. */
    __openClinXrEdBayVisibleCameraPose?: {
      framing: string | null;
      position: { x: number; y: number; z: number };
    } | undefined;
    /** #315: model assetId of the actor a comparator capture framed (recorded intent). */
    __openClinXrComparatorCameraTargetActorId?: string;
    /** #315 follow-up: framing measurement — NDC of the framed subject + per-slot visibility/NDC. */
    __openClinXrComparatorFramingDump?: {
      comparator: string;
      namedActorId: string;
      boundsMin: { x: number; y: number; z: number };
      boundsMax: { x: number; y: number; z: number };
      boundsCenter: { x: number; y: number; z: number };
      camPositionLocal: { x: number; y: number; z: number };
      camWorldPosition: { x: number; y: number; z: number };
      camParentName: string | null;
      camParentMatrixWorld: number[] | null;
      frameSpanFraction: number | null;
      ndcBoundsCenter: { x: number; y: number; z: number };
      namedActorSlotVisible: boolean | null;
      slots: Array<{
        slotKind: string;
        actorId: string;
        visible: boolean;
        worldCenter: { x: number; y: number; z: number };
        ndc: { x: number; y: number; z: number };
      }>;
    };
  }
}

export { isDeterministicCaptureClock, isEdBayVisibleCaptureMode } from "@openclinxr/xr-capture-evidence";

/** #315: camera + scene root the comparator capture frames through (assigned in createStationScene). */
let comparatorCaptureCamera: PerspectiveCamera | null = null;
let comparatorCaptureSceneRoot: Object3D | null = null;

export function setComparatorCaptureCamera(camera: PerspectiveCamera | null): void {
  comparatorCaptureCamera = camera;
}

export function setComparatorCaptureSceneRoot(root: Object3D | null): void {
  comparatorCaptureSceneRoot = root;
}

export const ED_BAY_VISIBLE_COMPARATOR_CAMERA_FRAMING =
  "clean_ed_anny_real_garment_source_comparator_full_body_ed_gown_sleeve_deform_capture_ed_bay_ed-gown-geo-reorchestrate";

// ed-gown-geo-reorchestrate (Q1+Q5): patient lies supine at x≈-0.9 on the
// stretcher, so the pose is shifted left and pulled inside the closed
// Infinigen shell (world z≈1.83 < room max 2.22) with the door-leaf
// occluder at frame edge; lookAt targets the stretcher torso/feet.
export function applyEdBayVisibleComparatorCameraPose(
  camera: PerspectiveCamera,
  comparator: string | null,
): boolean {
  if (comparator !== "ed_anny_real_garment_patient") return false;
  camera.fov = 50;
  camera.position.set(-0.35, 1.0, 2.45);
  camera.lookAt(-0.95, 0.7, -0.25);
  camera.userData.openClinXrCameraFraming = ED_BAY_VISIBLE_COMPARATOR_CAMERA_FRAMING;
  return true;
}

/**
 * #315: frame a comparator capture on the NAMED actor after it loads.
 * `peds_anny_real_garment_parent` names the family actor, `..._nurse` the clinical-team
 * actor. The camera is constructed before any humanoid exists, so authored numbers were
 * always a guess about where an actor would end up (two hand-fixes reverted — see the
 * planted contract header). Reuse the proven fit-to-bounds solve (frameCamera) against
 * the loaded actor's world AABB, and record the model assetId it framed so a gate can
 * check recorded intent — a test cannot see a picture and byte size is not identity.
 */
export function frameComparatorCaptureOnNamedActor(options: {
  actorId: string;
  humanoid: Object3D;
  modelAssetId: string;
  comparator: string | null;
  namedActorId: string | null;
  cleanCapture: boolean;
}): void {
  const { actorId, humanoid, modelAssetId, comparator, namedActorId, cleanCapture } = options;
  if (comparator !== "peds_anny_real_garment_parent" && comparator !== "peds_anny_real_garment_nurse") return;
  if (!cleanCapture) return;
  if (!namedActorId || actorId !== namedActorId) return;
  const cam = comparatorCaptureCamera;
  if (!cam) return;
  // World matrices must be current for the freshly-added subtree (#315 parent-aware solve).
  comparatorCaptureSceneRoot?.updateMatrixWorld(true);
  const bounds = computeMeshBounds(humanoid);
  if (!Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.x)) return;
  const center = bounds.getCenter(new Vector3());
  const frameSpanFraction = frameCamera(cam, bounds, "front");
  cam.userData.openClinXrCameraFraming =
    `clean_${comparator}_source_comparator_fit_to_bounds_named_actor_${namedActorId}_no_authored_numbers`;
  cam.userData.openClinXrComparatorFrameSpanFraction = frameSpanFraction;
  window.__openClinXrComparatorCameraTargetActorId = modelAssetId;
  // #315 follow-up: recorded framing dump — NDC projection of the framed subject's
  // world center plus every actor slot's visibility/NDC, so a framing miss is a
  // measurement, not a pixel guess. A slot with visible=false cannot be the figure
  // in the frame even though the camera aims at it.
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  const projectNdc = (point: Vector3): { x: number; y: number; z: number } => {
    const p = point.clone().applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
    return { x: Number(p.x.toFixed(3)), y: Number(p.y.toFixed(3)), z: Number(p.z.toFixed(3)) };
  };
  const slotRows: NonNullable<NonNullable<Window["__openClinXrComparatorFramingDump"]>["slots"]> = [];
  comparatorCaptureSceneRoot?.updateMatrixWorld(true);
  comparatorCaptureSceneRoot?.traverse((o) => {
    const slotKind = (o as { userData?: { openClinXrSlotKind?: string } }).userData?.openClinXrSlotKind;
    const slotActorId = (o as { userData?: { openClinXrActorId?: string } }).userData?.openClinXrActorId;
    if (typeof slotKind !== "string" || typeof slotActorId !== "string" || slotActorId.length === 0) return;
    const slotBounds = computeMeshBounds(o as Object3D);
    if (!Number.isFinite(slotBounds.min.x)) return;
    const slotCenter = slotBounds.getCenter(new Vector3());
    slotRows.push({
      slotKind,
      actorId: slotActorId,
      visible: (o as { visible: boolean }).visible,
      worldCenter: { x: Number(slotCenter.x.toFixed(3)), y: Number(slotCenter.y.toFixed(3)), z: Number(slotCenter.z.toFixed(3)) },
      ndc: projectNdc(slotCenter),
    });
  });
  const worldPos = new Vector3();
  cam.getWorldPosition(worldPos);
  window.__openClinXrComparatorFramingDump = {
    comparator,
    namedActorId,
    boundsMin: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
    boundsMax: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
    boundsCenter: { x: center.x, y: center.y, z: center.z },
    camPositionLocal: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
    camWorldPosition: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
    camParentName: cam.parent?.name ?? null,
    camParentMatrixWorld: cam.parent ? Array.from(cam.parent.matrixWorld.elements) : null,
    frameSpanFraction,
    ndcBoundsCenter: projectNdc(center),
    namedActorSlotVisible: humanoid.parent?.visible ?? null,
    slots: slotRows,
  };
}

// Deterministic ED-bay-visible capture: a debug scene graph readback so the
// capture script can verify camera pose without traversing live objects.
export function recordEdBayVisibleCameraPose(): void {
  const cam = comparatorCaptureCamera;
  if (!cam) return;
  window.__openClinXrEdBayVisibleCameraPose = {
    framing: typeof cam.userData.openClinXrCameraFraming === "string"
      ? (cam.userData.openClinXrCameraFraming as string)
      : null,
    position: {
      x: cam.position.x,
      y: cam.position.y,
      z: cam.position.z,
    },
  };
}
