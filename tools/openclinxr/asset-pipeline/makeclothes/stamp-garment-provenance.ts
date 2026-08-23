/**
 * #596 — stamp garment mesh extras with the source `.mhclo` the bake fitted from.
 *
 * The materializer holds the path at fit time (`read_hair_mhclo_licence`, `Mhclo.load`)
 * and historically discarded it. Without mesh extras the only signal is the material
 * name — which is how a peds_upper shell shipped as `hospital_gown`. This stamp is the
 * durable record clause (1) of `the-patient-gown-is-a-gown-class-asset` reads.
 *
 * claimScope: mesh.extras { sourceMhclo, garmentClass, licence } on MakeClothes /
 * real_garment meshes.
 * notEvidenceFor: appearance, fit quality, Anny retirement.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";

export type GarmentProvenanceStamp = {
  sourceMhclo: string;
  garmentClass: string;
  licence: string;
};

/**
 * Mesh-name substring → provenance. Longest match wins. Hair/eyes/brows/teeth are
 * excluded by the planted contract's filter; footwear and clothing are stamped.
 */
export const GARMENT_PROVENANCE_BY_MESH_SUBSTR: ReadonlyArray<{
  match: RegExp;
  stamp: GarmentProvenanceStamp;
}> = [
  {
    match: /lab_coat|labcoat|crudelabcoatopen/i,
    stamp: {
      sourceMhclo: "crudelabcoatopen.mhclo",
      garmentClass: "labcoat",
      licence: "CC0",
    },
  },
  {
    match: /scrub_shirt/i,
    stamp: {
      sourceMhclo: "Scrub_Shirt.mhclo",
      garmentClass: "scrub",
      licence: "CC-BY",
    },
  },
  {
    match: /scrub_pants/i,
    stamp: {
      sourceMhclo: "Scrub_Pants.mhclo",
      garmentClass: "scrub",
      licence: "CC-BY",
    },
  },
  {
    match: /toigo_t_shirt|toigo_basic_tucked_t_shirt|toigo_basic_tucked_t-shirt/i,
    stamp: {
      sourceMhclo: "toigo_basic_tucked_t-shirt.mhclo",
      garmentClass: "street",
      licence: "CC0",
    },
  },
  {
    match: /cargo_pants/i,
    stamp: {
      sourceMhclo: "cargo_pants.mhclo",
      garmentClass: "street",
      licence: "CC0",
    },
  },
  {
    match: /footwear_toigo_flats|toigo_flats/i,
    stamp: {
      sourceMhclo: "toigo_flats.mhclo",
      garmentClass: "footwear",
      licence: "CC0",
    },
  },
  {
    match: /footwear.*mj_cloth|toigo_mj_cloth/i,
    stamp: {
      sourceMhclo: "toigo_mj_cloth_shoes.mhclo",
      garmentClass: "footwear",
      licence: "CC0",
    },
  },
  {
    match: /culturalibre_male_boots|male_boots/i,
    stamp: {
      sourceMhclo: "culturalibre_male_boots.mhclo",
      garmentClass: "footwear",
      licence: "CC-0",
    },
  },
];

const SKIP = /eyes|hair|eyelash|eyebrow|teeth|tongue|declared_upper/i;

export function provenanceForMeshName(name: string): GarmentProvenanceStamp | null {
  if (!/real_garment|makeclothes_library/i.test(name)) return null;
  if (SKIP.test(name)) return null;
  for (const row of GARMENT_PROVENANCE_BY_MESH_SUBSTR) {
    if (row.match.test(name)) return row.stamp;
  }
  return null;
}

export async function stampGarmentProvenanceOnGlb(
  glbPath: string,
  overrides: Readonly<Record<string, GarmentProvenanceStamp>> = {},
): Promise<{ stamped: string[]; skipped: string[] }> {
  const io = new NodeIO();
  const doc = await io.read(glbPath);
  const stamped: string[] = [];
  const skipped: string[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() ?? "";
    const fromOverride = overrides[name];
    const stamp = fromOverride ?? provenanceForMeshName(name);
    if (!stamp) {
      if (/real_garment|makeclothes_library/i.test(name) && !SKIP.test(name)) {
        skipped.push(name);
      }
      continue;
    }
    mesh.setExtras({
      ...(mesh.getExtras() ?? {}),
      sourceMhclo: stamp.sourceMhclo,
      garmentClass: stamp.garmentClass,
      licence: stamp.licence,
    });
    stamped.push(name);
  }
  await io.write(glbPath, doc);
  return { stamped, skipped };
}

/** CLI: `pnpm exec tsx …/stamp-garment-provenance.ts <glb> [<glb>…]` */
async function main(argv: string[]): Promise<void> {
  const paths = argv.filter((a) => a.endsWith(".glb"));
  if (paths.length === 0) {
    console.error("usage: stamp-garment-provenance.ts <glb> [<glb>…]");
    process.exit(2);
  }
  for (const p of paths) {
    const abs = path.resolve(p);
    const result = await stampGarmentProvenanceOnGlb(abs);
    console.log(
      JSON.stringify({
        glb: abs,
        stamped: result.stamped,
        skipped: result.skipped,
      }),
    );
    // Touch mtime proof for callers that key off write.
    writeFileSync(abs, readFileSync(abs));
  }
}

const isCli =
  typeof process !== "undefined" &&
  process.argv[1] != null &&
  /stamp-garment-provenance\.(ts|js|mjs|cjs)$/.test(process.argv[1]);
if (isCli) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
