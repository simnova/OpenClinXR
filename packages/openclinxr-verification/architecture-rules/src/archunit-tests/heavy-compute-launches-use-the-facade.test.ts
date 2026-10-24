import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkDirectComputeLaunchFreeze,
  checkDirectComputeLaunchFreezeIsHonest,
  countDirectComputeLaunchesInSource,
  DIRECT_COMPUTE_LAUNCH_CEILING,
  DIRECT_COMPUTE_LAUNCH_INITIAL_COUNT,
  measureDirectComputeLaunches,
} from "../checks/direct-compute-launch-freeze.ts";

describe("heavy local compute launches use the compute-services facade", () => {
  it("keeps the real tree at its shrink-only ceiling", () => {
    const sites = measureDirectComputeLaunches();
    expect(checkDirectComputeLaunchFreeze(DIRECT_COMPUTE_LAUNCH_CEILING, sites)).toEqual([]);
    expect(checkDirectComputeLaunchFreezeIsHonest(DIRECT_COMPUTE_LAUNCH_CEILING, sites)).toEqual([]);
    expect(sites).toHaveLength(DIRECT_COMPUTE_LAUNCH_CEILING);
  });

  it("fails when new direct launchers are planted in a fixture", () => {
    const planted = [
      'spawn("blender", ["--background"]);',
      'spawn("/opt/trellis/.venv/bin/python", ["run.py"]);',
      "await chromium.launch({ headless: true });",
    ].join("\n");
    const sites = countDirectComputeLaunchesInSource(planted, "planted.ts");
    expect(sites.map((site) => site.kind)).toEqual(["blender", "ml-python", "chromium"]);
    expect(checkDirectComputeLaunchFreeze(0, sites)[0]).toContain("do NOT raise the ceiling");
  });

  it("shows the four migrated sites, including ward capture, paid the count down", () => {
    expect(DIRECT_COMPUTE_LAUNCH_INITIAL_COUNT - DIRECT_COMPUTE_LAUNCH_CEILING).toBe(4);
  });

  it("does not mistake comments or strings for launches", () => {
    expect(countDirectComputeLaunchesInSource('// chromium.launch()\nconst note = "spawn(blender)";')).toEqual([]);
  });

  it("excludes artifact/worktree containers and nested checkouts but counts real source", () => {
    const root = mkdtempSync(join(tmpdir(), "compute-freeze-"));
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    const launcher = "await chromium.launch({ headless: true });\n";
    const copied = join(root, ".claude", "worktrees", "copy");
    mkdirSync(copied, { recursive: true });
    writeFileSync(join(copied, "copied.ts"), launcher);
    const generated = join(root, ".openclinxr", "candidates");
    mkdirSync(generated, { recursive: true });
    writeFileSync(join(generated, "generated.ts"), launcher);
    const nested = join(root, "tools", "nested-checkout");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, ".git"), "gitdir: elsewhere\n");
    writeFileSync(join(nested, "nested.ts"), launcher);
    const real = join(root, "tools", "real");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "check.ts"), launcher);
    const sites = measureDirectComputeLaunches(root);
    expect(sites.map((site) => site.file)).toEqual(["tools/real/check.ts"]);
  });
});
