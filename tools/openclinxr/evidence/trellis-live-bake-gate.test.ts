import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * PLANTED CONTRACT (#273). Live TRELLIS bake must be opt-in, never a default.
 *
 * #237's isolation guarantee is proven by a live bake and must stay reachable —
 * this contract's middle row is the counterweight that keeps the gate openable,
 * so the fix cannot silently become a permanent disable (the #40 mistake).
 *
 * The bake cache lives under .openclinxr/evidence/ (gitignored), absent by design
 * in every git worktree. The default suite (`pnpm test:tools` -> `vitest run tools/`,
 * 13 explicit excludes, none TRELLIS) reaches trellis-metal-subject-isolation.ts,
 * so any worker running a broad test command used to re-bake from scratch
 * (measured: ~30 min per subject at ~600% CPU).
 *
 * WIRING PROOF METHOD — INJECTED RUNNER + TEMP CACHE DIR (chosen over a naive
 * integration test because a naive RED here spawns a three-hour bake; chosen over
 * source-text-only because an injected runner proves the gate's control flow
 * behaviorally). spawnPythonBake accepts deps.runBake / deps.env / deps.outputDir;
 * the tests inject a stub runner that records whether it was called, so the
 * wiring is proven without any path that can spawn a real TRELLIS process.
 * A source-text assertion pins that the module's ONLY execFile spawn site lives
 * inside runBakeProcess, behind the gate's allow branch.
 *
 * Header IMMUTABLE — append ## FIXED (#273).
 */

const load = () =>
  import("./trellis-metal-subject-isolation.js") as Promise<Record<string, unknown>>;

type SpawnProbe = (
  subject: unknown,
  deps?: unknown,
) => Promise<{ verdict?: string; verdictReason?: string }>;

describe("TRELLIS live-bake gate (#273)", () => {
  it("gate table: refuse without opt-in, allow with opt-in, use cache when present", async () => {
    const mod = await load();
    const gate = mod["trellisLiveBakeGate"] as (
      input: { optIn: boolean; cachePresent: boolean },
    ) => string;
    expect(gate).toBeTypeOf("function");
    expect(gate({ optIn: false, cachePresent: false })).toBe("refuse_opt_in_required");
    expect(gate({ optIn: true, cachePresent: false })).toBe("allow_live_bake");
    expect(gate({ optIn: false, cachePresent: true })).toBe("use_cache");
  });

  it("default env + no cache: refuses the live bake and does NOT call the runner", async () => {
    const mod = await load();
    const spawn = mod["spawnPythonBake"] as SpawnProbe;
    expect(spawn).toBeTypeOf("function");

    let runCalled = false;
    const tmp = mkdtempSync(path.join(os.tmpdir(), "trellis-gate-refuse-"));
    try {
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env["TRELLIS_LIVE_BAKE_OPT_IN"];
      const result = await spawn(
        { subjectId: "probe-refuse", displayName: "probe", inputImage: "/nonexistent/input.png" },
        {
          runBake: () => {
            runCalled = true;
            throw new Error("runBake must not be called without opt-in");
          },
          env,
          outputDir: tmp,
        },
      );
      expect(runCalled).toBe(false);
      expect(result.verdict).toBe("blocked_build");
      expect(String(result.verdictReason)).toMatch(/TRELLIS_LIVE_BAKE_OPT_IN|opt in|refused/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("COUNTERWEIGHT: opt-in env reaches the bake runner (injected stub, no real bake)", async () => {
    const mod = await load();
    const spawn = mod["spawnPythonBake"] as SpawnProbe;
    let runCalled = false;
    const tmp = mkdtempSync(path.join(os.tmpdir(), "trellis-gate-allow-"));
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, TRELLIS_LIVE_BAKE_OPT_IN: "1" };
      const result = await spawn(
        { subjectId: "probe-allow", displayName: "probe", inputImage: "/nonexistent/input.png" },
        {
          runBake: async () => {
            runCalled = true;
            return {
              subjectId: "probe-allow",
              verdict: "mesh_exported",
              verdictReason: "injected runner stub — no real bake",
              rawTriangleCount: 42,
              exportPath: null,
              exportBytes: null,
              wallClockS: 0.001,
              processIsolation: "fresh_subprocess",
              stages: {},
            };
          },
          env,
          outputDir: tmp,
        },
      );
      expect(runCalled).toBe(true);
      expect(result.verdict).toBe("mesh_exported");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("cache present: uses the cached bake without calling the runner, even without opt-in", async () => {
    const mod = await load();
    const spawn = mod["spawnPythonBake"] as SpawnProbe;
    let runCalled = false;
    const tmp = mkdtempSync(path.join(os.tmpdir(), "trellis-gate-cache-"));
    try {
      writeFileSync(
        path.join(tmp, "bake-measure.json"),
        JSON.stringify({
          subjectId: "probe-cache",
          verdict: "mesh_exported",
          verdictReason: "pre-seeded cache",
          rawTriangleCount: 7,
          processIsolation: "fresh_subprocess",
          stages: {},
        }),
      );
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env["TRELLIS_LIVE_BAKE_OPT_IN"];
      const result = await spawn(
        { subjectId: "probe-cache", displayName: "probe", inputImage: "/nonexistent/input.png" },
        {
          runBake: () => {
            runCalled = true;
            throw new Error("runBake must not be called when a usable cache is present");
          },
          env,
          outputDir: tmp,
        },
      );
      expect(runCalled).toBe(false);
      expect(result.verdict).toBe("mesh_exported");
      expect(result.verdictReason).toBe("pre-seeded cache");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("wiring (source-text): the ONLY execFile spawn site lives in runBakeProcess, reached only via the gate's allow branch", () => {
    const src = readFileSync(
      new URL("./trellis-metal-subject-isolation.ts", import.meta.url),
      "utf-8",
    );

    // Exactly one spawn site in the whole module.
    const execCalls = src.match(/execFile\(/g) ?? [];
    expect(execCalls.length).toBe(1);

    // It lives inside runBakeProcess (the production runner).
    const runBakeStart = src.indexOf("function runBakeProcess");
    const spawnSite = src.indexOf("execFile(");
    expect(runBakeStart).toBeGreaterThan(-1);
    expect(spawnSite).toBeGreaterThan(runBakeStart);

    // spawnPythonBake consults the gate and returns refused before any runner.
    const spawnFnStart = src.indexOf("export function spawnPythonBake");
    const allowBranch = src.indexOf('// decision === "allow_live_bake"');
    expect(spawnFnStart).toBeGreaterThan(-1);
    expect(allowBranch).toBeGreaterThan(spawnFnStart);
    const spawnFn = src.slice(spawnFnStart, allowBranch);
    expect(spawnFn).toMatch(/trellisLiveBakeGate\(/);
    expect(spawnFn).toMatch(/refuse_opt_in_required/);
    expect(spawnFn).toMatch(/return Promise\.resolve\(refused\)/);

    // The allow branch is the only path that reaches the runner.
    const allowToEnd = src.slice(allowBranch, src.indexOf("// ---------------------------------------------------------------------------", allowBranch));
    expect(allowToEnd).toMatch(/allow_live_bake/);
    expect(allowToEnd).toMatch(/runBakeProcess/);
  });
});
