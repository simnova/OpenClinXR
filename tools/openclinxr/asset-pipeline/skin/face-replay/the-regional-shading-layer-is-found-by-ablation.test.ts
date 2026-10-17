/**
 * The regional-shading layer is found by ablation (card tsk_bfe7c0ec6b0ba639).
 *
 * body2 fails 8 of 12 enforced (b) room-render-vs-photo gates in
 * skin-gates-split-report.json g3 while gate (a) passes 5/5, so albedo
 * lightness is probably not the cause. This test validates
 * regional-shading-report.json: STEP 0 decomposition (render-side vs
 * photo-side terms per subject, recorded before any ablation), frozen
 * thresholds equal to the landed split-gates report, every ablation with
 * body2 + Aisha rows, verdict consistent with the table and the falsifier
 * rule (no ablation moves body2 L_cheek logY_face from 0.30 to <= 0.20
 * unless exactly one skin layer is clearly the cause), and recomputes one
 * ablation gate value from its store render when present.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const MODULE = path.join(DIR, "skin_gates_split.py");
const FROZEN = path.join(DIR, "skin-gates-split-report.json");
const REPORT = path.join(DIR, "regional-shading-report.json");

const FAILING_GATES = [
  "G2/L_cheek/logY_face",
  "G2/L_cheek/Lratio_face",
  "G2/L_cheek/CdivL",
  "G2/forehead/logY_face",
  "G2/forehead/Lratio_face",
  "G2/upperlip_skin/logY_face",
  "G2/upperlip_skin/Lratio_face",
  "G2/upperlip_skin/CdivL",
];
const ABLATIONS = ["A1", "A2", "A3", "A4a", "A4b", "A5"];
const LAYER_OF: Record<string, string> = {
  A1: "albedo",
  A2: "ao",
  A3: "beard",
  A4a: "roughness",
  A4b: "normal",
  A5: "geometry",
};
const FALSIFIER_BASE = 0.30453;
const FALSIFIER_TARGET = 0.2;

type Step0Entry = {
  render_body2: number;
  photo_body2: number;
  render_aisha: number;
  photo_aisha: number;
  d_body2: number;
};
type AblationRow = {
  ablation: string;
  subject: string;
  render_png: string;
  render_sha256: string;
  gates: Record<string, { d_eval: number; threshold: number; pass: boolean }>;
};
type Report = {
  card: string;
  frozen_report_sha256: string;
  step0: {
    recorded_before_ablations: boolean;
    decision: string;
    gates: Record<string, Step0Entry>;
  };
  ablations: AblationRow[];
  verdict:
    | "photo_side"
    | "albedo"
    | "ao"
    | "beard"
    | "roughness"
    | "normal"
    | "geometry"
    | "other";
  falsifier: { base: number; target: number; best: number; met: boolean };
};

function loadReport(): Report {
  return JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
}

function frozenThresholds(): Record<string, number> {
  const frozen = JSON.parse(fs.readFileSync(FROZEN, "utf8")) as {
    g3: {
      gate_id: string;
      threshold: number;
      enforced: boolean;
    }[];
  };
  const out: Record<string, number> = {};
  for (const g of frozen.g3) {
    if (g.enforced && FAILING_GATES.includes(g.gate_id)) out[g.gate_id] = g.threshold;
  }
  return out;
}

describe("the regional-shading layer is found by ablation", () => {
  it("STEP 0 is present before ablations and decomposes every failing gate", () => {
    const rep = loadReport();
    expect(rep.card).toBe("tsk_bfe7c0ec6b0ba639");
    expect(rep.step0.recorded_before_ablations).toBe(true);
    expect(rep.step0.decision.length).toBeGreaterThan(0);
    for (const gid of FAILING_GATES) {
      const e = rep.step0.gates[gid];
      expect(e, gid).toBeDefined();
      for (const k of ["render_body2", "photo_body2", "render_aisha", "photo_aisha", "d_body2"] as const) {
        expect(typeof e[k], `${gid}.${k}`).toBe("number");
      }
      // Gate value recomposes from its render/photo terms.
      expect(Math.abs(Math.abs(e.render_body2 - e.photo_body2) - e.d_body2)).toBeLessThan(1e-4);
    }
  });

  it("ablation thresholds equal the frozen split-gates thresholds", () => {
    const rep = loadReport();
    const frozen = frozenThresholds();
    expect(Object.keys(frozen).length).toBe(8);
    for (const row of rep.ablations) {
      for (const gid of FAILING_GATES) {
        expect(row.gates[gid].threshold, `${row.ablation}/${row.subject}/${gid}`).toBe(frozen[gid]);
      }
    }
  });

  it("every ablation has body2 + Aisha rows with passing verdict flags", () => {
    const rep = loadReport();
    for (const ab of ABLATIONS) {
      const rows = rep.ablations.filter((r) => r.ablation === ab);
      expect(rows.map((r) => r.subject).sort()).toEqual(["aisha", "body2"]);
      for (const row of rows) {
        expect(fs.existsSync(row.render_png), row.render_png).toBe(true);
        for (const gid of FAILING_GATES) {
          const g = row.gates[gid];
          expect(g.pass, `${ab}/${row.subject}/${gid}`).toBe(g.d_eval < g.threshold);
        }
      }
    }
  });

  it("verdict is consistent with the table and the falsifier rule", () => {
    const rep = loadReport();
    const gid = "G2/L_cheek/logY_face";
    const moves: Record<string, number> = {};
    for (const row of rep.ablations.filter((r) => r.subject === "body2")) {
      moves[row.ablation] = row.gates[gid].d_eval;
    }
    const best = Math.min(...Object.values(moves));
    // Falsifier: no ablation moves 0.30453 toward the frozen threshold by
    // more than half the gap (to <= 0.20).
    expect(rep.falsifier.base).toBe(FALSIFIER_BASE);
    expect(rep.falsifier.target).toBe(FALSIFIER_TARGET);
    expect(rep.falsifier.best).toBe(best);
    expect(rep.falsifier.met).toBe(best <= FALSIFIER_TARGET);
    const passers = Object.entries(moves)
      .filter(([, d]) => d <= FALSIFIER_TARGET)
      .map(([ab]) => LAYER_OF[ab]);
    const singleSkinLayer = passers.length === 1 && passers[0] !== "geometry";
    if (!rep.falsifier.met) {
      expect(["photo_side", "geometry", "other"]).toContain(rep.verdict);
    } else if (singleSkinLayer) {
      expect(rep.verdict).toBe(passers[0]);
    }
  });

  it("one ablation gate value recomputes from its store render when present", () => {
    const rep = loadReport();
    const frozen = JSON.parse(fs.readFileSync(FROZEN, "utf8")) as {
      g2_per_image: Record<string, { quantities: Record<string, Record<string, number>> }>;
    };
    const photo = frozen.g2_per_image.photo_body2.quantities;
    const row = rep.ablations.find((r) => r.subject === "body2");
    if (!row || !fs.existsSync(row.render_png)) return;
    const rq = JSON.parse(
      execFileSync("python3", [MODULE, "--render-quantities", row.render_png], {
        encoding: "utf8",
        timeout: 300000,
      }),
    ) as { quantities: Record<string, Record<string, number>> };
    const gid = "G2/L_cheek/logY_face";
    const recomputed = Math.abs(rq.quantities["L_cheek"]["logY_face"] - photo["L_cheek"]["logY_face"]);
    expect(Math.abs(recomputed - row.gates[gid].d_eval)).toBeLessThan(0.01);
  }, 300000);
});
