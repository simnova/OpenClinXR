/**
 * The field covers the forehead (card tsk_364338d60bdf29ff) — FALSIFIER.
 *
 * The regional field's grid was extended above the brow (ny0 from the
 * FaceLandmarker forehead-polygon top) with a central-eval vs
 * upper/lateral-fit forehead split, and settings E/F/G/H were re-swept
 * with and without L. Result: the forehead never reaches within 3 per
 * channel — closest is sweepF (no L), missing only forehead a* by 0.57
 * while losing both cheeks on L; every +L setting passes cheeks+chin
 * (3/4) but misses forehead a* by 4.63-4.76. Mechanism (measured): the
 * field fits goal-minus-pre deltas (~0 on forehead a*) while the six
 * overshoots the forehead by -5.10, and forehead render transfer is
 * ~0.2 vs ~0.8 below the brow. Nothing lands in the stored field.
 *
 * This test pins that record: the extent/split machinery validates,
 * the trade-off table recomputes from the stored dLab, G2 holds on all
 * 8 sweeps, G4 asymmetries sit beside the pre-fix bound, G3/G5 are
 * recorded as not-run (no G1 passer), solve-parameters.json stays
 * field-free, and old-style grids replay to the pre-change pin.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPORT = path.join(DIR, "forehead-field-report.json");
const TRACKED = path.join(DIR, "solve-parameters.json");
const REGIONAL = path.join(DIR, "regional-chroma-report.json");

const BOUND = 3;
/** Pre-change pin: old-style grid (ny_range[0]==0) on a synthetic input. */
const OLD_FIELD_PIN =
  "a54c0df8995c3cd242f6eda21f8301a500ea877fd314245713c5b34d86a9ae18";

const PRE_FIX_BOUND = [4.4016, 1.4431, 2.8791];

type SweepEntry = {
  grid: string;
  luminance: boolean;
  six_matches_landed: boolean;
  ny_range: [number, number];
  fit_cells: [number, number][];
  eval_cells: [number, number][];
  forehead_eval_cells: [number, number][];
  forehead_fit_above_brow: [number, number][];
  g2_disjoint: boolean;
  g1_count: number;
  dLab: Record<string, [number, number, number]>;
  within3: Record<string, boolean>;
  asymmetry: [number, number, number];
};

type Report = {
  card: string;
  verdict: string;
  extent: {
    ny0: number; ny1: number;
    fh_top_pre_row: number; fh_top_goal_row: number;
    source: string;
  };
  forehead_split: {
    eval_cells: [number, number][];
    fit_cells_above_brow: [number, number][];
  };
  sweep: Record<string, SweepEntry>;
  tradeoff: {
    closest_forehead: { setting: string; forehead_miss_a: number };
  };
  gates: {
    g1_pass: boolean;
    g2_fit_eval_disjoint: boolean;
    g3_counterweight_pass: boolean;
    g3_note: string;
    g4_pre_fix_bound: [number, number, number];
    g5_note: string;
  };
  field_change: string;
};

function readReport(): Report {
  return JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
}

function disjoint(fit: [number, number][], ev: [number, number][]): boolean {
  const s = new Set(fit.map((c) => c.join(",")));
  return !ev.some((c) => s.has(c.join(",")));
}

function pythonBin(): string {
  return execFileSync("python3",
    ["-c", "import sys;print(sys.executable)"], { encoding: "utf8" }).trim();
}

function shaOf(file: string): string {
  return execFileSync("shasum", ["-a", "256", file], { encoding: "utf8" }).split(" ")[0]!;
}

/** Replay a synthetic old-style field; returns the output sha. */
function replayOldField(): string {
  const py = `
import sys
sys.path.insert(0, ${JSON.stringify(DIR)})
import hashlib, io
import numpy as np
from PIL import Image
import face_replay_colour as F
import face_replay_compose as C
S=16
ys, xs = np.mgrid[0:S,0:S]
rgb = np.stack([(xs*16)%256, (ys*16)%256, ((xs+ys)*8)%256]).astype(np.uint8).transpose(1,2,0)
face = np.ones((S,S))
lab = C.lab_of(rgb).astype(np.float64)
field = {'grid': {'nx':6,'ny':5,'nx_range':[-0.65,0.65],'ny_range':[0.0,1.149624060150376]},
 'uv_anchors': {'mid_s':8.0,'ied_s':4.0,'brow_t':2.0,'mouth_t':10.0,'landmarks_size':16},
 'cells_ab': [[[float(ix-iy), float(ix+iy)] for ix in range(6)] for iy in range(5)],
 'cells_l': None}
out = F.apply_regional_chroma(lab, face, field, S)
buf = io.BytesIO(); Image.fromarray(C.rgb_of(out)).save(buf, format='PNG')
sys.stdout.write(hashlib.sha256(buf.getvalue()).hexdigest())
`;
  return execFileSync(pythonBin(), ["-c", py], { encoding: "utf8" }).trim();
}

