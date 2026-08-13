/**
 * Measurement: flip rate + amplitude of the visible/hidden skin frontier at garment boundaries.
 *
 * Issue #355: "The jagged garment hems are unexplained — #350 removed the slivers and the sawtooth is
 * unchanged." This slice measures the frontier between visible skin and alpha-0 hidden skin on the
 * body mesh, at each garment boundary (shirt hem, trouser cuff, boot top), plus the garment's own
 * hem edge as the known-good comparison.
 *
 * Method: the hairline flip-rate method (hairline-is-a-line-not-a-sawtooth.test.ts) — order boundary
 * vertices along the edge, count sign changes in successive height deltas. The frontier is walked
 * into loops (at each vertex the boundary turns through the hidden-material wedge), so the vertex
 * order is the true along-the-edge order.
 *
 * Nothing is fixed. Output: .openclinxr/evidence/mpfb-hem-edge/pre-fix.json (force-added; the
 * directory is gitignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";
const OUT = join(REPO_ROOT, ".openclinxr/evidence/mpfb-hem-edge/pre-fix.json");
/** 1 px is ~1.53 mm in a full-body capture (measured in #350 on the same figures). */
const MM_PER_PX = 1.53;

const io = new NodeIO();

const KEY = (v: number[]): string => v.map((x) => x.toFixed(5)).join(",");
const edgeId = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const otherOf = (e: string, v: string): string => {
  const [a, b] = e.split("|");
  return a === v ? b : a;
};

type Face = { v: string[]; kind: "skin" | "hidden"; hiddenName?: string };
type Vec3 = [number, number, number];

