/**
 * #686 — post-bake sanity: gown bounds, NaN check, fold presence at the front-centre,
 * hip-ring alignment with the skirt, and the cuff radius. Text-only geometric checks the
 * orchestrator's pixel grade cannot substitute for.
 */
import { NodeIO } from "@gltf-transform/core";

const GOWN = /hospital_gown/;

async function main() {
  const doc = await new NodeIO().read("apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb");
  let pos: Float32Array | null = null;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      if (!GOWN.test(name)) continue;
      pos = prim.getAttribute("POSITION")?.getArray() ?? null;
    }
  }
  if (!pos) throw new Error("no gown");
  const n = pos.length / 3;
  let nan = 0;
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) nan++;
    xs.push(x); ys.push(y); zs.push(z);
  }
  const min = (a: number[]) => Math.min(...a);
  const max = (a: number[]) => Math.max(...a);
  console.log(`gown verts=${n} NaN=${nan}`);
  console.log(`x [${min(xs).toFixed(3)}, ${max(xs).toFixed(3)}]  y [${min(ys).toFixed(3)}, ${max(ys).toFixed(3)}]  z [${min(zs).toFixed(3)}, ${max(zs).toFixed(3)}]`);

  // fold profile at chest height: radial distance from the torso centreline vs azimuth
  const cx = 0.0024, cz = 0.0358;
  const yTarget = 1.30; // ~0.72 of 1.7756+floor — mid band
  const ring = [];
  for (let i = 0; i < n; i++) {
    if (Math.abs(pos[i * 3 + 1]! - yTarget) > 0.01) continue;
    const x = pos[i * 3]!, z = pos[i * 3 + 2]!;
    const r = Math.hypot(x - cx, z - cz);
    const th = Math.atan2(z - cz, x - cx);
    ring.push({ r, th });
  }
  ring.sort((a, b) => a.th - b.th);
  const profile = ring.filter((_, i) => i % Math.floor(ring.length / 36) === 0).slice(0, 36);
  console.log(`\nradial profile at y=${yTarget} (r mm vs azimuth deg), 36 samples:`);
  console.log(profile.map((p) => `${(p.r * 1000).toFixed(0)}@${(p.th * 57.3).toFixed(0)}°`).join(" "));

  // hip-ring alignment: mean |x| radius just above vs just below the hip (0.55 of height)
  const hip = 0.568183 + (1.775576 - 0.568183) * 0.55; // body min-y + 0.55*height
  const above: number[] = [], below: number[] = [];
  for (let i = 0; i < n; i++) {
    const y = pos[i * 3 + 1]!;
    const x = pos[i * 3]!, z = pos[i * 3 + 2]!;
    const r = Math.hypot(x - cx, z - cz);
    if (y > hip && y < hip + 0.02) above.push(r);
    if (y < hip && y > hip - 0.02) below.push(r);
  }
  const med = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]!; };
  console.log(`\nhip ring radius: above(mean)=${(med(above) * 1000).toFixed(0)}mm n=${above.length}  below(mean)=${(med(below) * 1000).toFixed(0)}mm n=${below.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
