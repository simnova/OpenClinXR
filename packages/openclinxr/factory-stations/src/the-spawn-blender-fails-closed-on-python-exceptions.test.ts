import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { spawnBlenderProcess } from "./spawn-blender.js";

/**
 * Blender must exit non-zero on an uncaught Python exception (S1 fail-closed).
 *
 * Measured 2026-09-27 on Blender 5.1.1: a script that raises partway through
 * exits 0 by default, so the albedo pass's link-failure RuntimeError never
 * surfaced and the occlusion pass's output overwrote the evidence. The first
 * case below pins that upstream default (raw spawn, no flag -> exit 0); the
 * second proves the RED->GREEN pair: the same raising script through
 * spawnBlenderProcess (which carries --python-exit-code 1) returns non-zero.
 * No Blender scene needed: the probe raises before touching any data.
 */

const execFileAsync = promisify(execFile);

const RAISING_PROBE = `import sys
print("exit-code probe: about to raise")
raise RuntimeError("deliberate probe exception (S1 exit-code RED/GREEN)")
`;

describe("spawnBlenderProcess exits non-zero on an uncaught Python exception", () => {
  it("raw Blender without the flag exits 0 despite the raise (upstream default)", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "blender-exit-probe-"));
    const probe = path.join(work, "raising_probe.py");
    writeFileSync(probe, RAISING_PROBE, "utf8");
    const result = await execFileAsync("blender", ["--background", "--python", probe], {
      timeout: 300_000,
    });
    expect(result.stderr).toContain("deliberate probe exception");
  }, 300_000);

  it("the same raising script through spawnBlenderProcess returns non-zero", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "blender-exit-probe-"));
    const probe = path.join(work, "raising_probe.py");
    writeFileSync(probe, RAISING_PROBE, "utf8");
    const result = await spawnBlenderProcess(
      "blender",
      ["--background", "--python", probe, "--"],
      { cwd: work, timeoutMs: 300_000 },
    );
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("deliberate probe exception");
  }, 300_000);
});