const GATED = ["L_cheek", "R_cheek", "forehead", "chin"] as const;

describe("the field covers the forehead", () => {
  it("verdict is the falsifier: forehead never within 3 with cheeks kept", () => {
    const r = readReport();
    expect(r.verdict).toMatch(/FALSIFIER/);
    expect(r.gates.g1_pass).toBe(false);
    expect(r.field_change).toBe("none");
    let anyForeheadPassWith3 = false;
    for (const [tag, s] of Object.entries(r.sweep)) {
      for (const name of GATED) {
        const pass = s.dLab[name]!.every((x) => Math.abs(x) <= BOUND);
        expect(s.within3[name], `${tag} ${name} flag matches`).toBe(pass);
      }
      const count = GATED.filter((n) => s.within3[n]).length;
      expect(s.g1_count, `${tag} count recomputes`).toBe(count);
      if (s.within3["forehead"] && count >= 3) anyForeheadPassWith3 = true;
    }
    expect(anyForeheadPassWith3, "no setting pairs forehead with >=3/4").toBe(false);
  });

  it("trade-off pins: sweepF closest on forehead at the cost of cheeks", () => {
    const r = readReport();
    expect(r.tradeoff.closest_forehead.setting).toBe("sweepF");
    const f = r.sweep["sweepF"]!;
    expect(f.luminance).toBe(false);
    expect(f.dLab["forehead"]![1], "sweepF forehead a* miss").toBe(-3.57);
    expect(f.within3["forehead"]).toBe(false);
    expect(f.within3["L_cheek"], "cheeks lost without L").toBe(false);
    expect(f.within3["R_cheek"], "cheeks lost without L").toBe(false);
    for (const tag of ["sweepE-L", "sweepF-L", "sweepG-L", "sweepH-L"]) {
      const s = r.sweep[tag]!;
      expect(s.g1_count, `${tag} 3/4 cheeks+chin`).toBe(3);
      expect(s.within3["forehead"], `${tag} forehead still out`).toBe(false);
      expect(Math.abs(s.dLab["forehead"]![1]), `${tag} a* miss band`)
        .toBeGreaterThanOrEqual(4.63);
    }
  });

  it("extent + split hold on every sweep (G2 for the forehead too)", () => {
    const r = readReport();
    expect(r.extent.ny0, "grid reaches above the brow").toBeLessThan(0);
    expect(r.extent.source).toMatch(/forehead-polygon/);
    expect(r.gates.g2_fit_eval_disjoint).toBe(true);
    for (const [tag, s] of Object.entries(r.sweep)) {
      expect(s.ny_range[0], `${tag} carries the extent`).toBe(r.extent.ny0);
      expect(s.six_matches_landed, `${tag} six untouched`).toBe(true);
      expect(disjoint(s.fit_cells, s.eval_cells), `${tag} G2`).toBe(true);
      expect(s.g2_disjoint).toBe(true);
      expect(s.forehead_eval_cells.length, `${tag} forehead eval non-empty`)
        .toBeGreaterThan(0);
      expect(s.forehead_fit_above_brow.length, `${tag} forehead fit non-empty`)
        .toBeGreaterThan(0);
      expect(disjoint(s.forehead_fit_above_brow, s.forehead_eval_cells),
        `${tag} forehead eval never fitted`).toBe(true);
    }
  });

  it("G4 recorded beside pre-fix; G3/G5 honestly not-run", () => {
    const r = readReport();
    expect(r.gates.g4_pre_fix_bound).toEqual(PRE_FIX_BOUND);
    for (const [tag, s] of Object.entries(r.sweep)) {
      expect(s.asymmetry.length, `${tag} asymmetry recorded`).toBe(3);
    }
    expect(r.gates.g3_counterweight_pass).toBe(false);
    expect(r.gates.g3_note).toMatch(/no setting reached G1/);
    expect(r.gates.g5_note).toMatch(/nothing chosen/);
  });

  it("nothing landed: solve-parameters stays field-free, regional key added", () => {
    const tracked = JSON.parse(fs.readFileSync(TRACKED, "utf8")) as Record<string, unknown>;
    expect(tracked["regional_chroma"], "no field landed in solve params").toBeUndefined();
    const regional = JSON.parse(fs.readFileSync(REGIONAL, "utf8")) as {
      forehead_field: { verdict: string; field_change: string };
      mouthlm_r4: { setting: string };
      pre_fix: { g1_count: number };
    };
    expect(regional.forehead_field.verdict).toMatch(/FALSIFIER/);
    expect(regional.forehead_field.field_change).toBe("none");
    expect(regional.mouthlm_r4.setting, "landed numbers untouched")
      .toMatch(/^sweepE\+L/);
    expect(regional.pre_fix.g1_count, "landed numbers untouched").toBe(1);
  });

  it("old params replay byte-identically (below-brow normalisation unchanged)", () => {
    expect(replayOldField(), "old-style grid replays to the pre-change pin").toBe(OLD_FIELD_PIN);
  }, 120000);
});

