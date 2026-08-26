/**
 * #686 — decompose the bodice band: trunk vs sleeve vertices, baseline dot per class,
 * and the torso centerline (from trunk vertices only). Determines how much of the
 * median the sleeves own and where the trunk can legitimately decorrelate.
 */
import { NodeIO } from "@gltf-transform/core";

const DIR = "apps/ui-xr/public/generated-humanoids";
const ASSET = "mpfb-gown-adult-patient.glb";
const GOWN = /hospital_gown/;
const BODY = /mpfb_skin|hidden_(upper|lower)/;
const SLAB_METRES = 0.01;
const STRIDE = 3;
const TRUNK_X_MAX = 0.22; // from gown-torso-standoff.py: arms abducted beyond this

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

  // torso centerline from TRUNK body vertices in the chest band (y 1.0-1.5)
  const trunkBody = b.filter((v) => Math.abs(v.p[0]) < TRUNK_X_MAX && (v.p[1] - floorY) / height >= 0.55 && (v.p[1] - floorY) / height <= 0.84);
  const cx = trunkBody.map((v) => v.p[0]).reduce((a, c) => a + c, 0) / trunkBody.length;
  const cz = trunkBody.map((v) => v.p[2]).reduce((a, c) => a + c, 0) / trunkBody.length;
  console.log(`torso centerline: cx=${cx.toFixed(4)} cz=${cz.toFixed(4)} (from ${trunkBody.length} trunk body verts)`);

  const band: readonly [number, number] = [0.62, 0.82];
  const g = gown.filter((_, i) => i % STRIDE === 0).filter((v) => {
    const f = (v.p[1] - floorY) / height;
    return f >= band[0] && f < band[1];
  });

  const classes = { trunk: [] as number[], sleeve: [] as number[] };
  const clear = { trunk: [] as number[], sleeve: [] as number[] };
  const tubeDot = { trunk: [] as number[], sleeve: [] as number[] };
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
    const dotv = v.n[0] * nearest.n[0] + v.n[1] * nearest.n[1] + v.n[2] * nearest.n[2];
    const scale = Math.hypot(v.n[0], v.n[1], v.n[2]) * Math.hypot(nearest.n[0], nearest.n[1], nearest.n[2]);
    classes[cls].push(scale > 0 ? dotv / scale : Number.NaN);
    clear[cls].push(best * 1000);
    const rx = v.p[0] - cx;
    const rz = v.p[2] - cz;
    const rr = Math.hypot(rx, rz) || 1e-9;
    const tubeN = [rx / rr, 0, rz / rr];
    tubeDot[cls].push(tubeN[0] * nearest.n[0] + tubeN[1] * nearest.n[1] + tubeN[2] * nearest.n[2]);
  }
  const show = (name: string, arr: number[]) =>
    `${name}: n=${arr.length} p10=${percentile(arr, 0.1).toFixed(3)} p25=${percentile(arr, 0.25).toFixed(3)} p50=${median(arr).toFixed(3)} p75=${percentile(arr, 0.75).toFixed(3)} p90=${percentile(arr, 0.9).toFixed(3)}`;
  console.log(`\nBASELINE DOT:`);
  console.log(`  ${show("trunk ", classes.trunk)}`);
  console.log(`  ${show("sleeve", classes.sleeve)}`);
  console.log(`\nBASELINE CLEARANCE mm:`);
  console.log(`  ${show("trunk ", clear.trunk)}`);
  console.log(`  ${show("sleeve", clear.sleeve)}`);
  console.log(`\nTUBE-NORMAL DOT (horizontal radial from TORSO centerline):`);
  console.log(`  ${show("trunk ", tubeDot.trunk)}`);
  console.log(`  ${show("sleeve", tubeDot.sleeve)}`);
  // y distribution of sleeve verts in band
  const sleeveYs = g.filter((v) => Math.abs(v.p[0]) >= TRUNK_X_MAX).map((v) => ((v.p[1] - floorY) / height).toFixed(2));
  console.log(`\nsleeve vertex height fractions (first 30): ${sleeveYs.slice(0, 30).join(",")}`);
  const trunkCount = classes.trunk.length;
  const sleeveCount = classes.sleeve.length;
  console.log(`\ncounts: trunk=${trunkCount} sleeve=${sleeveCount} total=${trunkCount + sleeveCount}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
