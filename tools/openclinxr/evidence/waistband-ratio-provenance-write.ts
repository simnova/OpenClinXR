/**
 * #429 — regenerate tools/openclinxr/evidence/waistband-ratio-provenance.json from the shipped bytes.
 *
 * E5.2 (#422): a waistband-to-hem ratio is only a pass when the hem ring belongs to the actor's
 * SINGLE upper garment. This artifact records, per trouser-carrying actor, the mesh behind each
 * ring and the actor's upper-garment set — derived from the GLB, keyed on the count alone, never
 * on an actor name — so an actor wearing two uppers (the physician's lab coat over scrub shirt)
 * is marked notComparable with the ambiguous garments named, instead of passing on a hem that is
 * not its own. A second actor gaining a coat is caught by the same rule; the physician losing its
 * coat becomes comparable with no edit.
 *
 * Reuses the #427 ring instrument (waistband-ring.ts): same traversal, same ring measurement, same
 * ratio convention (3dp stored millimetres) as waistband-membership-write.ts. Run after a
 * legitimate rebake that changes trouser or upper geometry — the contract refuses a stale or
 * fabricated artifact on its own.
 *
 *   pnpm exec tsx tools/openclinxr/evidence/waistband-ratio-provenance-write.ts
 */
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATED_HUMANOIDS, measureTrouserActor } from "./waistband-ring.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ARTIFACT = join(REPO_ROOT, "tools/openclinxr/evidence/waistband-ratio-provenance.json");

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
    const upperGarments = row.upperGarments;
    const comparable = upperGarments.length === 1;
    // Ratio derives from the STORED millimetre values so a near-bound value like kevin's
    // 3.958x cannot round to 4.00 and read as "at the bound" — the membership writer's convention.
    const ratio = Math.round((mm3(row.waist.hfP95) / mm3(row.hem.hfP95)) * 1000) / 1000;
    rows.push({
      actor,
      waistRingMesh: row.trouserMesh,
      hemRingMesh: row.hemMesh,
      upperGarments,
      comparable,
      ...(comparable
        ? {}
        : {
            notComparableReason: `hem ambiguous: ${upperGarments.length} upper garments (${upperGarments.join(", ")}); the first supplied the hem ring`,
          }),
      ratio,
    });
    console.log(
      `${actor} | waist ${mm3(row.waist.hfP95)}mm | hem ${mm3(row.hem.hfP95)}mm | upper=${upperGarments.join("+")} | comparable=${comparable} | ratio ${ratio}`,
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
