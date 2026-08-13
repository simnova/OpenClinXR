// #180: append the re-bake note to the three peds cast provenance sidecars.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const REPO_ROOT = resolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

const NOTE =
  "Issue #180 (2026-08-12): re-baked with the #180 palette + scrub wiring — " +
  "materialize_mpfb_humanoid_candidate.py now takes --actor-role and consumes " +
  "automate_blender.garment_shell_color as-is (locked gown/scrub + closed_casual role fallback; " +
  "no table copied). Nurse actor: upper garment is the CC-BY makehuman-community-scrub-shirt " +
  "Scrub_Shirt.mhclo (max ref 11,018 < 13,380, fits the #318 stripped basemesh; ClothesService " +
  "smoke fit ok, 4,688 verts / 9,384 tris) with the locked scrub colour (0.05, 0.48, 0.52); " +
  "patient actors keep the CC0 toigo t-shirt with the closed_casual role palette " +
  "(patient 0.72, 0.68, 0.55; family/parent 0.42, 0.36, 0.40); lower follows the same palette " +
  "call. Post-fix the peds cast is pairwise distinct on upper AND lower base colours and the " +
  "clinician's upper asset differs from the patients'. Footwear assets unchanged. " +
  "Encounter-distance legibility is graded from the staged lit capture by the orchestrator.";

for (const file of [
  "mpfb-peds-patient-child.glb",
  "mpfb-ob-patient-aisha.glb",
  "mpfb-peds-nurse-kevin.glb",
]) {
  const p = join(REPO_ROOT, GENERATED, file.replace(/\.glb$/, ".provenance.json"));
  const doc = JSON.parse(readFileSync(p, "utf8"));
  const chain = doc.sourceOriginChain;
  if (!chain) throw new Error(`${file}: no sourceOriginChain`);
  chain.derivationNote = chain.derivationNote ? `${chain.derivationNote} ${NOTE}` : NOTE;
  writeFileSync(p, JSON.stringify(doc, null, 2) + "\n");
  console.log(`updated ${file.replace(/\.glb$/, ".provenance.json")}`);
}
