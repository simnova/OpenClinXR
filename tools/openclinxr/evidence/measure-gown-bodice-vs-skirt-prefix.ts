/**
 * #686 — pre-fix measurement: gown bodice shape (normal-dot) and level (clearance)
 * per band, for BOTH the shipped asset and the inspect fixture, before any edit.
 *
 * Reuses the planted contract's instrument exactly (NodeIO, same GOWN/BODY material
 * regexes, same STRIDE, same SLAB_METRES, same band fractions) so the pre-fix table
 * is the same measurement the contract runs, extended to `mpfb-gown-inspect.glb`
 * and the waist band.
 *
 * Writes .openclinxr/evidence/issue-686/pre-fix.json.
 *
 * claimScope: per-band vertex count, median clearance (mm), and median normal-dot
 *   (garment surface normal vs nearest body vertex normal within the Y slab) on the
 *   two gown GLBs at the pre-fix commit.
 * notEvidenceFor: appearance (orchestrator's pixel grade), cloth physics, runtime
 *   skinning, any other garment.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";

const DIR = "apps/ui-xr/public/generated-humanoids";
const ASSETS = ["mpfb-gown-adult-patient.glb", "mpfb-gown-inspect.glb"] as const;

/** Only vertices whose material is the delivered gown shell. */
const GOWN = /hospital_gown/;
/** Body surface: the skin plus the hidden torso/leg regions the gown covers. */
const BODY = /mpfb_skin|hidden_(upper|lower)/;

/** Half-height of the Y slab a garment vertex is compared within. */
const SLAB_METRES = 0.01;
/** Every third vertex, so the O(n*m) scan stays under a second. Deterministic, not random. */
const STRIDE = 3;

/** Bands as a fraction of body height, from the shipped asset's own body bounds. */
const BODICE: readonly [number, number] = [0.62, 0.82];
const WAIST: readonly [number, number] = [0.52, 0.62];
const SKIRT: readonly [number, number] = [0.34, 0.5];

type Vertex = { readonly p: readonly [number, number, number]; readonly n: readonly [number, number, number] };

async function loadVertices(asset: string): Promise<{ gown: Vertex[]; body: Vertex[] }> {
  const doc = await new NodeIO().read(`${DIR}/${asset}`);
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

function bandMetrics(
  gown: Vertex[], body: Vertex[], floorY: number, height: number, band: readonly [number, number],
): { n: number; medianMm: number; medianNormalDot: number } {
  const inBand = (v: Vertex) => {
    const f = (v.p[1] - floorY) / height;
    return f >= band[0] && f < band[1];
  };
  const g = gown.filter((_, i) => i % STRIDE === 0).filter(inBand);
  const b = body.filter((_, i) => i % STRIDE === 0);
  const distances: number[] = [];
  const dots: number[] = [];
  for (const v of g) {
    let best = Number.POSITIVE_INFINITY;
    let nearest: Vertex | null = null;
    for (const q of b) {
      if (Math.abs(q.p[1] - v.p[1]) > SLAB_METRES) continue;
      const d = Math.hypot(q.p[0] - v.p[0], q.p[2] - v.p[2]);
      if (d < best) { best = d; nearest = q; }
    }
    if (!Number.isFinite(best) || nearest === null) continue;
    distances.push(best);
    const dot = v.n[0] * nearest.n[0] + v.n[1] * nearest.n[1] + v.n[2] * nearest.n[2];
    const scale = Math.hypot(v.n[0], v.n[1], v.n[2]) * Math.hypot(nearest.n[0], nearest.n[1], nearest.n[2]);
    if (scale > 0) dots.push(dot / scale);
  }
  return { n: distances.length, medianMm: median(distances) * 1000, medianNormalDot: median(dots) };
}

async function measureAsset(asset: string) {
  const { gown, body } = await loadVertices(asset);
  const ys = body.map((v) => v.p[1]);
  const floorY = Math.min(...ys);
  const height = Math.max(...ys) - floorY;
  return {
    asset,
    heightM: Number(height.toFixed(4)),
    bodyGownVerts: { body: body.length, gown: gown.length },
    bands: {
      bodice: bandMetrics(gown, body, floorY, height, BODICE),
      waist: bandMetrics(gown, body, floorY, height, WAIST),
      skirt: bandMetrics(gown, body, floorY, height, SKIRT),
    },
  };
}

async function main() {
  const rows = [];
  for (const asset of ASSETS) {
    rows.push(await measureAsset(asset));
  }
  const report = {
    kind: "issue-686-pre-fix-gown-bodice-shape-and-level",
    capturedAt: new Date().toISOString(),
    instrument: "tools/openclinxr/evidence/measure-gown-bodice-vs-skirt-prefix.ts — identical to the planted contract's measure() (NodeIO, GOWN=/hospital_gown/, BODY=/mpfb_skin|hidden_(upper|lower)/, STRIDE=3, SLAB_METRES=0.01), extended to both GLBs and the waist band.",
    bands: { bodice: [0.62, 0.82], waist: [0.52, 0.62], skirt: [0.34, 0.5] },
    rows,
  };
  const out = path.resolve(".openclinxr/evidence/issue-686/pre-fix.json");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
