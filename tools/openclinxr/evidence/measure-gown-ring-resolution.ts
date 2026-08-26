/**
 * #686 — measure the gown's bodice ring resolution: how many vertices per y-row in the
 * bodice band, and the azimuth distribution. Determines whether the fold pattern can be
 * resolved by the existing mesh or needs subdivision.
 */
import { NodeIO } from "@gltf-transform/core";

const GOWN = /hospital_gown/;
const BODY = /mpfb_skin|hidden_(upper|lower)/;

async function main() {
  const doc = await new NodeIO().read("apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb");
  const gown: number[][] = [];
  const body: number[][] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      const isGown = GOWN.test(name);
      const isBody = !isGown && BODY.test(name);
      if (!isGown && !isBody) continue;
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        (isGown ? gown : body).push([v[0]!, v[1]!, v[2]!]);
      }
    }
  }
  const ys = body.map((v) => v[1]!);
  const floorY = Math.min(...ys);
  const height = Math.max(...ys) - floorY;
  for (const [label, frac] of [["0.66", 0.66], ["0.70", 0.70], ["0.74", 0.74], ["0.78", 0.78]] as const) {
    const y = floorY + height * frac;
    const ring = gown.filter((v) => Math.abs(v[1]! - y) < 0.015);
    // count distinct azimuths
    const cx = 0.0024, cz = 0.0358;
    const az = new Set(ring.map((v) => Math.round(Math.atan2(v[2]! - cz, v[0]! - cx) * 57.2958)));
    const trunk = ring.filter((v) => Math.abs(v[0]!) < 0.22).length;
    console.log(`y=${frac} (${y.toFixed(3)}): gown verts=${ring.length} trunk(|x|<0.22)=${trunk} distinct-degrees=${az.size}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
