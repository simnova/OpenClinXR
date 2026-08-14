/**
 * Dark-factory B motion-bind CLI — one MPFB actor + one licence-clean BVH → bound clip.
 *
 *   pnpm asset:motion-bind -- --once
 *   pnpm asset:motion-bind -- --actor <glb> --clip <bvh> --output <glb>
 *
 * Invokes retarget_bvh (GPL-2.0-or-later) at build time only via motion_bind_stage.py.
 * Never a runtime dependency. Does not recolour or overwrite the source actor GLB.
 *
 * claimScope: factory stage that binds one clip to one MPFB armature.
 * notEvidenceFor: clinical motion, Quest readiness, visual walk quality.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");

export const STAGE_ID = "motion_bind_stage";
export const STAGE_SCRIPT = path.join(HERE, "motion_bind_stage.py");
export const TARGET_MAP = path.join(HERE, "known-rigs/mpfb2-default-no-toes.json");
export const DEFAULT_ACTOR = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb",
);
export const DEFAULT_CLIP = path.join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/anny/proof-animations/diag/cmu_07_01_walk.bvh",
);
export const DEFAULT_OUTPUT = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb",
);
export const DEFAULT_REPORT = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind-report.json",
);
export const RETARGET_CLIP_NAME = "openclinxr_retarget_cmu_07_01_walk";
export const PREEXISTING_CLIPS = new Set([
  "ClinicalIdleConversation",
  "ClinicalExpressionMicroTransition",
]);

export type MotionBindClipInfo = {
  name: string;
  channelCount: number;
};

export type MotionBindInspect = {
  animationCount: number;
  clips: MotionBindClipInfo[];
  retargetClip: MotionBindClipInfo | null;
};

function resolveBlender(): string {
  if (process.env.OPENCLINXR_BLENDER && existsSync(process.env.OPENCLINXR_BLENDER)) {
    return process.env.OPENCLINXR_BLENDER;
  }
  if (existsSync("/opt/homebrew/bin/blender")) return "/opt/homebrew/bin/blender";
  return "blender";
}

function runCmd(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, opts.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function isRetargetClipName(name: string): boolean {
  if (PREEXISTING_CLIPS.has(name)) return false;
  return /retarget|cmu|walk|0701/i.test(name);
}

export async function inspectMotionBindOutput(glbPath: string): Promise<MotionBindInspect> {
  if (!existsSync(glbPath) || statSync(glbPath).size < 64) {
    return { animationCount: 0, clips: [], retargetClip: null };
  }
  const io = new NodeIO();
  const doc = await io.read(glbPath);
  const clips: MotionBindClipInfo[] = doc
    .getRoot()
    .listAnimations()
    .map((anim) => ({
      name: anim.getName() || "(unnamed)",
      channelCount: anim.listChannels().length,
    }));
  const retargetClip =
    clips.find((c) => isRetargetClipName(c.name) && c.channelCount > 0) ??
    clips.find((c) => !PREEXISTING_CLIPS.has(c.name) && c.channelCount > 0) ??
    null;
  return { animationCount: clips.length, clips, retargetClip };
}

type CliOpts = {
  once: boolean;
  help: boolean;
  actor: string;
  clip: string;
  output: string;
  report: string;
};

function parseArgs(argv: string[]): CliOpts {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const opts: CliOpts = {
    once: args.includes("--once") || args.length === 0,
    help: args.includes("--help") || args.includes("-h"),
    actor: DEFAULT_ACTOR,
    clip: DEFAULT_CLIP,
    output: DEFAULT_OUTPUT,
    report: DEFAULT_REPORT,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--actor") opts.actor = path.resolve(args[++i] ?? "");
    else if (a === "--clip") opts.clip = path.resolve(args[++i] ?? "");
    else if (a === "--output") opts.output = path.resolve(args[++i] ?? "");
    else if (a === "--report") opts.report = path.resolve(args[++i] ?? "");
  }
  return opts;
}

export async function runMotionBindOnce(opts?: Partial<CliOpts>): Promise<{
  code: number;
  reportPath: string;
  outputPath: string;
  inspect: MotionBindInspect;
}> {
  const actor = opts?.actor ?? DEFAULT_ACTOR;
  const clip = opts?.clip ?? DEFAULT_CLIP;
  const output = opts?.output ?? DEFAULT_OUTPUT;
  const report = opts?.report ?? DEFAULT_REPORT;
  mkdirSync(path.dirname(output), { recursive: true });
  mkdirSync(path.dirname(report), { recursive: true });
  if (!existsSync(STAGE_SCRIPT)) {
    throw new Error(`motion bind stage script missing: ${STAGE_SCRIPT}`);
  }
  const blender = resolveBlender();
  const result = await runCmd(
    blender,
    [
      "--background",
      "--python",
      STAGE_SCRIPT,
      "--",
      "--actor",
      actor,
      "--clip",
      clip,
      "--map",
      TARGET_MAP,
      "--output",
      output,
      "--report",
      report,
    ],
    { cwd: REPO_ROOT, timeoutMs: 300_000 },
  );
  if (result.code !== 0) {
    const reportText = existsSync(report) ? readFileSync(report, "utf8") : "";
    throw new Error(
      `motion_bind_stage exit ${result.code}\n${result.stderr.slice(-2500)}\n${reportText.slice(0, 1500)}`,
    );
  }
  const inspect = await inspectMotionBindOutput(output);
  return { code: result.code, reportPath: report, outputPath: output, inspect };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      "usage: pnpm asset:motion-bind -- --once | --actor <glb> --clip <bvh> --output <glb>",
    );
    return;
  }
  const out = await runMotionBindOnce(opts);
  console.log(
    JSON.stringify(
      {
        stageId: STAGE_ID,
        output: out.outputPath,
        report: out.reportPath,
        retargetClip: out.inspect.retargetClip,
      },
      null,
      2,
    ),
  );
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
