import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { captureIsolatedFootGrounder } from "./capture.js";

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("isolated-foot-grounder capture", () => {
  it("samples both feet and produces a not-gradeable report with named refusals", async () => {
    const outputDir = ".openclinxr/evidence/isolated-foot-grounder/test-run";
    // Pass the report path explicitly. Without it the capture writes the TRACKED report and this
    // test reads a ${outputDir}/report.json nobody wrote — it passed only while a stale test-run
    // directory from an earlier run happened to hold one, and failed ENOENT on a clean checkout
    // (integrate #717 caught exactly that against the merged tree).
    const report = await captureIsolatedFootGrounder(outputDir, `${outputDir}/report.json`);

    // Verify the report exists and has the required schema
    expect(report.schemaVersion).toBe("openclinxr.isolated-foot-grounder.v1");
    expect(report.generatedAt).toBeDefined();
    expect(report.headSha).toBeDefined();

    // Verify asset identity (positive counterweight)
    expect(report.assetIdentity.assetPath).toBe(
      "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb"
    );
    expect(report.assetIdentity.sha256).toBe(
      "63a4c9dec2065aae38d0e3336fc4a46be2de647354848cebe8269564c01d4b13"
    );
    expect(report.assetIdentity.bytes).toBeGreaterThan(0);

    // Verify clip identity (positive counterweight)
    expect(report.clipIdentity.caseFrozenClipRevision).toBe(
      "openclinxr_retarget_walk_formal_cc0"
    );
    expect(report.clipIdentity.liveClipStamp).toBeDefined();
    expect(report.clipIdentity.match).toBe(true);

    // Verify drive source reflects absent prerequisite (refusal assertion)
    expect(report.driveSource).toBeNull();

    // Verify floor frame reflects absent prerequisite (refusal assertion)
    expect(report.floorFrame).toBeNull();

    // Verify both feet were sampled (positive counterweight)
    const hasLeft = report.samples.some(
      (s) => s.leftHeel !== null || s.leftToe !== null
    );
    const hasRight = report.samples.some(
      (s) => s.rightHeel !== null || s.rightToe !== null
    );
    expect(hasLeft).toBe(true);
    expect(hasRight).toBe(true);

    // Verify samples have per-frame data (positive counterweight)
    expect(report.samples.length).toBe(120);
    expect(report.cadence.sampleCount).toBe(120);
    for (const sample of report.samples) {
      expect(sample.frame).toBeGreaterThanOrEqual(0);
      expect(sample.atMs).toBeGreaterThan(0);
      expect(typeof sample.phase).toBe("string");
      expect(typeof sample.locomotion).toBe("number");
    }

    // Verify cadence fields present and finite (positive counterweight)
    expect(report.cadence.sampleCount).toBe(report.samples.length);
    expect(typeof report.cadence.maxOverMedian).toBe("number");
    expect(Number.isFinite(report.cadence.maxOverMedian)).toBe(true);
    expect(typeof report.cadence.medianStrideMeters).toBe("number");
    expect(Number.isFinite(report.cadence.medianStrideMeters)).toBe(true);
    expect(typeof report.cadence.hz).toBe("number");
    expect(Number.isFinite(report.cadence.hz)).toBe(true);

    // Verify grade.ok is false with named problems (refusal assertions)
    expect(report.grade.ok).toBe(false);
    expect(Array.isArray(report.grade.problems)).toBe(true);
    expect(report.grade.problems.length).toBeGreaterThan(0);

    // Verify named failure classes appear in problems (stable substrings)
    const problems = report.grade.problems.join(" ");
    expect(problems).toContain("drive-source prerequisite timed out");
    expect(problems).toContain("environment prerequisite timed out");
    expect(problems).toContain("required case_owned_bedside_approach");
    expect(problems).toContain("maxOverMedian");
    expect(problems).toContain("median stride");
    expect(problems).toContain("no floor frame observed");

    // Verify screenshots exist and hashes match (positive counterweight)
    expect(report.screenshots.length).toBeGreaterThan(0);
    for (const ss of report.screenshots) {
      const buf = await readFile(ss.path);
      const actualSha = sha256Hex(buf);
      expect(actualSha).toBe(ss.sha256);
    }

    // Verify report.json was written and has minimum size
    const reportPath = `${outputDir}/report.json`;
    const reportBuf = await readFile(reportPath);
    expect(reportBuf.byteLength).toBeGreaterThanOrEqual(256);
    const parsed = JSON.parse(reportBuf.toString("utf8"));
    expect(parsed.schemaVersion).toBe("openclinxr.isolated-foot-grounder.v1");
  }, 300_000); // 5 minute timeout for browser capture
});