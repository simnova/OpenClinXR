import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CARD tsk_6a46705a72eb008b: make the eye occlusion shell darken the upper
 * sclera under the lid on body2, not only the canthi.
 *
 * Outcome: NOT CONVERGED. The generic fix (lid-relative asymmetric rings,
 * limbus-sparing lateral gate, wide lid-relative corner, pupil-guarded upper
 * band; shell composes with --eye-cornea; shell-span donor band) moves M1/M2b
 * past midpoint on both subjects and body2 D90 into its window at s5, but
 * M2a stays short on both, aisha D90 stays out, and the iris rim moves past
 * the 1px floor. Defaults unchanged (shell opt-in, old knob values pinned).
 *
 * This test reads the report + the materializer source. claimScope: report
 * integrity + gate honesty + opt-in defaults + no-subject-literal code.
 * notEvidenceFor: clinical_validity, quest_readiness, any visual grade.
 */

const HERE = join(repoRoot(), "tools/openclinxr/asset-pipeline/realism-head/sclera-shade");
const REPO_ROOT = repoRoot();
const REPORT_PATH = join(HERE, "shell-placement-report.json");
const MATERIALIZE = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);

type Metrics = { M1: number; M2a: number; M2b: number; D90: number };
type Report = {
  card: string;
  verdict: string;
  goal: { aisha: Metrics; body2: Metrics };
  pre: { report: { aisha: Metrics; body2: Metrics }; remeasured: { aisha: Metrics; body2: Metrics } };
  midpoints: { aisha: Record<string, number>; body2: Record<string, number> };
  d90Windows: { aisha: [number, number]; body2: [number, number] };
  noise: { mask: Record<string, Record<string, number>>; irisEuclidFloor: Record<string, number> };
  sweep: Array<{
    row: string;
    params: { ring_frac: number; upper_peak: number; upper_span_mm: number };
    aisha: Metrics & { irisEuclidVsPre: number; skinDeltaVsPre: number };
    body2: Metrics & { irisEuclidVsPre: number; skinDeltaVsPre: number };
  }>;
  gates: {
    g1: Record<string, Record<string, { value: number; mid: number; pass: boolean }>>;
    g2: Record<string, { D90: { value: number; window: [number, number]; pass: boolean }; irisEuclidVsPre: number; irisFloor: number; skinDeltaVsPre: number }>;
  };
  probes: {
    shellOff: { M2b: { aisha: number; body2: number } };
    uniform15: { aisha: Metrics; body2: Metrics };
  };
  defaults: { unchanged: boolean };
  files: Record<string, { sha256: string }>;
};

function loadReport(): Report {
  return JSON.parse(readFileSync(REPORT_PATH, "utf8")) as Report;
}

function expectFiniteMetrics(m: Metrics, label: string): void {
  for (const k of ["M1", "M2a", "M2b", "D90"] as const) {
    expect(typeof m[k], `${label}.${k} is a number`).toBe("number");
    expect(Number.isFinite(m[k]), `${label}.${k} is finite (NaN must fail, not pass)`).toBe(true);
  }
}

/** Source slice between two top-level def lines (the changed eyeshell code). */
function functionSlice(src: string, start: string, end: string): string {
  const i = src.indexOf(`\ndef ${start}(`);
  const j = src.indexOf(`\ndef ${end}(`, i + 1);
  expect(i, `def ${start} found`).toBeGreaterThan(-1);
  expect(j, `def ${end} found after ${start}`).toBeGreaterThan(i);
  return src.slice(i, j);
}

