import { collectActorWorldBoxes } from "./infinigen-station-environment.js";
import { Box3, Mesh, type Object3D, OrthographicCamera, type PerspectiveCamera, type Scene, Vector3 } from "three";

type LayoutViewMode = "overhead" | "isometric" | "perspective";

declare global {
  interface Window {
    __openClinXrDebugCamera?: PerspectiveCamera;
    __openClinXrDebugHoldCamera?: OrthographicCamera | null;
    __openClinXrSetLayoutView?: (mode: LayoutViewMode) => void;
  }
}

function coverOrthographicFrustum(ortho: OrthographicCamera, bounds: Box3, aspect: number): void {
  ortho.updateMatrixWorld(true);
  const right = new Vector3(1, 0, 0).applyQuaternion(ortho.quaternion);
  const upAxis = new Vector3(0, 1, 0).applyQuaternion(ortho.quaternion);
  const centre = bounds.getCenter(new Vector3());
  let halfWidth = 0;
  let halfHeight = 0;
  const corner = new Vector3();
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        corner.set(x, y, z).sub(centre);
        halfWidth = Math.max(halfWidth, Math.abs(corner.dot(right)));
        halfHeight = Math.max(halfHeight, Math.abs(corner.dot(upAxis)));
      }
    }
  }
  let width = Math.max(halfWidth * 2, 0.5);
  let height = Math.max(halfHeight * 2, 0.5);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (width / height > safeAspect) height = width / safeAspect;
  else width = height * safeAspect;
  ortho.left = -width / 2;
  ortho.right = width / 2;
  ortho.top = height / 2;
  ortho.bottom = -height / 2;
  ortho.near = 0.05;
  ortho.far = 40;
  ortho.updateProjectionMatrix();
}

function excludedFromLayoutBounds(mesh: Mesh): boolean {
  let current: Object3D | null = mesh;
  while (current) {
    if (!current.visible) return true;
    if (current.userData.openClinXrPortalInteriorReviewAffordance === true) return true;
    current = current.parent;
  }
  return false;
}

function collectVisibleRoomBounds(scene: Scene, interior: Box3): Box3 {
  const covered = interior.clone();
  const candidate = new Box3();
  scene.updateMatrixWorld(true);
  scene.traverse((obj) => {
    if (!(obj instanceof Mesh) || excludedFromLayoutBounds(obj)) return;
    candidate.setFromObject(obj);
    if (candidate.isEmpty() || !Number.isFinite(candidate.min.x)) return;
    const overlapsRoomFootprint = candidate.max.x >= interior.min.x - 0.5
      && candidate.min.x <= interior.max.x + 0.5
      && candidate.max.z >= interior.min.z - 0.5
      && candidate.min.z <= interior.max.z + 0.5;
    if (overlapsRoomFootprint) covered.union(candidate);
  });
  return covered;
}

