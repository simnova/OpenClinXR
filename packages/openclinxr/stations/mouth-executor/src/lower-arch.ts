/**
 * Lower-arch rule (MADR 0061 mouth executor).
 *
 * Moved verbatim from tools/openclinxr/asset-pipeline/makeclothes/seat-teeth-on-lip-rim.ts
 * `lowerArchByJoint`. The tools CLI re-exports it; behavior is unchanged.
 */

/**
 * Lower arch by connected component + jaw rule (R7).
 *
 * The teeth mesh splits into connected components over its index buffer.
 * Each component votes its dominant input joint (per-vertex argmax weight,
 * ties to the lowest joint index; component majority, ties likewise). A
 * component is lower exactly when its dominant joint is the jaw or a jaw
 * descendant. The lower arch is the jaw-bound verts of lower components in
 * ascending order; everything else is upper and stays bitwise identical to
 * the producer input. Deterministic: union-find, ascending vertex order,
 * no iteration, no thresholds on coordinates.
 */
export function lowerArchByJoint(input: {
  indexArray: ArrayLike<number>;
  jointArray: ArrayLike<number>;
  weightArray: ArrayLike<number>;
  teethSkinJointNames: (string | undefined)[];
  jawDescendantNames: Set<string>;
}): { lowerArch: number[]; upperArch: number[]; componentCount: number } {
  const { indexArray, jointArray, weightArray, teethSkinJointNames, jawDescendantNames } = input;
  const count = weightArray.length / 4;
  const parent = new Array<number>(count);
  for (let vertex = 0; vertex < count; vertex += 1) parent[vertex] = vertex;
  const find = (start: number): number => {
    let root = start;
    while (parent[root] !== root) root = parent[root] ?? root;
    let node = start;
    while (parent[node] !== root) {
      const next = parent[node] ?? root;
      parent[node] = root;
      node = next;
    }
    return root;
  };
  const union = (x: number, y: number): void => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  };
  for (let tri = 0; tri < indexArray.length / 3; tri += 1) {
    const a = indexArray[tri * 3] ?? -1;
    const b = indexArray[tri * 3 + 1] ?? -1;
    const c = indexArray[tri * 3 + 2] ?? -1;
    if (a < 0 || b < 0 || c < 0 || a >= count || b >= count || c >= count) {
      throw new Error("teeth index out of range");
    }
    union(a, b);
    union(b, c);
  }
  const dominantOf = (vertex: number): number => {
    let joint = jointArray[vertex * 4] ?? 0;
    let best = weightArray[vertex * 4] ?? 0;
    for (let slot = 1; slot < 4; slot += 1) {
      const next = weightArray[vertex * 4 + slot] ?? 0;
      if (next > best) {
        best = next;
        joint = jointArray[vertex * 4 + slot] ?? joint;
      }
    }
    return joint;
  };
  const members = new Map<number, number[]>();
  for (let vertex = 0; vertex < count; vertex += 1) {
    const root = find(vertex);
    const list = members.get(root);
    if (list) list.push(vertex);
    else members.set(root, [vertex]);
  }
  const isJawJoint = (joint: number): boolean =>
    jawDescendantNames.has((teethSkinJointNames[joint] ?? "").toLowerCase());
  const lowerComponents = new Set<number>();
  for (const [root, verts] of members) {
    const votes = new Map<number, number>();
    for (const vertex of verts) {
      const joint = dominantOf(vertex);
      votes.set(joint, (votes.get(joint) ?? 0) + 1);
    }
    let top = -1;
    let topVotes = -1;
    for (const [joint, total] of votes) {
      if (total > topVotes || (total === topVotes && joint < top)) {
        top = joint;
        topVotes = total;
      }
    }
    if (top >= 0 && isJawJoint(top)) lowerComponents.add(root);
  }
  const lowerArch: number[] = [];
  const upperArch: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) {
    if (lowerComponents.has(find(vertex)) && isJawJoint(dominantOf(vertex))) lowerArch.push(vertex);
    else upperArch.push(vertex);
  }
  if (lowerArch.length === 0) throw new Error("lower arch is empty");
  if (upperArch.length === 0) throw new Error("upper arch is empty");
  return { lowerArch, upperArch, componentCount: members.size };
}
