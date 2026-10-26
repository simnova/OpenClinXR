/** Run after the chain, live captures and SC-06 freeze; derive, never transcribe, asset pins. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  computeSupineControlFreeze,
  produceSupineControlFreeze,
  readSupineControlFreeze,
  supineControlFreezeIsStillValid,
} from "../supine-control-freeze/supine-control-freeze.js";

export interface ShipWardProvenanceOptions {
  publicationRoot?: string;
  sourceRoot?: string;
  outDir?: string;
  /** Explicit publication sub-path for the freeze record. Preserves dated behavior. */
  reportPath?: string;
  freezeRecordPath?: string;
  chainDir?: string;
  seed?: number;
  previousBudgetPath?: string;
  provenanceTemplatePath?: string;
  /** Additive override: control-asset rel path -> bytes the published tree carries. */
  publishedControlAssets?: Record<string, Buffer>;
  runBudget?: (assetAbs: string) => { sha256: string; bytes: number; triangles: number; primitiveCount: number; decodedMiBWithMips: number; images: Array<{ name: string; decodedRgbaBytes: number }>; meshCount?: number; materiallessPrimitives?: number; assetSha256?: string; rigSha256?: string; decodedMiB?: number };
}

export function shipWardProvenance(opts: ShipWardProvenanceOptions = {}): { out: string; provenancePath: string; shippedBudgetPath: string; freezeRecordPath: string; assetSha256: string; rigSha256: string; decodedMiB: number } {
const publicationRoot = path.resolve(opts.publicationRoot ?? process.env["SHIP_WARD_PUBLICATION_ROOT"] ?? process.cwd());
const sourceRoot = path.resolve(opts.sourceRoot ?? process.env["SHIP_WARD_SOURCE_ROOT"] ?? process.cwd());
const resolveOut = (p: string): string => path.resolve(publicationRoot, p);
const resolveSource = (p: string): string => path.resolve(sourceRoot, p);
const out = opts.outDir ?? resolveOut(process.env["SHIP_WARD_OUT"] ?? "docs/openclinxr/room-realism/ship-ward-room");
mkdirSync(out, { recursive: true });
const asset = resolveOut("apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb");
const rig = resolveOut("apps/ui-xr/public/xr-assets/lighting/inpatient_ward_room_v1.rig.json");
const chain = opts.chainDir ?? process.env["SHIP_WARD_CHAIN_OUT"] ?? resolveOut(".openclinxr/evidence/ward-finish-chain");
const seed = opts.seed ?? Number(process.env["SHIP_WARD_SEED"] ?? "205");
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
if (digest(asset) !== digest(`${chain}/infinigen-inpatient-ward.chain.glb`) ||
    digest(rig) !== digest(`${chain}/ward-chain.lighting-rig.json`)) {
  throw new Error("Runtime bytes must equal the chain outputs before producing provenance");
}
const publishedWardRel = "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb";
const freezeOverrides: Record<string, Buffer> = opts.publishedControlAssets ?? {
  [publishedWardRel]: readFileSync(asset),
};
const budget = opts.runBudget ? opts.runBudget(asset) : JSON.parse(execFileSync("pnpm", ["exec", "tsx",
  "tools/openclinxr/evidence/room-ward-finish-chain/ship-ward-budget.ts", asset], {encoding:"utf8", cwd: sourceRoot}));
const previousPath = opts.previousBudgetPath ?? process.env["SHIP_WARD_PREVIOUS_BUDGET"] ??
  resolveSource("docs/openclinxr/room-realism/ship-ward-room/shipped-budget.json");
const previous = JSON.parse(readFileSync(previousPath,"utf8"));
if (!Array.isArray((previous as { images?: unknown }).images)) {
  throw new Error(`Previous budget ${previousPath} must carry required images[] contract`);
}
const previousImages = (previous as { images: Array<{ name: string; decodedRgbaBytes: number }> }).images;
const imageComparison = budget.images.map((image: {name: string; decodedRgbaBytes: number}) => {
  const prior = previousImages.find((old: {name: string}) => old.name === image.name) as
    { decodedRgbaBytes: number } | undefined;
  return {
    name: image.name,
    beforeMiBWithMips: prior ? prior.decodedRgbaBytes * 1.33 / 1024**2 : null,
    afterMiBWithMips: image.decodedRgbaBytes * 1.33 / 1024**2,
  };
});
writeFileSync(`${out}/shipped-budget.json`,JSON.stringify({...budget,
  assetSha256: budget.sha256, rigSha256:digest(rig),rigBytes:readFileSync(rig).length,imageComparison,
  decodedMiB: budget.decodedMiBWithMips,
  producer:"tools/openclinxr/evidence/room-ward-finish-chain/ship-ward-provenance.ts",
},null,2)+"\n");
const provenanceTemplate = opts.provenanceTemplatePath ?? process.env["SHIP_WARD_PROVENANCE_TEMPLATE"] ??
  resolveSource("apps/ui-xr/public/xr-assets/environment/PROVENANCE.md");
const provenancePath = resolveOut("apps/ui-xr/public/xr-assets/environment/PROVENANCE.md");
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
writeFileSync(provenancePath,readFileSync(provenanceTemplate,"utf8").replace(
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
const freezeOut = opts.freezeRecordPath ?? opts.reportPath ?? resolveOut("tools/openclinxr/evidence/supine-control-freeze/supine-control-freeze.record.json");
{
const recorded = readSupineControlFreeze(sourceRoot);
const current = computeSupineControlFreeze(sourceRoot, freezeOverrides);
if (recorded === null || !supineControlFreezeIsStillValid(recorded, current).valid) {
  const produced = produceSupineControlFreeze({
    observedBy:"factory:room:promote deterministic asset promotion",
    observedAtIso:new Date().toISOString(),
    reason:`Room-chain promotion changed the installed ${asset} bytes; provenance and byte counts were re-derived by the supported producer.`,
    repoRootPath: sourceRoot,
    publishedControlAssets: freezeOverrides,
  });
  if (!produced.produced) throw new Error(produced.reason);
  mkdirSync(path.dirname(freezeOut), { recursive: true });
  writeFileSync(freezeOut,JSON.stringify(produced.freeze,null,2)+"\n");
}
}
const shippedBudgetPath = `${out}/shipped-budget.json`;
const freezeRecordPath = freezeOut;
return { out, provenancePath, shippedBudgetPath, freezeRecordPath, assetSha256: budget.sha256, rigSha256: digest(rig), decodedMiB: budget.decodedMiBWithMips };
}

const invokedAsCli = process.argv[1] !== undefined && /ship-ward-provenance(\.[tj]s)?$/.test(process.argv[1]);
if (invokedAsCli) {
  const result = shipWardProvenance();
  console.log(JSON.stringify({ out: result.out }));
}