function faceNormal(f: Face, posOf: Map<string, number[]>): Vec3 {
  const p0 = posOf.get(f.v[0]!)!, p1 = posOf.get(f.v[1]!)!, p2 = posOf.get(f.v[2]!)!;
  const ux = p1[0]! - p0[0]!, uy = p1[1]! - p0[1]!, uz = p1[2]! - p0[2]!;
  const vx = p2[0]! - p0[0]!, vy = p2[1]! - p0[1]!, vz = p2[2]! - p0[2]!;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function angleAround(vkey: string, faceIdx: number, nrm: Vec3, faces: Face[], posOf: Map<string, number[]>): number {
  const v = posOf.get(vkey)!;
  const f = faces[faceIdx]!;
  const other = f.v.filter((k) => k !== vkey).map((k) => posOf.get(k)!);
  const c = [
    (v[0]! + other[0]![0]! + other[1]![0]!) / 3 - v[0]!,
    (v[1]! + other[0]![1]! + other[1]![1]!) / 3 - v[1]!,
    (v[2]! + other[0]![2]! + other[1]![2]!) / 3 - v[2]!,
  ];
  const d = nrm[0]! * c[0]! + nrm[1]! * c[1]! + nrm[2]! * c[2]!;
  const px = c[0]! - d * nrm[0]!, py = c[1]! - d * nrm[1]!, pz = c[2]! - d * nrm[2]!;
  let tx = 0, ty = 0, tz = 1;
  if (Math.abs(nrm[2]!) > 0.9) { tx = 1; ty = 0; tz = 0; }
  const bx = ty * nrm[2]! - tz * nrm[1]!, by = tz * nrm[0]! - tx * nrm[2]!, bz = tx * nrm[1]! - ty * nrm[0]!;
  const ux = by * nrm[2]! - bz * nrm[1]!, uy = bz * nrm[0]! - bx * nrm[2]!, uz = bx * nrm[1]! - by * nrm[0]!;
  return Math.atan2(px * bx + py * by + pz * bz, px * ux + py * uy + pz * uz);
}

/** Walk the visible/hidden frontier of the body mesh into loops (turn through the hidden wedge). */
function frontierLoops(doc: Awaited<ReturnType<typeof io.read>>) {
  const body = doc.getRoot().listMeshes().find((m) => /_body$/.test(m.getName()));
  if (!body) return { loops: [] as string[][], posOf: new Map<string, number[]>(), faces: [] as Face[] };

  const faces: Face[] = [];
  const posOf = new Map<string, number[]>();
  for (const p of body.listPrimitives()) {
    const n = p.getMaterial()?.getName() ?? "";
    let kind: "skin" | "hidden" | null = null;
    if (/skin/i.test(n)) kind = "skin";
    else if (/openclinxr_hidden/i.test(n)) kind = "hidden";
    if (!kind) continue;
    const a = p.getAttribute("POSITION");
    const ix = p.getIndices();
    if (!a || !ix) continue;
    const keys: string[] = [];
    for (let i = 0; i < a.getCount(); i++) {
      const v = a.getElement(i, [0, 0, 0]) as number[];
      const k = KEY(v);
      keys.push(k);
      posOf.set(k, v);
    }
    for (let i = 0; i < ix.getCount(); i += 3) {
      faces.push({ v: [keys[ix.getScalar(i)]!, keys[ix.getScalar(i + 1)]!, keys[ix.getScalar(i + 2)]!], kind, hiddenName: n });
    }
  }

  const facesAt = new Map<string, number[]>();
  faces.forEach((f, fi) => {
    for (const k of f.v) {
      const l = facesAt.get(k) ?? [];
      l.push(fi);
      facesAt.set(k, l);
    }
  });

  const pairAt = new Map<string, Map<string, string>>();
  for (const [vkey, fis] of facesAt) {
    if (fis.length < 3) continue;
    const nrmAcc: Vec3 = [0, 0, 0];
    for (const fi of fis) {
      const n = faceNormal(faces[fi]!, posOf);
      nrmAcc[0] += n[0]; nrmAcc[1] += n[1]; nrmAcc[2] += n[2];
    }
    const len = Math.hypot(nrmAcc[0], nrmAcc[1], nrmAcc[2]);
    if (len === 0) continue;
    const nrm: Vec3 = [nrmAcc[0] / len, nrmAcc[1] / len, nrmAcc[2] / len];
    const ordered = fis.map((fi) => ({ fi, ang: angleAround(vkey, fi, nrm, faces, posOf) })).sort((x, y) => x.ang - y.ang);
    type Trans = { pos: number; edge: string };
    const transitions: Trans[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const fa = faces[ordered[i]!.fi]!;
      const fb = faces[ordered[(i + 1) % ordered.length]!.fi]!;
      if (fa.kind !== fb.kind) {
        const shared = fa.v.find((k) => k !== vkey && fb.v.includes(k))!;
        transitions.push({ pos: i, edge: edgeId(vkey, shared) });
      }
    }
    if (transitions.length < 2) continue;
    for (let i = 0; i < transitions.length; i++) {
      const t = transitions[i]!;
      const j = (i + 1) % transitions.length;
      const nextPos = transitions[j]!.pos;
      let allHidden = true;
      let k = (t.pos + 1) % ordered.length;
      while (k !== nextPos) {
        if (faces[ordered[k]!.fi]!.kind !== "hidden") { allHidden = false; break; }
        k = (k + 1) % ordered.length;
      }
      if (allHidden) {
        const m = pairAt.get(vkey) ?? new Map();
        m.set(t.edge, transitions[j]!.edge);
        pairAt.set(vkey, m);
      }
    }
  }

  const visitedEdges = new Set<string>();
  const loops: string[][] = [];
  for (const [vkey, m] of pairAt) {
    for (const [inE] of m) {
      if (visitedEdges.has(inE)) continue;
      const loop: string[] = [];
      let v = vkey;
      let e = inE;
      let guard = 0;
      while (!visitedEdges.has(e) && guard++ < 1_000_000) {
        visitedEdges.add(e);
        loop.push(e);
        const next = pairAt.get(v)?.get(e);
        if (!next) break;
        v = otherOf(next, v);
        e = next;
      }
      if (loop.length > 1) loops.push(loop);
    }
  }
  return { loops, posOf, faces };
}

/** Vertex sequence of a walked loop, in walk order (edge-adjacent). */
function loopVertexKeys(loop: string[]): string[] {
  const seq: string[] = [];
  const [a, b] = loop[0]!.split("|");
  seq.push(a, b);
  let v = b;
  for (let i = 1; i < loop.length; i++) {
    v = otherOf(loop[i]!, v);
    seq.push(v);
  }
  return seq;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Circular moving average (window must be odd). */
function smoothCircular(ys: number[], window: number): number[] {
  const n = ys.length;
  const out: number[] = new Array(n);
  const half = Math.floor(window / 2);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = -half; j <= half; j++) {
      sum += ys[(i + j + n) % n]!;
    }
    out[i] = sum / window;
  }
  return out;
}

