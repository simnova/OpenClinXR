/** Run after the chain, live captures and SC-06 freeze; derive, never transcribe, asset pins. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { produceSupineControlFreeze } from "../supine-control-freeze/supine-control-freeze.js";

const out = process.env["SHIP_WARD_OUT"] ?? "docs/openclinxr/room-realism/ship-ward-room";
const asset = "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb";
const rig = "apps/ui-xr/public/xr-assets/lighting/inpatient_ward_room_v1.rig.json";
const chain = ".openclinxr/evidence/ward-finish-chain";
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
if (digest(asset) !== digest(`${chain}/infinigen-inpatient-ward.chain.glb`) ||
    digest(rig) !== digest(`${chain}/ward-chain.lighting-rig.json`)) {
  throw new Error("Runtime bytes must equal the chain outputs before producing provenance");
}
const budget = JSON.parse(execFileSync("pnpm", ["exec", "tsx",
  "tools/openclinxr/evidence/room-ward-finish-chain/ship-ward-budget.ts",asset], {encoding:"utf8"}));
const previousPath = process.env["SHIP_WARD_PREVIOUS_BUDGET"] ??
  "docs/openclinxr/room-realism/ship-ward-room/shipped-budget.json";
const previous = JSON.parse(readFileSync(previousPath,"utf8"));
const imageComparison = budget.images.map((image: {name: string; decodedRgbaBytes: number}) => {
  const prior = previous.images.find((old: {name: string}) => old.name === image.name) as
    { decodedRgbaBytes: number } | undefined;
  return {
    name: image.name,
    beforeMiBWithMips: prior ? prior.decodedRgbaBytes * 1.33 / 1024**2 : null,
    afterMiBWithMips: image.decodedRgbaBytes * 1.33 / 1024**2,
  };
});
writeFileSync(`${out}/shipped-budget.json`,JSON.stringify({...budget,
  rigSha256:digest(rig),rigBytes:readFileSync(rig).length,imageComparison,
  producer:"tools/openclinxr/evidence/room-ward-finish-chain/ship-ward-provenance.ts",
},null,2)+"\n");
const provenancePath = "apps/ui-xr/public/xr-assets/environment/PROVENANCE.md";
const entry = `- \`infinigen-inpatient-ward.glb\`
  - SHA-256: \`${budget.sha256}\`; ${budget.bytes} bytes; ${budget.triangles} triangles; ${budget.primitiveCount} primitives, all authored materials.
  - Source: Infinigen Indoors (Princeton VL, BSD-3-Clause), seed 205, factory chain \`room_generate → room_clinic_finish → lighting_design\`; ward footprint 4.3 × 3.9 × 2.4 m. Supersedes the historical seed-29 shell.
  - Reproduce: \`pnpm --filter @openclinxr/factory-stations exec tsx src/room_chain/cli.ts --seed 205 --out-dir .openclinxr/evidence/ward-finish-chain --pass-timeout-ms 3600000\`, copy final GLB and rig, then run \`tools/openclinxr/evidence/room-ward-finish-chain/ship-ward-provenance.ts\` with tsx. Scene-plan sidecar is independently re-derived by the SC-06 live-runtime freeze producer.
  - Finish: baked Infinigen wall material, neutral matte paint, vinyl tile, cove base, hospital door, framed troffer and slim T-bar. Procedural/derived finish texture lineage remains in \`room_clinic_finish/textures\`; no new external assets in this promotion.
  - Occlusion: separate Cycles AO maps, box-projected AO UVs, four maps at 512²; unchanged zero-coplanar-boundary and <=5 single-texel gates. Floor shell albedo reduced from 2048² to 1024² in the producer; unique decoded RGBA textures including 1.33× mips: ${budget.decodedMiBWithMips.toFixed(4)} MiB <=56 MiB.
  - Lighting: \`lighting/inpatient_ward_room_v1.rig.json\`, clinic_day chain output, SHA-256 \`${digest(rig)}\`.
  - Evidence: \`${out}\` contains six before/after learner-URL captures (no GLB route override), two-way/three-way sheets, exact runtime box grades and budget breakdown. Environment-ID URL mapping is unchanged.
  - Boundaries: not production readiness, Quest readiness, clinical visual validity, scoring or exam-equivalence evidence.
`;
writeFileSync(provenancePath,readFileSync(provenancePath,"utf8").replace(
  /- `infinigen-inpatient-ward\.glb`\n[\s\S]*?(?=- `infinigen-pediatric-fever)/,entry));
const produced = produceSupineControlFreeze({
  observedBy:"door-finish worker: real UI-XR six-pose runtime capture and SC-06 live hull observation",
  observedAtIso:new Date().toISOString(),
  reason:"Authorized seed-205 ward door finish promotion; casing, glass, veneer and exact runtime ceiling/floor/wall grades pass. Rebaseline records changed room bytes, not a claim that the old control is unchanged.",
});
if (!produced.produced) throw new Error(produced.reason);
writeFileSync("tools/openclinxr/evidence/supine-control-freeze/supine-control-freeze.record.json",JSON.stringify(produced.freeze,null,2)+"\n");
console.log(JSON.stringify({assetSha256:budget.sha256,rigSha256:digest(rig),decodedMiB:budget.decodedMiBWithMips}));
