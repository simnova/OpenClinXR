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

  it("shows the three migrated sites paid the count down", () => {
    expect(DIRECT_COMPUTE_LAUNCH_INITIAL_COUNT - DIRECT_COMPUTE_LAUNCH_CEILING).toBe(3);
  });

  it("does not mistake comments or strings for launches", () => {
    expect(countDirectComputeLaunchesInSource('// chromium.launch()\nconst note = "spawn(blender)";')).toEqual([]);
  });
});