/** Hairline flip-rate + amplitude stats over a walked vertex sequence. */
function flipStats(keys: string[], posOf: Map<string, number[]>) {
  const ys = keys.map((k) => posOf.get(k)![1]!);
  let steps = 0;
  let flips = 0;
  let prev = 0;
  const dys: number[] = [];
  for (let i = 1; i <= ys.length; i++) {
    const a = ys[i - 1]!;
    const b = ys[i % ys.length]!;
    const dy = b - a;
    if (Math.abs(dy) < 1e-6) continue;
    steps++;
    dys.push(dy);
    if (prev !== 0 && Math.sign(dy) !== Math.sign(prev)) flips++;
    prev = Math.sign(dy) as number;
  }
  // extrema teeth: consecutive extremum heights (alternating peaks/valleys)
  const teeth: number[] = [];
  {
    let dir = 0;
    let lastExt = ys[0]!;
    let started = false;
    for (let i = 1; i <= ys.length; i++) {
      const d = Math.sign(ys[i % ys.length]! - ys[i - 1]!);
      if (d !== 0) {
        if (!started) { dir = d; started = true; }
        if (d !== dir) {
          teeth.push(Math.abs(ys[i - 1]! - lastExt));
          lastExt = ys[i - 1]!;
          dir = d;
        }
      }
    }
    teeth.push(Math.abs(ys[0]! - lastExt));
  }
  // detrended zigzag amplitude: residual after circular moving-average smoothing
  const smooth = smoothCircular(ys, Math.min(9, ys.length % 2 === 0 ? 9 : 9));
  const resid = ys.map((y, i) => y - smooth[i]!);
  const residP2p = Math.max(...resid) - Math.min(...resid);
  return {
    verts: ys.length,
    steps,
    flips,
    flipRate: steps ? flips / steps : 0,
    medianStepMm: median(dys.map(Math.abs)) * 1000,
    maxStepMm: (dys.length ? Math.max(...dys.map(Math.abs)) : 0) * 1000,
    medianToothMm: median(teeth) * 1000,
    maxToothMm: (teeth.length ? Math.max(...teeth) : 0) * 1000,
    zigzagP2pMm: residP2p * 1000,
    spanMm: (Math.max(...ys) - Math.min(...ys)) * 1000,
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  };
}