/** Publish the capture hook that swaps the station render camera for a layout shot. */
export function installStationLayoutView(scene: Scene, canvas: HTMLCanvasElement, camera: PerspectiveCamera): PerspectiveCamera {
  window.__openClinXrDebugCamera = camera;
  window.__openClinXrDebugHoldCamera = null;
  const hiddenLayoutMeshes: Mesh[] = [];
  // GLB primitives inherit the ceiling or exterior-hull name from a parent group.
  // mesh.name alone leaves the slab. Both kinds restore from this one list.
  const setLayoutShellVisible = (visible: boolean): void => {
    if (visible) {
      for (const mesh of hiddenLayoutMeshes) mesh.visible = true;
      hiddenLayoutMeshes.length = 0;
      return;
    }
    scene.traverse((obj) => {
      if (!/ceiling/i.test(obj.name) && !/exterior/i.test(obj.name)) return;
      obj.traverse((child) => {
        if (!(child instanceof Mesh) || !child.visible) return;
        child.visible = false;
        hiddenLayoutMeshes.push(child);
      });
    });
  };
  window.__openClinXrSetLayoutView = (mode: LayoutViewMode): void => {
    const previous = window.__openClinXrDebugHoldCamera;
    if (previous) previous.removeFromParent();
    window.__openClinXrDebugHoldCamera = null;
    if (mode === "perspective") {
      setLayoutShellVisible(true);
      return;
    }
    setLayoutShellVisible(false);
    const roomRoot = scene.getObjectByName("openclinxr.station-environment.infinigen-room");
    if (!roomRoot) throw new Error("layout view: room interior is missing");
    const interior = new Box3();
    const meshBox = new Box3();
    let hasInterior = false;
    roomRoot.updateMatrixWorld(true);
    roomRoot.traverse((obj) => {
      if (!(obj instanceof Mesh) || /exterior/i.test(obj.name)) return;
      meshBox.setFromObject(obj);
      if (meshBox.isEmpty() || !Number.isFinite(meshBox.min.x)) return;
      if (!hasInterior) {
        interior.copy(meshBox);
        hasInterior = true;
      } else {
        interior.union(meshBox);
      }
    });
    if (!hasInterior) throw new Error("layout view: room interior is empty");
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    const hold = new OrthographicCamera(-1, 1, 1, -1, 0.05, 40);
    if (mode === "overhead") {
      const centre = interior.getCenter(new Vector3());
      const covered = collectVisibleRoomBounds(scene, interior);
      hold.position.set(centre.x, covered.max.y + 1, centre.z);
      hold.up.set(0, 0, -1);
      hold.lookAt(centre.x, covered.min.y, centre.z);
      covered.min.x -= 0.5;
      covered.max.x += 0.5;
      covered.min.z -= 0.5;
      covered.max.z += 0.5;
      coverOrthographicFrustum(hold, covered, aspect);
      hold.far = Math.max(40, hold.position.y - covered.min.y + 2);
      hold.updateProjectionMatrix();
      hold.name = "openclinxr.layout-overhead";
      hold.userData.openClinXrLayoutView = {
        mode,
        eyeAboveSceneMaxMeters: 1,
        coveredBounds: {
          min: covered.min.toArray(),
          max: covered.max.toArray(),
        },
        hiddenShellMeshNames: hiddenLayoutMeshes.map((mesh) => mesh.name),
      };
    } else {
      const actorBoxes = collectActorWorldBoxes(scene);
      if (actorBoxes.length === 0) throw new Error("layout view: actor group is empty");
      const group = new Box3();
      group.makeEmpty();
      for (const row of actorBoxes) {
        group.union(new Box3(
          new Vector3(row.min[0], row.min[1], row.min[2]),
          new Vector3(row.max[0], row.max[1], row.max[2]),
        ));
      }
      const centre = group.getCenter(new Vector3());
      const azimuth = Math.PI / 4;
      const elevation = Math.atan(1 / Math.sqrt(2));
      // 45° from the walls. +Z puts the eye behind the foot-wall monitors and hides the
      // standing nurse, so the eye sits on the open-floor side of that diagonal.
      const direction = new Vector3(
        Math.cos(elevation) * Math.sin(azimuth),
        Math.sin(elevation),
        -Math.cos(elevation) * Math.cos(azimuth),
      ).normalize();
      const inset = interior.clone();
      inset.min.addScalar(0.4);
      inset.max.addScalar(-0.4);
      if (inset.min.x > inset.max.x || inset.min.y > inset.max.y || inset.min.z > inset.max.z) inset.copy(interior);
      const start = centre.clone();
      start.x = Math.min(inset.max.x, Math.max(inset.min.x, start.x));
      start.y = Math.min(inset.max.y, Math.max(inset.min.y, start.y));
      start.z = Math.min(inset.max.z, Math.max(inset.min.z, start.z));
      let exit = Number.POSITIVE_INFINITY;
      const origin = [start.x, start.y, start.z];
      const step = [direction.x, direction.y, direction.z];
      const low = [inset.min.x, inset.min.y, inset.min.z];
      const high = [inset.max.x, inset.max.y, inset.max.z];
      for (let axis = 0; axis < 3; axis += 1) {
        const component = step[axis] ?? 0;
        if (Math.abs(component) < 1e-8) continue;
        const t1 = ((low[axis] ?? 0) - (origin[axis] ?? 0)) / component;
        const t2 = ((high[axis] ?? 0) - (origin[axis] ?? 0)) / component;
        const hit = Math.max(t1, t2);
        if (hit > 0 && hit < exit) exit = hit;
      }
      const distance = Number.isFinite(exit) ? Math.max(0.75, exit - 0.05) : 3;
      hold.position.copy(start).addScaledVector(direction, distance);
      // Stay inside the interior, just under the ceiling, on the open-floor diagonal.
      // An eye past interior.max photographs the roof. Do not flip direction to +Z.
      hold.position.y = interior.max.y - 0.25;
      hold.up.set(0, 1, 0);
      hold.lookAt(centre.x, 0.9, centre.z);
      const covered = interior.clone();
      covered.min.addScalar(-0.15);
      covered.max.addScalar(0.15);
      coverOrthographicFrustum(hold, covered, aspect);
      hold.name = "openclinxr.layout-isometric";
    }
    hold.updateMatrixWorld(true);
    window.__openClinXrDebugHoldCamera = hold;
  };
  return camera;
}
