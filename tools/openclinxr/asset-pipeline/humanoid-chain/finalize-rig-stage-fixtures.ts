// Fixture GLB mutators for finalize-rig-stage F1-F8 (raw JSON+BIN edits, test-only).
export interface GltfNode { name?: string | undefined; children?: number[] | undefined; translation?: number[] | undefined; rotation?: number[] | undefined; scale?: number[] | undefined; matrix?: number[] | undefined; mesh?: number | undefined; skin?: number | undefined; }
export interface GltfAccessor { type: string; componentType: number; bufferView: number; byteOffset?: number | undefined; count: number; }
export interface GltfDoc { nodes: GltfNode[]; skins: { joints: number[]; inverseBindMatrices: number }[]; accessors: GltfAccessor[]; buffers?: { byteLength?: number | undefined; uri?: string | undefined }[] | undefined; bufferViews: { byteOffset?: number | undefined; byteStride?: number | undefined; byteLength?: number | undefined; buffer?: number | undefined }[]; animations?: { samplers: { input: number; output: number; interpolation?: string | undefined }[]; channels: { sampler: number; target?: { node?: number | undefined; path?: string | undefined } | undefined }[] }[] | undefined; meshes: { primitives: { attributes: Record<string, number> }[] }[]; }
export interface Glb { doc: GltfDoc; bin: Buffer; }
const NC: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const CS: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
export function parseGlb(b: Buffer): Glb {
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  const jl = b.readUInt32LE(12);
  const doc = JSON.parse(b.subarray(20, 20 + jl).toString("utf8")) as GltfDoc;
  const nx = 20 + jl;
  const bin = nx >= b.length ? Buffer.alloc(0) : Buffer.from(b.subarray(nx + 8, nx + 8 + b.readUInt32LE(nx)));
  return { doc, bin };
}
export function buildGlb(doc: GltfDoc, bin: Buffer): Buffer {
  const jb = Buffer.from(JSON.stringify(doc));
  const jp = (4 - (jb.length % 4)) % 4;
  const bp = (4 - (bin.length % 4)) % 4;
  const g = Buffer.alloc(12 + 8 + jb.length + jp + 8 + bin.length + bp);
  g.writeUInt32LE(0x46546c67, 0); g.writeUInt32LE(2, 4); g.writeUInt32LE(g.length, 8);
  g.writeUInt32LE(jb.length + jp, 12); g.writeUInt32LE(0x4e4f534a, 16);
  jb.copy(g, 20); g.fill(0x20, 20 + jb.length, 20 + jb.length + jp);
  const bo = 20 + jb.length + jp;
  g.writeUInt32LE(bin.length + bp, bo); g.writeUInt32LE(0x004e4942, bo + 4);
  bin.copy(g, bo + 8);
  return g;
}
export function accRange(doc: GltfDoc, i: number): { base: number; stride: number; n: number } {
  const a = doc.accessors[i] as GltfAccessor;
  const bv = doc.bufferViews[a.bufferView] as GltfDoc["bufferViews"][number];
  const n = NC[a.type] as number;
  if (n === undefined || a.componentType !== 5126) throw new Error(`acc ${i}: float32 only`);
  return { base: (bv.byteOffset ?? 0) + (a.byteOffset ?? 0), stride: bv.byteStride ?? n * 4, n };
}
function mul(a: number[], b: number[]): number[] {
  const c = new Array<number>(16).fill(0);
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) { let s = 0; for (let k = 0; k < 4; k++) s += (a[k * 4 + y] as number) * (b[x * 4 + k] as number); c[x * 4 + y] = s; }
  return c;
}
function inv(m: number[]): number[] {
  const a = [...m]; const o = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let c = 0; c < 4; c++) { let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(a[c * 4 + r] as number) > Math.abs(a[c * 4 + p] as number)) p = r; for (let k = 0; k < 4; k++) { const t = a[k * 4 + c] as number; a[k * 4 + c] = a[k * 4 + p] as number; a[k * 4 + p] = t; const u = o[k * 4 + c] as number; o[k * 4 + c] = o[k * 4 + p] as number; o[k * 4 + p] = u; } const d = a[c * 4 + c] as number; for (let k = 0; k < 4; k++) { a[k * 4 + c] = (a[k * 4 + c] as number) / d; o[k * 4 + c] = (o[k * 4 + c] as number) / d; } for (let r = 0; r < 4; r++) { if (r === c) continue; const f = a[c * 4 + r] as number; for (let k = 0; k < 4; k++) { a[k * 4 + r] = (a[k * 4 + r] as number) - f * (a[k * 4 + c] as number); o[k * 4 + r] = (o[k * 4 + r] as number) - f * (o[k * 4 + c] as number); } } }
  return o;
}
function localOf(n: GltfNode): number[] {
  if (n.matrix !== undefined) return [...n.matrix];
  const t = (n.translation ?? [0, 0, 0]) as number[]; const q = (n.rotation ?? [0, 0, 0, 1]) as number[]; const s = (n.scale ?? [1, 1, 1]) as number[];
  const [x, y, z, w] = [q[0] as number, q[1] as number, q[2] as number, q[3] as number];
  const r = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  const m = new Array<number>(16).fill(0);
  for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) m[c * 4 + rr] = (r[rr * 3 + c] as number) * (s[c] as number);
  m[12] = t[0] as number; m[13] = t[1] as number; m[14] = t[2] as number; m[15] = 1;
  return m;
}
function worldCache(doc: GltfDoc): (i: number) => number[] {
  const par = new Array<number>(doc.nodes.length).fill(-1);
  doc.nodes.forEach((n, i) => { (n.children ?? []).forEach((c) => { par[c] = i; }); });
  const memo = new Map<number, number[]>();
  const rec = (i: number): number[] => { const hit = memo.get(i); if (hit !== undefined) return hit; const p = par[i] as number; const w = p < 0 ? localOf(doc.nodes[i] as GltfNode) : mul(rec(p), localOf(doc.nodes[i] as GltfNode)); memo.set(i, w); return w; };
  return rec;
}
// A6: IBM' = inv(J'_world) * J_world * IBM; translation outputs shift by the parent-local delta.
export function applyRigDelta(pre: Buffer, names: string[], deltaOf: (nm: string) => number[]): Buffer {
  const { doc, bin } = parseGlb(pre);
  const out = Buffer.from(bin); const W = worldCache(doc);
  for (const nm of names) {
    const ni = doc.nodes.findIndex((n) => n.name === nm);
    if (ni < 0) throw new Error(`${nm}: joint node missing`);
    const node = doc.nodes[ni] as GltfNode;
    if (node.translation === undefined || node.matrix !== undefined) throw new Error(`${nm}: no plain translation`);
    const Jw = W(ni); const wd = deltaOf(nm); const Jn = [...Jw]; Jn[12] = (Jw[12] as number) + (wd[0] as number); Jn[13] = (Jw[13] as number) + (wd[1] as number); Jn[14] = (Jw[14] as number) + (wd[2] as number);
    let par = -1; doc.nodes.forEach((n, i) => { if ((n.children ?? []).includes(ni)) par = i; });
    const Wp = par < 0 ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : W(par);
    const Wi = inv(Wp); const tNv = [0, 1, 2].map((r) => (Wi[r] as number) * (Jn[12] as number) + (Wi[4 + r] as number) * (Jn[13] as number) + (Wi[8 + r] as number) * (Jn[14] as number) + (Wi[12 + r] as number));
    const tO = node.translation; const dl = [0, 1, 2].map((k) => (tNv[k] as number) - (tO[k] as number));
    node.translation = tNv;
    for (const sk of doc.skins) { const slot = sk.joints.indexOf(ni); if (slot < 0) continue; const r = accRange(doc, sk.inverseBindMatrices); const row = Array.from({ length: 16 }, (_, c) => out.readFloatLE(r.base + slot * 64 + c * 4)); mul(mul(inv(Jn), Jw), row).forEach((v, c) => { out.writeFloatLE(v, r.base + slot * 64 + c * 4); }); }
    for (const an of doc.animations ?? []) for (const ch of an.channels) { if (ch.target?.node !== ni || ch.target?.path !== "translation") continue; const s = an.samplers[ch.sampler] as { input: number; output: number }; const r = accRange(doc, s.output); for (let k = 0; k < (doc.accessors[s.output] as GltfAccessor).count; k++) for (let q = 0; q < 3; q++) { const o = r.base + k * r.stride + q * 4; out.writeFloatLE(out.readFloatLE(o) + (dl[q] as number), o); } }
  }
  return buildGlb(doc, out);
}
export const EYE_DELTA: Record<string, number[]> = { "eye.L": [0.002, -0.001, 0.0005], "eye.R": [-0.002, -0.001, 0.0005] };
export const applyF1 = (pre: Buffer): Buffer => applyRigDelta(pre, ["eye.L", "eye.R"], (nm) => EYE_DELTA[nm] as number[]);
export function nudgeNodeField(pre: Buffer, name: string, field: "translation" | "rotation", idx: number, amt: number): Buffer {
  const { doc, bin } = parseGlb(pre);
  const n = doc.nodes.find((x) => x.name === name) as GltfNode;
  ((n[field] ?? []) as number[])[idx] = (((n[field] ?? []) as number[])[idx] as number) + amt;
  return buildGlb(doc, Buffer.from(bin));
}
export function nudgeAccessor(pre: Buffer, ai: number, elem: number, amt: number): Buffer {
  const { doc, bin } = parseGlb(pre);
  const out = Buffer.from(bin); const r = accRange(doc, ai);
  const o = r.base + Math.floor(elem / r.n) * r.stride + (elem % r.n) * 4;
  out.writeFloatLE(out.readFloatLE(o) + amt, o);
  return buildGlb(doc, out);
}
export function probe(pre: Buffer, name: string): { ibm: number; slot: number; node: number; out: number; body: number } {
  const { doc } = parseGlb(pre);
  const node = doc.nodes.findIndex((n) => n.name === name);
  const sk = doc.skins.find((s) => s.joints.includes(node)) as GltfDoc["skins"][number];
  let out = -1;
  for (const an of doc.animations ?? []) for (const ch of an.channels) if (ch.target?.node === node && ch.target?.path === "translation") out = (an.samplers[ch.sampler] as { input: number; output: number }).output;
  if (out < 0) throw new Error(`${name}: no translation output`);
  const holder = doc.nodes.find((n) => n.mesh !== undefined && n.skin !== undefined) as GltfNode;
  const prim = (doc.meshes[holder.mesh as number] as GltfDoc["meshes"][number]).primitives[0] as { attributes: Record<string, number> };
  return { ibm: sk.inverseBindMatrices, slot: sk.joints.indexOf(node), node, out, body: prim.attributes["POSITION"] as number };
}
function rawAccessorBytes(g: Glb, i: number): Buffer {
  const ac = g.doc.accessors[i] as GltfAccessor;
  if (ac.bufferView === undefined) return Buffer.from(JSON.stringify(ac));
  const bv = g.doc.bufferViews[ac.bufferView] as GltfDoc["bufferViews"][number];
  const n = NC[ac.type] as number; const cs = CS[ac.componentType] as number;
  const stride = bv.byteStride ?? n * cs; const base = (bv.byteOffset ?? 0) + (ac.byteOffset ?? 0);
  const o = Buffer.alloc(ac.count * n * cs);
  for (let k = 0; k < ac.count; k++) g.bin.subarray(base + k * stride, base + k * stride + n * cs).copy(o, k * n * cs);
  return o;
}
export function structuralDiff(a: Buffer, b: Buffer): string[] {
  const A = parseGlb(a); const B = parseGlb(b); const out: string[] = [];
  A.doc.nodes.forEach((n, i) => { const m = B.doc.nodes[i] as GltfNode; for (const f of ["translation", "rotation", "scale", "matrix", "children"] as const) if (JSON.stringify(n[f] ?? null) !== JSON.stringify((m[f] ?? null) as unknown)) out.push(`node ${i} ${f}`); });
  A.doc.accessors.forEach((_, i) => { if (rawAccessorBytes(A, i).compare(rawAccessorBytes(B, i)) !== 0) out.push(`accessor ${i}`); });
  return out;
}
// h1 counterweight mutators (JSON-only edits; structuralDiff above is blind to them by design).
export function remapDoc(pre: Buffer, fn: (doc: GltfDoc) => void): Buffer {
  const { doc, bin } = parseGlb(pre);
  fn(doc);
  return buildGlb(doc, Buffer.from(bin));
}
export function renameNode(pre: Buffer, oldName: string, newName: string): Buffer {
  return remapDoc(pre, (doc) => {
    const n = doc.nodes.find((x) => x.name === oldName) as GltfNode | undefined;
    if (n === undefined) throw new Error(`${oldName}: node missing`);
    n.name = newName;
  });
}
export function shareOutput(pre: Buffer, from: string, to: string): Buffer {
  const src = probe(pre, from); const dst = probe(pre, to);
  return remapDoc(pre, (doc) => {
    for (const an of doc.animations ?? []) for (const ch of an.channels) {
      if (ch.target?.node === src.node && ch.target?.path === "translation") (an.samplers[ch.sampler] as { input: number; output: number }).output = dst.out;
    }
  });
}
export function setInterp(pre: Buffer, name: string, value: string): Buffer {
  const p = probe(pre, name);
  return remapDoc(pre, (doc) => {
    for (const an of doc.animations ?? []) for (const ch of an.channels) {
      if (ch.target?.node === p.node && ch.target?.path === "translation") (an.samplers[ch.sampler] as { input: number; output: number; interpolation?: string }).interpolation = value;
    }
  });
}
export function movePositionToSecondBuffer(pre: Buffer): Buffer {
  const p = probe(pre, "jaw");
  return remapDoc(pre, (doc) => {
    doc.buffers = [{ byteLength: 8 }, { byteLength: 8, uri: "data:application/octet-stream;base64,AA==" }];
    (doc.bufferViews[(doc.accessors[p.body] as GltfAccessor).bufferView] as GltfDoc["bufferViews"][number]).buffer = 1;
  });
}
