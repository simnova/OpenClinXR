/**
 * Illustrative in-memory SkinnedMesh pair fixtures for the shared-accessor
 * guards + RED (fixture values are illustrative, not specification; not
 * GLB data). Each builder makes SkinnedMeshes (A + optional hidden B) whose
 * geometries share ONE position BufferAttribute instance (mirroring
 * three.js prim splitting). Hidden B uses the hidden-material convention the
 * runtime uses (mesh visible, opacity 0 / alphaTest 0.5,
 * e.g. openclinxr_hidden_upper_* in S1 m-a5.log); visible=false is the repo-test
 * convention (supine-support-contact.test.ts:160). Three.js only: this module
 * never reaches xr-pose code, so importing it adds 0 testInternalImports.
 * Precedent: shared-attribute-index-union.test.ts:19-30 (carrier()).
 */
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from "three";

export type RowXYZ = [number, number, number];

export function sharedPosition(rows: RowXYZ[]): Float32BufferAttribute {
  const flat: number[] = [];
  for (const row of rows) flat.push(row[0], row[1], row[2]);
  return new Float32BufferAttribute(flat, 3);
}

export function buildPair(options: {
  rows: RowXYZ[];
  position?: Float32BufferAttribute;
  aName: string;
  aIndex: number[];
  bName: string | null;
  bIndex: number[];
  boneNames: string[];
  boneAt?: Record<string, RowXYZ>;
  /** hidden-material convention for B (mesh stays visible, opacity 0). */
  hideB?: boolean;
  /**
   * Per-POSITION-row bone lane for skinning/region classification. Entry per
   * row: index into boneNames driving that row (lane 0, weight 1). Defaults
   * to bone 0 for every row (legacy single-region fixtures).
   */
  boneForRow?: number[];
}): { root: Group; A: SkinnedMesh; B: SkinnedMesh | null; position: Float32BufferAttribute } {
  const position = options.position ?? sharedPosition(options.rows);
  const root = new Group();
  const bones = options.boneNames.map((name) => {
    const bone = new Bone();
    bone.name = name;
    const at = options.boneAt?.[name] ?? ([0, 0, 0] as RowXYZ);
    bone.position.set(at[0], at[1], at[2]);
    root.add(bone);
    return bone;
  });
  root.updateMatrixWorld(true);
  const makeMesh = (name: string, index: number[], hidden: boolean): SkinnedMesh => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", position);
    geometry.setIndex(new Uint16BufferAttribute(index, 1));
    const count = position.count;
    const skinIndex: number[] = [];
    const skinWeight: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const lane = options.boneForRow?.[i] ?? 0;
      skinIndex.push(lane, 0, 0, 0);
      skinWeight.push(1, 0, 0, 0);
    }
    geometry.setAttribute("skinIndex", new Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute("skinWeight", new Float32BufferAttribute(skinWeight, 4));
    const material = new MeshBasicMaterial({ color: 0xffffff });
    if (hidden) {
      material.opacity = 0;
      material.alphaTest = 0.5;
    }
    const mesh = new SkinnedMesh(geometry, material);
    mesh.name = name;
    mesh.bind(new Skeleton(bones));
    root.add(mesh);
    return mesh;
  };
  const A = makeMesh(options.aName, options.aIndex, false);
  const B = options.bName ? makeMesh(options.bName, options.bIndex, options.hideB === true) : null;
  root.updateMatrixWorld(true);
  return { root, A, B, position };
}
