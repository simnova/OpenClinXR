import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * CARD tsk_57f4ae74d62739e0: spare the iris from the eye shell and scale its
 * shadow by how much lid covers each eye.
 *
 * The B2 shell darkened the iris past its 1px noise floor on both subjects
 * at s5 (aisha 17.39 vs floor 6.90, body2 8.58 vs 5.16) and grey-mauved
 * aisha's whole sclera with a dimmed catch-light. The fix is one generic
 * builder change: UV-space iris spare (globe UVs vs the eye texture's own
 * iris centre/radius, limbus width feather) plus per-eye lid-occlusion
 * scale (covered upper-cap fraction from the seated lid loops, no photo).
 *
 * This test reads the report + the materializer source. claimScope: report
 * integrity + gate honesty + opt-in defaults + no-subject-literal code.
 * notEvidenceFor: clinical_validity, quest_readiness, any visual grade.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../../..");
const REPORT_PATH = join(HERE, "shell-iris-spare-report.json");
const MATERIALIZE = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);

type Metrics = { M1: number; M2a: number; M2b: number; D90: number };
type SideGate = {
  M1: number; M2a: number; M2b: number; D90: number;
  irisEuclidVsPre: number; catchlightPeakL: number; catchlightDeltaVsPre: number;
};
type Report = {
  card: string;
  verdict: string;
  goal: { aisha: Metrics; body2: Metrics };
  pre: { aisha: Metrics; body2: Metrics };
  midpoints: { aisha: Record<string, number>; body2: Record<string, number> };
  d90Windows: { aisha: [number, number]; body2: [number, number] };
  noise: {
    mask: Record<string, number>;
    irisEuclidFloor: { aisha: number; body2: number };
    catchlightNoise: { aisha: number; body2: number };
  };
  sweep: Array<{
    row: string;
    params: { irisSpare: number; occlusionPower: number };
    aisha: SideGate; body2: SideGate;
  }>;
  gates: {
    g1: Record<string, Record<string, { value: number; mid: number; pass: boolean }>>;
    g2: Record<string, {
      D90: { value: number; window: [number, number]; pass: boolean };
      iris: { value: number; floor: number; pass: boolean };
      catchlight: { value: number; pre: number; noise: number; pass: boolean };
    }>;
    g3: { pass: boolean };
  };
  probes: {
    spareOff: { aisha: SideGate; body2: SideGate; result: string };
    powerOff: { aisha: SideGate; result: string };
  };
  defaults: { unchanged: boolean; shell: string };
  occlusion: { aisha: number; body2: number; formula: string };
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

describe("the iris spare scales with lid occlusion (report integrity)", () => {
  it("report exists with a card verdict", () => {
    expect(existsSync(REPORT_PATH)).toBe(true);
    const r = loadReport();
    expect(r.card).toBe("tsk_57f4ae74d62739e0");
    expect(["converged", "not_converged"]).toContain(r.verdict);
  });

  it("goal and PRE cover both subjects with finite metrics", () => {
    const r = loadReport();
    for (const subject of ["aisha", "body2"] as const) {
      expectFiniteMetrics(r.goal[subject], `goal.${subject}`);
      expectFiniteMetrics(r.pre[subject], `pre.${subject}`);
    }
  });

  it("sweep rows carry only the two new knobs and finite metrics", () => {
    const r = loadReport();
    expect(r.sweep.length).toBeGreaterThanOrEqual(1);
    expect(r.sweep.length).toBeLessThanOrEqual(6);
    for (const row of r.sweep) {
      expect(typeof row.params.irisSpare).toBe("number");
      expect(typeof row.params.occlusionPower).toBe("number");
      for (const side of ["aisha", "body2"] as const) {
        expectFiniteMetrics(row[side], `sweep-${row.row}.${side}`);
        expect(Number.isFinite(row[side].irisEuclidVsPre)).toBe(true);
        expect(Number.isFinite(row[side].catchlightPeakL)).toBe(true);
      }
    }
  });

  it("G1 passes past midpoint on both subjects iff verdict converged", () => {
    const r = loadReport();
    for (const subject of ["aisha", "body2"] as const) {
      for (const k of ["M1", "M2a", "M2b"] as const) {
        const g = r.gates.g1[subject]![k]!;
        expect(g.pass).toBe(r.verdict === "converged");
      }
    }
  });

  it("G2 D90 + iris + catch-light pass on both iff converged", () => {
    const r = loadReport();
    for (const subject of ["aisha", "body2"] as const) {
      const g = r.gates.g2[subject]!;
      expect(g.D90.pass).toBe(r.verdict === "converged");
      expect(g.iris.pass).toBe(r.verdict === "converged");
      expect(g.catchlight.pass).toBe(r.verdict === "converged");
      if (r.verdict === "converged") {
        expect(g.iris.value).toBeLessThanOrEqual(g.iris.floor);
        expect(Math.abs(g.catchlight.value - g.catchlight.pre))
          .toBeLessThanOrEqual(g.catchlight.noise);
      }
    }
  });

  it("probes are non-vacuous: spare-off fails iris, power-off fails aisha D90", () => {
    const r = loadReport();
    for (const subject of ["aisha", "body2"] as const) {
      const g = r.probes.spareOff[subject].irisEuclidVsPre;
      const floor = r.noise.irisEuclidFloor[subject]!;
      expect(g, `spare-off ${subject} iris past floor`).toBeGreaterThan(floor);
    }
    const w = r.d90Windows.aisha;
    const d = r.probes.powerOff.aisha.D90;
    expect(d < w[0] || d > w[1], `power-off aisha D90 ${d} outside [${w}]`).toBe(true);
  });

  it("every cited file has a sha256", () => {
    const r = loadReport();
    expect(Object.keys(r.files).length).toBeGreaterThan(10);
    for (const [p, e] of Object.entries(r.files)) {
      expect(e.sha256, `${p} sha256`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("defaults unchanged unless converged; old knob values pinned", () => {
    const r = loadReport();
    const src = readFileSync(MATERIALIZE, "utf8");
    expect(src).toMatch(/"--eye-occlusion-shell"[\s\S]{0,200}?action\s*=\s*"store_true"/);
    expect(src).toMatch(/"--eye-shell-margin", type=float, default=0\.5\)/);
    expect(src).toMatch(/"--eye-shell-corner", type=float, default=0\.8\)/);
    expect(src).toMatch(/"--eye-shell-ramp-mm", type=float, default=2\.5\)/);
    expect(src).toMatch(/"--eye-shell-upper-boost", type=float, default=1\.6\)/);
    expect(src).toMatch(/"--eye-shell-color", default="120,88,80"\)/);
    if (r.verdict !== "converged") {
      expect(r.defaults.unchanged).toBe(true);
    }
  });

  it("no subject name/stem and no goal-photo path in the eyeshell code", () => {
    const src = readFileSync(MATERIALIZE, "utf8");
    const build = functionSlice(src, "_eyshell_build", "patch_glb_eye_occlusion");
    for (const [name, body] of [["build", build]] as const) {
      expect(body, `${name} has no subject literal`).not.toMatch(/aisha|body2/i);
      expect(body, `${name} has no goal-photo path`)
        .not.toMatch(/goal-front|edit-v9|pts_target|goal\.png/i);
    }
    const argv = src.slice(src.indexOf("--eye-shell-iris-spare"));
    expect(argv.slice(0, 2000)).not.toMatch(/aisha|body2/i);
  });
});
