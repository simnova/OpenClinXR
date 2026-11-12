import { createHash } from "node:crypto";
import type { Accessor, Document, Mesh, NodeIO, Primitive } from "@gltf-transform/core";
import {
  NECK_STAGE_INDICES_SHA256,
  NECK_STAGE_PHYSICIAN,
} from "./shipped-lash-follow-neck-stage.js";
import {
  CLOSURE,
  MOVE_EPS_M,
  WELD_TOLERANCE_M,
  type ActorMeasurement,
  type Card,
  type HullVertex,
  type Mutation,
  type Side,
  type Tri,
  type V3,
} from "./shipped-lash-follow-types.js";

export function vecs(a: Accessor): V3[] {
  const out: V3[] = [];
  const v: V3 = [0, 0, 0];
  for (let i = 0; i < a.getCount(); i++) {
    a.getElement(i, v);
    out.push([...v]);
  }
  return out;
}
export function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function add(a: V3, b: V3, s = 1): V3 { return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]; }
export function dot(a: V3, b: V3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function norm(a: V3): number { return Math.hypot(...a); }
export function unit(a: V3): V3 {
  const length = norm(a);
  if (length <= 1e-12) throw new Error("projected left-right eye line has zero length");
  return a.map((value) => value / length) as V3;
}
export function closest(p: V3, [a, b, c]: Tri): V3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, sub(c, b), (d4 - d3) / (d4 - d3 + d5 - d6));
  const den = 1 / (va + vb + vc); return add(add(a, ab, vb * den), ac, vc * den);
}
export function barycentric(p: V3, [a, b, c]: Tri): V3 {
  const v0 = sub(b, a), v1 = sub(c, a), v2 = sub(p, a);
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1);
  const d20 = dot(v2, v0), d21 = dot(v2, v1);
  const den = d00 * d11 - d01 * d01;
  const v = (d11 * d20 - d01 * d21) / den;
  const w = (d00 * d21 - d01 * d20) / den;
  return [1 - v - w, v, w];
}
export function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return Number(sorted[Math.floor(p * (sorted.length - 1))]?.toFixed(3));
}
export function exactMedian(xs: number[]): number {
  if (!xs.length) throw new Error("median needs at least one value");
  const sorted = [...xs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
export function upperHull(points: HullVertex[]): HullVertex[] {
  const candidates = [...points].sort((a, b) => a.x - b.x || Math.abs(b.dyMm) - Math.abs(a.dyMm) || a.vertexId - b.vertexId)
    .filter((point, index, rows) => index === 0 || point.x !== rows[index - 1]!.x);
  if (candidates.length < 2) throw new Error("moving upper-lid hull has no horizontal span");
  const cross = (a: HullVertex, b: HullVertex, c: HullVertex) =>
    (b.x - a.x) * (Math.abs(c.dyMm) - Math.abs(a.dyMm))
    - (Math.abs(b.dyMm) - Math.abs(a.dyMm)) * (c.x - a.x);
  const hull: HullVertex[] = [];
  for (const candidate of candidates) {
    while (hull.length >= 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, candidate) >= 0) hull.pop();
    hull.push(candidate);
  }
  return hull;
}

export function interpolateUpperHull(points: HullVertex[], x: number): number | null {
  if (points.some(({ source }) => source !== "body")) throw new Error("hull vertex is not a body vertex");
  if (x < points[0]!.x || x > points[points.length - 1]!.x) return null;
  const exact = points.find((point) => Math.abs(point.x - x) <= 1e-12);
  if (exact) return exact.dyMm;
  for (let i = 0; i + 1 < points.length; i++) {
    const left = points[i]!, right = points[i + 1]!;
    if (left.x <= x && x <= right.x) {
      const t = (x - left.x) / (right.x - left.x);
      const magnitude = Math.abs(left.dyMm) + t * (Math.abs(right.dyMm) - Math.abs(left.dyMm));
      const signSource = left.dyMm * right.dyMm >= 0 || t <= 0.5 ? left.dyMm : right.dyMm;
      return Math.sign(signSource) * magnitude;
    }
  }
  throw new Error(`upper hull could not bracket in-span x=${x}`);
}
export function target(prim: Primitive, names: string[], name: string): V3[] | null {
  const index = names.indexOf(name);
  const a = index >= 0 ? prim.listTargets()[index]?.getAttribute("POSITION") : null;
  return a ? vecs(a) : null;
}
export function matched(doc: Document, actor: string) {
  const nodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
  const bodies = nodes.filter((n) => {
    const names = (n.getMesh()?.getExtras() as { targetNames?: string[] } | null)?.targetNames ?? [];
    const label = `${n.getName()} ${n.getMesh()?.getName()}`;
    return !/eyelash/i.test(label) && names.includes(CLOSURE.left) && names.includes(CLOSURE.right);
  });
  const lashes = nodes.filter((n) => /eyelash/i.test(`${n.getName()} ${n.getMesh()?.getName()}`));
  if (bodies.length !== 1) throw new Error(`${actor}: CW3 body match count ${bodies.length}`);
  if (lashes.length !== 1) throw new Error(`${actor}: CW3 lash match count ${lashes.length}`);
  return { body: bodies[0]!, lash: lashes[0]! };
}
export function accessorBytes(a: Accessor | null): Buffer {
  if (!a?.getArray()) return Buffer.alloc(0);
  const array = a.getArray()!;
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}
export function primitiveHash(p: Primitive): string {
  const h = createHash("sha256");
  const framed = (label: string, a: Accessor | null) => {
    h.update(JSON.stringify([label, a?.getType() ?? null, a?.getComponentType() ?? null, a?.getCount() ?? 0]));
    h.update(accessorBytes(a));
  };
  framed("indices", p.getIndices());
  for (const semantic of p.listSemantics().sort()) framed(semantic, p.getAttribute(semantic));
  for (const [i, t] of p.listTargets().entries()) for (const semantic of t.listSemantics().sort()) {
    framed(`${i}:${semantic}`, t.getAttribute(semantic));
  }
  return h.digest("hex");
}
export function targetHash(p: Primitive, names: string[]): string {
  const h = createHash("sha256");
  for (const [index, targetEntry] of p.listTargets().entries()) {
    h.update(JSON.stringify([index, names[index] ?? null]));
    for (const semantic of targetEntry.listSemantics().sort()) {
      const accessor = targetEntry.getAttribute(semantic);
      h.update(JSON.stringify([
        semantic,
        accessor?.getType() ?? null,
        accessor?.getComponentType() ?? null,
        accessor?.getCount() ?? 0,
      ]));
      h.update(accessorBytes(accessor));
    }
  }
  return h.digest("hex");
}
function indicesSha256(p: Primitive): string {
  return createHash("sha256").update(accessorBytes(p.getIndices())).digest("hex");
}
function primAttrSig(p: Primitive): string {
  const h = createHash("sha256");
  for (const semantic of p.listSemantics().sort()) {
    const a = p.getAttribute(semantic)!;
    h.update(JSON.stringify([semantic, a.getType(), a.getComponentType(), a.getCount()]));
    h.update(accessorBytes(a));
  }
  return h.digest("hex");
}
function sortedIndexArray(p: Primitive): number[] {
  return Array.from(p.getIndices()!.getArray() as ArrayLike<number>).map(Number).sort((a, b) => a - b);
}
// R1: physician neck-stage split allowance (owning gate: the collar test; pin moves
// only on a new neck stage). Pairs current body prims to baseline prims by shared
// attribute + morph bytes; an unmatched pair is allowed only as one moved + one new
// skin prim whose INDICES bytes hash to NECK_STAGE_INDICES_SHA256 and whose sorted
// index union equals the baseline prim (no triangle lost or added).
function neckSplitBodyEqual(cp: Primitive[], bp: Primitive[], cn: string[], actor: string): boolean {
  if (actor !== NECK_STAGE_PHYSICIAN || cp.length !== bp.length + 4) return false;
  const allowed = new Set(NECK_STAGE_INDICES_SHA256);
  const used = new Set<string>();
  const key = (p: Primitive) => `${primAttrSig(p)}|${targetHash(p, cn)}`;
  const byKey = new Map<string, Primitive[]>();
  for (const p of cp) {
    const k = key(p);
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }
  for (const b of bp) {
    const k = key(b);
    const mates = byKey.get(k) ?? [];
    if (mates.length === 1) {
      if (indicesSha256(mates[0]!) !== indicesSha256(b)) return false;
    } else if (mates.length === 2) {
      const [m1, m2] = mates as [Primitive, Primitive];
      const s1 = indicesSha256(m1), s2 = indicesSha256(m2);
      if (!allowed.has(s1) || !allowed.has(s2)) return false;
      const mats = [m1.getMaterial()?.getName(), m2.getMaterial()?.getName()].sort();
      if (!mats[0]!.startsWith("mpfb_skin_") || mats[1] !== b.getMaterial()?.getName()) return false;
      const merged = [...sortedIndexArray(m1), ...sortedIndexArray(m2)].sort((a, c) => a - c);
      const want = sortedIndexArray(b);
      if (merged.length !== want.length || merged.some((v, i) => v !== want[i])) return false;
      used.add(s1);
      used.add(s2);
    } else {
      return false;
    }
    byKey.delete(k);
  }
  return byKey.size === 0 && used.size === allowed.size;
}
export function counterweights(current: Document, baseline: Document, actor: string) {
  const c = matched(current, actor), b = matched(baseline, actor);
  const currentBody = c.body.getMesh(), baselineBody = b.body.getMesh();
  if (!currentBody || !baselineBody) throw new Error(`${actor}: CW3 matched body has no mesh`);
  const cn = (currentBody.getExtras() as { targetNames?: string[] }).targetNames ?? [];
  const bn = (baselineBody.getExtras() as { targetNames?: string[] }).targetNames ?? [];
  let bodyMorphsByteEqual = JSON.stringify(cn) === JSON.stringify(bn);
  const cp = currentBody.listPrimitives(), bp = baselineBody.listPrimitives();
  if (cp.length === bp.length) {
    for (let i = 0; bodyMorphsByteEqual && i < cp.length; i++) {
      bodyMorphsByteEqual &&= targetHash(cp[i]!, cn) === targetHash(bp[i]!, bn);
    }
  } else {
    bodyMorphsByteEqual &&= neckSplitBodyEqual(cp, bp, cn, actor);
  }
  // Teeth/tongue are excluded: tsk_27e0cec12cab410d swapped hm08 for fitted CC0 teeth after BASELINE_REF.
  // Their bytes are gated by humanoid-bake-evidence the-shipped-teeth-carry-their-texture.test.ts
  // (T1-T3 always, T5' against the scratch bakes). Every other non-lash mesh still hash-matches BASELINE_REF.
  const meshHashes = (doc: Document) => new Map(doc.getRoot().listNodes().filter((n) => n.getMesh() && !/eyelash|_teeth|_tongue/i.test(`${n.getName()} ${n.getMesh()?.getName()}`)).map((n) => [
    `${n.getName()}|${n.getMesh()?.getName()}`,
    n.getMesh()?.listPrimitives().map(primitiveHash),
  ]));
  const ch = meshHashes(current), bh = meshHashes(baseline);
  // R1: the physician body mesh goes through the neck-split allowance (indices gated
  // by NECK_STAGE_INDICES_SHA256, attributes/morphs paired); every other non-lash
  // mesh still hash-matches BASELINE_REF exactly.
  const bodyKey = `${c.body.getName()}|${currentBody.getName()}`;
  const nonLashBodyOk =
    actor !== NECK_STAGE_PHYSICIAN || ch.size !== bh.size
      ? null
      : neckSplitBodyEqual(currentBody.listPrimitives(), baselineBody.listPrimitives(), cn, actor);
  const nonLashMeshesHashEqual =
    ch.size === bh.size &&
    (nonLashBodyOk === null
      ? [...ch].every(([k, hashes]) => JSON.stringify(hashes) === JSON.stringify(bh.get(k)))
      : [...ch].every(
          ([k, hashes]) =>
            (k === bodyKey ? nonLashBodyOk : JSON.stringify(hashes) === JSON.stringify(bh.get(k))),
        ));
  return { bodyMorphsByteEqual, nonLashMeshesHashEqual };
}

export function rayInside(p: V3, tris: Tri[]): boolean {
  let hits = 0;
  const d: V3 = [1, 0.000013, 0.000037];
  for (const [a, b, c] of tris) {
    const e1 = sub(b, a), e2 = sub(c, a);
    const h: V3 = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = dot(e1, h); if (Math.abs(det) < 1e-10) continue;
    const s = sub(p, a), u = dot(s, h) / det; if (u < 0 || u > 1) continue;
    const q: V3 = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = dot(d, q) / det; if (v < 0 || u + v > 1) continue;
    if (dot(e2, q) / det > 1e-9) hits++;
  }
  return hits % 2 === 1;
}
export function triangles(prim: Primitive): Tri[] {
  const pos = vecs(prim.getAttribute("POSITION")!);
  const idx = prim.getIndices()?.getArray() ?? Uint32Array.from(pos.keys());
  const out: Tri[] = [];
  for (let i = 0; i + 2 < idx.length; i += 3) out.push([pos[idx[i]!]!, pos[idx[i + 1]!]!, pos[idx[i + 2]!]!]);
  return out;
}

export function weldedBoundaryLoops(points: V3[], indices: ArrayLike<number>): number[][] {
  const keyToWeld = new Map<string, number>();
  const sourceByWeld = new Map<number, number[]>();
  const welded = points.map((point, source) => {
    const key = point.map((value) => Math.round(value / WELD_TOLERANCE_M)).join(",");
    let id = keyToWeld.get(key);
    if (id === undefined) { id = keyToWeld.size; keyToWeld.set(key, id); }
    sourceByWeld.set(id, [...(sourceByWeld.get(id) ?? []), source]);
    return id;
  });
  const counts = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const ids: [number, number, number] = [welded[Number(indices[i])]!, welded[Number(indices[i + 1])]!, welded[Number(indices[i + 2])]!];
    for (const [a0, b0] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]] as const) {
      const [a, b] = a0 < b0 ? [a0, b0] : [b0, a0];
      const key = `${a}:${b}`, row = counts.get(key);
      counts.set(key, { a, b, count: (row?.count ?? 0) + 1 });
    }
  }
  const adjacency = new Map<number, Set<number>>();
  for (const { a, b, count } of counts.values()) if (count === 1) {
    adjacency.set(a, new Set([...(adjacency.get(a) ?? []), b]));
    adjacency.set(b, new Set([...(adjacency.get(b) ?? []), a]));
  }
  const remaining = new Set(adjacency.keys()), loops: number[][] = [];
  while (remaining.size) {
    const seed = Math.min(...remaining), component = new Set<number>(), stack = [seed];
    while (stack.length) {
      const value = stack.pop()!;
      if (component.has(value)) continue;
      component.add(value);
      for (const next of adjacency.get(value) ?? []) if (!component.has(next)) stack.push(next);
    }
    for (const value of component) remaining.delete(value);
    if (component.size < 3 || [...component].some((value) => adjacency.get(value)?.size !== 2)) continue;
    const start = Math.min(...component), cycle: number[] = [];
    let previous = -1, current = start;
    while (true) {
      cycle.push(current);
      const choices = [...(adjacency.get(current) ?? [])].filter((value) => value !== previous).sort((a, b) => a - b);
      const next = choices[0]!;
      if (next === start) break;
      if (cycle.includes(next)) { cycle.length = 0; break; }
      previous = current; current = next;
    }
    if (cycle.length === component.size) loops.push(cycle.map((id) => Math.min(...(sourceByWeld.get(id) ?? []))));
  }
  return loops.sort((a, b) => a[0]! - b[0]! || a.length - b.length);
}

