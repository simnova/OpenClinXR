/** Run after the chain, live captures and SC-06 freeze; derive, never transcribe, asset pins. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  computeSupineControlFreeze,
  produceSupineControlFreeze,
  readSupineControlFreeze,
  supineControlFreezeIsStillValid,
} from "../supine-control-freeze/supine-control-freeze.js";

const out = process.env["SHIP_WARD_OUT"] ?? "docs/openclinxr/room-realism/ship-ward-room";
const asset = "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb";
const rig = "apps/ui-xr/public/xr-assets/lighting/inpatient_ward_room_v1.rig.json";
const chain = process.env["SHIP_WARD_CHAIN_OUT"] ?? ".openclinxr/evidence/ward-finish-chain";
const seed = Number(process.env["SHIP_WARD_SEED"] ?? "205");
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
  - Source: Infinigen Indoors (Princeton VL, BSD-3-Clause), seed ${seed}, factory chain \`room_generate → room_clinic_finish → lighting_design\`; ward footprint 4.3 × 3.9 × 2.4 m. Supersedes the historical seed-29 shell.
  - Reproduce: \`pnpm factory:room:promote -- --environment inpatient_ward_room_v1 --seed ${seed}\`. The command runs or cache-hits the chain, installs the GLB and rig, and calls this producer to derive every digest and size pin. Scene-plan sidecar is independently re-derived by the SC-06 live-runtime freeze producer.
  - Finish: baked Infinigen wall material, neutral matte paint, runtime-calibrated neutral vinyl tile, cove base, hospital door, framed troffer and slim T-bar. Procedural/derived finish texture lineage remains in \`room_clinic_finish/textures\`; no new external assets in this promotion.
  - Occlusion: separate Cycles AO maps, box-projected AO UVs, four maps at 512²; unchanged zero-coplanar-boundary and <=5 single-texel gates. Floor shell albedo reduced from 2048² to 1024² in the producer; unique decoded RGBA textures including 1.33× mips: ${budget.decodedMiBWithMips.toFixed(4)} MiB <=56 MiB.
  - Lighting: \`lighting/inpatient_ward_room_v1.rig.json\`, clinic_day chain output, SHA-256 \`${digest(rig)}\`.
  - Evidence: \`${out}\` contains six before/after learner-URL captures (no GLB route override), two-way/three-way sheets, exact runtime box grades and budget breakdown. Environment-ID URL mapping is unchanged.
  - Boundaries: not production readiness, Quest readiness, clinical visual validity, scoring or exam-equivalence evidence.
`;
writeFileSync(provenancePath,readFileSync(provenancePath,"utf8").replace(
  /- `infinigen-inpatient-ward\.glb`\n[\s\S]*?(?=- `infinigen-pediatric-fever)/,entry));
const readerAuditPath = `${out}/READER-AUDIT.md`;
if (existsSync(readerAuditPath)) {
  const readerAudit = readFileSync(readerAuditPath, "utf8")
    .replace(
      /The shipped GLB is [\d,]+ bytes, SHA-256\n`[a-f0-9]{64}`,\nwith [\s\S]*?\(limit 56 MiB\)\./,
      `The shipped GLB is ${budget.bytes.toLocaleString("en-US")} bytes, SHA-256\n\`${budget.sha256}\`,\nwith ${budget.triangles.toLocaleString("en-US")} triangles, ${budget.primitiveCount} primitives, zero material-less primitives, and\n${budget.decodedMiBWithMips.toFixed(4)} MiB decoded RGBA including the 1.33× mip allowance (limit 56 MiB).`,
    )
    .replace(/The rig SHA-256 is\n`[a-f0-9]{64}`\./, `The rig SHA-256 is\n\`${digest(rig)}\`.`);
  writeFileSync(readerAuditPath, readerAudit);
}
const recorded = readSupineControlFreeze();
const current = computeSupineControlFreeze(process.cwd());
if (recorded === null || !supineControlFreezeIsStillValid(recorded, current).valid) {
  const produced = produceSupineControlFreeze({
    observedBy:"factory:room:promote deterministic asset promotion",
    observedAtIso:new Date().toISOString(),
    reason:`Room-chain promotion changed the installed ${asset} bytes; provenance and byte counts were re-derived by the supported producer.`,
  });
  if (!produced.produced) throw new Error(produced.reason);
  writeFileSync("tools/openclinxr/evidence/supine-control-freeze/supine-control-freeze.record.json",JSON.stringify(produced.freeze,null,2)+"\n");
}
console.log(JSON.stringify({assetSha256:budget.sha256,rigSha256:digest(rig),decodedMiB:budget.decodedMiBWithMips}));
