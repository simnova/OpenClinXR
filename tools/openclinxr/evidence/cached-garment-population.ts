/**
 * E5 — the class inventory's population. The cache population must be ENUMERATED from
 * disk, never hardcoded, so a garment staged today is in the population today rather
 * than the day someone remembers to add it (#512).
 *
 * Measured 2026-08-21 (floors, not equalities — the cache grows):
 *   44 `*.mhclo` under .openclinxr-local/provider-cache/
 *   −27 hair  (hair/ — own two-column licence inventory, the-hair-pack-...test.ts)
 *   − 1 eyes  (eyes/makehuman-default/low-poly.mhclo — excluded BY PATH, not by name)
 *   ─────
 *   16 files / 13 unique in-scope garments.
 *
 * The exclusion rule is DATA, not a docstring: GARMENT_EXCLUSION_RULE records each
 * exclusion with its reason, so a later reader can execute the rule that was written down.
 */

import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

export type CachedGarment = { basename: string; sourcePath: string };

export type GarmentExclusionRule = {
  reason: string;
  test: (relPath: string) => boolean;
};

export const GARMENT_EXCLUSION_RULE: GarmentExclusionRule[] = [
  {
    reason:
      "eyes assets live under eyes/ and are facial anatomy, not garments — " +
      "low-poly.mhclo is excluded by its directory, not by name",
    test: (relPath) => relPath === "eyes" || relPath.startsWith("eyes/"),
  },
  {
    reason:
      "hair styles live under hair/ and carry their own two-column licence inventory " +
      "(the-hair-pack-has-a-two-column-licence-inventory.test.ts) — excluded by directory " +
      "because o4saken_long01 and sonntag78_blond_with_headband carry no 'hair' token in " +
      "the filename and a filename-token rule would leak them as garments",
    test: (relPath) => relPath === "hair" || relPath.startsWith("hair/"),
  },
  {
    reason:
      "eyebrow and eyelash proxies live under facial/ and are anatomy, not garments — " +
      "the eyebrows/lashes factory work (#542) cached 19 .mhclo there, which leaked into the " +
      "garment walk and made the staleness clause demand a garment CLASS for " +
      "mindfront_eyebrows_01.mhclo. Excluded by directory for the same reason as hair/: the " +
      "filenames carry no reliable token (elvs_eyelashes_01 and mindfront_eyebrows_01 differ), " +
      "and classing anatomy as street/other would be a wrong green that hides the real question",
    test: (relPath) => relPath === "facial" || relPath.startsWith("facial/"),
  },
];

function isExcluded(relPath: string): boolean {
  return GARMENT_EXCLUSION_RULE.some((rule) => rule.test(relPath));
}

function walkMhclo(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMhclo(full));
    else if (entry.isFile() && entry.name.endsWith(".mhclo")) out.push(full);
  }
  return out;
}

export function enumerateCachedGarments(cacheRoot: string): CachedGarment[] {
  if (!existsSync(cacheRoot)) {
    throw new Error(
      `cache root missing at ${cacheRoot} — a population guard that cannot see the ` +
        `population must fail, not pass vacuously (#64 second-order bite)`,
    );
  }
  const rows: CachedGarment[] = [];
  for (const abs of walkMhclo(cacheRoot)) {
    const rel = relative(cacheRoot, abs);
    if (isExcluded(rel)) continue;
    rows.push({ basename: basename(abs), sourcePath: relative(dirname(cacheRoot), abs) });
  }
  rows.sort((a, b) => a.basename.localeCompare(b.basename));
  return rows;
}