export function selectEyeMarginLoop(
  points: V3[], loops: number[][], eyeCentre: V3, eyeAabb: { min: V3; max: V3 }, upAxis: number,
): { status: "ok" | "margin-below-minimum" | "no-eye-opening-loop"; loop: number[]; margin: number[] } {
  const axes = [...new Set([0, upAxis])];
  const candidates = loops.map((candidateLoop, loopIndex) => {
    const loopPoints = candidateLoop.map((index) => points[index]!);
    const min = [0, 1, 2].map((axis) => Math.min(...loopPoints.map((point) => point[axis]!))) as V3;
    const max = [0, 1, 2].map((axis) => Math.max(...loopPoints.map((point) => point[axis]!))) as V3;
    const overlaps = axes.every((axis) => max[axis]! >= eyeAabb.min[axis]! && min[axis]! <= eyeAabb.max[axis]!);
    const centre = [0, 1, 2].map((axis) => loopPoints.reduce((sum, point) => sum + point[axis]!, 0) / loopPoints.length) as V3;
    return { loop: candidateLoop, loopIndex, overlaps, distance: norm(sub(centre, eyeCentre)) };
  }).filter(({ overlaps }) => overlaps).sort((a, b) => a.distance - b.distance || a.loopIndex - b.loopIndex);
  if (!candidates.length) return { status: "no-eye-opening-loop", loop: [], margin: [] };
  const loop = candidates[0]!.loop;
  const margin = loop.filter((index) => points[index]![upAxis]! > eyeCentre[upAxis]!);
  return { status: margin.length >= 10 ? "ok" : "margin-below-minimum", loop, margin };
}

