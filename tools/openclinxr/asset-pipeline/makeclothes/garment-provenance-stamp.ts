/**
 * garment-provenance-stamp.ts — write sourceMhclo / licence / garmentClass extras
 * onto garment meshes in a GLB. Clone of the teeth-rest-clearance / tongue-forward
 * post-export shape: one station, fail-closed, dry-run default for shipped bytes.
 *
 * The bake already knows the .mhclo at fit time and discards it. This station
 * persists a measured name→source table onto mesh extras so later clauses can
 * read the source instead of the material name.
 *
 * It does NOT relabel a t-shirt as a gown. garmentClass is the library class.
 *
 * Run: tsx tools/openclinxr/asset-pipeline/makeclothes/garment-provenance-stamp.ts <glb> [--dry]
 */
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";

const SKIP_RE = /eyes|hair|eyelash|eyebrow|teeth|tongue/i;
const GARMENT_RE = /real_garment|makeclothes_library/i;

type Stamp = { sourceMhclo: string; licence: string; garmentClass: string };

/** Measured library names on mpfb-gown-adult-patient.glb (HEAD 426bec0ea). */
const STAMP_BY_SUBSTRING: Array<{ match: RegExp; stamp: Stamp }> = [
  {
    match: /toigo_t_shirt/i,
    stamp: {
      sourceMhclo: "toigo_t_shirt.mhclo",
      licence: "CC0",
      garmentClass: "tshirt",
    },
  },
  {
    match: /footwear_toigo/i,
    stamp: {
      sourceMhclo: "toigo_mj_cloth_shoes.mhclo",
      licence: "CC0",
      garmentClass: "shoes",
    },
  },
  {
    match: /real_garment_peds_upper/i,
    stamp: {
      sourceMhclo: "openclinxr_real_garment_peds_upper_v1",
      licence: "CC0",
      garmentClass: "shell",
    },
  },
  {
    match: /lab_coat/i,
    stamp: {
      sourceMhclo: "crudelabcoatopen.mhclo",
      licence: "CC0",
      garmentClass: "labcoat",
    },
  },
];

function stampFor(name: string): Stamp | null {
  for (const row of STAMP_BY_SUBSTRING) {
    if (row.match.test(name)) return row.stamp;
  }
  return null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const glb = args.find((a) => !a.startsWith("--"));
  if (!glb) throw new Error("usage: garment-provenance-stamp.ts <glb> [--dry]");
  const dry = args.includes("--dry");

  const io = new NodeIO();
  const doc = await io.read(glb);
  const candidates = doc
    .getRoot()
    .listMeshes()
    .filter((m) => GARMENT_RE.test(m.getName()) && !SKIP_RE.test(m.getName()));
  if (candidates.length === 0) {
    throw new Error(`no garment meshes found in ${glb}`);
  }

  const stamped: Array<{ mesh: string; stamp: Stamp | null; skippedExisting?: boolean }> = [];
  for (const mesh of candidates) {
    const name = mesh.getName();
    const existing = (mesh.getExtras() ?? {}) as { sourceMhclo?: unknown };
    const already = typeof existing.sourceMhclo === "string" && existing.sourceMhclo.length > 0;
    if (already) {
      stamped.push({ mesh: name, stamp: null, skippedExisting: true });
      continue;
    }
    const stamp = stampFor(name);
    stamped.push({ mesh: name, stamp });
    if (!stamp || dry) continue;
    mesh.setExtras({ ...(mesh.getExtras() ?? {}), ...stamp });
  }

  const known = stamped.filter((s) => s.stamp || s.skippedExisting);
  if (known.length === 0) {
    throw new Error(`no garment mesh matched the stamp table in ${glb}`);
  }
  const wrote = !dry && stamped.some((s) => s.stamp);
  if (wrote) await io.write(glb, doc);

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "openclinxr.garment-provenance-stamp.v1",
        glb,
        action: dry ? "dry-run (no write)" : "stamped mesh extras",
        meshes: stamped,
        notEvidenceFor: ["clinical_validity", "production_asset_readiness", "gown_class_swap"],
      },
      null,
      2,
    )}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
