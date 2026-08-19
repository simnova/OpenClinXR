/**
 * E7.1 — regenerate tools/openclinxr/evidence/hair-pack-licence-inventory.json.
 *
 * The 27 cached hair `.mhclo` files have a two-column licence contradiction (pack
 * page CC0 vs headers that say AGPL3 / CC0 / CC-0 / CC BY 4.0 / CC_by / nothing) and
 * only `mhair02` is mapped to an actor. This generator records BOTH licence columns
 * and the topology verdict per style; it maps nothing and allowlists no uuid.
 *
 * Decisions (recorded for the E7.1 commit message):
 *   - Reader: `maxBodyVertexRef` + `HELPER_STRIP_VERTEX` are the shared module
 *     tools/openclinxr/evidence/lib/mhclo-topology.ts, extracted verbatim from the
 *     gown contract (D1 — the plant pins that walker; no new parser).
 *   - headerLicence: raw `# license` token via the PROVEN reader `readHairLicenceLine`
 *     (hair-licence-classify.ts:131), or the literal `NONE` when no line exists.
 *   - pageLicence: `CC0` for every row. hair01.html for the 25 pack styles; mhair02
 *     and male_short_hair from their community pages per the ledger's page-grant
 *     records (materialize_mpfb_humanoid_candidate.py:72-83). NO network is touched —
 *     the page values are recorded, not fetched.
 *   - maxVertRef `null` + `fitsStrippedBasemesh: false` when a verts block is absent
 *     or unparseable — fails closed, unmeasured is not fit.
 *   - mappedToReference: only `mhair02` (HAIR_STYLE_BY_REFERENCE,
 *     materialize_mpfb_humanoid_candidate.py:56-70 → peds_nurse_kevin +
 *     adult_male_street_casual). Snapshot value; the python table is the live source.
 *   - Row order: alphabetical by style.
 *
 * claimScope: licence columns + max basemesh-vertex reference for the 27 CACHED hair
 * styles, and which style is mapped today.
 * notEvidenceFor: which licence column WINS (licence-provenance decides later), how
 * the hair looks (E7.2), or whether any sub-13,380 style actually FITS (index range
 * is necessary, not sufficient).
 *
 * Regeneration requires the gitignored cache; the artifact is tracked (#396).
 */

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readHairLicenceLine } from "../asset-pipeline/makeclothes/hair-licence-classify.js";
import { HELPER_STRIP_VERTEX, maxBodyVertexRef } from "./lib/mhclo-topology.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const CACHE = join(REPO_ROOT, ".openclinxr-local/provider-cache/hair/sources");
const OUT = join(HERE, "hair-pack-licence-inventory.json");

/** Cached hair .mhclo files — pinned by the plant contract (clause 1). */
const CACHED_STYLE_COUNT = 27;
/** Page licence for every style: hair01.html (25 styles) + the two community pages. */
const PAGE_LICENCE = "CC0";
/** Mapped style → references today, read from HAIR_STYLE_BY_REFERENCE. */
const MAPPED_STYLE_REFERENCES: Readonly<Record<string, string>> = {
  mhair02: "peds_nurse_kevin, adult_male_street_casual",
};

type HairPackRow = {
  style: string;
  sourcePath: string;
  headerLicence: string;
  pageLicence: string;
  maxVertRef: number | null;
  fitsStrippedBasemesh: boolean;
  mappedToReference: string | null;
};

function collectMhcloFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectMhcloFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".mhclo")) out.push(full);
  }
  return out;
}

function buildRows(): HairPackRow[] {
  if (!existsSync(CACHE)) {
    throw new Error(
      `hair cache missing at ${CACHE} — the inventory is regenerated from the gitignored ` +
        `cache and the committed artifact is the deliverable (tracked, #396).`,
    );
  }
  const files = collectMhcloFiles(CACHE).sort();
  if (files.length !== CACHED_STYLE_COUNT) {
    throw new Error(
      `expected ${CACHED_STYLE_COUNT} cached .mhclo files, found ${files.length} — ` +
        `the inventory must not silently shrink or grow.`,
    );
  }
  return files.map((file) => {
    // style = the containing directory name (hair01 style dirs, or the male-pack dir):
    // male_short_hair/hair_short.mhclo -> "male_short_hair", mhair02/mhair02.mhclo -> "mhair02".
    const style = file.split("/").slice(-2, -1)[0] ?? file;
    const { raw } = readHairLicenceLine(file);
    const { max, rows } = maxBodyVertexRef(file);
    const maxVertRef = rows > 0 && max >= 0 ? max : null;
    return {
      style,
      sourcePath: relative(REPO_ROOT, file),
      headerLicence: raw ?? "NONE",
      pageLicence: PAGE_LICENCE,
      maxVertRef,
      fitsStrippedBasemesh: maxVertRef !== null && maxVertRef < HELPER_STRIP_VERTEX,
      mappedToReference: MAPPED_STYLE_REFERENCES[style] ?? null,
    };
  });
}

function main(): void {
  const rows = buildRows();
  rows.sort((a, b) => a.style.localeCompare(b.style));
  writeFileSync(OUT, `${JSON.stringify({ rows }, null, 2)}\n`);
  const parsed = rows.filter((r) => r.maxVertRef !== null).length;
  const oversized = rows.filter((r) => r.maxVertRef !== null && (r.maxVertRef as number) >= HELPER_STRIP_VERTEX);
  console.log(
    `wrote ${OUT}: ${rows.length} rows, ${parsed} parsed, ` +
      `${oversized.map((r) => `${r.style}=${String(r.maxVertRef)}`).join(", ")} oversized`,
  );
}

const isDirect =
  process.argv[1] != null && pathResolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  try {
    main();
  } catch (err) {
    console.error(`[hair-pack-inventory] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
