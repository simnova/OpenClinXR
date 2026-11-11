#!/usr/bin/env node
/**
 * RR1 site capture plan (card W0b).
 *
 * The site reuses the proven xr-sync runners by spawning them as child
 * processes. Nothing is copied out of the runners: this file only records
 * which runner covers each RR1 chapter and which A1 capture.json fields
 * every chaptered run records.
 *
 * Chapter map (PLAN-draft.md section 7, RR1 CH1-CH5):
 *   CH1 doorway plus station label      -> c36-run.mjs
 *   CH2 spoken turn with authored reply -> c36-run.mjs
 *   CH3 patient note                    -> c11-run.mjs
 *   CH4 station end, break, next door   -> c7-run.mjs
 *   CH5 lobby replay, marks, lock       -> c14-run.mjs
 *
 * Server plan: per-runner. The shared parseArgs helper only accepts
 * --mode, --serial and --out, so no runner can attach to an already
 * running sync server; each runner boots and owns its own stack (for
 * example the c36 startStack helper spawns the dev portless server).
 * The runners themselves are never modified.
 *
 * Usage:
 *   node rr1.mjs --dry-run --out <dir> [--chapters CH1,CH2]
 *   node rr1.mjs --out <dir> [--chapters CH1,CH2]
 * The dry run prints the plan as JSON and spawns nothing. Without it
 * each argv entry runs in order and <out>/capture.json is written.
 */
import { execSync, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CAPTURE_HOME = fileURLToPath(new URL(".", import.meta.url));
const RUNNER_HOME = resolve(CAPTURE_HOME, "..", "..", "xr-sync");
const TREE_TOP = resolve(CAPTURE_HOME, "..", "..", "..", "..", "..");

const CHAPTER_TO_RUNNER = {
  CH1: "c36-run.mjs",
  CH2: "c36-run.mjs",
  CH3: "c11-run.mjs",
  CH4: "c7-run.mjs",
  CH5: "c14-run.mjs",
};
const ALL_CHAPTERS = ["CH1", "CH2", "CH3", "CH4", "CH5"];

function readBuildSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: TREE_TOP, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function planCapture({ chapters = ALL_CHAPTERS, out, dryRun = false } = {}) {
  if (typeof dryRun !== "boolean") throw new Error("dryRun must be a boolean");
  if (typeof out !== "string" || out === "") throw new Error("--out <dir> is required");
  const wanted = [...new Set(chapters)];
  for (const id of wanted) {
    if (Object.hasOwn(CHAPTER_TO_RUNNER, id) === false) throw new Error(`unknown RR1 chapter: ${id}`);
  }
  const targetRoot = resolve(out);
  const argv = wanted.map((id) => [
    "node",
    join(RUNNER_HOME, CHAPTER_TO_RUNNER[id]),
    "--mode",
    "host",
    "--out",
    join(targetRoot, id),
  ]);
  const captureJson = {
    buildSha: readBuildSha(),
    seed: "rr1",
    blueprintId: "ed-chest-pain",
    cameraPreset: "iwer-first-person",
    clientRoles: ["learner", "faculty"],
    ffmpeg: { version: null, args: null },
  };
  const serverPlan = {
    mode: "per-runner",
    reason: "runner_owns_stack",
    evidence: "tools/openclinxr/evidence/xr-sync/c36-run.mjs:54",
  };
  return { argv, captureJson, serverPlan };
}

function parseCliArgs(raw) {
  const parsed = { dryRun: false, out: null, chapters: [...ALL_CHAPTERS] };
  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    if (token === "--dry-run") {
      parsed.dryRun = true;
    } else if (token === "--out") {
      parsed.out = raw[i + 1];
      i += 1;
    } else if (token === "--chapters") {
      parsed.chapters = String(raw[i + 1]).split(",").map((part) => part.trim()).filter(Boolean);
      i += 1;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  if (typeof parsed.out !== "string" || parsed.out === "") throw new Error("--out <dir> is required");
  return parsed;
}

function spawnRunner(cmd) {
  return new Promise((finish, fail) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit" });
    child.on("error", fail);
    child.on("close", (code) => {
      if (code === 0) finish();
      else fail(new Error(`runner exited ${code}: ${cmd[1]}`));
    });
  });
}

async function runCli(raw) {
  const cli = parseCliArgs(raw);
  const plan = planCapture(cli);
  if (cli.dryRun) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  const targetRoot = resolve(cli.out);
  for (const cmd of plan.argv) await spawnRunner(cmd);
  await mkdir(targetRoot, { recursive: true });
  const payload = `${JSON.stringify(plan.captureJson, null, 2)}\n`;
  await writeFile(join(targetRoot, "capture.json"), payload, "utf8");
}

const invokedAsScript = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(String(error?.message ?? error));
    process.exitCode = 1;
  });
}
