/** Conservative deck-plane garment envelope; disjointness is not a 3D collision verdict. */
import { type Mesh, type Object3D, Vector3 } from "three";

export type GarmentLane = { triangles: number; separation: number | null; shift: number; buffer: number };

export function measureGarmentLane(root: Object3D, hand: Vector3[], forward: Vector3, lateral: Vector3): GarmentLane {
  if (hand.length === 0) return { triangles: 0, separation: null, shift: 0, buffer: 0 };
  const longitudinal = hand.map((point) => point.dot(forward));
  const across = hand.map((point) => point.dot(lateral));
  const low = Math.min(...longitudinal); const high = Math.max(...longitudinal);
  const inner = Math.min(...across); const width = Math.max(...across) - inner;
  const buffer = width * 0.02;
  let outer = -Infinity; let triangles = 0;
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !/garment|shirt|pants|gown|trouser/iu.test(mesh.name)) return;
    for (let ancestor: Object3D | null = mesh; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.some((material) => material.visible && material.opacity > 0 && material.opacity >= material.alphaTest)) return;
    const skin = mesh as Mesh & { skeleton?: { update: () => void } };
    skin.skeleton?.update();
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;
    const points = Array.from({ length: position.count }, (_, index) => mesh.getVertexPosition(index, new Vector3()).applyMatrix4(mesh.matrixWorld));
    const indices = mesh.geometry.index;
    const count = indices?.count ?? position.count;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      const group = mesh.geometry.groups.find((entry) => offset >= entry.start && offset < entry.start + entry.count);
      const material = Array.isArray(mesh.material) ? materials[group?.materialIndex ?? 0] : materials[0];
      if (!material?.visible || material.opacity <= 0 || material.opacity < material.alphaTest) continue;
      const triangle = [0, 1, 2].map((lane) => points[indices ? indices.getX(offset + lane) : offset + lane]);
      if (triangle.some((point) => point === undefined)) continue;
      const [a, b, c] = triangle;
      if (!a || !b || !c || b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() <= 1e-16) continue;
      const along = triangle.map((point) => point?.dot(forward) ?? 0);
      if (Math.max(...along) < low || Math.min(...along) > high) continue;
      // Retain the entire overlapping triangle, including edges crossing the hand interval.
      outer = Math.max(outer, ...triangle.map((point) => point?.dot(lateral) ?? -Infinity));
      triangles += 1;
    }
  });
  const separation = triangles > 0 ? inner - outer : null;
  return { triangles, separation, shift: separation === null ? 0 : Math.max(0, buffer - separation), buffer };
}