describe("the shell shades the upper sclera on both subjects (report integrity)", () => {
  it("report exists with the not_converged verdict", () => {
    expect(existsSync(REPORT_PATH)).toBe(true);
    const r = loadReport();
    expect(r.card).toBe("tsk_6a46705a72eb008b");
    expect(r.verdict).toBe("not_converged");
  });

  it("goal and both PREs cover both subjects with finite metrics", () => {
    const r = loadReport();
    for (const subject of ["aisha", "body2"] as const) {
      expectFiniteMetrics(r.goal[subject], `goal.${subject}`);
      expectFiniteMetrics(r.pre.report[subject], `pre.report.${subject}`);
      expectFiniteMetrics(r.pre.remeasured[subject], `pre.remeasured.${subject}`);
    }
  });

  it("sweep has s1-s6 rows with the fix knobs; measured rows are finite", () => {
    const r = loadReport();
    expect(r.sweep.map((s) => s.row)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
    for (const row of r.sweep) {
      for (const k of ["ring_frac", "upper_peak", "upper_span_mm"] as const) {
        expect(typeof row.params[k], `${row.row}.params.${k} recorded`).toBe("number");
      }
      for (const side of ["aisha", "body2"] as const) {
        expectFiniteMetrics(row[side], `sweep-${row.row}.${side}`);
        expect(Number.isFinite(row[side].irisEuclidVsPre), `${row.row}.${side} iris recorded`).toBe(true);
        expect(Number.isFinite(row[side].skinDeltaVsPre), `${row.row}.${side} skin recorded`).toBe(true);
      }
    }
  });

  it("G1 is recorded honestly: M2a fails midpoint on both at the best round", () => {
    const r = loadReport();
    for (const subject of ["aisha", "body2"] as const) {
      const g = r.gates.g1[subject]!;
      expect(g["M1"]!.pass, `${subject} M1 past midpoint`).toBe(true);
      expect(g["M2b"]!.pass, `${subject} M2b past midpoint`).toBe(true);
      expect(g["M2a"]!.pass, `${subject} M2a must NOT pass (not_converged)`).toBe(false);
    }
  });

  it("G2 is recorded honestly: aisha D90 out, body2 D90 in, iris past floor", () => {
    const r = loadReport();
    expect(r.gates.g2["aisha"]!.D90.pass, "aisha D90 must NOT pass").toBe(false);
    expect(r.gates.g2["body2"]!.D90.pass, "body2 D90 passes").toBe(true);
    for (const subject of ["aisha", "body2"] as const) {
      const g = r.gates.g2[subject]!;
      expect(g.irisEuclidVsPre, `${subject} iris moves past its 1px floor`).toBeGreaterThan(g.irisFloor);
      expect(Math.abs(g.skinDeltaVsPre), `${subject} skin within noise`).toBeLessThan(0.5);
    }
  });

  it("probes are recorded: shell-off fails G1, uniform-15% fails body2 G2-D90", () => {
    const r = loadReport();
    expect(r.probes.shellOff.M2b.aisha, "shell-off aisha M2b short of mid").toBeGreaterThan(r.midpoints.aisha["M2b"]!);
    expect(r.probes.shellOff.M2b.body2, "shell-off body2 M2b short of mid").toBeGreaterThan(r.midpoints.body2["M2b"]!);
    const w = r.d90Windows.body2;
    const u = r.probes.uniform15.body2.D90;
    expect(u < w[0] || u > w[1], `uniform-15% body2 D90 ${u} outside [${w}]`).toBe(true);
  });

  it("every cited file has a sha256", () => {
    const r = loadReport();
    expect(Object.keys(r.files).length).toBeGreaterThan(20);
    for (const [p, e] of Object.entries(r.files)) {
      expect(e.sha256, `${p} sha256`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("defaults unchanged: shell opt-in, old knob values pinned, new knobs default off", () => {
    const r = loadReport();
    expect(r.defaults.unchanged).toBe(true);
    const src = readFileSync(MATERIALIZE, "utf8");
    expect(src).toMatch(/"--eye-occlusion-shell"[\s\S]{0,200}?action\s*=\s*"store_true"/);
    expect(src).toMatch(/"--eye-shell-margin", type=float, default=0\.5\)/);
    expect(src).toMatch(/"--eye-shell-corner", type=float, default=0\.8\)/);
    expect(src).toMatch(/"--eye-shell-ramp-mm", type=float, default=2\.5\)/);
    expect(src).toMatch(/"--eye-shell-upper-boost", type=float, default=1\.6\)/);
    expect(src).toMatch(/"--eye-shell-color", default="120,88,80"\)/);
    expect(src).toMatch(/"--eye-shell-ring-frac",\s*\n?\s*type=float,\s*\n?\s*default=0\.25/);
    expect(src).toMatch(/"--eye-shell-upper-peak",\s*\n?\s*type=float,\s*\n?\s*default=0\.0/);
  });

  it("shell composes with --eye-cornea (refusal gone, transfer before split)", () => {
    const src = readFileSync(MATERIALIZE, "utf8");
    expect(src, "cornea no longer refuses the shell").not.toMatch(/--eye-cornea refuses the eyeshell/);
    expect(src).toMatch(/composes with --eye-occlusion-shell/);
  });

  it("no subject name or stem in the changed eyeshell functions", () => {
    const src = readFileSync(MATERIALIZE, "utf8");
    const build = functionSlice(src, "_eyshell_build", "patch_glb_eye_occlusion");
    const transfer = functionSlice(src, "_eyshell_transfer_lid_keys", "_eyemesh_split_cornea_glb");
    for (const [name, body] of [["build", build], ["transfer", transfer]] as const) {
      expect(body, `${name} has no subject literal`).not.toMatch(/aisha|body2/i);
    }
  });
});