export function connectedComponents(vertexCount: number, raw: ArrayLike<number>): number[][] {
  const parent = Array.from({ length: vertexCount }, (_, index) => index);
  const find = (value: number): number => {
    while (parent[value] !== value) { parent[value] = parent[parent[value]!]!; value = parent[value]!; }
    return value;
  };
  const union = (a: number, b: number) => { const ar = find(a), br = find(b); if (ar !== br) parent[br] = ar; };
  for (let i = 0; i + 2 < raw.length; i += 3) { union(Number(raw[i]), Number(raw[i + 1])); union(Number(raw[i]), Number(raw[i + 2])); }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < vertexCount; i++) { const root = find(i); groups.set(root, [...(groups.get(root) ?? []), i]); }
  return [...groups.values()].sort((a, b) => a[0]! - b[0]!);
}

export function aggregateMesh(mesh: Mesh, targetNames: string[] = []): { points: V3[]; indices: number[]; deltas: Record<string, V3[]> } {
  const points: V3[] = [], indices: number[] = [];
  const deltas = Object.fromEntries(targetNames.map((name) => [name, []])) as Record<string, V3[]>;
  for (const [primitiveIndex, primitive] of mesh.listPrimitives().entries()) {
    const position = primitive.getAttribute("POSITION");
    if (!position) throw new Error(`${mesh.getName()} primitive ${primitiveIndex}: POSITION missing`);
    const localPoints = vecs(position), offset = points.length;
    points.push(...localPoints);
    const localIndices = primitive.getIndices()?.getArray() ?? Uint32Array.from(localPoints.keys());
    for (const index of localIndices) indices.push(Number(index) + offset);
    for (const name of targetNames) {
      const delta = target(primitive, targetNames, name);
      if (!delta) throw new Error(`${mesh.getName()} primitive ${primitiveIndex}: target ${name} missing`);
      deltas[name]!.push(...delta);
    }
  }
  return { points, indices, deltas };
}

