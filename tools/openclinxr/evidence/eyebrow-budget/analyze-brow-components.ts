/**
 * One-off analysis: connected-component structure of the fitted_eyebrow mesh in a shipped GLB.
 * Positions are merged at 5 decimal places (normals/UVs split indices, not geometry) so
 * components reflect real geometric connectivity, per the §8q graph-naming rule.
 */
import { NodeIO } from "@gltf-transform/core";

const FILE = process.argv[2] ?? "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb";
const io = new NodeIO();
const doc = await io.read(FILE);

for (const mesh of doc.getRoot().listMeshes()) {
  const name = mesh.getName() ?? "";
  if (!/fitted_eyebrow/i.test(name)) continue;
  console.log(`mesh: ${name}`);
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION")!;
    const idx = prim.getIndices();
    const n = pos.getCount();
    const posArr = pos.getArray()!;
    const idxArr = idx ? idx.getArray()! : null;

    // union-find over quantized positions
    const keyOf = new Map<string, number>();
    const parent = new Array<number>(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    function find(a: number): number {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    }
    function union(a: number, b: number) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }
    const q = (v: number) => v.toFixed(5);
    for (let i = 0; i < n; i++) {
      const k = `${q(posArr[i * 3])},${q(posArr[i * 3 + 1])},${q(posArr[i * 3 + 2])}`;
      const prev = keyOf.get(k);
      if (prev !== undefined) union(prev, i);
      else keyOf.set(k, i);
    }
    const triCount = idxArr ? idxArr.length / 3 : n / 3;
    if (idxArr) {
      for (let t = 0; t < idxArr.length; t += 3)
        union(idxArr[t], idxArr[t + 1]), union(idxArr[t + 1], idxArr[t + 2]);
    }

    // component stats
    const compVerts = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      compVerts.set(r, (compVerts.get(r) ?? 0) + 1);
    }
    // faces per component (indexed case)
    const compFaces = new Map<number, number>();
    if (idxArr) {
      for (let t = 0; t < idxArr.length; t += 3) {
        const r = find(idxArr[t]);
        compFaces.set(r, (compFaces.get(r) ?? 0) + 1);
      }
    }
    const sizes = [...compFaces.entries()].sort((a, b) => b[1] - a[1]);
    const fvals = sizes.map(([, f]) => f);
    const totalF = fvals.reduce((a, b) => a + b, 0);
    console.log(
      JSON.stringify(
        {
          verts: n,
          tris: triCount,
          components: compVerts.size,
          facesByComponent_top20: sizes.slice(0, 20).map(([root, f]) => ({ root, faces: f })),
          faceCountHistogram: {
            min: Math.min(...fvals),
            median: fvals.sort((a, b) => a - b)[Math.floor(fvals.length / 2)],
            max: Math.max(...fvals),
            sum: totalF,
          },
        },
        null,
        1,
      ),
    );
    break;
  }
  break;
}
