import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runRoomGenerate } from "../index.js";

// Public-API GENERATE-path abort regression for runRoomGenerate through the
// public barrel (../index.js), never private modules. The Infinigen GENERATE
// step runs only when footprintMeters is present; these tests drive it with a
// local executable stand-in PYTHON (venvPython) that logs its PID then
// sleeps, plus a stubbed Infinigen source tree (generate_indoors.py +
// patched decorate.py) so the fail-closed source checks pass with no real
// Infinigen, Blender, or network. Distinct test names from the bake-path
// abort tests so the existing post-spawn bake/probe selection still matches
// exactly one test.
const STANDIN_SOURCE = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const me = process.argv[1] ?? "";
const dir = me ? path.dirname(me) : process.cwd();
try {
  fs.writeFileSync(path.join(dir, "generate-standin.pid"), String(process.pid), "utf8");
} catch {}
setTimeout(() => {}, 120_000);
`;

const JOB_TMP_ROOT = process.env["OPENCLINXR_JOB_TMP"] ?? os.tmpdir();

const GENERATE_PRE_ABORT_REASON = "generate pre-aborted probe";
const GENERATE_POST_ABORT_REASON = "generate post-spawn abort";

function validGenerateInput() {
  return {
    environmentId: "generate-abort-probe",
    infinigenPrompt: "generate abort probe",
    seed: 7,
    layoutVariant: "exam-bay",
    footprintMeters: { width: 3, depth: 4, ceilingHeight: 2.7 },
    door: { doorWall: "+y", hingeSide: "+x" },
  };
}

async function writeGenerateStandins(jobTmp: string): Promise<{ standin: string; source: string }> {
  const standin = path.join(jobTmp, "venv-python-standin");
  await writeFile(standin, STANDIN_SOURCE, "utf8");
  await chmod(standin, 0o755);
  const source = path.join(jobTmp, "infinigen-source");
  const examples = path.join(source, "infinigen_examples");
  const solver = path.join(source, "infinigen/core/constraints/example_solver/room");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(examples, { recursive: true });
  await mkdir(solver, { recursive: true });
  await writeFile(path.join(examples, "generate_indoors.py"), "# stub\n", "utf8");
  await writeFile(
    path.join(solver, "decorate.py"),
    '# stub\nOPENCLINXR_ROOM_REALISM = 1\nWALL = "Concrete"\n',
    "utf8",
  );
  return { standin, source };
}

async function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("runRoomGenerate GENERATE-path abort (public API, stand-in PYTHON)", () => {
  it("generate pre-aborted signal spawns no generate child and releases the slot", async () => {
    const jobTmp = await mkdtemp(path.join(JOB_TMP_ROOT, "room-gen-gen-pre-"));
    try {
      const { standin, source } = await writeGenerateStandins(jobTmp);
      const workGlb = path.join(jobTmp, "work.glb");
      await writeFile(workGlb, "glb-fixture", "utf8");
      const controller = new AbortController();
      controller.abort(new Error(GENERATE_PRE_ABORT_REASON));
      await expect(
        runRoomGenerate(validGenerateInput(), {
          blender: standin,
          workGlb,
          cwd: jobTmp,
          timeoutMs: 30_000,
          bakeAlbedo: false,
          bakeOcclusion: false,
          simplifyAfterBake: false,
          infinigenSource: source,
          venvPython: standin,
          signal: controller.signal,
        }),
      ).rejects.toThrow(GENERATE_PRE_ABORT_REASON);
      expect(existsSync(path.join(jobTmp, "generate-standin.pid"))).toBe(false);
    } finally {
      await rm(jobTmp, { recursive: true, force: true });
    }
    expect(existsSync(jobTmp)).toBe(false);
  });

  it("generate post-spawn abort kills the owned generate child and cleans temp", async () => {
    const jobTmp = await mkdtemp(path.join(JOB_TMP_ROOT, "room-gen-gen-post-"));
    let childPid = 0;
    let pending: Promise<unknown> | null = null;
    try {
      const { standin, source } = await writeGenerateStandins(jobTmp);
      const workGlb = path.join(jobTmp, "work.glb");
      await writeFile(workGlb, "glb-fixture", "utf8");
      const controller = new AbortController();
      pending = runRoomGenerate(validGenerateInput(), {
        blender: standin,
        workGlb,
        cwd: jobTmp,
        timeoutMs: 120_000,
        bakeAlbedo: false,
        bakeOcclusion: false,
        simplifyAfterBake: false,
        infinigenSource: source,
        venvPython: standin,
        signal: controller.signal,
      });
      pending.catch(() => {});
      const pidFile = path.join(jobTmp, "generate-standin.pid");
      await waitFor(() => existsSync(pidFile), 30_000, "generate stand-in spawn");
      childPid = Number(await readFile(pidFile, "utf8"));
      expect(Number.isFinite(childPid) && childPid > 0).toBe(true);
      controller.abort(new Error(GENERATE_POST_ABORT_REASON));
      await expect(
        Promise.race([
          pending,
          new Promise((_, reject) => setTimeout(() => reject(new Error("generate post-abort settlement exceeded 2s")), 2_000)),
        ]),
      ).rejects.toThrow(GENERATE_POST_ABORT_REASON);
      await waitFor(() => !isAlive(childPid), 15_000, "generate child reaped");
    } finally {
      if (childPid > 0 && isAlive(childPid)) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {}
      }
      if (pending !== null) {
        await Promise.race([pending.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2_000))]);
      }
      await rm(jobTmp, { recursive: true, force: true });
    }
    expect(existsSync(jobTmp)).toBe(false);
  });
});
