import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENVIRONMENT_ARTIFACTS_OUTPUT_DIR,
  writeEnvironmentArtifacts,
} from "../environment-artifacts.js";

// Exercises the ACTUAL owned chain writeEnvironmentArtifacts -> initial
// Blender stage (via createLocalComputeServices) with a temp BLENDER
// stand-in executable that logs its PID/readiness then sleeps. Proves
// pre-abort spawns nothing and post-spawn abort kills the process.
// Makes NO claim about real bake quality.
//
// NOTE: String.raw keeps the stand-in's "\n" escape intact through the TS
// template layer so the generated file holds a valid string escape.
const STANDIN_SOURCE = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const me = process.argv[1] ?? "";
const dir = me ? path.dirname(me) : process.cwd();
try {
  fs.writeFileSync(path.join(dir, "standin.pid"), String(process.pid), "utf8");
} catch {}
try {
  fs.appendFileSync(path.join(dir, "standin.args.log"), JSON.stringify(process.argv.slice(2)) + "\n", "utf8");
} catch {}
setTimeout(() => {}, 120_000);
`;

const JOB_TMP_ROOT = process.env["ENV_CANCELLATION_JOB_TMP"] ?? os.tmpdir();

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

describe("environment-artifacts cancellation (owned chain, stand-in BLENDER)", () => {
  it("pre-aborted signal spawns no child", async () => {
    const jobTmp = await mkdtemp(path.join(JOB_TMP_ROOT, "env-cancel-pre-"));
    const prevBlender = process.env["BLENDER"];
    const standin = path.join(jobTmp, "blender-standin");
    process.env["BLENDER"] = standin;
    const controller = new AbortController();
    controller.abort(new Error("pre-aborted"));
    const pending = writeEnvironmentArtifacts({
      outputRoot: path.join(jobTmp, "environment"),
      reportPath: path.join(jobTmp, "environment-artifacts.json"),
      signal: controller.signal,
    });
    pending.catch(() => undefined);
    try {
      await writeFile(standin, STANDIN_SOURCE, "utf8");
      await chmod(standin, 0o755);
      await expect(pending).rejects.toThrow();
      expect(existsSync(path.join(jobTmp, "standin.pid"))).toBe(false);
    } finally {
      controller.abort(new Error("test teardown"));
      await pending.catch(() => undefined);
      if (prevBlender === undefined) delete process.env["BLENDER"];
      else process.env["BLENDER"] = prevBlender;
      await rm(jobTmp, { recursive: true, force: true });
    }
  }, 60_000);

  it("abort after actual spawn kills the process and rejects", async () => {
    const jobTmp = await mkdtemp(path.join(JOB_TMP_ROOT, "env-cancel-active-"));
    const prevBlender = process.env["BLENDER"];
    const standin = path.join(jobTmp, "blender-standin");
    process.env["BLENDER"] = standin;
    const globalScript = path.resolve(ENVIRONMENT_ARTIFACTS_OUTPUT_DIR, "generate-ed-exam-bay-shell.py");
    const globalBefore = existsSync(globalScript) ? await readFile(globalScript) : null;
    const controller = new AbortController();
    await writeFile(standin, STANDIN_SOURCE, "utf8");
    await chmod(standin, 0o755);
    const pending = writeEnvironmentArtifacts({
      outputRoot: path.join(jobTmp, "environment"),
      reportPath: path.join(jobTmp, "environment-artifacts.json"),
      signal: controller.signal,
    });
    pending.catch(() => undefined);
    try {
      const pidFile = path.join(jobTmp, "standin.pid");
      await waitFor(() => existsSync(pidFile), 30_000, "stand-in spawn");
      const pid = Number((await readFile(pidFile, "utf8")).trim());
      expect(Number.isInteger(pid) && pid > 0).toBe(true);
      expect(isAlive(pid)).toBe(true);
      controller.abort(new Error("test-timeout stand-in"));
      await expect(pending).rejects.toThrow();
      await waitFor(() => !isAlive(pid), 15_000, "spawned process death");
      expect(existsSync(path.join(jobTmp, "environment", "generate-ed-exam-bay-shell.py"))).toBe(true);
      const globalAfter = existsSync(globalScript) ? await readFile(globalScript) : null;
      expect(globalAfter?.toString() ?? null).toBe(globalBefore?.toString() ?? null);
    } finally {
      controller.abort(new Error("test teardown"));
      await pending.catch(() => undefined);
      if (prevBlender === undefined) delete process.env["BLENDER"];
      else process.env["BLENDER"] = prevBlender;
      await rm(jobTmp, { recursive: true, force: true });
    }
  }, 60_000);
});
