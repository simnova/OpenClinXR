import { describe, expect, it } from "vitest";
import { ENV_DOCTOR_SCHEMA_VERSION, runEnvDoctor } from "./env-doctor.ts";
import path from "node:path";
import { readFileSync } from "node:fs";

describe("env-doctor", () => {
  it("produces a v1 report for the repo root", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../..");
    const report = runEnvDoctor(repoRoot);
    expect(report.schemaVersion).toBe(ENV_DOCTOR_SCHEMA_VERSION);
    expect(report.cwd).toBe(repoRoot);
    expect(["ok", "warn", "fail"]).toContain(report.health);
    expect(report.checks.length).toBeGreaterThan(5);
    expect(report.mcpCliMatrix.some((r) => r.mcpId.includes("playwright"))).toBe(true);
    expect(report.mcpCliMatrix.some((r) => r.recommendation === "prefer_cli")).toBe(true);
    expect(report.pins.miseTools).toBeTruthy();
    expect(report.pins.miseTools?.node).toBe("24");
    expect(report.pins.miseTools?.python).toBe("3.13");
  });
});

describe("toolchain probes are bounded (health-gate flake)", () => {
  /**
   * env-doctor shells out to probe the toolchain via spawnSync with NO timeout. Alone it takes
   * ~5s and passes; under full-gate CPU contention a probe exceeds vitest's default 5s test
   * timeout and the whole suite fails. It surfaced only after the cycle-6 glob fix made 135 tools
   * files run instead of 14 — the flake was always there, hidden with 90% of the suite.
   *
   * The fix is #24's lesson again: bound the wait rather than raise the timeout. A diagnostic tool
   * whose probe cannot answer in a bounded time should REPORT that, not hang the caller. Raising
   * the test timeout would hide contention-sensitivity instead of removing it.
   *
   * Asserted structurally rather than by wall-clock, because a timing assertion is itself flaky.
   */
  it("passes an explicit timeout to every spawnSync probe", () => {
    const source = readFileSync(
      new URL("./env-doctor.ts", import.meta.url),
      "utf8",
    );
    // Strip comments FIRST. Matching raw text was wrong twice over: an explanatory comment pushed
    // the real option past a fixed character window, and a comment merely mentioning "timeout:"
    // would have satisfied the check without bounding anything.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const spawnBlocks = code.split("spawnSync(").slice(1);
    expect(spawnBlocks.length, "expected at least one probe").toBeGreaterThan(0);
    for (const block of spawnBlocks) {
      const options = block.slice(0, block.indexOf("});") + 1);
      expect(options, "spawnSync must be bounded by an explicit timeout").toMatch(/timeout\s*:/);
    }
  });
});