/** Figure height from rendering primitives (alpha-0 MASK excluded). */
function figureHeight(doc: Awaited<ReturnType<typeof io.read>>): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of doc.getRoot().listMeshes()) {
    for (const p of m.listPrimitives()) {
      const mat = p.getMaterial();
      if (mat?.getAlphaMode() === "MASK" && (mat?.getBaseColorFactor()?.[3] ?? 1) === 0) continue;
      const pos = p.getAttribute("POSITION");
      if (!pos) continue;
      for (let i = 0; i < pos.getCount(); i++) {
        const y = (pos.getElement(i, [0, 0, 0]) as number[])[1]!;
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
  }
  return hi - lo;
}

/** Boundary (open-edge) loops of a garment mesh, walked in order. */
function garmentBoundaryLoops(doc: Awaited<ReturnType<typeof io.read>>, nameRe: RegExp) {
  const garment = doc
    .getRoot()
    .listMeshes()
    .find((m) => nameRe.test(m.getName()));
  if (!garment) return { loops: [] as string[][], posOf: new Map<string, number[]>() };
  const posOf = new Map<string, number[]>();
  const faces: string[][] = [];
  for (const p of garment.listPrimitives()) {
    const a = p.getAttribute("POSITION");
    const ix = p.getIndices();
    if (!a || !ix) continue;
    const keys: string[] = [];
    for (let i = 0; i < a.getCount(); i++) {
      const v = a.getElement(i, [0, 0, 0]) as number[];
      const k = KEY(v);
      keys.push(k);
      posOf.set(k, v);
    }
    for (let i = 0; i < ix.getCount(); i += 3) {
      faces.push([keys[ix.getScalar(i)]!, keys[ix.getScalar(i + 1)]!, keys[ix.getScalar(i + 2)]!]);
    }
  }
  const edgeCount = new Map<string, number>();
  for (const f of faces) {
    for (let k = 0; k < 3; k++) {
      const e = edgeId(f[k]!, f[(k + 1) % 3]!);
      edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1);
    }
  }
  const boundary = [...edgeCount.entries()].filter(([, c]) => c === 1).map(([e]) => e);
  const adj = new Map<string, string[]>();
  for (const e of boundary) {
    const [a, b] = e.split("|");
    const la = adj.get(a) ?? [];
    la.push(b);
    adj.set(a, la);
    const lb = adj.get(b) ?? [];
    lb.push(a);
    adj.set(b, lb);
  }
  const visited = new Set<string>();
  const loops: string[][] = [];
  for (const e of boundary) {
    if (visited.has(e)) continue;
    const loop: string[] = [];
    const [a, b] = e.split("|");
    loop.push(e);
    visited.add(e);
    let v = b;
    let prev = a;
    let guard = 0;
    while (v !== a && guard++ < 1_000_000) {
      const nbrs = adj.get(v) ?? [];
      const next = nbrs.find((n) => n !== prev);
      if (next === undefined) break;
      const ne = edgeId(v, next);
      if (visited.has(ne)) break;
      visited.add(ne);
      loop.push(ne);
      prev = v;
      v = next;
    }
    loops.push(loop);
  }
  return { loops, posOf };
}

function hiddenRegionOf(name: string): string {
  const m = name.match(/openclinxr_hidden_([a-z0-9]+)/);
  return m?.[1] ?? "?";
}

const px = (mm: number) => mm / MM_PER_PX;
const withPx = (mm: number) => ({ mm: Math.round(mm * 10) / 10, px: Math.round(px(mm) * 10) / 10 });

const FILES = ["mpfb-ob-patient-aisha.glb", "mpfb-peds-nurse-kevin.glb", "mpfb-peds-patient-child.glb"];

const actors: unknown[] = [];
const loopInventory: unknown[] = [];

