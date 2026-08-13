// #360: append the re-bake note to the three peds cast provenance sidecars.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const REPO_ROOT = resolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

const NOTE =
  "Issue #360 (2026-08-13): re-baked with the garment-texture wiring — the materializer now " +
  "consumes each garment's OWN declared .mhmat diffuseTexture via the generic " +
  "make_material_from_mhmat path (the #340/#356 eye path): patients' upper toigo t-shirt " +
  "consumes T-shirt_basic.png and each footwear slot consumes its declared map (flats Shoe.png / " +
  "mj MJ-shoes3.png / boots boot.png). The #180 role colour is preserved as the exported " +
  "baseColorFactor (glTF factor x texture; the exporter drops the factor when a texture binds, " +
  "so it is patched into the GLB post-export). Recorded skips keep flat colours: the scrub's " +
  "declared Scrub_Shirt.mhmat and the cargo-pants' cargo_pants.mhmat are not staged in the " +
  "provider cache, and the shipped lower cover shell carries no TEXCOORD_0 — a lower-garment " +
  "texture is a fitting-pipeline slice, not this material slice.";

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
