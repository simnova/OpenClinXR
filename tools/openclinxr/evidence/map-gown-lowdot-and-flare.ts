/**
 * #686 — spatial map of the bodice band's current dot distribution, plus a flared-tube
 * candidate: for each sampled bodice vertex, the dot of (flared loft normal, nearest body
 * normal) where the flared loft normal has a downward/outward lean component like the
 * skirt's loft (r' = r0*flare/span), and per-class (trunk/sleeve) medians.
 * Also: where are the current sub-0.891 vertices?
 */
import { NodeIO } from "@gltf-transform/core";

const DIR = "apps/ui-xr/public/generated-humanoids";
const ASSET = "mpfb-gown-adult-patient.glb";
const GOWN = /hospital_gown/;
const BODY = /mpfb_skin|hidden_(upper|lower)/;
const SLAB_METRES = 0.01;
const STRIDE = 3;
const TRUNK_X_MAX = 0.22;

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

async function main() {
  const { gown, body } = await loadVertices();
  const ys = body.map((v) => v.p[1]);
  const floorY = Math.min(...ys);
  const height = Math.max(...ys) - floorY;
  const b = body.filter((_, i) => i % STRIDE === 0);
  const trunkBody = b.filter((v) => Math.abs(v.p[0]) < TRUNK_X_MAX && (v.p[1] - floorY) / height >= 0.55 && (v.p[1] - floorY) / height <= 0.84);
  const cx = trunkBody.map((v) => v.p[0]).reduce((a, c) => a + c, 0) / trunkBody.length;
  const cz = trunkBody.map((v) => v.p[2]).reduce((a, c) => a + c, 0) / trunkBody.length;

  const band: readonly [number, number] = [0.62, 0.82];
  const g = gown.filter((_, i) => i % STRIDE === 0).filter((v) => {
    const f = (v.p[1] - floorY) / height;
    return f >= band[0] && f < band[1];
  });

  // hip and neck heights (same fractions the builder uses)
  const hipY = floorY + height * 0.55;
  const neckY = floorY + height * 0.84;
  const span = neckY - hipY;
  const r0 = 0.22; // tube radius at the hip ring (approx, matches r_base ~ torso_half_w*1.14)

  const perClass = { trunk: { base: [] as number[], flared: [] as number[] }, sleeve: { base: [] as number[], flared: [] as number[] } };
  const lowDotVerts: string[] = [];
  for (const v of g) {
    let best = Number.POSITIVE_INFINITY;
    let nearest: Vertex | null = null;
    for (const q of b) {
      if (Math.abs(q.p[1] - v.p[1]) > SLAB_METRES) continue;
      const d = Math.hypot(q.p[0] - v.p[0], q.p[2] - v.p[2]);
      if (d < best) { best = d; nearest = q; }
    }
    if (!Number.isFinite(best) || nearest === null) continue;
    const cls = Math.abs(v.p[0]) < TRUNK_X_MAX ? "trunk" : "sleeve";
    const s = Math.hypot(v.n[0], v.n[1], v.n[2]) * Math.hypot(nearest.n[0], nearest.n[1], nearest.n[2]);
    const baseDot = s > 0 ? (v.n[0] * nearest.n[0] + v.n[1] * nearest.n[1] + v.n[2] * nearest.n[2]) / s : Number.NaN;
    perClass[cls].base.push(baseDot);
    // flared loft normal: horizontal radial + outward lean component (skirt-style loft)
    const rx = v.p[0] - cx;
    const rz = v.p[2] - cz;
    const rr = Math.hypot(rx, rz) || 1e-9;
    const f = (neckY - v.p[1]) / span; // 0 at neck, 1 at hip
    const r = r0 * (1 + 0.12 * f);
    const lean = (r / Math.max(span, 1e-9)) * 0.12 * 0.5; // vertical component proxy (r' = dr/dy)
    const flareN = [rx / rr, 0, rz / rr];
    // outward lean: skirt normals have a small UP component (trumpet); use it as-is
    const fn = [flareN[0], 0, flareN[2]];
    perClass[cls].flared.push(fn[0] * nearest.n[0] + fn[1] * nearest.n[1] + fn[2] * nearest.n[2]);
    if (baseDot <= 0.891) {
      lowDotVerts.push(`pos=(${v.p[0].toFixed(3)},${v.p[1].toFixed(3)},${v.p[2].toFixed(3)}) cls=${cls} dot=${baseDot.toFixed(3)}`);
    }
  }
  const show = (name: string, arr: number[]) =>
    `${name}: n=${arr.length} p10=${percentile(arr, 0.1).toFixed(3)} p25=${percentile(arr, 0.25).toFixed(3)} p50=${median(arr).toFixed(3)} p75=${percentile(arr, 0.75).toFixed(3)} p90=${percentile(arr, 0.9).toFixed(3)}`;
  console.log(`torso centerline: cx=${cx.toFixed(4)} cz=${cz.toFixed(4)} hipY=${hipY.toFixed(3)} neckY=${neckY.toFixed(3)} span=${span.toFixed(3)}`);
  console.log(`\nBASELINE DOT:`);
  console.log(`  ${show("trunk ", perClass.trunk.base)}`);
  console.log(`  ${show("sleeve", perClass.sleeve.base)}`);
  console.log(`\nFLARED-LOFT DOT:`);
  console.log(`  ${show("trunk ", perClass.trunk.flared)}`);
  console.log(`  ${show("sleeve", perClass.sleeve.flared)}`);
  const allFlared = [...perClass.trunk.flared, ...perClass.sleeve.flared];
  console.log(`  ${show("ALL   ", allFlared)}`);
  console.log(`\nCurrent sub-0.891 vertices (${lowDotVerts.length}):`);
  for (const s of lowDotVerts.slice(0, 25)) console.log(`  ${s}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
