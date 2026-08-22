import { createHash } from "node:crypto";
import { NodeIO } from "@gltf-transform/core";
import type { Document, Material } from "@gltf-transform/core";

export type EyeRow = {
  irisSha: string | null;
  irisKb: number;
  factor: [number, number, number];
};

const io = new NodeIO();

/**
 * The eye material is the one CARRYING A baseColorTexture — not "any name containing eye".
 * #569: the old last-wins `/eye/i` scan attributed the EYELASH's factor (0.02) to the iris,
 * because eyebrow/eyelash names also contain "eye" and document order is not a guarantee.
 */
export function eyeRowFromDoc(doc: Document): Omit<EyeRow, never> | null {
  let irisMat: Material | null = null;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!mat || !mat.getBaseColorTexture()) continue;
      if (/eye/i.test(`${mesh.getName()}/${mat.getName()}`)) {
        irisMat = mat;
        break;
      }
    }
    if (irisMat) break;
  }
  if (!irisMat) return null;
  const img = irisMat.getBaseColorTexture()?.getImage();
  const c = irisMat.getBaseColorFactor();
  return {
    irisSha: img ? createHash("sha256").update(img).digest("hex").slice(0, 16) : null,
    irisKb: img ? img.length / 1024 : 0,
    factor: [c[0]!, c[1]!, c[2]!],
  };
}

export async function readEyeRow(path: string): Promise<Omit<EyeRow, never>> {
  const doc = await io.read(path);
  const row = eyeRowFromDoc(doc);
  if (!row) {
    throw new Error(
      `no textured /eye/ material in ${path} — the iris is identified by carrying a `
        + `baseColorTexture, never by document order (#569)`,
    );
  }
  return row;
}
