/**
 * Licence catalogue lookup for the bake gates (2026-09-17 slice).
 *
 * The committed snapshot `makehuman-catalogue-snapshot.json` maps pack slug
 * (hair01, shoes01, pants01, shirts01, skins01, skins02) to the per-pack
 * licence listed on the MakeHuman asset-pack index page. It is read
 * synchronously at bake/classification time — no network in the hot path.
 *
 * SUPERSEDED 2026-09-17 by the operator ruling: "remember that unclassified
 * should default to the asset catalog page's listing of licensing not the asset
 * itself" — on packs the catalogue lists CC0 while the asset's own file declares
 * AGPLv3 (skins01/skins02): "go with what site links say (CC0 over AGPLv3)".
 * REFINED by the operator the same day: "Review the assets with their listing page -
 * is the listing page more permissive? If so record that as the license instead of the
 * license embedded into the asset as many just leave the default license." So the
 * catalogue listing no longer wins always: the MORE PERMISSIVE of the catalogue
 * listing and the file line governs (CC0 3 > CC-BY 2 > copyleft 1 > unrecognised 0).
 * Precedence lives in licence-precedence.ts: more-permissive (catalogue vs file) >
 * file (when the catalogue is silent) > refused (both silent, or the catalogue lists
 * conflicting licences for the same pack).
 *
 * claimScope: silence-fallback provenance for the bake gates.
 * notEvidenceFor: per-asset grants, user-contributed licences.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CATALOGUE_SNAPSHOT_PATH = join(HERE, "makehuman-catalogue-snapshot.json");

export type CatalogueLicence = "CC0" | "CC-BY";

export type CatalogueEntry = {
  licence: CatalogueLicence;
  /** Every licence the index listed for that pack; conflict = >1 distinct value. */
  licences?: string[];
  sourceUrl: string;
  packPageUrl: string;
  label: string;
  fetchedAt: string;
};

type SnapshotShape = {
  packs?: Record<string, CatalogueEntry>;
};

let cache: Record<string, CatalogueEntry> | null = null;

function loadPacks(): Record<string, CatalogueEntry> {
  if (cache) return cache;
  if (!existsSync(CATALOGUE_SNAPSHOT_PATH)) {
    cache = {};
    return cache;
  }
  const raw = JSON.parse(readFileSync(CATALOGUE_SNAPSHOT_PATH, "utf8")) as SnapshotShape;
  cache = raw.packs ?? {};
  return cache;
}

/** Catalogue entry for a pack slug (e.g. "hair01"), or null when unlisted. */
export function catalogueEntryForPack(packSlug: string | null | undefined): CatalogueEntry | null {
  if (!packSlug) return null;
  return loadPacks()[packSlug] ?? null;
}

/** Pack slug from a provider-cache path (`.../makehuman-shoes01/...` -> `shoes01`). */
export function packSlugFromPath(assetPath: string): string | null {
  const m = /makehuman-([a-z0-9]+)/i.exec(assetPath);
  return m ? m[1]!.toLowerCase() : null;
}

/** HAIR_SOURCE_ID `makehuman-hair01` -> `hair01`; pass-through for bare slugs. */
export function packSlugFromSourceId(sourceId: string): string | null {
  const m = /^makehuman-(.+)$/i.exec(sourceId.trim());
  return m ? m[1]!.toLowerCase() : sourceId.trim().toLowerCase() || null;
}
