import { Box3, Mesh, type Object3D, type PerspectiveCamera, Vector3 } from "three";
import type { CandidateCaptureView } from "./candidate-capture-views.js";

export function cameraPosition(view: CandidateCaptureView): Vector3 {
  if (view === "side") return new Vector3(4.8, 1.35, 0);
  if (view === "three_quarter") return new Vector3(3.6, 1.35, 3.6);
  return new Vector3(0, 1.35, 4.8);
}

export function frameCameraForBounds(camera: PerspectiveCamera, bounds: Box3, view: CandidateCaptureView): void {
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const radius = Math.max(size.x, size.y, size.z, 0.5);
  const distance = radius * 2.35;
  const eyeHeight = Math.max(size.y * 0.12, 0.25);
  if (view === "side") camera.position.set(center.x + distance, center.y + eyeHeight, center.z);
  else if (view === "three_quarter") camera.position.set(center.x + distance * 0.72, center.y + eyeHeight, center.z + distance * 0.72);
  else camera.position.set(center.x, center.y + eyeHeight, center.z + distance);
  camera.lookAt(center.x, center.y + size.y * 0.08, center.z);
}

export function computeBaseMeshBounds(model: Object3D): Box3 {
  const bounds = new Box3();
  const point = new Vector3();
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      bounds.expandByPoint(point);
    }
  });
  return bounds;
}

export function roundMeters(value: number): number {
  return Math.round(value * 1000) / 1000;
}
