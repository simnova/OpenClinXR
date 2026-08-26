/**
 * #686 — geometry analysis: what does the skirt's normal-dot actually look like
 * versus the bodice's? Print per-band statistics and a sampled vertex table so the
 * decorrelation mechanism is visible before any fix is designed.
 *
 * claimScope: directional statistics of gown-vs-body surface normals per band on
 *   mpfb-gown-adult-patient.glb at the pre-fix commit.
 * notEvidenceFor: appearance, any fix design.
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

function nearest(g: Vertex, body: Vertex[]): { q: Vertex; d: number } | null {
  let best = Number.POSITIVE_INFINITY;
  let nearest: Vertex | null = null;
  for (const q of body) {
    if (Math.abs(q.p[1] - g.p[1]) > SLAB_METRES) continue;
    const d = Math.hypot(q.p[0] - g.p[0], q.p[2] - g.p[2]);
    if (d < best) { best = d; nearest = q; }
  }
  return nearest === null ? null : { q: nearest, d: best };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : Number.NaN;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : Number.NaN;
}

function stats(values: number[]): string {
  return `n=${values.length} p10=${percentile(values, 0.1).toFixed(3)} p25=${percentile(values, 0.25).toFixed(3)} p50=${median(values).toFixed(3)} p75=${percentile(values, 0.75).toFixed(3)} p90=${percentile(values, 0.9).toFixed(3)}`;
}

async function main() {
  const { gown, body } = await loadVertices();
  const ys = body.map((v) => v.p[1]);
  const floorY = Math.min(...ys);
  const height = Math.max(...ys) - floorY;
  const cx = 0; // approximate; refine below from body
  const cz = 0;
  const bodyCx = body.map((v) => v.p[0]).reduce((a, b) => a + b, 0) / body.length;
  const bodyCz = body.map((v) => v.p[2]).reduce((a, b) => a + b, 0) / body.length;
  console.log(`height=${height.toFixed(4)} bodyCx=${bodyCx.toFixed(4)} bodyCz=${bodyCz.toFixed(4)}`);

  const bands: Record<string, [number, number]> = {
    bodice: [0.62, 0.82],
    waist: [0.52, 0.62],
    skirt: [0.34, 0.5],
  };
  for (const [bname, band] of Object.entries(bands)) {
    const g = gown.filter((_, i) => i % STRIDE === 0).filter((v) => {
      const f = (v.p[1] - floorY) / height;
      return f >= band[0] && f < band[1];
    });
    const dots: number[] = [];
    const gNormVert: number[] = []; // vertical component of gown normal
    const gNormRadial: number[] = []; // dot of gown normal with radial-from-centerline dir
    const bNormRadial: number[] = []; // dot of body normal with radial dir
    const sample: Array<Record<string, unknown>> = [];
    for (const v of g) {
      const nn = nearest(v, body);
      if (!nn) continue;
      const { q } = nn;
      const dot = v.n[0] * q.n[0] + v.n[1] * q.n[1] + v.n[2] * q.n[2];
      const scale = Math.hypot(v.n[0], v.n[1], v.n[2]) * Math.hypot(q.n[0], q.n[1], q.n[2]);
      dots.push(dot / scale);
      const rx = v.p[0] - bodyCx;
      const rz = v.p[2] - bodyCz;
      const rr = Math.hypot(rx, rz) || 1e-9;
      gNormVert.push(v.n[1] / (Math.hypot(v.n[0], v.n[1], v.n[2]) || 1e-9));
      gNormRadial.push((v.n[0] * rx / rr + v.n[2] * rz / rr) / (Math.hypot(v.n[0], v.n[1], v.n[2]) || 1e-9));
      bNormRadial.push((q.n[0] * rx / rr + q.n[2] * rz / rr) / (Math.hypot(q.n[0], q.n[1], q.n[2]) || 1e-9));
      if (sample.length < 12) {
        sample.push({
          gownPos: v.p.map((x) => Number(x.toFixed(3))),
          gownN: v.n.map((x) => Number(x.toFixed(3))),
          bodyPos: q.p.map((x) => Number(x.toFixed(3))),
          bodyN: q.n.map((x) => Number(x.toFixed(3))),
          dot: Number((dot / scale).toFixed(3)),
          clearMm: Number((nn.d * 1000).toFixed(1)),
        });
      }
    }
    console.log(`\n=== ${bname} [${band}] ===`);
    console.log(`dot:      ${stats(dots)}`);
    console.log(`gNormVert: ${stats(gNormVert)}   (gown normal vertical component)`);
    console.log(`gNormRadial: ${stats(gNormRadial)} (gown normal vs centerline-radial)`);
    console.log(`bNormRadial: ${stats(bNormRadial)} (body normal vs centerline-radial)`);
    console.log("sample:");
    for (const s of sample) console.log(JSON.stringify(s));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
