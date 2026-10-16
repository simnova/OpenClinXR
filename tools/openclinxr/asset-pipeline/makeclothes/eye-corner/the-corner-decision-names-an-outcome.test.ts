import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The corner decision names an outcome (tsk_269eccc5a315a65f).
 *
 * corner-decision.json re-runs the eye-corner fill (derived on the
 * PRE-lid-conform eye3 bake) on the two lid-conformed heads (Aisha +
 * body2) and records per subject {g1Base, g1Fill, g2FillOutsidePx,
 * renders+sha256} plus one decision in {land, rework, drop, other}.
 *
 * Rules (from the card):
 * - land: fill >= base on every outer crop AND > base on >= 1 far-eye
 *   crop (yaw40-L-outer, yaw-40-R-outer) AND G2 0 px on both subjects.
 * - drop: the conformed base already reaches frontal on the outer crops,
 *   OR the fill changes no outer crop by more than the run-to-run noise.
 * - rework: the fill helps (any outer fill > base) but G2 fails
 *   (unionOutside > 0) or it visibly floats off the conformed lid.
 * - other: anything else, explained in `reason`.
 *
 * The test recomputes the outcome from the recorded numbers and asserts
 * the named decision matches. Pure JSON: no store dependency.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../../..");
const DECISION = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eye-corner/corner-decision.json",
);

const SUBJECTS = ["aisha", "body2"] as const;
const VIEWS = ["front", "yaw40", "yaw-40"] as const;
const SIDES = ["L", "R"] as const;
const FAR_EYE: ReadonlyArray<readonly [string, string]> = [
  ["yaw40", "L"],
  ["yaw-40", "R"],
];

type Cell = { frac: number; headPx: number; bg: number };
type Subject = {
  g1Base: Record<string, Record<string, Cell>>;
  g1Fill: Record<string, Record<string, Cell>>;
  g2FillOutsidePx: number;
  renders: Array<{ file: string; sha256: string }>;
  floatsOffLid: boolean;
};

function decision(): {
  decision: string;
  reason: string;
  subjects: Record<string, Subject>;
  noise: { maxAbsG1Delta: number };
} {
  return JSON.parse(readFileSync(DECISION, "utf8")) as {
    decision: string;
    reason: string;
    subjects: Record<string, Subject>;
    noise: { maxAbsG1Delta: number };
  };
}

function recompute(d: ReturnType<typeof decision>): string {
  const noise = d.noise.maxAbsG1Delta;
  const g2ok = SUBJECTS.every((s) => d.subjects[s].g2FillOutsidePx === 0);
  const landPer = (s: string): boolean =>
    VIEWS.every((v) =>
      SIDES.every(
        (side) => d.subjects[s].g1Fill[v][side].frac >= d.subjects[s].g1Base[v][side].frac,
      ),
    );
  const farEyeGain = (s: string): boolean =>
    FAR_EYE.some(
      ([v, side]) => d.subjects[s].g1Fill[v][side].frac > d.subjects[s].g1Base[v][side].frac,
    );
  const land =
    g2ok && SUBJECTS.every(landPer) && SUBJECTS.some(farEyeGain);
  const baseReachesFrontal = SUBJECTS.every((s) =>
    (["yaw40", "yaw-40"] as const).every((v) =>
      SIDES.every(
        (side) =>
          d.subjects[s].g1Base[v][side].frac >= d.subjects[s].g1Base.front[side].frac,
      ),
    ),
  );
  const withinNoise = SUBJECTS.every((s) =>
    VIEWS.every((v) =>
      SIDES.every(
        (side) =>
          Math.abs(
            d.subjects[s].g1Fill[v][side].frac - d.subjects[s].g1Base[v][side].frac,
          ) <= noise,
      ),
    ),
  );
  const drop = baseReachesFrontal || withinNoise;
  const helps = SUBJECTS.some((s) =>
    VIEWS.some((v) =>
      SIDES.some(
        (side) => d.subjects[s].g1Fill[v][side].frac > d.subjects[s].g1Base[v][side].frac,
      ),
    ),
  );
  const rework =
    helps &&
    SUBJECTS.some((s) => d.subjects[s].g2FillOutsidePx > 0 || d.subjects[s].floatsOffLid);
  if (land) return "land";
  if (drop) return "drop";
  if (rework) return "rework";
  return "other";
}

describe("the corner decision names an outcome", () => {
  it("(1) both subjects present with g1, g2, renders and a valid decision", () => {
    expect(existsSync(DECISION), DECISION).toBe(true);
    const d = decision();
    for (const s of SUBJECTS) {
      expect(d.subjects[s], s).toBeTruthy();
      for (const v of VIEWS) {
        for (const side of SIDES) {
          for (const bake of ["g1Base", "g1Fill"] as const) {
            const c = d.subjects[s][bake][v][side];
            expect(typeof c.frac, `${s} ${bake} ${v} ${side}`).toBe("number");
            expect(c.headPx).toBeGreaterThan(0);
          }
        }
      }
      expect(typeof d.subjects[s].g2FillOutsidePx).toBe("number");
      expect(d.subjects[s].renders.length).toBeGreaterThanOrEqual(17);
      for (const r of d.subjects[s].renders) {
        expect(r.file).toMatch(/^assets:corner-decide\//);
        expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
    expect(["land", "rework", "drop", "other"]).toContain(d.decision);
    expect(d.reason.length).toBeGreaterThan(50);
  });

  it("(2) the named decision follows from the recorded numbers", () => {
    const d = decision();
    expect(d.decision).toBe(recompute(d));
  });

  it("(3) the recorded numbers pin the conformed-bake outcome", () => {
    const d = decision();
    // G1 NOT_MET both: no far-eye fill outer reaches its frontal threshold.
    for (const s of SUBJECTS) {
      for (const [v, side] of FAR_EYE) {
        expect(
          d.subjects[s].g1Fill[v][side].frac,
          `${s} ${v} ${side} below frontal`,
        ).toBeLessThan(d.subjects[s].g1Fill.front[side].frac);
      }
    }
    // The Aisha yaw40-L-outer regression that blocks land (noise is 0).
    expect(d.noise.maxAbsG1Delta).toBe(0);
    expect(d.subjects.aisha.g1Fill["yaw40"].L.frac).toBeLessThan(
      d.subjects.aisha.g1Base["yaw40"].L.frac,
    );
    // G2 clean both, no float: rework triggers absent.
    for (const s of SUBJECTS) {
      expect(d.subjects[s].g2FillOutsidePx).toBe(0);
      expect(d.subjects[s].floatsOffLid).toBe(false);
    }
  });
});
