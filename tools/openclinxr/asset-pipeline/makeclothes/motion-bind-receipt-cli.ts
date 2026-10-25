/**
 * motion-bind receipt producer — reconstructed CURRENT receipt, not a re-run.
 *
 * The casting SSOT expects `<stem>.motion-bind.provenance.json` beside every
 * motion-bind GLB (actor-casting.ts), but the bind stage only ever wrote
 * `<stem>.motion-bind-report.json`. This CLI derives a truthful receipt from
 * what exists NOW, without touching the original report or re-running Blender:
 *
 *   inputs   existing stage report (historical record, read-only) +
 *            current on-disk bytes of output GLB, source clip, target rig,
 *            rig maps, and the target rig's recorded provenance;
 *   output   one sidecar JSON: current sha256/byte counts, scenarioId
 *            inherited ONLY from the target rig's recorded provenance (with
 *            source cited), historical bind transcribed with its unknown
 *            parts marked UNKNOWN, generatedAt = now (never backdated).
 *
 * Hard rules (violations exit non-zero, no file written):
 *   - historical input hashes are UNKNOWN: the 2026-09-03 report records no
 *     input hashes, so none are stated. Current target bytes (2e2561a7...)
 *     do NOT prove the September target bytes.
 *   - output identity IS provable: current output sha must equal
 *     report.teethRestClearance.outputSha (post-clearance record); else refuse.
 *   - no Blender rerun is claimed; the rerun command is informational only.
 *
 * Usage (run from the repo root; writes only --out):
 *   tsx tools/openclinxr/asset-pipeline/makeclothes/motion-bind-receipt-cli.ts --repo . \
 *     --report apps/ui-xr/public/xr-assets/humanoids/candidates/NAME.motion-bind-report.json \
 *     --out <receipt path>
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : fallback;
}

function fail(msg: string): never {
  console.error(`motion-bind-receipt-cli: REFUSED: ${msg}`);
  process.exit(1);
}

function sha256Of(abs: string): { sha256: string; bytes: number } {
  if (!existsSync(abs)) fail(`missing file ${abs}`);
  const buf = readFileSync(abs);
  return { sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

function repoRel(repoBase: string, abs: string): string {
  return path.relative(repoBase, abs).replace(/\\/g, "/");
}

const repoRoot = path.resolve(arg("--repo", "."));
const reportPath = path.resolve(repoRoot, arg("--report", ""));
const outPath = path.resolve(arg("--out", ""));
if (!reportPath.endsWith(".motion-bind-report.json")) fail("--report must be a .motion-bind-report.json");
if (!outPath.endsWith(".motion-bind.provenance.json")) fail("--out must be a .motion-bind.provenance.json");

const report = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
const stem = (v: unknown): string => (typeof v === "string" ? path.basename(v) : "");
const outGlb = path.join(repoRoot, "apps/ui-xr/public/xr-assets/humanoids/candidates", stem(report["outputGlb"]).replace(/\.glb$/u, "") + ".glb");
const targetRig = path.join(repoRoot, "apps/ui-xr/public/generated-humanoids", stem(report["targetRig"]));
const sourceClip = path.join(repoRoot, "tools/openclinxr/asset-pipeline/makeclothes", stem(report["sourceClip"]));
const targetMap = path.join(repoRoot, "tools/openclinxr/asset-pipeline/makeclothes/known-rigs", stem(report["targetMap"]));
const sourceMap = path.join(repoRoot, "tools/openclinxr/asset-pipeline/makeclothes/known-rigs", stem(report["sourceMap"]));
for (const [label, p] of [["outputGlb", outGlb], ["targetRig", targetRig], ["sourceClip", sourceClip], ["targetMap", targetMap], ["sourceMap", sourceMap]] as const) {
  if (!existsSync(p)) fail(`${label} not on disk at ${repoRel(repoRoot, p)} (report names ${String(report[label === "outputGlb" ? "outputGlb" : label === "targetRig" ? "targetRig" : label === "sourceClip" ? "sourceClip" : label === "targetMap" ? "targetMap" : "sourceMap"] ?? "")})`);
}

const out = sha256Of(outGlb);
const rig = sha256Of(targetRig);
const clip = sha256Of(sourceClip);
const tmap = sha256Of(targetMap);
const smap = sha256Of(sourceMap);
const reportHash = sha256Of(reportPath);

const clearance = (report["teethRestClearance"] ?? {}) as { outputSha?: unknown };
if (typeof clearance.outputSha === "string" && clearance.outputSha.length > 0 && clearance.outputSha !== out.sha256) {
  fail(`current output sha ${out.sha256} != report post-clearance outputSha ${clearance.outputSha}: bytes changed since the record`);
}

const rigProvPath = targetRig.replace(/\.glb$/u, ".provenance.json");
let scenarioId: string | null = null;
let scenarioIdSource = "";
if (existsSync(rigProvPath)) {
  const rigProv = JSON.parse(readFileSync(rigProvPath, "utf8")) as { scenarioId?: unknown };
  if (typeof rigProv.scenarioId === "string" && rigProv.scenarioId.length > 0) {
    scenarioId = rigProv.scenarioId;
    scenarioIdSource = `inherited from the bind target's recorded provenance ${repoRel(repoRoot, rigProvPath)} (scenarioId=${scenarioId}); not invented by the casting code.`;
  }
}

const receipt: Record<string, unknown> = {
  schemaVersion: "openclinxr.motion-bind-provenance.v1",
  assetPath: repoRel(repoRoot, outGlb),
  ...(scenarioId === null ? {} : { scenarioId, scenarioIdSource }),
  derivationMode: "bind_stage_report_transcribed_by_receipt_cli_not_rerun",
  generator: "tools/openclinxr/asset-pipeline/makeclothes/motion-bind-receipt-cli.ts (reconstructed current receipt; no Blender run, no byte changes, no backdate)",
  generatedAt: new Date().toISOString().replace(/\.\d+Z$/u, "Z"),
  historicalBind: {
    ranAt: report["generatedAt"] ?? "UNKNOWN",
    record: `${repoRel(repoRoot, reportPath)} (schemaVersion ${String(report["schemaVersion"] ?? "UNKNOWN")}, stageId ${String(report["stageId"] ?? "UNKNOWN")}, verdict ${String(report["verdict"] ?? "UNKNOWN")})`,
    operator: report["operator"] ?? "UNKNOWN",
    addonModule: report["addonModule"] ?? "UNKNOWN",
    clipName: report["clipName"] ?? "UNKNOWN",
    historicalInputHashes: "UNKNOWN: the bind-time record carries no input hashes; current bytes below do not prove historical bytes.",
    note: "report absolute paths point at the bind-time worktree and are transcribed as history, resolved here by basename to current in-tree files with hashes measured now.",
  },
  inputsMeasuredNow: {
    sourceClip: repoRel(repoRoot, sourceClip),
    sourceClipSha256: clip.sha256,
    sourceClipBytes: clip.bytes,
    targetRig: repoRel(repoRoot, targetRig),
    targetRigSha256: rig.sha256,
    targetRigBytes: rig.bytes,
    targetMap: repoRel(repoRoot, targetMap),
    targetMapSha256: tmap.sha256,
    sourceMap: repoRel(repoRoot, sourceMap),
    sourceMapSha256: smap.sha256,
  },
  outputMeasuredNow: {
    outputGlbSha256: out.sha256,
    outputBytes: out.bytes,
    matchesReportPostClearanceHash: typeof clearance.outputSha === "string" ? clearance.outputSha === out.sha256 : "no clearance record present; identity vs history unverified",
  },
  reportSha256: reportHash.sha256,
  producerWhyReceiptExists: "the bind stage emits only <stem>.motion-bind-report.json; the casting SSOT convention (<stem>.provenance.json) had no file. This receipt closes that gap from measured current bytes.",
  rerunCommandNotExecuted: "blender --background --python tools/openclinxr/asset-pipeline/makeclothes/seated_clip_bind_stage.py -- --actor <targetRig> --clip <sourceClip> --map <targetMap> --source-map <sourceMap> --output <outputGlb>",
  claimScope: "sidecar existence for casting inspector reads + current-byte identity of bind output/inputs",
  notEvidenceFor: [
    "clinical_motion_realism",
    "quest_readiness",
    "visual_motion_quality",
    "runtime_playback",
    "reverification_of_the_historical_retarget_math",
    "historical_input_byte_identity",
  ],
  explicitUnknown: [
    "bind-time input bytes (clip, rig, maps): no hashes recorded then; current hashes do not prove them",
    "whether a fresh Blender rerun reproduces byte-identical output (not attempted; expensive)",
  ],
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receipt: repoRel(repoRoot, outPath), outputGlbSha256: out.sha256, scenarioId }));
