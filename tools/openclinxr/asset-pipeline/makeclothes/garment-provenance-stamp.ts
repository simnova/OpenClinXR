/**
 * garment-provenance-stamp.ts — write sourceMhclo / licence / garmentClass extras
 * onto garment meshes in a GLB. Clone of the teeth-rest-clearance / tongue-forward
 * post-export shape: one station, fail-closed, dry-run default for shipped bytes.
 *
 * The bake already knows the .mhclo at fit time and discards it. This station
 * persists a measured name→source table onto mesh extras so later clauses can
 * read the source instead of the material name.
 *
 * TWO provenance families, never mixed:
 *  - makeclothes: genuine MakeClothes library input. sourceMhclo names a real
 *    `.mhclo` file from the provider cache (header + licence ledger verified).
 *  - procedural: first-party OpenClinXR geometry with NO .mhclo input. These
 *    rows MUST NOT invent a sourceMhclo. They carry sourceKind="procedural"
 *    plus the actual generator path/function/recipe and the observed sha256 of
 *    the generator definition file, and they preserve the mesh's own
 *    bake-written sourceRecipe extra. sourceMhclo is reserved for genuine
 *    MakeClothes input.
 *
 * Legacy note: a nonempty sourceMhclo extra is a compatibility tag, NOT
 * verified file existence. The one pre-existing `real_garment_peds_upper`
 * row keeps its legacy tag shape unupgraded (no sourceKind claim is added
 * to it) pending verification of its actual producer; it must not be read
 * as proof of a genuine MakeClothes file.
 *
 * It does NOT relabel a t-shirt as a gown. garmentClass is the library class
 * for makeclothes rows and the bake-recorded class for procedural rows.
 *
 * Run: tsx tools/openclinxr/asset-pipeline/makeclothes/garment-provenance-stamp.ts <glb> [--dry]
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";

const SKIP_RE = /eyes|hair|eyelash|eyebrow|teeth|tongue/i;
const GARMENT_RE = /real_garment|makeclothes_library/i;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");

/** Verified generator of the procedural hospital-gown mesh (measured, not alleged).
 * Function `_replace_with_clean_clinical_gown` in bake_mpfb_gown_inspect.py writes
 * mesh extras sourceRecipe/garmentClass/licence on the baked mesh; the GLB sidecar
 * provenance.json records the same bake lineage. */
export const PROCEDURAL_GOWN_GENERATOR =
  "tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py:_replace_with_clean_clinical_gown#regular-clinical-gown-cage";
export const PROCEDURAL_GOWN_RECIPE =
  "tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py#regular-clinical-gown-cage";
export const PROCEDURAL_GOWN_CLASS = "gown";
export const PROCEDURAL_GOWN_LICENCE = "first-party OpenClinXR procedural geometry";

/** Observed sha256 of the current generator definition file. This pins what
 * the tree contains now; it is NOT a claim that the historical bake executed
 * with these entire file bytes. */
export function proceduralGownSourceHash(repoRoot: string = REPO_ROOT): string {
  const bytes = readFileSync(join(repoRoot, "tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py"));
  return createHash("sha256").update(bytes).digest("hex");
}

type MakeclothesStamp = {
  sourceKind: "makeclothes";
  sourceMhclo: string;
  licence: string;
  garmentClass: string;
};

/** Legacy compatibility tag: shape predates sourceKind. A nonempty
 * sourceMhclo here is NOT verified file existence; see the module note. */
type LegacyStamp = {
  sourceMhclo: string;
  licence: string;
  garmentClass: string;
};

type ProceduralStamp = {
  sourceKind: "procedural";
  sourceGenerator: string;
  sourceHash: string;
  sourceRecipe: string;
  licence: string;
  garmentClass: string;
};

export type Stamp = MakeclothesStamp | LegacyStamp | ProceduralStamp;

/** Measured library names. sourceMhclo rows with sourceKind "makeclothes"
 * name genuine cached .mhclo files only. */
