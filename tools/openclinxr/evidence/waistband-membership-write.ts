/**
 * #427 — regenerate tools/openclinxr/evidence/waistband-membership.json from the shipped bytes.
 *
 * Enumerates apps/ui-xr/public/generated-humanoids, keeps every actor whose GLB carries a
 * trouser mesh (/pants|trouser|cargo/), and measures each with the SAME instrument the
 * shipped smoothness contract uses (waistband-ring.ts). Run after a legitimate rebake that
 * changes trouser geometry — the membership test refuses a stale artifact on its own.
 *
 *   pnpm exec tsx tools/openclinxr/evidence/waistband-membership-write.ts
 */
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATED_HUMANOIDS, measureTrouserActor, isPantsName } from "./waistband-ring.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ARTIFACT = join(REPO_ROOT, "tools/openclinxr/evidence/waistband-membership.json");

const mm3 = (n: number): number => Math.round(n * 1000) / 1000;

async function main(): Promise<void> {
  const glbFiles = readdirSync(GENERATED_HUMANOIDS)
    .filter((f) => f.endsWith(".glb"))
    .sort();
  const rows = [];
  for (const file of glbFiles) {
    const actor = file.replace(/\.glb$/, "");
    const row = await measureTrouserActor(actor);
    if (!row.trouserMesh) continue; // not a trouser-carrying actor
    if (!row.waist || !row.hem) {
      throw new Error(
        `${actor}: trouser mesh "${row.trouserMesh}" but ${row.waist ? "no hem" : "no waistband"} ring — a rough ring is data, a missing ring is not.`,
      );
    }
    const waistHfP95Mm = mm3(row.waist.hfP95);
    const hemHfP95Mm = mm3(row.hem.hfP95);
    // Ratio derives from the STORED millimetre values so the artifact is internally consistent
    // (ratio === waistHfP95Mm / hemHfP95Mm), stored at 3dp so a near-bound value like kevin's
    // 3.958x cannot round to 4.00 and read as "at the bound".
    const ratio = Math.round((waistHfP95Mm / hemHfP95Mm) * 1000) / 1000;
    rows.push({ actor, trouserMesh: row.trouserMesh, waistHfP95Mm, hemHfP95Mm, ratio });
    console.log(
      `${actor} | ${row.trouserMesh} | waist ${row.waist.hfP95.toFixed(3)}mm (${row.waist.verts} verts) | hem ${row.hem.hfP95.toFixed(3)}mm (${row.hem.verts} verts) | ratio ${ratio}`,
    );
  }
  rows.sort((a, b) => a.actor.localeCompare(b.actor));
  const artifact = { enumeratedFrom: "apps/ui-xr/public/generated-humanoids", glbFilesScanned: glbFiles.length, rows };
  writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`\nwrote ${ARTIFACT}: ${rows.length} trouser actors, ${glbFiles.length} GLBs scanned`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
