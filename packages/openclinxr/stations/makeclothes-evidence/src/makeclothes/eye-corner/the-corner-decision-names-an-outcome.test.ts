import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "@openclinxr/factory-station-core/runner";

/**
 * The corner decision names an outcome (tsk_269eccc5a315a65f).
 *
 * corner-decision.json re-runs the eye-corner fill (derived on the
 * PRE-lid-conform eye3 bake) on the two lid-conformed heads (Aisha +
 * body2) and records per subject {g1Base, g1Fill, g2FillOutsidePx,
 * renders+sha256} plus one decision in {land, rework, drop, other}.
 *
 * Rules (from the card as corrected by HANDBACK 1):
 * - land: fill >= base on every outer crop AND > base on >= 1 far-eye
 *   crop (yaw40-L-outer, yaw-40-R-outer) AND G2 0 px on both subjects.
 * - rework: the fill helps (any outer fill > base) but G2 fails
 *   (unionOutside > 0) or it visibly floats off the conformed lid.
 * - drop: land fails and rework triggers are absent and the grader saw
 *   no visible difference (graderVerdict === "no visible difference").
 *   (The original noise-clause drop rule counted any 1px change as a
 *   change because run-to-run noise is 0; the grader's native-pixel
 *   verdict replaces it.)
 * - other: anything else, explained in `reason`.
 *
 * The test recomputes the outcome from the recorded numbers and asserts
 * the named decision matches. Pure JSON: no store dependency.
 */

const REPO_ROOT = repoRoot();
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
  graderVerdict: string;
  subjects: Record<string, Subject>;
  noise: { maxAbsG1Delta: number };
} {
  return JSON.parse(readFileSync(DECISION, "utf8")) as {
    decision: string;
    reason: string;
    graderVerdict: string;
    subjects: Record<string, Subject>;
    noise: { maxAbsG1Delta: number };
  };
}

function subjectOf(d: ReturnType<typeof decision>, s: string): Subject {
  const sub = d.subjects[s];
  if (!sub) throw new Error(`corner decision is missing subject ${s}`);
  return sub;
}

function fillCell(
  d: ReturnType<typeof decision>,
  s: string,
  bake: "g1Base" | "g1Fill",
  v: string,
  side: string,
): Cell {
  const cell = subjectOf(d, s)[bake][v]?.[side];
  if (!cell) throw new Error(`corner decision is missing cell ${s} ${bake} ${v} ${side}`);
  return cell;
}

function recompute(d: ReturnType<typeof decision>): string {
  const g2ok = SUBJECTS.every((s) => subjectOf(d, s).g2FillOutsidePx === 0);
  const landPer = (s: string): boolean =>
    VIEWS.every((v) =>
      SIDES.every(
        (side) => fillCell(d, s, "g1Fill", v, side).frac >= fillCell(d, s, "g1Base", v, side).frac,
      ),
    );
  const farEyeGain = (s: string): boolean =>
    FAR_EYE.some(
      ([v, side]) => fillCell(d, s, "g1Fill", v, side).frac > fillCell(d, s, "g1Base", v, side).frac,
    );
  const land =
    g2ok && SUBJECTS.every(landPer) && SUBJECTS.some(farEyeGain);
  const helps = SUBJECTS.some((s) =>
    VIEWS.some((v) =>
      SIDES.some(
        (side) => fillCell(d, s, "g1Fill", v, side).frac > fillCell(d, s, "g1Base", v, side).frac,
      ),
    ),
  );
  const rework =
    helps &&
    SUBJECTS.some((s) => subjectOf(d, s).g2FillOutsidePx > 0 || subjectOf(d, s).floatsOffLid);
  const drop =
    !land && !rework && d.graderVerdict === "no visible difference";
  if (land) return "land";
  if (rework) return "rework";
  if (drop) return "drop";
  return "other";
}

describe("the corner decision names an outcome", () => {
  it("(1) both subjects present with g1, g2, renders and a valid decision", () => {
    expect(existsSync(DECISION), DECISION).toBe(true);
    const d = decision();
    for (const s of SUBJECTS) {
      expect(d.subjects[s], s).toBeTruthy();
      const sub = subjectOf(d, s);
      for (const v of VIEWS) {
        for (const side of SIDES) {
          for (const bake of ["g1Base", "g1Fill"] as const) {
            const c = fillCell(d, s, bake, v, side);
            expect(typeof c.frac, `${s} ${bake} ${v} ${side}`).toBe("number");
            expect(c.headPx).toBeGreaterThan(0);
          }
        }
      }
      expect(typeof sub.g2FillOutsidePx).toBe("number");
      expect(sub.renders.length).toBeGreaterThanOrEqual(17);
      for (const r of sub.renders) {
        expect(r.file).toMatch(/^assets:corner-decide\//);
        expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
    expect(["land", "rework", "drop", "other"]).toContain(d.decision);
    expect(d.graderVerdict).toBe("no visible difference");
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
          fillCell(d, s, "g1Fill", v, side).frac,
          `${s} ${v} ${side} below frontal`,
        ).toBeLessThan(fillCell(d, s, "g1Fill", "front", side).frac);
      }
    }
    // The Aisha yaw40-L-outer regression that blocks land (noise is 0).
    expect(d.noise.maxAbsG1Delta).toBe(0);
    expect(fillCell(d, "aisha", "g1Fill", "yaw40", "L").frac).toBeLessThan(
      fillCell(d, "aisha", "g1Base", "yaw40", "L").frac,
    );
    // G2 clean both, no float: rework triggers absent.
    for (const s of SUBJECTS) {
      expect(subjectOf(d, s).g2FillOutsidePx).toBe(0);
      expect(subjectOf(d, s).floatsOffLid).toBe(false);
    }
  });
});