const STAMP_BY_SUBSTRING: Array<{ match: RegExp; stamp: Stamp }> = [
  {
    match: /toigo_t_shirt/i,
    stamp: {
      sourceKind: "makeclothes",
      sourceMhclo: "toigo_t_shirt.mhclo",
      licence: "CC0",
      garmentClass: "tshirt",
    },
  },
  {
    match: /footwear_toigo/i,
    stamp: {
      sourceKind: "makeclothes",
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
      sourceKind: "makeclothes",
      sourceMhclo: "crudelabcoatopen.mhclo",
      licence: "CC0",
      garmentClass: "labcoat",
    },
  },
  {
    match: /scrub_shirt/i,
    stamp: {
      sourceKind: "makeclothes",
      sourceMhclo: "Scrub_Shirt.mhclo",
      licence: "CC-BY",
      garmentClass: "scrub_shirt",
    },
  },
  {
    match: /scrub_pants/i,
    stamp: {
      sourceKind: "makeclothes",
      sourceMhclo: "Scrub_Pants.mhclo",
      licence: "CC-BY",
      garmentClass: "pants",
    },
  },
  {
    match: /bootcut_jeans/i,
    stamp: {
      sourceKind: "makeclothes",
      sourceMhclo: "elvs_jeans_bootcut.mhclo",
      licence: "CC-BY",
      garmentClass: "pants",
    },
  },
  {
    match: /female_tight_jeans/i,
    stamp: {
      sourceKind: "makeclothes",
      sourceMhclo: "punkduck_female_tight_jeans.mhclo",
      licence: "CC-BY",
      garmentClass: "pants",
    },
  },
  {
    match: /straight_leg_jeans/i,
    stamp: {
      sourceKind: "makeclothes",
      sourceMhclo: "elvs_jeans_straight_leg.mhclo",
      licence: "CC-BY",
      garmentClass: "pants",
    },
  },
  {
    match: /cargo_pants/i,
    stamp: {
      sourceKind: "makeclothes",
      sourceMhclo: "cargo_pants.mhclo",
      licence: "CC0",
      garmentClass: "pants",
    },
  },
  {
    match: /real_garment_hospital_gown/i,
    stamp: {
      sourceKind: "procedural",
      sourceGenerator: PROCEDURAL_GOWN_GENERATOR,
      sourceHash: "9df84331aee02808cb9636193de659efa20fb05367c95798f58dd2e0f5caa800",
      sourceRecipe: PROCEDURAL_GOWN_RECIPE,
      licence: PROCEDURAL_GOWN_LICENCE,
      garmentClass: PROCEDURAL_GOWN_CLASS,
    },
  },
  {
    match: /culturalibre_male_boots/i,
    stamp: {
      sourceKind: "makeclothes",
      sourceMhclo: "culturalibre_male_boots.mhclo",
      licence: "CC0",
      garmentClass: "shoes",
    },
  },
];

/** True when the mesh already carries provenance this station must not overwrite:
 * a legacy nonempty sourceMhclo tag (compatibility, see module note), or a
 * validated procedural linkage whose hash matches the generator file on disk. */
export function hasValidProvenance(extras: Record<string, unknown>, repoRoot: string = REPO_ROOT): boolean {
  if (typeof extras["sourceMhclo"] === "string" && (extras["sourceMhclo"] as string).length > 0) return true;
  if (extras["sourceKind"] !== "procedural" || typeof extras["sourceGenerator"] !== "string") return false;
  if ((extras["sourceGenerator"] as string) !== PROCEDURAL_GOWN_GENERATOR) return false;
  if (typeof extras["sourceHash"] !== "string" || typeof extras["sourceRecipe"] !== "string") return false;
  if ((extras["sourceRecipe"] as string) !== PROCEDURAL_GOWN_RECIPE) return false;
  const genPath = join(repoRoot, "tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py");
  if (!existsSync(genPath)) return false;
  const actual = createHash("sha256").update(readFileSync(genPath)).digest();
  const claimed = Buffer.from(extras["sourceHash"] as string, "hex");
  return actual.length === claimed.length && timingSafeEqual(actual, claimed);
}

export function stampFor(name: string): Stamp | null {
  for (const row of STAMP_BY_SUBSTRING) {
    if (row.match.test(name)) {
      if ("sourceKind" in row.stamp && row.stamp.sourceKind === "procedural") {
        // Refresh the hash from the actual generator file so a stale pin fails
        // closed instead of stamping a lineage the tree no longer contains.
        // Falls back to the pinned hash only when the generator file is absent
        // (e.g. a source export without the blender tree).
        try {
          return { ...row.stamp, sourceHash: proceduralGownSourceHash() };
        } catch {
          return row.stamp;
        }
      }
      return row.stamp;
    }
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
    const existing = (mesh.getExtras() ?? {}) as Record<string, unknown>;
    if (hasValidProvenance(existing)) {
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
