import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("Quest manual performance checker", () => {
  it("accepts a completed foreground headset report at the current readiness thresholds", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-quest-manual-pass-"));
    const input = path.join(dir, "quest-manual-performance.json");
    const output = path.join(dir, "quest-manual-performance-check.json");
    await writeFile(input, JSON.stringify({
      runContext: { durationMinutes: 10 },
      setup: {
        foregroundPageConfirmed: true,
        devtoolsScreencastDisabled: true,
        extraBrowserWindowsClosed: true,
      },
      station: {
        shellLoaded: true,
        traceInteractionPassed: true,
        textReadable: true,
        consoleErrors: [],
      },
      performance: {
        avgFps: 72,
        p95FrameMs: 25,
        minimumObservedFps: 60,
      },
      comfort: {
        motionComfort: "comfortable",
        heatConcern: false,
      },
    }, null, 2), "utf8");

    await execFileAsync(path.resolve("node_modules/.bin/tsx"), [
      "tools/openclinxr/check-quest-manual-performance.ts",
      "--input",
      input,
      "--output",
      output,
    ], { encoding: "utf8", timeout: 15000 });

    const check = JSON.parse(await readFile(output, "utf8")) as {
      readyToClaimFramePacing: boolean;
      blockers: string[];
      satisfiedConditions: string[];
    };

    expect(check.readyToClaimFramePacing).toBe(true);
    expect(check.blockers).toEqual([]);
    expect(check.satisfiedConditions).toEqual(expect.arrayContaining([
      "foreground_page_confirmed",
      "duration_10_minutes_or_more",
      "average_fps_72_or_higher",
      "p95_frame_ms_25_or_lower",
    ]));
  });

  it("keeps missing comfort and frame metrics as explicit blockers", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-quest-manual-blocked-"));
    const input = path.join(dir, "quest-manual-performance.json");
    const output = path.join(dir, "quest-manual-performance-check.json");
    await writeFile(input, JSON.stringify({
      runContext: { durationMinutes: 2 },
      setup: {
        foregroundPageConfirmed: true,
        devtoolsScreencastDisabled: true,
        extraBrowserWindowsClosed: true,
      },
      station: {
        shellLoaded: true,
        traceInteractionPassed: true,
        textReadable: true,
        consoleErrors: [],
      },
      performance: {
        avgFps: null,
        p95FrameMs: null,
        minimumObservedFps: null,
      },
      comfort: {
        motionComfort: "not_run",
        heatConcern: null,
      },
    }, null, 2), "utf8");

    await execFileAsync(path.resolve("node_modules/.bin/tsx"), [
      "tools/openclinxr/check-quest-manual-performance.ts",
      "--input",
      input,
      "--output",
      output,
    ], { encoding: "utf8", timeout: 15000 });

    const check = JSON.parse(await readFile(output, "utf8")) as {
      readyToClaimFramePacing: boolean;
      blockers: string[];
    };

    expect(check.readyToClaimFramePacing).toBe(false);
    expect(check.blockers).toEqual(expect.arrayContaining([
      "duration_under_10_minutes",
      "average_fps_below_72_or_missing",
      "minimum_fps_below_60_or_missing",
      "p95_frame_ms_above_25_or_missing",
      "motion_comfort_not_confirmed",
      "heat_concern_not_cleared",
    ]));
  });
});
