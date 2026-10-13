/**
 * Walk-clip census (slice 2, stage 2): gate every Mesh2Motion Walk_* clip at source and
 * bound offline to the physician rig through the existing motion_bind_stage.py recipe.
 *
 * Reuses landed stations/tools only: extract-library-clip.ts (child process, the same
 * reason bind-walk-clip-all.ts invokes it out-of-process), runMotionRetarget (station,
 * compute facade), dropLeadingRestFrame (graft-bound-clip.ts). No hand-authored motion.
 *
 * GLBs and bound outputs stay under --workdir (default /tmp, uncommitted); the table
 * records path + sha256 per clip.
 *
 *   pnpm exec tsx tools/openclinxr/evidence/walk-clip/walk-clip-census.ts [--clip Walk]... [--step extract|bind|gate]
 *
 * claimScope: offline gate table for seven library clips. notEvidenceFor: gait realism,
 * runtime playback, Quest readiness.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { GATE_BARS, MESHMOTION_WALK_JOINTS, MPFB_WALK_JOINTS, runMotionRetarget } from "@openclinxr/factory-stations";
import type { WalkGateReport } from "@openclinxr/factory-stations";
import { dropLeadingRestFrame } from "../../factory/graft-bound-clip.js";
import { gateOneClip } from "./gate-one-clip.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const HOME = process.env["HOME"] ?? "";
const BASE_LIBRARY = path.join(HOME, ".openclinxr-tools/mesh2motion-app/static/animations/human-base-animations.glb");
const ADDON_LIBRARY = path.join(HOME, ".openclinxr-tools/mesh2motion-app/static/animations/human-addon-animations.glb");
const PHYSICIAN_GLB = path.join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb");
const TARGET_MAP = path.join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mpfb2-default-no-toes.json");
const SOURCE_MAP = path.join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mesh2motion-human-66.json");
const EXTRACT_SCRIPT = path.join(REPO_ROOT, "packages/openclinxr/factory-stations/src/motion_retarget/extract-library-clip.ts");

export const CENSUS_CLIPS: ReadonlyArray<{ clip: string; library: string }> = [
  { clip: "Walk", library: BASE_LIBRARY },
  { clip: "Walk_Carry", library: BASE_LIBRARY },
  { clip: "Walk_Formal", library: BASE_LIBRARY },
  { clip: "Walk_Backwards", library: ADDON_LIBRARY },
  { clip: "Walk_Female", library: ADDON_LIBRARY },
  { clip: "Walk_Large", library: ADDON_LIBRARY },
  { clip: "Walk_Stealth", library: ADDON_LIBRARY },
];

export type CensusRow = {
  clip: string;
  library: string;
  sourceGlb: string;
  sourceSha256: string;
  sourceGate: WalkGateReport;
  boundGlb: string;
  boundSha256: string;
  boundClip: string;
  boundGate: WalkGateReport;
  droppedLeadingRestFrame: boolean;
};

function sha256Of(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function runNode(tsxArgs: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "tsx", ...tsxArgs], { cwd: REPO_ROOT, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 300_000);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function resolveBlender(): string {
  if (process.env["OPENCLINXR_BLENDER"] && existsSync(process.env["OPENCLINXR_BLENDER"])) {
    return process.env["OPENCLINXR_BLENDER"]!;
  }
  if (existsSync("/opt/homebrew/bin/blender")) return "/opt/homebrew/bin/blender";
  return "blender";
}

async function strippedActorCopy(workdir: string): Promise<string> {
  const out = path.join(workdir, "physician-stripped.glb");
  if (existsSync(out)) return out;
  const io = new NodeIO();
  const document = await io.read(PHYSICIAN_GLB);
  for (const animation of document.getRoot().listAnimations()) animation.dispose();
  await io.write(out, document);
  return out;
}

async function boundClipName(boundGlb: string): Promise<string> {
  const doc = await new NodeIO().read(boundGlb);
  const names = doc.getRoot().listAnimations().map((a) => a.getName());
  const candidates = names.filter((n) => n.startsWith("openclinxr_retarget_"));
  if (candidates.length !== 1) {
    throw new Error(`expected exactly one bound clip in ${boundGlb}, found: ${names.join(",")}`);
  }
  return candidates[0]!;
}

export async function extractCensusClip(clip: string, library: string, workdir: string): Promise<string> {
  const out = path.join(workdir, `source-${clip}.glb`);
  if (existsSync(out)) {
    console.log(`REUSE ${clip} -> ${out}`);
    return out;
  }
  const report = path.join(workdir, `source-${clip}-extraction.json`);
  const extraction = await runNode([EXTRACT_SCRIPT, "--library", library, "--clip", clip, "--output", out, "--report", report]);
  if (extraction.code !== 0) throw new Error(`extract ${clip} exit ${extraction.code}\n${extraction.stderr.slice(-1500)}`);
  console.log(`EXTRACTED ${clip} -> ${out}`);
  return out;
}

export async function bindCensusClip(clip: string, sourceGlb: string, workdir: string): Promise<{ boundGlb: string; dropped: boolean }> {
  const raw = path.join(workdir, `bound-${clip}-raw.glb`);
  const report = path.join(workdir, `bound-${clip}-report.json`);
  if (!existsSync(raw)) {
    const actor = await strippedActorCopy(workdir);
    const result = await runMotionRetarget(
      { actorId: "mpfb-clinical-physician-adult", clipId: clip },
      {
        blender: resolveBlender(),
        cwd: REPO_ROOT,
        timeoutMs: 600_000,
        extraArgs: [
          "--actor", actor,
          "--clip", sourceGlb,
          "--map", TARGET_MAP,
          "--source-map", SOURCE_MAP,
          "--source-orientation", "First person, Z up",
          "--output", raw,
          "--report", report,
        ],
      },
    );
    if (result["blenderExit"] !== 0) {
      throw new Error(`bind ${clip} exit ${String(result["blenderExit"])}\n${String(result["stderr"]).slice(-1500)}`);
    }
    console.log(`BOUND ${clip} -> ${raw}`);
  } else {
    console.log(`REUSE bound ${clip} -> ${raw}`);
  }
  const dropped = path.join(workdir, `bound-${clip}.glb`);
  if (existsSync(dropped)) return { boundGlb: dropped, dropped: true };
  try {
    await dropLeadingRestFrame({ targetPath: raw, clipName: await boundClipName(raw), outputPath: dropped });
    return { boundGlb: dropped, dropped: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("does not look like a prepended rest frame")) throw err;
    console.log(`${clip}: no leading rest frame to drop; gating the raw bind output`);
    return { boundGlb: raw, dropped: false };
  }
}

export async function gateCensusClip(clip: string, library: string, workdir: string): Promise<CensusRow> {
  const sourceGlb = await extractCensusClip(clip, library, workdir);
  const sourceGate = await gateOneClip({ glbPath: sourceGlb, clipName: clip, joints: MESHMOTION_WALK_JOINTS });
  const { boundGlb, dropped } = await bindCensusClip(clip, sourceGlb, workdir);
  const boundClip = await boundClipName(boundGlb);
  const boundGate = await gateOneClip({ glbPath: boundGlb, clipName: boundClip, joints: MPFB_WALK_JOINTS });
  return {
    clip,
    library,
    sourceGlb,
    sourceSha256: sha256Of(sourceGlb),
    sourceGate,
    boundGlb,
    boundSha256: sha256Of(boundGlb),
    boundClip,
    boundGate,
    droppedLeadingRestFrame: dropped,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = args.flatMap((arg, i) => (arg === "--clip" ? [args[i + 1]] : [])).filter((v): v is string => Boolean(v));
  const step = args.find((a) => a.startsWith("--step="))?.slice("--step=".length) ?? "all";
  const workdirFlag = args.find((a) => a.startsWith("--workdir="))?.slice("--workdir=".length);
  const workdir = workdirFlag ?? "/tmp/walkclip-census";
  mkdirSync(workdir, { recursive: true });
  const wanted = only.length > 0 ? CENSUS_CLIPS.filter((c) => only.includes(c.clip)) : [...CENSUS_CLIPS];
  if (wanted.length === 0) throw new Error(`no census clips match ${only.join(",")}`);
  if (step === "extract" || step === "all") {
    for (const { clip, library } of wanted) await extractCensusClip(clip, library, workdir);
  }
  if (step === "bind" || step === "all") {
    for (const { clip } of wanted) {
      const sourceGlb = path.join(workdir, `source-${clip}.glb`);
      if (!existsSync(sourceGlb)) throw new Error(`extract ${clip} first (missing ${sourceGlb})`);
      await bindCensusClip(clip, sourceGlb, workdir);
    }
  }
  if (step === "gate" || step === "all") {
    const rows: CensusRow[] = [];
    for (const { clip, library } of wanted) rows.push(await gateCensusClip(clip, library, workdir));
    const out = path.join(workdir, "census-rows.json");
    writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
    console.log("gate bars (threshold [provenance]):");
    for (const [id, bar] of Object.entries(GATE_BARS)) console.log(`  ${id}: ${bar.threshold} [${bar.provenance}]`);
    for (const row of rows) {
      const fails = (g: WalkGateReport): string => g.bars.filter((b) => !b.pass).map((b) => b.id).join(",") || "none";
      console.log(`${row.clip}: source ${row.sourceGate.pass ? "PASS" : `FAIL(${fails(row.sourceGate)})`} | bound ${row.boundGate.pass ? "PASS" : `FAIL(${fails(row.boundGate)})`}`);
    }
    console.log(`wrote ${out}`);
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
