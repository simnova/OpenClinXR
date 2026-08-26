/**
 * #686 — candidate-shape simulation. For each sampled bodice-band gown vertex, compute
 * the median dot product the contract measures, under three candidate garment shapes:
 *   (a) lofted tube: garment normal = horizontal radial from centerline (skirt-like)
 *   (b) flat-panel box: normal = sector direction (+z front / -z back / ±x sides)
 *   (c) baseline: the current gown normal
 * Also report clearance candidates for the tube (tube radius at that height) and the
 * current clearance. All measurements use the contract's exact nearest-body-vertex
 * instrument so a passing simulation predicts a passing contract.
 *
 * claimScope: which candidate bodice shape reaches the contract's 0.891 median line,
 *   measured on the real shipped body/gown geometry pre-fix.
 * notEvidenceFor: appearance (folds, silhouette), Blender implementability.
 */
import { NodeIO } from "@gltf-transform/core";

const DIR = "apps/ui-xr/public/generated-humanoids";
const ASSET = "mpfb-gown-adult-patient.glb";
const GOWN = /hospital_gown/;
const BODY = /mpfb_skin|hidden_(upper|lower)/;
const SLAB_METRES = 0.01;
const STRIDE = 3;

type Vertex = { readonly p: readonly [number, number, number]; readonly n: readonly [number, number, number] };

async function loadVertices(): Promise<{ gown: Vertex[]; body: Vertex[] }> {
  const doc = await new NodeIO().read(`${DIR}/${ASSET}`);
  const gown: Vertex[] = [];
  const body: Vertex[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      const isGown = GOWN.test(name);
      const isBody = !isGown && BODY.test(name);
      if (!isGown && !isBody) continue;
      const pos = prim.getAttribute("POSITION");
      const nrm = prim.getAttribute("NORMAL");
      if (!pos || !nrm) continue;
      const v = [0, 0, 0];
      const w = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, v);
        nrm.getElement(i, w);
        (isGown ? gown : body).push({ p: [v[0]!, v[1]!, v[2]!], n: [w[0]!, w[1]!, w[2]!] });
      }
    }
  }
  return { gown, body };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : Number.NaN;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : Number.NaN;
}

function dot(a: number[], b: number[]): number {
  const s = Math.hypot(...a) * Math.hypot(...b);
  return s > 0 ? (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / s : Number.NaN;
}

async function main() {
  const { gown, body } = await loadVertices();
  const ys = body.map((v) => v.p[1]);
  const floorY = Math.min(...ys);
  const height = Math.max(...ys) - floorY;
  const cx = body.map((v) => v.p[0]).reduce((a, b) => a + b, 0) / body.length;
  const cz = body.map((v) => v.p[2]).reduce((a, b) => a + b, 0) / body.length;
  const b = body.filter((_, i) => i % STRIDE === 0);

  const band: readonly [number, number] = [0.62, 0.82];
  const g = gown.filter((_, i) => i % STRIDE === 0).filter((v) => {
    const f = (v.p[1] - floorY) / height;
    return f >= band[0] && f < band[1];
  });

  const dots = { tube: [] as number[], box: [] as number[], baseline: [] as number[] };
  const clear = { tube: [] as number[], baseline: [] as number[] };
  const bodyTilt: number[] = []; // body normal angle from horizontal
  let front = 0, back = 0, side = 0;

  for (const v of g) {
    let best = Number.POSITIVE_INFINITY;
    let nearest: Vertex | null = null;
    for (const q of b) {
      if (Math.abs(q.p[1] - v.p[1]) > SLAB_METRES) continue;
      const d = Math.hypot(q.p[0] - v.p[0], q.p[2] - v.p[2]);
      if (d < best) { best = d; nearest = q; }
    }
    if (!Number.isFinite(best) || nearest === null) continue;

    const rx = v.p[0] - cx;
    const rz = v.p[2] - cz;
    const rr = Math.hypot(rx, rz) || 1e-9;
    // (a) lofted tube normal: horizontal radial from centerline
    const tubeN = [rx / rr, 0, rz / rr];
    // (b) box sector normal
    let boxN: number[];
    const ax = Math.abs(rx / rr);
    const az = Math.abs(rz / rr);
    if (az > ax && rz > 0) boxN = [0, 0, 1];
    else if (az > ax) boxN = [0, 0, -1];
    else if (rx > 0) boxN = [1, 0, 0];
    else boxN = [-1, 0, 0];
    if (az > ax) (rz > 0 ? front++ : back++); else side++;

    dots.tube.push(dot(tubeN, nearest.n));
    dots.box.push(dot(boxN, nearest.n));
    dots.baseline.push(dot(v.n, nearest.n));
    clear.baseline.push(best * 1000);
    const vn = Math.hypot(nearest.n[0], nearest.n[2]) / (Math.hypot(...nearest.n) || 1e-9);
    bodyTilt.push(Math.acos(Math.max(-1, Math.min(1, vn))) * 180 / Math.PI);
  }

  const show = (name: string, arr: number[]) =>
    `n=${arr.length} p10=${percentile(arr, 0.1).toFixed(3)} p25=${percentile(arr, 0.25).toFixed(3)} p50=${median(arr).toFixed(3)} p75=${percentile(arr, 0.75).toFixed(3)} p90=${percentile(arr, 0.9).toFixed(3)}`;
  console.log(`height=${height.toFixed(4)} cx=${cx.toFixed(4)} cz=${cz.toFixed(4)}`);
  console.log(`sectors: front=${front} back=${back} side=${side}`);
  console.log(`\nDOT (contract instrument):`);
  console.log(`  baseline: ${show("b", dots.baseline)}   (current gown)`);
  console.log(`  tube:     ${show("t", dots.tube)}   (horizontal radial — lofted tube)`);
  console.log(`  box:      ${show("x", dots.box)}   (flat sectors)`);
  console.log(`\nCLEARANCE mm:`);
  console.log(`  baseline: ${show("b", clear.baseline)}`);
  console.log(`\nbody normal tilt from horizontal (deg): p50=${(median(bodyTilt)).toFixed(1)} p90=${(percentile(bodyTilt, 0.9)).toFixed(1)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