for (const f of FILES) {
  const doc = await io.read(join(REPO_ROOT, GENERATED, f));
  const H = figureHeight(doc);
  const { loops, posOf, faces } = frontierLoops(doc);

  // frontier loop stats + hidden regions
  const loopRows = loops.map((l, li) => {
    const keys = loopVertexKeys(l);
    const st = flipStats(keys, posOf);
    const hiddenRegions = new Set<string>();
    for (const e of l) {
      const [a, b] = e.split("|");
      const fi = faces.findIndex((fc) => fc.kind === "hidden" && fc.v.includes(a) && fc.v.includes(b));
      if (fi >= 0) hiddenRegions.add(hiddenRegionOf(faces[fi]!.hiddenName ?? ""));
    }
    return { index: li, edges: l.length, hiddenRegions: [...hiddenRegions], ...st };
  });
  loopRows.forEach((r) => loopInventory.push({ file: f, ...r }));

  // garment rims
  const rim = (re: RegExp, label: string) => {
    const { loops: rls, posOf: rp } = garmentBoundaryLoops(doc, re);
    const rows = rls.map((l) => {
      const keys = loopVertexKeys(l);
      return { label, edges: l.length, ...flipStats(keys, rp) };
    });
    return rows;
  };
  const shirtRims = rim(/toigo_t_shirt/, "t_shirt");
  const pantsRims = rim(/cargo_pants/, "cargo_pants");
  const shoeRims = rim(/footwear/, "footwear");

  // boundary anchors from garment rims + hidden-region y-extents
  const shirtHemRim = shirtRims.filter((r) => r.spanMm > 15).sort((a, b) => a.yMin - b.yMin)[0]; // lowest big loop = hem
  const cuffRims = pantsRims.filter((r) => r.yMax < 0.5); // loops at the legs (not the waist)
  const bootRim = shoeRims.filter((r) => r.spanMm > 8).sort((a, b) => b.yMax - a.yMax)[0]; // highest big loop = top
  // foot hidden region y-extent (fallback boot-top anchor + the boot-top frontier itself)
  const footLoops = loopRows.filter((r) => r.hiddenRegions.includes("foot"));
  const footY = footLoops.length
    ? { yMin: Math.min(...footLoops.map((r) => r.yMin)), yMax: Math.max(...footLoops.map((r) => r.yMax)) }
    : undefined;

  const band = (anchor: { yMin: number; yMax: number } | undefined, margin: number): [number, number] | null =>
    anchor ? [anchor.yMin - margin, anchor.yMax + margin] : null;

  const inBand = (b: [number, number]) => loopRows.filter((r) => r.yMax >= b[0] && r.yMin <= b[1]);

  const boundary = (name: string, anchor: { yMin: number; yMax: number } | undefined, region: string) => {
    const b = band(anchor, 0.12);
    if (!b) return { boundary: name, note: "no anchor" };
    const rows = inBand(b)
      .filter((r) => r.hiddenRegions.includes(region))
      .map((r) => ({
      loopIndex: r.index,
      edges: r.edges,
      yMin: r.yMin,
      yMax: r.yMax,
      hiddenRegions: r.hiddenRegions,
      flipRate: r.flipRate,
      medianStepMm: r.medianStepMm,
      medianStepPx: px(r.medianStepMm),
      maxStepMm: r.maxStepMm,
      maxStepPx: px(r.maxStepMm),
      medianToothMm: r.medianToothMm,
      medianToothPx: px(r.medianToothMm),
      maxToothMm: r.maxToothMm,
      maxToothPx: px(r.maxToothMm),
      zigzagP2pMm: r.zigzagP2pMm,
      zigzagP2pPx: px(r.zigzagP2pMm),
      spanMm: r.spanMm,
      spanPx: px(r.spanMm),
    }));
    // banded flip rate over the combined walked sequences of the in-band loops (in walk order)
    let steps = 0;
    let flips = 0;
    for (const li of rows.map((r) => r.loopIndex)) {
      const keys = loopVertexKeys(loops[li]!).filter((k) => {
        const y = posOf.get(k)![1]!;
        return y >= b[0] && y <= b[1];
      });
      if (keys.length < 2) continue;
      let prev = 0;
      for (let i = 1; i < keys.length; i++) {
        const dy = posOf.get(keys[i]!)![1]! - posOf.get(keys[i - 1]!)![1]!;
        if (Math.abs(dy) < 1e-6) continue;
        steps++;
        if (prev !== 0 && Math.sign(dy) !== Math.sign(prev)) flips++;
        prev = Math.sign(dy) as number;
      }
    }
    return {
      boundary: name,
      band: [Math.round(b[0] * 1000) / 1000, Math.round(b[1] * 1000) / 1000],
      anchorRim: anchor ? { yMin: anchor.yMin, yMax: anchor.yMax } : null,
      frontierLoopsInBand: rows.map((r) => r.loopIndex),
      bandedFlipRate: steps ? Math.round((flips / steps) * 1000) / 1000 : null,
      bandedSteps: steps,
      bandedFlips: flips,
      perLoop: rows,
    };
  };

  const knownGood = (name: string, rimRow: { edges: number; flipRate: number; medianStepMm: number; maxStepMm: number; medianToothMm: number; maxToothMm: number; zigzagP2pMm: number; spanMm: number; yMin: number; yMax: number } | undefined) =>
    rimRow
      ? {
          garment: name,
          edges: rimRow.edges,
          yMin: rimRow.yMin,
          yMax: rimRow.yMax,
          flipRate: rimRow.flipRate,
          medianStepMm: rimRow.medianStepMm,
          medianStepPx: px(rimRow.medianStepMm),
          maxStepMm: rimRow.maxStepMm,
          maxStepPx: px(rimRow.maxStepMm),
          medianToothMm: rimRow.medianToothMm,
          medianToothPx: px(rimRow.medianToothMm),
          maxToothMm: rimRow.maxToothMm,
          maxToothPx: px(rimRow.maxToothMm),
          zigzagP2pMm: rimRow.zigzagP2pMm,
          zigzagP2pPx: px(rimRow.zigzagP2pMm),
          spanMm: rimRow.spanMm,
          spanPx: px(rimRow.spanMm),
        }
      : { garment: name, note: "no rim loop found (closed mesh)" };

  // garment mesh y-extent for the t_shirt (informational)
  const shirtMesh = doc
    .getRoot()
    .listMeshes()
    .find((m) => /toigo_t_shirt/.test(m.getName()));
  let shirtY = { yMin: 0, yMax: 0 };
  if (shirtMesh) {
    let mn = Infinity;
    let mx = -Infinity;
    for (const p of shirtMesh.listPrimitives()) {
      const a = p.getAttribute("POSITION");
      if (!a) continue;
      for (let i = 0; i < a.getCount(); i++) {
        const y = (a.getElement(i, [0, 0, 0]) as number[])[1]!;
        if (y < mn) mn = y;
        if (y > mx) mx = y;
      }
    }
    shirtY = { yMin: mn, yMax: mx };
  }

  actors.push({
    file: f,
    figureHeightM: H,
    garments: {
      t_shirt: { yMin: shirtY.yMin, yMax: shirtY.yMax, rims: shirtRims.map((r) => ({ edges: r.edges, yMin: r.yMin, yMax: r.yMax, flipRate: r.flipRate })) },
      cargo_pants: { rims: pantsRims.map((r) => ({ edges: r.edges, yMin: r.yMin, yMax: r.yMax, flipRate: r.flipRate })) },
      footwear: { rims: shoeRims.map((r) => ({ edges: r.edges, yMin: r.yMin, yMax: r.yMax, flipRate: r.flipRate })) },
    },
    boundaries: {
      shirt_hem: boundary("shirt_hem", shirtHemRim, "upper"),
      trouser_cuff: boundary("trouser_cuff", cuffRims.sort((a, b) => a.yMin - b.yMin)[0], "lower"),
      boot_top: boundary("boot_top", footY ? { yMin: footY.yMin - 0.05, yMax: footY.yMax + 0.05 } : undefined, "foot"),
    },
    knownGood: {
      shirt_hem_rim: knownGood("t_shirt bottom rim", shirtHemRim),
      trouser_cuff_rim: knownGood("cargo_pants bottom rim", cuffRims.sort((a, b) => a.yMin - b.yMin)[0]),
      boot_top_rim: knownGood("footwear top rim", bootRim),
    },
  });
}