export function connectedCards(prim: Primitive): Card[] {
  const position = prim.getAttribute("POSITION");
  if (!position) throw new Error("lash primitive has no POSITION");
  const points = vecs(position);
  const raw = prim.getIndices()?.getArray() ?? Uint32Array.from(points.keys());
  const parent = Array.from(points.keys());
  const find = (value: number): number => {
    while (parent[value] !== value) {
      parent[value] = parent[parent[value]!]!;
      value = parent[value]!;
    }
    return value;
  };
  const union = (a: number, b: number) => {
    const ar = find(a), br = find(b);
    if (ar !== br) parent[br] = ar;
  };
  for (let i = 0; i + 2 < raw.length; i += 3) {
    union(Number(raw[i]), Number(raw[i + 1]));
    union(Number(raw[i]), Number(raw[i + 2]));
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < points.length; i++) {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  }
  return [...groups.values()].sort((a, b) => a[0]! - b[0]!).map((indices) => ({
    indices,
    points: indices.map((index) => points[index]!),
  }));
}

export async function mutateGlbCopy(
  io: NodeIO,
  source: Document,
  actor: string,
  mutation: Exclude<Mutation, "none">,
): Promise<{ doc: Document; bytes: Uint8Array; proof: NonNullable<ActorMeasurement["mutationProof"]> }> {
  const beforeBytes = await io.writeBinary(source);
  const copy = await io.readBinary(beforeBytes);
  const { body, lash } = matched(copy, actor);
  const bodyMesh = body.getMesh(), lashMesh = lash.getMesh();
  if (!bodyMesh || !lashMesh) throw new Error(`${actor}: probe matched node without mesh`);
  const beforeNames = (lashMesh.getExtras() as { targetNames?: string[] } | null)?.targetNames ?? [];
  const beforeTargetMatches = beforeNames.filter((name) => Object.values(CLOSURE).includes(name as typeof CLOSURE[Side])).length;
  const browTriangleIds: Partial<Record<Side, [number, number, number]>> = {};
  let targetDeltaBeforeSha256: string | undefined;
  if (mutation === "strip") {
    const remove = beforeNames.map((name, index) => ({ name, index }))
      .filter(({ name }) => Object.values(CLOSURE).includes(name as typeof CLOSURE[Side]))
      .sort((a, b) => b.index - a.index);
    for (const prim of lashMesh.listPrimitives()) for (const { index } of remove) {
      const targetEntry = prim.listTargets()[index];
      if (targetEntry) prim.removeTarget(targetEntry);
    }
    const removed = new Set(remove.map(({ index }) => index));
    lashMesh.setExtras({ ...lashMesh.getExtras(), targetNames: beforeNames.filter((_, index) => !removed.has(index)) });
  } else {
    const mutationSide: Side = mutation.endsWith("left") ? "left" : "right";
    const bodyPrim = bodyMesh.listPrimitives()[0], lashPrim = lashMesh.listPrimitives()[0];
    const bodyPosition = bodyPrim?.getAttribute("POSITION"), bodyIndices = bodyPrim?.getIndices()?.getArray();
    const bodyNames = (bodyMesh.getExtras() as { targetNames?: string[] } | null)?.targetNames ?? [];
    if (!bodyPrim || !lashPrim || !bodyPosition || !bodyIndices) throw new Error(`${actor}: probe body/lash primitive missing`);
    const bodyPoints = vecs(bodyPosition);
    for (const side of ["left", "right"] as const) {
      if (side !== mutationSide) continue;
      const lashIndex = beforeNames.indexOf(CLOSURE[side]);
      const lashAccessor = lashPrim.listTargets()[lashIndex]?.getAttribute("POSITION");
      if (!lashAccessor) throw new Error(`${actor} ${side}: probe lash target missing before ${mutation}`);
      if (mutation.startsWith("double")) {
        targetDeltaBeforeSha256 = createHash("sha256").update(accessorBytes(lashAccessor)).digest("hex");
        const value: V3 = [0, 0, 0];
        for (let i = 0; i < lashAccessor.getCount(); i++) {
          lashAccessor.getElement(i, value);
          lashAccessor.setElement(i, [value[0] * 2, value[1] * 2, value[2] * 2]);
        }
        continue;
      }
      const bodyDelta = target(bodyPrim, bodyNames, CLOSURE[side]);
      if (!bodyDelta) throw new Error(`${actor} ${side}: probe body closure target missing`);
      const movingIds = bodyDelta.map((delta, id) => ({ id, delta })).filter(({ delta }) => norm(delta) > MOVE_EPS_M).map(({ id }) => id);
      const movingMeanX = movingIds.reduce((sum, id) => sum + bodyPoints[id]![0], 0) / movingIds.length;
      const movingMaxY = Math.max(...movingIds.map((id) => bodyPoints[id]![1]));
      let brow: [number, number, number] | null = null;
      for (let i = 0; i + 2 < bodyIndices.length; i += 3) {
        const ids: [number, number, number] = [Number(bodyIndices[i]), Number(bodyIndices[i + 1]), Number(bodyIndices[i + 2])];
        const centroidX = ids.reduce((sum, id) => sum + bodyPoints[id]![0], 0) / 3;
        const centroidY = ids.reduce((sum, id) => sum + bodyPoints[id]![1], 0) / 3;
        if (Math.sign(centroidX) === Math.sign(movingMeanX) && centroidY > movingMaxY && ids.every((id) => norm(bodyDelta[id]!) <= MOVE_EPS_M)) {
          brow = ids;
          break;
        }
      }
      if (!brow) throw new Error(`${actor} ${side}: P3 no non-moving brow triangle above lid region`);
      browTriangleIds[side] = brow;
      const lashDelta = vecs(lashAccessor);
      const card = connectedCards(lashPrim).find(({ indices }) =>
        indices.some((index) => norm(lashDelta[index]!) > MOVE_EPS_M),
      );
      if (!card) throw new Error(`${actor} ${side}: P3 no moving lash component to rebind`);
      const browDelta = brow.map((id) => bodyDelta[id]!).reduce((sum, delta) => add(sum, delta), [0, 0, 0] as V3)
        .map((value) => value / 3) as V3;
      for (const index of card.indices) lashAccessor.setElement(index, browDelta);
    }
  }
  const afterBytes = await io.writeBinary(copy);
  const doc = await io.readBinary(afterBytes);
  const afterLash = matched(doc, actor).lash.getMesh();
  const afterNames = (afterLash?.getExtras() as { targetNames?: string[] } | null)?.targetNames ?? [];
  let targetDeltaAfterSha256: string | undefined;
  if (mutation.startsWith("double") && afterLash) {
    const side: Side = mutation.endsWith("left") ? "left" : "right";
    const index = afterNames.indexOf(CLOSURE[side]);
    const accessor = afterLash.listPrimitives()[0]?.listTargets()[index]?.getAttribute("POSITION") ?? null;
    targetDeltaAfterSha256 = createHash("sha256").update(accessorBytes(accessor)).digest("hex");
  }
  return {
    doc,
    bytes: afterBytes,
    proof: {
      kind: mutation,
      beforeSha256: createHash("sha256").update(beforeBytes).digest("hex"),
      afterSha256: createHash("sha256").update(afterBytes).digest("hex"),
      beforeTargetMatches,
      afterTargetMatches: afterNames.filter((name) => Object.values(CLOSURE).includes(name as typeof CLOSURE[Side])).length,
      ...(targetDeltaBeforeSha256 && targetDeltaAfterSha256 ? { targetDeltaBeforeSha256, targetDeltaAfterSha256 } : {}),
      ...(mutation.startsWith("brow") ? { browTriangleIds } : {}),
    },
  };
}
