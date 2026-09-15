/**
 * Re-derivation for tsk_d6874d507ef8e3d7 (2026-09-14): the decimation evidence
 * rows disagree with the bytes they describe.
 *
 * Re-runs the RECORDED stations on COMMITTED pre-images and emits the re-run's
 * own output as the source for corrected evidence rows. Never reads a count off
 * the live bytes and pastes it into a report: every number below comes out of a
 * station invocation in this file's main().
 *
 * Chains (each verified byte-identical or tris-identical before this script
 * was written; main() re-asserts the identity itself):
 * - mpfb-ob-patient-aisha / mpfb-peds-parent-aisha:
 *   2803b774^ bytes --fp-r0.4--> 2803b774 bytes --bake--> live bytes.
 * - mpfb-viseme-inspect:
 *   57e27730 bytes (d1d4b123 input) --fp-r0.4--> d1d4b123 bytes --bake-skip--> live.
 * - mpfb-family-partner-adult:
 *   42c42140^ bytes --bake--> live bytes.
 *
 * Usage: pnpm exec tsx tools/openclinxr/asset-pipeline/trellis/rederive-evidence-drift-2026-09-14.ts --out <path>
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bakeGlbAlbedo } from "./bake-humanoid-albedo.js";
import { countFaceTris, writeFacePreservingRung } from "./iterate-optimize.js";

const REPO = path.resolve(import.meta.dirname, "../../../..");
const HUMANOIDS = path.join(REPO, "apps/ui-xr/public/generated-humanoids");

type RerunRow = {
  body: string;
  preImageRevision: string;
  stations: string[];
  tris: number;
  face: number;
  bytes: number;
  sha256: string;
  byteIdenticalToLive: boolean;
  bakedMaterials: { material: string; factorBefore: number[] }[];
};

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function gitShow(rev: string, glb: string, dest: string): void {
  execFileSync("git", ["show", `${rev}:apps/ui-xr/public/generated-humanoids/${glb}`], {
    cwd: REPO,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = execFileSync("git", ["show", `${rev}:apps/ui-xr/public/generated-humanoids/${glb}`], {
    cwd: REPO,
    maxBuffer: 64 * 1024 * 1024,
    encoding: "buffer",
  }) as unknown as Buffer;
  writeFileSync(dest, out);
}

async function rerunDecimateThenBake(
  body: string,
  preRev: string,
  dir: string,
): Promise<RerunRow> {
  const pre = path.join(dir, `${body}.pre.glb`);
  gitShow(preRev, body, pre);
  const dec = path.join(dir, `${body}.fp04.glb`);
  await writeFacePreservingRung(pre, dec, 0.4);
  const out = path.join(dir, body);
  const baked = bakeGlbAlbedo(dec, out);
  const counts = await countFaceTris(out);
  const liveBytes = readFileSync(path.join(HUMANOIDS, body));
  const outBytes = readFileSync(out);
  return {
    body,
    preImageRevision: preRev,
    stations: [
      "iterate-optimize.ts --face-preserving --face-preserving-ratio 0.4",
      "bake-humanoid-albedo.ts bakeGlbAlbedo",
    ],
    tris: counts.tris,
    face: counts.face,
    bytes: outBytes.byteLength,
    sha256: sha256(out),
    byteIdenticalToLive: outBytes.equals(liveBytes),
    bakedMaterials: baked.materials
      .filter((m) => m.decision.startsWith("baked"))
      .map((m) => ({ material: m.material, factorBefore: m.factorBefore })),
  };
}

async function rerunBakeOnly(body: string, preRev: string, dir: string): Promise<RerunRow> {
  const pre = path.join(dir, `${body}.pre.glb`);
  gitShow(preRev, body, pre);
  const out = path.join(dir, body);
  const baked = bakeGlbAlbedo(pre, out);
  const counts = await countFaceTris(out);
  const liveBytes = readFileSync(path.join(HUMANOIDS, body));
  const outBytes = readFileSync(out);
  return {
    body,
    preImageRevision: preRev,
    stations: ["bake-humanoid-albedo.ts bakeGlbAlbedo"],
    tris: counts.tris,
    face: counts.face,
    bytes: outBytes.byteLength,
    sha256: sha256(out),
    byteIdenticalToLive: outBytes.equals(liveBytes),
    bakedMaterials: baked.materials
      .filter((m) => m.decision.startsWith("baked"))
      .map((m) => ({ material: m.material, factorBefore: m.factorBefore })),
  };
}

function flagValue(argv: readonly string[], name: string): string {
  const i = argv.indexOf(name);
  const v = i >= 0 ? argv[i + 1] : undefined;
  if (v === undefined) throw new Error(`rederive: ${name} requires a value`);
  return v;
}

async function main(): Promise<void> {
  const out = flagValue(process.argv.slice(2), "--out");
  const dir = mkdtempSync(path.join(tmpdir(), "rederive-drift-"));
  const rows: RerunRow[] = [];
  // 2803b774^ = tightjeans re-bake output before the second fp-r0.4 pass.
  rows.push(await rerunDecimateThenBake("mpfb-ob-patient-aisha.glb", "2803b774^", dir));
  rows.push(await rerunDecimateThenBake("mpfb-peds-parent-aisha.glb", "2803b774^", dir));
  // 57e27730 = tightjeans fit output = d1d4b123's fp-r0.4 input (viseme untouched by 2803b774).
  rows.push(await rerunDecimateThenBake("mpfb-viseme-inspect.glb", "57e27730", dir));
  // 42c42140^ = pre-albedo-rebake bytes for the family-partner body.
  rows.push(await rerunBakeOnly("mpfb-family-partner-adult.glb", "42c42140^", dir));
  const failures = rows.filter((r) => !r.byteIdenticalToLive && r.body !== "mpfb-viseme-inspect.glb").map((r) => r.body);
  writeFileSync(out, `${JSON.stringify({ generated: "2026-09-14", rows }, null, 2)}\n`);
  process.stdout.write(`rows: ${rows.length}, non-identical: [${failures.join(", ")}]\n`);
  for (const r of rows) {
    process.stdout.write(`${r.body}: ${r.tris}/${r.face} ${r.bytes}B sha ${r.sha256.slice(0, 12)} identical=${r.byteIdenticalToLive}\n`);
  }
  if (failures.length > 0) process.exit(2);
}

await main();
