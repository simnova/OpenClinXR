import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { isUpperGarmentName } from "./garment-slot.ts";

/**
 * #427 — the shared waistband-ring instrument. ONE copy for every consumer.
 *
 * Three consumers import from here and nowhere else: the shipped smoothness contract
 * (the-waistband-is-as-smooth-as-the-hem.test.ts), the E5 membership contract
 * (every-shipped-trouser-waistband-is-measured.test.ts), and the artifact generator
 * (waistband-membership-write.ts). The alternative — each consumer carrying its own copy —
 * is how the matcher went stale in multiple places (#389's warning) and how a second
 * instrument that happens to be quiet can pass a "same instrument" check.
 *
 * The ring measurement is #373's, unchanged: order the boundary ring by angle about the
 * body axis, subtract a 7-neighbour circular moving average (which removes the contour),
 * and measure the high-frequency residual. The planted header of
 * the-waistband-is-as-smooth-as-the-hem.test.ts records why HF residual is the defect
 * measure and not spread or an extreme.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = pathResolve(HERE, "../../..");
export const GENERATED_HUMANOIDS = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");

/**
 * #427 — the E5 enumeration: a shipped trouser mesh is any material whose name carries
 * pants/trousers/cargo. This deliberately replaces the narrower /cargo_pants/ matcher,
 * which went blind when kevin's trousers were renamed scrub_pants (the waistband contract
 * was measuring 2 of 7 shipped trouser actors without noticing).
 */
export function isPantsName(materialName: string): boolean {
  return /pants|trouser|cargo/i.test(materialName);
}

export type Ring = { verts: number; hfMedian: number; hfP95: number; span: number };

export type TrouserRow = {
  actor: string;
  trouserMesh: string;
  waist: Ring | null;
  hem: Ring | null;
  pantsTris: number;
};

/**
 * Order a boundary ring by angle about the body axis, subtract a 7-neighbour CIRCULAR moving average
 * to remove the legitimate contour, and return the high-frequency residual in millimetres.
 */
export function ringHighFrequency(pts: number[][], which: "top" | "bottom"): Ring | null {
  if (pts.length < 12) return null;
  const ys = pts.map((p) => p[1]!);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const height = hi - lo;
  const cx = pts.reduce((s, p) => s + p[0]!, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[2]!, 0) / pts.length;
  const band = pts
    .filter((p) => (which === "top" ? p[1]! > hi - height * 0.03 : p[1]! < lo + height * 0.03))
    .map((p) => ({ y: p[1]!, th: Math.atan2(p[2]! - cz, p[0]! - cx) }))
    .sort((a, b) => a.th - b.th);
  if (band.length < 12) return null;

  const residual: number[] = [];
  for (let i = 0; i < band.length; i += 1) {
    let sum = 0;
    for (let k = -3; k <= 3; k += 1) sum += band[(i + k + band.length) % band.length]!.y;
    residual.push(Math.abs(band[i]!.y - sum / 7) * 1000);
  }
  const sorted = [...residual].sort((a, b) => a - b);
  const bandYs = band.map((b) => b.y);
  return {
    verts: band.length,
    hfMedian: sorted[Math.floor(sorted.length / 2)] ?? 0,
    hfP95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    span: (Math.max(...bandYs) - Math.min(...bandYs)) * 1000,
  };
}

const io = new NodeIO();

/**
 * Measure one actor's trouser waistband (top ring of the pants material) and upper-garment hem
 * (bottom ring of the first makeclothes upper), reusing the shipped contract's traversal order.
 */
export async function measureTrouserActor(actor: string, generatedDir: string = GENERATED_HUMANOIDS): Promise<TrouserRow> {
  const doc = await io.read(join(generatedDir, `${actor}.glb`));
  let waist: Ring | null = null;
  let hem: Ring | null = null;
  let pantsTris = 0;
  let trouserMesh = "";
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      const isPants = isPantsName(name);
      const isShirt = isUpperGarmentName(name);
      if (!isPants && !isShirt) continue;
      const pos = prim.getAttribute("POSITION");
      const idx = prim.getIndices();
      if (!pos) continue;
      const v = [0, 0, 0];
      const pts: number[][] = [];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, v);
        pts.push([...v]);
      }
      if (isPants) {
        waist = ringHighFrequency(pts, "top");
        pantsTris = idx ? idx.getCount() / 3 : 0;
        trouserMesh = name;
      } else if (!hem) {
        hem = ringHighFrequency(pts, "bottom");
      }
    }
  }
  return { actor, trouserMesh, waist, hem, pantsTris };
}
