import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { childEnv, HELD_ENV, jobWidth, parseArgs } from "./heavy-slot.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "heavy-slot.ts");
const tsx = path.resolve(here, "../../../node_modules/.bin/tsx");

describe("jobWidth", () => {
  it("keeps the whole pool within the core count on this 10-core machine shape", () => {
    for (const pool of [1, 2, 3, 4]) {
      const w = jobWidth(10, pool);
      expect(w.turboConcurrency * w.vitestMaxWorkers * pool).toBeLessThanOrEqual(10);
      expect(w.turboConcurrency).toBeGreaterThanOrEqual(1);
      expect(w.vitestMaxWorkers).toBeGreaterThanOrEqual(1);
    }
    expect(jobWidth(10, 2)).toEqual({ turboConcurrency: 2, vitestMaxWorkers: 2 });
  });

  it("never returns zero width, even with more slots than cores", () => {
    expect(jobWidth(2, 8)).toEqual({ turboConcurrency: 1, vitestMaxWorkers: 1 });
  });
});

describe("childEnv", () => {
  it("sets the held marker and the widths", () => {
    const env = childEnv({}, { turboConcurrency: 2, vitestMaxWorkers: 3 });
    expect(env[HELD_ENV]).toBe("1");
    expect(env["TURBO_CONCURRENCY"]).toBe("2");
    expect(env["CELLIX_VITEST_MAX_WORKERS"]).toBe("3");
  });

  it("leaves a caller's explicit widths alone", () => {
    const env = childEnv({ TURBO_CONCURRENCY: "1", CELLIX_VITEST_MAX_WORKERS: "1" }, { turboConcurrency: 4, vitestMaxWorkers: 4 });
    expect(env["TURBO_CONCURRENCY"]).toBe("1");
    expect(env["CELLIX_VITEST_MAX_WORKERS"]).toBe("1");
  });
});

describe("parseArgs", () => {
  it("splits the label from the command at --", () => {
    expect(parseArgs(["pre-push", "--", "tsx", "x.ts", "--profile", "pre-push"])).toEqual({
      label: "pre-push",
      command: ["tsx", "x.ts", "--profile", "pre-push"],
    });
  });

  it("refuses a missing label or a missing command", () => {
    expect(() => parseArgs(["--", "tsx"])).toThrow(/usage/u);
    expect(() => parseArgs(["label", "--"])).toThrow(/usage/u);
    expect(() => parseArgs(["label", "tsx"])).toThrow(/usage/u);
  });
});

describe("heavy-slot process (real lock root, pool of 1)", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function runWrapper(env: NodeJS.ProcessEnv, label: string, shell: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn(tsx, [script, label, "--", "sh", "-c", shell], { env, stdio: ["ignore", "inherit", "inherit"] });
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? -1));
    });
  }

  it("runs two jobs one after the other, and exits with the child's status", async () => {
    root = mkdtempSync(path.join(tmpdir(), "heavy-slot-"));
    const log = path.join(root, "log.txt");
    const env = { ...process.env, OPENCLINXR_LOCK_ROOT: root, OPENCLINXR_SLOTS_HEAVY: "1" };
    delete env[HELD_ENV];
    const job = (name: string, code: number) => `echo ${name} >> ${log}; sleep 1; echo ${name} >> ${log}; exit ${code}`;
    const codes = await Promise.all([runWrapper(env, "a", job("a", 0)), runWrapper(env, "b", job("b", 3))]);
    expect(codes.sort()).toEqual([0, 3]);
    // Serialized: each job's two lines are adjacent (aabb or bbaa), never interleaved.
    expect(["a\na\nb\nb", "b\nb\na\na"]).toContain(readFileSync(log, "utf8").trim());
  }, 120_000);

  it("counterweight: two slots let two jobs run at once (each waits for the other's flag)", async () => {
    root = mkdtempSync(path.join(tmpdir(), "heavy-slot-"));
    const env = { ...process.env, OPENCLINXR_LOCK_ROOT: root, OPENCLINXR_SLOTS_HEAVY: "2" };
    delete env[HELD_ENV];
    // Each job raises its flag, then needs the other's: only possible if both hold a slot together.
    const job = (me: string, other: string) =>
      `touch ${root}/${me}; i=0; while [ ! -e ${root}/${other} ] && [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done; test -e ${root}/${other}`;
    const codes = await Promise.all([runWrapper(env, "a", job("a", "b")), runWrapper(env, "b", job("b", "a"))]);
    expect(codes).toEqual([0, 0]);
  }, 120_000);

  it("a nested call inside a held slot passes through instead of deadlocking on a pool of 1", async () => {
    root = mkdtempSync(path.join(tmpdir(), "heavy-slot-"));
    const env = { ...process.env, OPENCLINXR_LOCK_ROOT: root, OPENCLINXR_SLOTS_HEAVY: "1" };
    delete env[HELD_ENV];
    const nested = `${tsx} ${script} inner -- sh -c 'test "$${HELD_ENV}" = 1'`;
    expect(await runWrapper(env, "outer", nested)).toBe(0);
  }, 120_000);
});
