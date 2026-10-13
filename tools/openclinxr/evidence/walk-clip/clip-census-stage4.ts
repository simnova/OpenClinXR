/**
 * Walk-clip census stage 4: browser check of the bound symmetric candidate on the 6 m
 * proving ground (lockOff, 3 runs) through the capture's --humanoid-glb override.
 *
 * Builds the served GLB (full physician copy with the shipped walk clip replaced by the
 * symmetric candidate under the runtime's clip name; uncommitted, path + sha recorded),
 * then per run reports: live/mixer leg amplitude vs the bound clip, toe lift, rendered
 * world-stationary fraction vs kinematic contact, as-played L/R stride asymmetry,
 * the runtime's timeScale, and natural speed. Renders come from the capture itself.
 *
 *   pnpm exec tsx tools/openclinxr/evidence/walk-clip/clip-census-stage4.ts --run <subdir> [--run <subdir>...]
 *   (runs the analysis over finished capture dirs; the captures themselves run separately)
 *
 * claimScope: three lockOff browser runs of one staged candidate. notEvidenceFor: gait
 * realism, clinical plausibility, Quest performance.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { graftBoundClip } from "../../factory/graft-bound-clip.js";
import { analyzeClip, analyzeRow, readWalkClipInfo } from "../loco-ground/loco-ground-analyze.js";
import type { ClipReport, RowReport, TapFrame } from "../loco-ground/loco-ground-analyze.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const WORKDIR = "/tmp/clip-census-stage4";
const PHYSICIAN_GLB = path.join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb");
const CANDIDATE_BOUND = "/tmp/walkclip-census/bound-symmetric.glb";
const CANDIDATE_CLIP = "openclinxr_retarget_source_walk_symmetric";
const RUNTIME_CLIP = "openclinxr_retarget_walk_source";
const EVIDENCE_ROOT = path.join(REPO_ROOT, ".openclinxr/evidence/loco-ground");

type Quat = [number, number, number, number];

function quatAngleDeg(a: Quat, b: Quat): number {
  const na = Math.hypot(a[0], a[1], a[2], a[3]);
  const nb = Math.hypot(b[0], b[1], b[2], b[3]);
  if (!(na > 0) || !(nb > 0)) return Number.NaN;
  const dot = Math.abs((a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) / (na * nb));
  return ((2 * Math.acos(Math.min(1, dot))) * 180) / Math.PI;
}

function romDeg(track: Quat[]): number {
  let worst = 0;
  for (let i = 0; i < track.length; i += 1) {
    for (let j = i + 1; j < track.length; j += 1) {
      const d = quatAngleDeg(track[i]!, track[j]!);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/** Build the served GLB once: full physician with the candidate under the runtime name. */
export async function ensureServedGlb(): Promise<{ path: string; sha256: string }> {
  const out = path.join(WORKDIR, "physician-candidate.glb");
  if (existsSync(out)) {
    console.log(`REUSE served GLB ${out}`);
    return { path: out, sha256: createHash("sha256").update(readFileSync(out)).digest("hex") };
  }
  mkdirSync(WORKDIR, { recursive: true });
  const io = new NodeIO();
  const grafted = path.join(WORKDIR, "physician-grafted.glb");
  const graft = await graftBoundClip({
    targetPath: PHYSICIAN_GLB,
    sourcePath: CANDIDATE_BOUND,
    clipName: CANDIDATE_CLIP,
    removeClips: [{ clipName: RUNTIME_CLIP, reason: "stage-4 candidate supersedes the shipped walk for this uncommitted test file only" }],
    outputPath: grafted,
  });
  console.log(`grafted channels=${graft.graftedChannels} joints=${graft.graftedJoints}`);
  const document = await io.read(grafted);
  const anim = document.getRoot().listAnimations().find((a) => a.getName() === CANDIDATE_CLIP);
  if (!anim) throw new Error(`grafted clip ${CANDIDATE_CLIP} absent after graft`);
  anim.setName(RUNTIME_CLIP);
  await io.write(out, document);
  const check = await io.read(out);
  const names = check.getRoot().listAnimations().map((a) => a.getName());
  if (!names.includes(RUNTIME_CLIP) || names.includes(CANDIDATE_CLIP)) {
    throw new Error(`rename failed; clips now: ${names.join(",")}`);
  }
  console.log(`served clips include ${RUNTIME_CLIP}; total animations=${names.length}`);
  return { path: out, sha256: createHash("sha256").update(readFileSync(out)).digest("hex") };
}

const AMPLITUDE_JOINTS: ReadonlyArray<{ tap: string; glb: string }> = [
  { tap: "upperleg01L", glb: "upperleg01.L" },
  { tap: "upperleg01R", glb: "upperleg01.R" },
  { tap: "lowerleg01L", glb: "lowerleg01.L" },
  { tap: "lowerleg01R", glb: "lowerleg01.R" },
  { tap: "footL", glb: "foot.L" },
  { tap: "footR", glb: "foot.R" },
];

/** Live (mixer-pose tap) ROM over bound-clip local ROM per leg joint. */
async function amplitudeRatios(tap: TapFrame[], candidateBoundGlb: string): Promise<Record<string, number>> {
  const armed = tap.filter((t) => t.meta.phase === "walking" && t.meta.lockArmed === true);
  const doc = await new NodeIO().read(candidateBoundGlb);
  const anim = doc.getRoot().listAnimations().find((a) => a.getName() === CANDIDATE_CLIP);
  if (!anim) throw new Error(`no clip ${CANDIDATE_CLIP} in ${candidateBoundGlb}`);
  const out: Record<string, number> = {};
  for (const { tap: tapName, glb } of AMPLITUDE_JOINTS) {
    const live: Quat[] = [];
    for (const frame of armed) {
      const q = frame.mixer.quat[tapName];
      if (q) live.push(q as Quat);
    }
    const ch = anim.listChannels().find((c) => c.getTargetNode()?.getName() === glb && c.getTargetPath() === "rotation");
    const values = ch?.getSampler()?.getOutput()?.getArray();
    if (!ch || !values || live.length < 2) throw new Error(`cannot compare ${tapName}: live=${live.length}`);
    const clip: Quat[] = [];
    for (let k = 0; k < values.length; k += 4) clip.push([values[k]!, values[k + 1]!, values[k + 2]!, values[k + 3]!]);
    const liveRom = romDeg(live);
    const clipRom = romDeg(clip);
    out[tapName] = clipRom > 0 ? liveRom / clipRom : Number.NaN;
  }
  return out;
}