mkdirSync(dirname(OUT), { recursive: true });
const artifact: Record<string, unknown> = {
  slice: "issue-355",
  generatedAt: new Date().toISOString(),
  mmPerPx: MM_PER_PX,
  method:
    "hairline flip-rate method (hairline-is-a-line-not-a-sawtooth.test.ts): the visible/hidden skin frontier " +
    "(skin material vs alpha-0 openclinxr_hidden materials) is walked into loops on the body mesh (the boundary " +
    "turns through the hidden-material wedge at each vertex); boundary vertices are ordered along the edge by the " +
    "walk; flip rate = sign changes in successive height deltas / steps. Amplitude = |dY| step sizes, extremum " +
    "teeth, detrended (circular moving-average, window 9) zigzag peak-to-peak, and total span, all in mm and px " +
    "at 1.53 mm/px. The known-good is the garment's own boundary rim (t_shirt bottom loop etc.) measured the " +
    "same way. Nothing is fixed.",
  loopInventory,
  actors,
};
artifact.summary = buildSummary(artifact.actors as typeof actors);

function buildSummary(acts: typeof actors): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of acts as {
    file: string;
    boundaries: Record<string, { bandedFlipRate: number | null; bandedSteps: number; perLoop?: { zigzagP2pMm: number; medianStepMm: number; spanMm: number }[] }>;
    knownGood: Record<string, { flipRate?: number; zigzagP2pMm?: number; medianStepMm?: number; spanMm?: number }>;
  }[]) {
    const row: Record<string, unknown> = {};
    for (const [bn, b] of Object.entries(a.boundaries)) {
      const loops = b.perLoop ?? [];
      row[bn] = {
        frontierBandedFlipRate: b.bandedFlipRate,
        frontierBandedSteps: b.bandedSteps,
        frontierLoops: loops.length,
        frontierMedianStepMm: loops.length ? Math.min(...loops.map((l) => l.medianStepMm)) : null,
        frontierZigzagP2pMm: loops.length ? Math.max(...loops.map((l) => l.zigzagP2pMm)) : null,
        frontierMaxSpanMm: loops.length ? Math.max(...loops.map((l) => l.spanMm)) : null,
      };
    }
    const kg: Record<string, unknown> = {};
    for (const [gn, g] of Object.entries(a.knownGood)) {
      kg[gn] = g.flipRate !== undefined ? { flipRate: g.flipRate, zigzagP2pMm: g.zigzagP2pMm, medianStepMm: g.medianStepMm, spanMm: g.spanMm } : { note: "no rim" };
    }
    out[a.file] = { boundaries: row, knownGood: kg };
  }
  return out;
}
writeFileSync(OUT, JSON.stringify(artifact, null, 2));
console.log("wrote", OUT);

