/**
 * #498 wardrobe layering read — evidence sweep.
 *
 * Sweeps the cached garment .mhclo files through `readMhcloLayering` (fit-cli.ts) and
 * writes `wardrobe-layering-read-report.json` next to it. The report is the machine
 * record that the bake can READ both layering directives; it does not claim anything
 * is APPLIED (that is the next slice).
 *
 * claimScope: pipeline can read z_depth + delete_verts out of a cached .mhclo.
 * notEvidenceFor: that any garment renders correctly, that poke-through is fixed, or
 *                 that layering is applied in the bake.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readMhcloLayering } from "../asset-pipeline/makeclothes/fit-cli.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "../../..");
const CACHE = join(REPO_ROOT, ".openclinxr-local/provider-cache/garments");
const REPORT = join(HERE, "wardrobe-layering-read-report.json");

function cachedMhclo(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith(".mhclo")) out.push(p);
    }
  };
  walk(CACHE);
  return out.sort();
}

function rawZDepth(p: string): number | null {
  const m = readFileSync(p, "utf8").match(/^z_depth\s+(\d+)/im);
  return m ? Number(m[1]) : null;
}

const files = cachedMhclo();
const rows = files.map((f) => {
  const layering = readMhcloLayering(f);
  return {
    basename: f.split("/").pop(),
    rel: relative(REPO_ROOT, f),
    zDepth: layering.zDepth,
    deleteVertsCount: layering.deleteVerts.length,
  };
});

const distinctZDepths = [...new Set(rows.map((r) => r.zDepth))].sort((a, b) => (a ?? 0) - (b ?? 0));
const boots = rows.find((r) => r.basename === "culturalibre_male_boots.mhclo");
const labcoat = rows.find((r) => r.basename === "male_crude_labcoatop.mhclo");
const scrubShirt = rows.find((r) => r.basename === "Scrub_Shirt.mhclo");

const report = {
  schemaVersion: "openclinxr.wardrobe-layering-read-report.v1",
  generatedAt: new Date().toISOString(),
  claimScope:
    "pipeline_can_read_z_depth_and_delete_verts_out_of_a_cached_mhclo_header",
  notEvidenceFor: [
    "any_garment_renders_correctly",
    "poke_through_is_fixed",
    "layering_is_applied_in_the_bake",
  ],
  filesScanned: rows.length,
  distinctZDepths,
  controls: {
    culturalibre_male_boots: { zDepth: boots?.zDepth ?? null },
    male_crude_labcoatop: {
      zDepth: labcoat?.zDepth ?? null,
      deleteVertsCount: labcoat?.deleteVertsCount ?? null,
    },
    Scrub_Shirt: { deleteVertsCount: scrubShirt?.deleteVertsCount ?? null },
  },
  rows,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`wrote ${relative(REPO_ROOT, REPORT)}: ${rows.length} files, zDepth spread=${distinctZDepths.join(",")}`);