const HB1 = "handback1" as const;

type Hb1Report = Report & {
  handback1: {
    verdict: string;
    fit_target_change: { to: string; method_version: string };
    transfer: {
      albedo_delta_a_face_mean: number;
      render_delta_a: Record<string, number>;
      transfer_ratio_a: Record<string, number>;
      roughness_mean: { forehead_band: number; cheek_band: number };
      highlight_fraction: {
        forehead: number; L_cheek: number; R_cheek: number; chin: number;
      };
      finding: string;
    };
    sweep: Record<string, SweepEntry & {
      method: string; fit_target: string;
    }>;
    gates: { g1_pass: boolean; g2_fit_eval_disjoint: boolean };
    field_change: string;
  };
};

function readHb1(): Hb1Report {
  return JSON.parse(fs.readFileSync(REPORT, "utf8")) as Hb1Report;
}

describe("the field covers the forehead (handback 1: refit to residual)", () => {
  it("v2 improves the forehead but loses L_cheek: nothing lands", () => {
    const r = readHb1();
    expect(r.handback1.verdict).toMatch(/NO LAND/);
    expect(r.handback1.field_change).toMatch(/none/);
    expect(r.handback1.gates.g1_pass).toBe(false);
    let anyForeheadPassWith3 = false;
    for (const [tag, s] of Object.entries(r.handback1.sweep)) {
      expect(s.method, `${tag} marked v2`).toBe("regional-chroma-v2");
      expect(s.fit_target, `${tag} fit target`).toBe("goal-minus-sixonly-render");
      expect(s.six_matches_landed, `${tag} six untouched`).toBe(true);
      for (const name of GATED) {
        const pass = s.dLab[name]!.every((x) => Math.abs(x) <= BOUND);
        expect(s.within3[name], `${tag} ${name} flag matches`).toBe(pass);
      }
      const count = GATED.filter((n) => s.within3[n]).length;
      expect(s.g1_count, `${tag} count recomputes`).toBe(count);
      expect(disjoint(s.fit_cells, s.eval_cells), `${tag} G2`).toBe(true);
      if (s.within3["forehead"] && count >= 3) anyForeheadPassWith3 = true;
    }
    expect(anyForeheadPassWith3, "no refit pairs forehead with >=3/4").toBe(false);
    const fl = r.handback1.sweep["sweepF-L"]!;
    expect(fl.dLab["forehead"]![1], "refit forehead a* improves to -3.89").toBe(-3.89);
    expect(fl.within3["forehead"]).toBe(false);
    expect(fl.dLab["L_cheek"]![2], "but L_cheek b* lost at -3.20").toBe(-3.2);
    expect(fl.within3["L_cheek"]).toBe(false);
  });

  it("transfer table pins: forehead 0.49, cheeks 0.97, sheen without roughness gap", () => {
    const t = readHb1().handback1.transfer;
    expect(t.albedo_delta_a_face_mean).toBe(3.828);
    expect(t.render_delta_a["forehead"]).toBe(1.87);
    expect(t.transfer_ratio_a["forehead"], "forehead transfer ~0.49, not 0.2").toBe(0.489);
    expect(t.transfer_ratio_a["L_cheek"]).toBe(0.969);
    expect(t.transfer_ratio_a["R_cheek"]).toBe(0.974);
    expect(t.roughness_mean.forehead_band, "no roughness gap").toBe(0.6043);
    expect(t.roughness_mean.cheek_band).toBe(0.6209);
    expect(t.highlight_fraction.forehead, "forehead sheen 36% over L70").toBe(0.3616);
    expect(t.highlight_fraction.L_cheek).toBe(0.0);
    expect(t.finding).toMatch(/shading card/);
  });

  it("v1 field params replay byte-identically when scratch present", () => {
    const base = "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/mouthlm/resweepL/sweepE";
    const params = `${base}/solve-params.json`;
    const solved = `${base}/solved-albedo.png`;
    if (!fs.existsSync(params) || !fs.existsSync(solved)) return;
    const wb = JSON.parse(fs.readFileSync(params, "utf8")) as {
      regional_chroma: { method: string };
    };
    expect(wb.regional_chroma.method, "scratch params are v1").toBe("regional-chroma-v1");
    const dir = fs.mkdtempSync("/tmp/v1fr-");
    const out = `${dir}/out.png`;
    execFileSync(pythonBin(), [path.join(DIR, "face_replay_colour.py"), "--replay",
      "--input-albedo", `${base}/../../../crownreg/body2hb1/compose-albedo.png`,
      "--albedo-mask", `${base}/../../../crownreg/body2hb1/chain/derive_out/mask-facecore.png`,
      "--params", params, "--out", out], { encoding: "utf8" });
    expect(shaOf(out), "v1 field replays to stored bytes").toBe(shaOf(solved));
  }, 180000);
});
