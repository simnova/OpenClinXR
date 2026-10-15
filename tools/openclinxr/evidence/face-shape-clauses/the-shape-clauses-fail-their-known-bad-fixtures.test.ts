import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: two REGION clauses fail their known-bad fixtures and pass
 * their known-good, with cutoffs as good/bad midpoints enforced only when
 * min-margin / measured run-to-run noise >= 1 (face-gate h2 rule).
 * A single-scanline clause passes the lid known-bad and is therefore
 * rejected (report-only). A known-bad fixture that showed no defect would
 * fail here: the bad values below re-measure the visible defect
 * (tint edge at crop x76-79, lid white rows 30-53) on every run.
 *
 * S = .openclinxr/realism-spike in worktree realism-95 (gitignored scratch).
 * Every number cites its file; sweeps live beside this test.
 */

const DIR = import.meta.dirname;
const REPORT = join(DIR, "shape-report.json");
const SWEEP_TINT = join(DIR, "sweep-tint.json");
const SWEEP_LID = join(DIR, "sweep-lid.json");
const CLAUSES = join(DIR, "shape_clauses.py");

type Sweep = {
  cutoff: number;
  status: string;
  known_good: { value: number };
  known_bad: { value: number };
  noise: { value: number; file: string };
  margin: { bad_minus_thr: number; thr_minus_good: number };
};

function measured(): Record<string, { value: number }> {
  const out = execFileSync("python3", [CLAUSES, "--verify"], {
    encoding: "utf8",
    timeout: 120000,
  });
  return JSON.parse(out) as Record<string, { value: number }>;
}

function midpoint(good: number, bad: number): number {
  return (good + bad) / 2;
}

describe("the shape clauses fail their known-bad fixtures", () => {
  it("(1) fixtures and report exist", () => {
    for (const f of [
      "fixtures/tint-known-bad.png",
      "fixtures/lid-known-bad.png",
      "fixtures/tint-known-good.png",
      "fixtures/lid-known-good.png",
      "fixtures/tint-pre.png",
    ]) {
      expect(
        () => readFileSync(join(DIR, f)),
        `${f} missing. Restoration: cut the fixture crop, do not invent numbers.`,
      ).not.toThrow();
    }
    expect(
      () => readFileSync(REPORT),
      "shape-report.json missing.",
    ).not.toThrow();
  });

  it("(2) TINT region clause fails its known-bad and passes its known-good", () => {
    const sweep = JSON.parse(readFileSync(SWEEP_TINT, "utf8")) as Sweep;
    const m = measured();
    expect(m["tint-known-bad"].value).toBeGreaterThan(sweep.cutoff);
    expect(m["tint-known-good"].value).toBeLessThanOrEqual(sweep.cutoff);
  });

  it("(3) LID length-fraction clause fails its known-bad and passes its known-good", () => {
    const sweep = JSON.parse(readFileSync(SWEEP_LID, "utf8")) as Sweep;
    const m = measured();
    expect(m["lid-known-bad"].value).toBeGreaterThan(sweep.cutoff);
    expect(m["lid-known-good"].value).toBeLessThanOrEqual(sweep.cutoff);
  });

  it("(4) cutoffs are good/bad midpoints, not inventions", () => {
    for (const file of [SWEEP_TINT, SWEEP_LID]) {
      const sweep = JSON.parse(readFileSync(file, "utf8")) as Sweep;
      expect(
        sweep.cutoff,
        `${file} cutoff ${sweep.cutoff} != midpoint of its recorded anchors.`,
      ).toBeCloseTo(
        midpoint(sweep.known_good.value, sweep.known_bad.value),
        3,
      );
    }
  });

  it("(5) enforced clauses clear noise; margin/noise >= 1", () => {
    for (const file of [SWEEP_TINT, SWEEP_LID]) {
      const sweep = JSON.parse(readFileSync(file, "utf8")) as Sweep;
      expect(sweep.status).toBe("enforced");
      const margin = Math.min(
        sweep.margin.thr_minus_good,
        sweep.margin.bad_minus_thr,
      );
      if (sweep.noise.value === 0) {
        expect(margin).toBeGreaterThan(0);
      } else {
        expect(margin / sweep.noise.value).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("(6) COUNTERWEIGHT: a single-row clause passes the lid known-bad and is rejected", () => {
    const m = measured();
    // The plant reads ONE row (y=2, skin above the opening): 0 on both.
    // It passes the known-bad, so it can never gate: the report keeps it
    // report-only, and this test fails if anyone promotes it to enforced.
    expect(m["plant-on-known-bad"].value).toBeLessThanOrEqual(0.0);
    const report = JSON.parse(readFileSync(REPORT, "utf8")) as {
      clauses: { clause: string; status: string }[];
    };
    const plant = report.clauses.find((c) => c.clause === "PLANT")!;
    expect(plant.status.startsWith("report-only")).toBe(true);
    expect(plant.status).not.toMatch(/^enforced/);
  });
});
