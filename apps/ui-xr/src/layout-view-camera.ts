import { collectActorWorldBoxes } from "@openclinxr/xr-scene";
import { Box3, Mesh, OrthographicCamera, type Scene, Vector3 } from "three";

export type LayoutViewMode = "overhead" | "isometric" | "perspective";

declare global {
  interface Window {
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

/** Publish the capture hook that swaps the station render camera for a layout shot. */
export function installStationLayoutView(scene: Scene, canvas: HTMLCanvasElement): void {
  window.__openClinXrDebugHoldCamera = null;
  const hiddenCeilings: Mesh[] = [];
  // GLB primitives inherit the ceiling name from a parent group; mesh.name alone leaves the slab.
  const setCeilingVisible = (visible: boolean): void => {
    if (visible) {
      for (const mesh of hiddenCeilings) mesh.visible = true;
      hiddenCeilings.length = 0;
      return;
    }
    scene.traverse((obj) => {
      if (!/ceiling/i.test(obj.name)) return;
      obj.traverse((child) => {
        if (!(child instanceof Mesh) || !child.visible) return;
        child.visible = false;
        hiddenCeilings.push(child);
      });
    });
  };
  window.__openClinXrSetLayoutView = (mode: LayoutViewMode): void => {
    const previous = window.__openClinXrDebugHoldCamera;
    if (previous) previous.removeFromParent();
    window.__openClinXrDebugHoldCamera = null;
    if (mode === "perspective") {
      setCeilingVisible(true);
      return;
    }
    setCeilingVisible(false);
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
      hold.position.set(centre.x, interior.max.y - 0.4, centre.z);
      hold.up.set(0, 0, -1);
      hold.lookAt(centre);
      const covered = interior.clone();
      covered.min.x -= 0.5;
      covered.max.x += 0.5;
      covered.min.z -= 0.5;
      covered.max.z += 0.5;
      coverOrthographicFrustum(hold, covered, aspect);
      hold.name = "openclinxr.layout-overhead";
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
      hold.position.copy(centre).addScaledVector(direction, 4);
      if (hold.position.y < interior.max.y + 1.2) hold.position.y = interior.max.y + 1.2;
      hold.up.set(0, 1, 0);
      hold.lookAt(centre);
      const covered = group.clone();
      covered.union(interior);
      covered.min.addScalar(-1);
      covered.max.addScalar(1);
      coverOrthographicFrustum(hold, covered, aspect);
      hold.name = "openclinxr.layout-isometric";
    }
    hold.updateMatrixWorld(true);
    window.__openClinXrDebugHoldCamera = hold;
  };
}