export type Stage4Run = {
  subdir: string;
  row: RowReport;
  clip: ClipReport;
  amplitude: Record<string, number>;
  armedFrames: number;
};

export async function analyzeStage4Run(subdir: string, servedGlb: string): Promise<Stage4Run> {
  const raw = JSON.parse(readFileSync(path.join(EVIDENCE_ROOT, subdir, "loco-ground-lockOff.json"), "utf8")) as Parameters<typeof analyzeRow>[1] & { tap: TapFrame[] };
  const row = analyzeRow("lockOff", raw);
  const ev = raw.evidence;
  const route = ev.startWorld !== null && ev.targetWorld !== null
    ? { x: ev.targetWorld.x - ev.startWorld.x, z: ev.targetWorld.z - ev.startWorld.z }
    : { x: 1, z: 0 };
  const routeLen = Math.hypot(route.x, route.z) || 1;
  const info = await readWalkClipInfo(servedGlb);
  const armed = raw.tap.filter((t) => t.meta.phase === "walking" && t.meta.lockArmed === true);
  const clip = analyzeClip(armed, { x: route.x / routeLen, z: route.z / routeLen }, info, row.actionTimeScale);
  const amplitude = await amplitudeRatios(raw.tap, CANDIDATE_BOUND);
  return { subdir, row, clip, amplitude, armedFrames: armed.length };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subdirs = args.flatMap((arg, i) => (arg === "--run" ? [args[i + 1]] : [])).filter((v): v is string => Boolean(v));
  if (subdirs.length === 0) throw new Error("usage: clip-census-stage4.ts --run <subdir> [--run <subdir>...]");
  const served = await ensureServedGlb();
  console.log(`served GLB ${served.path} sha256=${served.sha256.slice(0, 16)}`);
  const runs: Stage4Run[] = [];
  for (const subdir of subdirs) runs.push(await analyzeStage4Run(subdir, served.path));
  const med = (values: number[]): number => {
    const s = values.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
    return s.length === 0 ? Number.NaN : s.length % 2 === 1 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  };
  const summary = {
    schemaVersion: "openclinxr.walk-clip-stage4.v1",
    generatedAt: new Date().toISOString(),
    servedGlb: served.path,
    servedSha256: served.sha256,
    runs: runs.map((r) => ({
      subdir: r.subdir,
      armedFrames: r.armedFrames,
      timeScale: r.row.actionTimeScale,
      amplitudeMin: Math.min(...Object.values(r.amplitude)),
      amplitude: r.amplitude,
      perFoot: {
        left: {
          stationary: r.row.perFoot["left"]?.worldStationaryFraction,
          kinematic: r.row.perFoot["left"]?.kinematicContactFraction,
          swingToeM: r.row.perFoot["left"]?.swingToeHeightMaxM,
          mixerSwingToeM: r.row.perFoot["left"]?.mixerSwingToeHeightMaxM,
          strideM: r.clip.perFoot["left"]?.strideLengthWorldM,
          stanceMps: r.clip.perFoot["left"]?.stanceBackwardBodySpeedMedianMps,
          duty: r.clip.perFoot["left"]?.kinematicDutyFactor,
        },
        right: {
          stationary: r.row.perFoot["right"]?.worldStationaryFraction,
          kinematic: r.row.perFoot["right"]?.kinematicContactFraction,
          swingToeM: r.row.perFoot["right"]?.swingToeHeightMaxM,
          mixerSwingToeM: r.row.perFoot["right"]?.mixerSwingToeHeightMaxM,
          strideM: r.clip.perFoot["right"]?.strideLengthWorldM,
          stanceMps: r.clip.perFoot["right"]?.stanceBackwardBodySpeedMedianMps,
          duty: r.clip.perFoot["right"]?.kinematicDutyFactor,
        },
      },
      steadyRootMps: r.row.steadyRootSpeedMps,
      plannedMps: r.row.plannedSpeedMps,
    })),
  };
  const stridesL = runs.map((r) => r.clip.perFoot["left"]?.strideLengthWorldM ?? Number.NaN);
  const stridesR = runs.map((r) => r.clip.perFoot["right"]?.strideLengthWorldM ?? Number.NaN);
  const strideAsym = 200 * Math.abs(med(stridesL) - med(stridesR)) / (Math.abs(med(stridesL)) + Math.abs(med(stridesR)));
  const verdict = {
    amplitudeMin: Math.min(...runs.map((r) => Math.min(...Object.values(r.amplitude)))),
    timeScaleMed: med(runs.map((r) => r.row.actionTimeScale ?? Number.NaN)),
    strideAsymmetryPct: strideAsym,
    naturalSpeedMps: med(runs.map((r) => r.clip.perFoot["left"]?.stanceBackwardBodySpeedMedianMps ?? Number.NaN)),
  };
  const out = { ...summary, verdict };
  const outPath = path.join(WORKDIR, "stage4-runs.json");
  mkdirSync(WORKDIR, { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(verdict, null, 2));
  console.log(`wrote ${outPath}`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