// console summary
const A = artifact.actors as {
  file: string;
  boundaries: Record<string, { bandedFlipRate: number | null; bandedSteps: number; perLoop?: { loopIndex: number; flipRate: number; medianStepMm: number; maxStepMm: number; zigzagP2pMm: number; spanMm: number }[]; note?: string }>;
  knownGood: Record<string, { garment: string; flipRate: number; medianStepMm: number; maxStepMm: number; zigzagP2pMm: number; spanMm: number }>;
}[];
for (const a of A) {
  console.log(`\n=== ${a.file} ===`);
  for (const [bname, b] of Object.entries(a.boundaries)) {
    if (b.note) {
      console.log(`  ${bname}: ${b.note}`);
      continue;
    }
    const fr = b.bandedFlipRate === null ? "n/a" : `${(b.bandedFlipRate * 100).toFixed(0)}%`;
    const loops = (b.perLoop ?? []).map((l) => `#${l.loopIndex} ${(l.flipRate * 100).toFixed(0)}% step${l.medianStepMm.toFixed(1)}mm p2p${l.zigzagP2pMm.toFixed(0)}mm span${l.spanMm.toFixed(0)}mm`).join(" | ");
    console.log(`  ${bname}: banded flip=${fr} (${b.bandedSteps} steps) loops=[${loops}]`);
  }
  for (const [gname, g] of Object.entries(a.knownGood)) {
    if (!("flipRate" in g)) {
      console.log(`  knownGood ${gname}: ${(g as { garment: string; note: string }).garment} — ${(g as { note: string }).note}`);
      continue;
    }
    console.log(`  knownGood ${gname}: ${g.garment} flip=${(g.flipRate * 100).toFixed(0)}% step=${g.medianStepMm.toFixed(1)}mm p2p=${g.zigzagP2pMm.toFixed(0)}mm span=${g.spanMm.toFixed(0)}mm`);
  }
}
