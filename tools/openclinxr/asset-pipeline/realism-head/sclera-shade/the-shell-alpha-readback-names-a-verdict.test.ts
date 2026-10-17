import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Card tsk_6c0405833c1f5952: does the three.js lab apply the eye shell's
 * per-vertex alpha? Frames per subject: A shell as baked, B shell with
 * COLOR_0 alpha forced to 0 at runtime, C shell removed from the scene.
 * If alpha were ignored, B would render like A; B equal to C means alpha
 * is applied, so A-vs-C differences come from the baked alpha field.
 *
 * Limitation recorded by the lane manager: the define readback joins the
 * fragment sources of every compiled program, not only the shell's, so
 * USE_COLOR_ALPHA alone does not prove the shell program has it. The
 * B-equals-C frame comparison is the deciding evidence.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT = join(HERE, "shell-alpha-readback-report.json");
const VERDICTS = ["alpha_ignored", "alpha_applied_shell_occludes_iris", "other"] as const;

type Frame = { sha256: string; render: string; irisMeanRGB: { R: number; G: number; B: number }; catchlightPeakL: number; M1: number };
type Subject = {
  A: Frame;
  B: Frame;
  C: Frame;
  irisEuclidBC: number;
  catchlightDeltaBC: number;
  irisFloor: number;
  catchlightNoiseBC: number;
  bEqualsCWithinNoise: boolean;
};
type Report = {
  verdict: string;
  defineReadback: { useColorAlpha: boolean; vec4VColor: boolean; geometryColorItemSize: number };
  aisha: Subject;
  body2: Subject;
};

const report = JSON.parse(readFileSync(REPORT, "utf8")) as Report;

describe("the shell alpha readback names a verdict", () => {
  it("records a verdict from the closed enum", () => {
    expect(VERDICTS).toContain(report.verdict);
  });

  it("records the define readback", () => {
    expect(typeof report.defineReadback.useColorAlpha).toBe("boolean");
    expect(typeof report.defineReadback.vec4VColor).toBe("boolean");
    expect(report.defineReadback.geometryColorItemSize).toBe(4);
  });

  for (const key of ["aisha", "body2"] as const) {
    it(`${key}: three frames with shas and finite metrics`, () => {
      const s = report[key];
      for (const f of [s.A, s.B, s.C]) {
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(f.render.length).toBeGreaterThan(0);
        expect([f.irisMeanRGB.R, f.irisMeanRGB.G, f.irisMeanRGB.B].every(Number.isFinite)).toBe(true);
        expect(Number.isFinite(f.catchlightPeakL)).toBe(true);
        expect(Number.isFinite(f.M1)).toBe(true);
        if (existsSync(f.render)) {
          expect(createHash("sha256").update(readFileSync(f.render)).digest("hex")).toBe(f.sha256);
        }
      }
    });

    it(`${key}: bEqualsCWithinNoise follows from the recorded numbers`, () => {
      const s = report[key];
      const within = s.irisEuclidBC <= s.irisFloor && Math.abs(s.catchlightDeltaBC) <= s.catchlightNoiseBC;
      expect(s.bEqualsCWithinNoise).toBe(within);
    });
  }

  it("the verdict follows the rule", () => {
    const bc = report.aisha.bEqualsCWithinNoise && report.body2.bEqualsCWithinNoise;
    const define = report.defineReadback.useColorAlpha && report.defineReadback.vec4VColor;
    const expected = bc && define ? "alpha_applied_shell_occludes_iris" : !bc || !define ? "alpha_ignored" : "other";
    if (report.verdict !== "other") expect(report.verdict).toBe(expected);
  });
});
