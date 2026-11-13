import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCaptureAfterLatch,
  createDeferredErrorCollector,
  RR1_CAPTURE_ASSERTION_SITES,
  RR1_SETUP_THROW_ALLOWLIST,
  writeEvidenceBeforeDeferredErrors,
} from "./rr1-run.mjs";

const RUNNER = new URL("./rr1-run.mjs", import.meta.url);

describe("RR1 capture-path deferred failure order", () => {
  for (const site of RR1_CAPTURE_ASSERTION_SITES) {
    it(`writes all required evidence before ${site} fails`, () => {
      const directory = mkdtempSync(join(tmpdir(), `rr1-deferred-${site}-`));
      const required = ["capture.json", "chapters.json", "faculty-layout-log.json"];
      const collector = createDeferredErrorCollector();
      collector.capture(site, () => {
        throw new Error(`injected ${site}`);
      });
      expect(() => writeEvidenceBeforeDeferredErrors(() => {
        for (const name of required) writeFileSync(join(directory, name), `${JSON.stringify({ site })}\n`);
      }, collector.errors)).toThrow(`${site}: injected ${site}`);
      expect(required.map((name) => existsSync(join(directory, name)))).toEqual([true, true, true]);
    });
  }

  it("has no direct throw between first recording start and the deferred collector", () => {
    const source = readFileSync(RUNNER, "utf8");
    const start = source.indexOf("// RR1_CAPTURE_THROW_SCAN_START");
    const end = source.indexOf("// RR1_CAPTURE_THROW_SCAN_END");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const violations = source.slice(start, end).split(/\r?\n/u)
      .map((line, index) => ({ line: source.slice(0, start).split(/\r?\n/u).length + index, text: line.trim() }))
      .filter((entry) => /\bthrow\b/u.test(entry.text));
    expect(violations, `capture-path throw sites: ${JSON.stringify(violations)}`).toEqual([]);
  });

  it("routes every named assertion site through the run's one collector", () => {
    const source = readFileSync(RUNNER, "utf8");
    const capture = source.slice(source.indexOf("async function runCapture"));
    const missing = RR1_CAPTURE_ASSERTION_SITES.filter((site) => !capture.includes(`"${site}"`));
    expect(missing, `unrouted deferred assertion sites: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it("names every permitted pre-recording throw with a reason", () => {
    expect(RR1_SETUP_THROW_ALLOWLIST.map((entry) => entry.site)).toEqual([
      "required-build-inputs",
      "scenario-patient",
      "learner-static-start",
      "browser-launch",
      "recording-context-init",
    ]);
    expect(RR1_SETUP_THROW_ALLOWLIST.every((entry) => entry.reason.length > 20)).toBe(true);
  });

  it("lets a planted collector failure exit code 1 after closing its active replay-server handle", () => {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { closeRr1Handles, createDeferredErrorCollector, writeEvidenceBeforeDeferredErrors } from ${JSON.stringify(RUNNER.href)};
      const activeHandle = setInterval(() => undefined, 1000);
      const replayServer = { close: async () => clearInterval(activeHandle) };
      const collector = createDeferredErrorCollector();
      collector.reject("planted", "collector rejection");
      try {
        writeEvidenceBeforeDeferredErrors(() => undefined, collector.errors);
      } catch (error) {
        await closeRr1Handles({ replayServer });
        console.error(String(error.message));
        process.exitCode = 1;
      }
    `], { encoding: "utf8" });
    expect(child.signal).toBeNull();
    expect(child.status).toBe(1);
    expect(child.stderr).toContain("planted: collector rejection");
  });

  describe("interior preview latch gate (rr1latch RED)", () => {
    it("refuses a chapter capture with no latch wall clock", () => {
      expect(() => assertCaptureAfterLatch({
        artifact: "frames/ch1.png",
        captureStartedWallMs: 1794523137389,
        latchWallMs: undefined,
      })).toThrow(/latch/);
    });

    it("refuses a chapter capture started before the latch", () => {
      expect(() => assertCaptureAfterLatch({
        artifact: "frames/ch1.png",
        captureStartedWallMs: 1794523137389,
        latchWallMs: 1794523139409,
      })).toThrow(/latch/);
    });

    it("accepts a chapter capture started after the latch", () => {
      expect(() => assertCaptureAfterLatch({
        artifact: "frames/ch1.png",
        captureStartedWallMs: 1794523139500,
        latchWallMs: 1794523139409,
      })).not.toThrow();
    });

    it("accepts a chapter capture started exactly at the latch", () => {
      expect(() => assertCaptureAfterLatch({
        artifact: "frames/ch1.png",
        captureStartedWallMs: 1794523139409,
        latchWallMs: 1794523139409,
      })).not.toThrow();
    });
  });
});
