/**
 * View-space refresh for the parity SSS wrap uniform. The dominant light dir
 * is recorded in world space; the shader needs it in view space, which is
 * only stable once the camera is placed. Called after the first compile.
 */

import { Mesh, Vector3, type Object3D, type PerspectiveCamera } from "three";

export function updateSssViewUniforms(root: Object3D, camera: PerspectiveCamera): number {
  camera.updateMatrixWorld(true);
  const view = camera.matrixWorldInverse;
  let touched = 0;
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      const ud = m.userData as Record<string, unknown>;
      const uniforms = ud["paritySSSUniforms"] as
        | Record<string, { value: unknown }>
        | undefined;
      const dirWorld = ud["paritySSSLightDirWorld"] as [number, number, number] | undefined;
      if (!uniforms || !dirWorld) continue;
      const v = new Vector3(dirWorld[0], dirWorld[1], dirWorld[2])
        .transformDirection(view);
      const slot = uniforms["uParitySSSLightView"];
      if (slot) {
        slot.value = [v.x, v.y, v.z];
        touched += 1;
      }
    }
  });
  return touched;
}
