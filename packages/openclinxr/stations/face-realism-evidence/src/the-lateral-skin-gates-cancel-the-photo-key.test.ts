/**
 * The lateral skin gates cancel the photo key (card tsk_b2e8149e77e563f4).
 *
 * WHY: both goal photos carry a lateral key (regional-shading-report.json
 * step0 LR_asym_logY: Aisha -0.091, body2 -0.150), so one-sided L/R cheek
 * room-render gates measure the photo's light direction. Lateral gates are
 * measured mirror-averaged: q_mirror = mean(q_L, q_R), render vs photo.
 *
 * Unit fixture: a uniform-tone PNG through --apply-lateral / --lr-quantities
 * proves a pure log-linear lateral gradient leaves q_mirror within its noise
 * floor while moving q_L beyond it (linear ramp within stated tolerance);
 * CdivL is exposure-invariant pixel by pixel so even one-sided CdivL must
 * not move (recorded, asserted). Report validation: G0M rule recorded before
 * results, one-sided lateral gates report-only with reason "photo lateral
 * key", upper lip stays enforced, the enforcement rule holds for every
 * enforced gate, status-change list present; one mirrored value recomputes
 * from the store images when present.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "@openclinxr/factory-station-core/runner";
/** Relocated evidence: skin sources stay under tools/ (S4); anchor via the repo-root helper (S5). */
const DIR = path.join(repoRoot(), "tools/openclinxr/asset-pipeline/skin/face-replay");
const MODULE = path.join(DIR, "skin_gates_split.py");
const REPORT = path.join(DIR, "skin-gates-mirror-report.json");
const SPLIT_REPORT = path.join(DIR, "skin-gates-split-report.json");

const STORE_IOR = "/Volumes/files/openclinxr-assets/store/skin-ior-room";

// Noise floors: measured G0 epsilons (module G0M_FLOOR). Linear-ramp steady
// tolerance: second-order residual of a linear ramp on log quantities is
// ~g^2/6 (g=0.2 -> ~0.007); the test states 0.01 for logY mirror.
const FLOOR = { logY_face: 0.01, Lratio_face: 0.005, CdivL: 0.005 } as const;
const LINEAR_TOL = { logY_face: 0.01, Lratio_face: 0.005, CdivL: 0.005 } as const;

function py(args: string[], timeoutMs = 180000): string {
  return execFileSync("python3", [MODULE, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
  });
}

/** Uniform warm-tone fixture: any lateral asymmetry is pure gradient. */
function flatFixture(dir: string, name: string): string {
  const dest = path.join(dir, name);
  execFileSync("python3", ["-c",
    `from PIL import Image; im = Image.new("RGB", (160, 160), (172, 126, 92));` +
    ` im.save(${JSON.stringify(dest)});`],
  { encoding: "utf8" });
  return dest;
}

function lateralCopy(png: string, g: number, shape: string, dir: string): string {
  const out = path.join(dir, `${shape}-g${g}.png`);
  py(["--apply-lateral", png, String(g), shape, out]);
  return out;
}

function lrQuantities(png: string): Record<string, Record<string, number>> {
  return JSON.parse(py(["--lr-quantities", png])) as Record<string, Record<string, number>>;
}

function mirrorOf(q: Record<string, Record<string, number>>, k: string): number {
  return (q.left[k] + q.right[k]) / 2;
}

type Gate = {
  gate_id: string;
  kind: string;
  region: string;
  channel_or_quantity: string;
  known_good: string;
  known_bads: string[];
  d_good: number;
  d_bads: (number | null)[];
  row_thresholds: number[];
  row_enforceable: boolean[];
  threshold: number | null;
  margin: number | null;
  noise: number | null;
  phys_floor: number | null;
  margin_over_denom: number | null;
  enforced: boolean;
  unenforced_reason: string | null;
  enforced_by_rule: boolean;
  body2_match: { pair: string | null; d_eval: number | null; pass: boolean | null };
  body2_reject: { pair: string | null; d_eval: number | null; pass: boolean | null };
  body2_pass: boolean | null;
};

type MirrorReport = {
  card: string;
  g0m: {
    rule: string;
    floors: Record<string, number>;
    gs: number[];
    kept: string[];
    dropped: string[];
    per_quantity: Record<string, {
      mirror_max_move: number; onesided_max_move: number;
      onesided_moved: boolean; sens_move: number; kept: boolean;
    }>;
  };
  gates: Gate[];
  status_changes: { gate_id: string; was_enforced: boolean; now_enforced: boolean; why: string }[];
  added_gates: string[];
  forehead_verdict: { gate_id: string; enforced: boolean; note: string }[];
  aisha_eval: Record<string, { pass: boolean | null }>;
  body2_summary: { enforced_pass: number; enforced_total: number };
  aisha_summary: { enforced_pass: number; enforced_total: number };
  red_first: string;
};

function loadReport(): MirrorReport {
  return JSON.parse(fs.readFileSync(REPORT, "utf8")) as MirrorReport;
}

/** Unchanged enforcement rule: separates + threshold smallest midpoint +
 * margin/max(noise, floor) >= 1. Coordinator overrides (photo lateral key,
 * photo side dominates) may only demote, never promote. */
function checkGateEnforced(gate: Gate): void {
  expect(gate.known_bads.length).toBe(2);
  expect(gate.row_thresholds.length).toBe(2);
  expect(gate.threshold).not.toBeNull();
  expect(gate.threshold).toBe(Math.min(...gate.row_thresholds));
  expect(gate.d_bads.every((b) => b !== null && (b as number) > gate.d_good)).toBe(true);
  const denom = Math.max(gate.noise as number, gate.phys_floor as number);
  expect((gate.margin as number) / denom).toBeGreaterThanOrEqual(1);
  const m = gate.body2_match;
  const r = gate.body2_reject;
  if (m.d_eval !== null) expect(m.pass).toBe(m.d_eval < (gate.threshold as number));
  if (r.d_eval !== null) expect(r.pass).toBe(r.d_eval > (gate.threshold as number));
}

describe("the lateral skin gates cancel the photo key", () => {
  it("a pure log-linear lateral gradient leaves q_mirror within floor and moves q_L", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gatemirror-"));
    const base = flatFixture(tmp, "flat.png");
    const q0 = lrQuantities(base);
    for (const shape of ["exp", "linear"]) {
      for (const g of [0.05, 0.1, 0.2]) {
        const qk = lrQuantities(lateralCopy(base, g, shape, tmp));
        const tol = shape === "exp" ? FLOOR : LINEAR_TOL;
        for (const k of ["logY_face", "Lratio_face", "CdivL"] as const) {
          expect(Math.abs(mirrorOf(qk, k) - mirrorOf(q0, k))).toBeLessThan(tol[k]);
        }
        // One-sided logY/Lratio move beyond floor at every g (probe stress);
        // CdivL is exposure-invariant pixel by pixel: even one-sided stays.
        expect(Math.abs(qk.left.logY_face - q0.left.logY_face)).toBeGreaterThan(FLOOR.logY_face);
        expect(Math.abs(qk.left.Lratio_face - q0.left.Lratio_face)).toBeGreaterThan(FLOOR.Lratio_face);
        expect(Math.abs(qk.left.CdivL - q0.left.CdivL)).toBeLessThan(FLOOR.CdivL);
      }
    }
  }, 180000);

  it("G0M rule recorded; one-sided lateral report-only; upper lip enforced; rule holds; changes listed", () => {
    const rep = loadReport();
    expect(rep.card).toBe("tsk_b2e8149e77e563f4");
    // G0M rule recorded before results: pass criteria text + per-quantity
    // verdicts consistent with the recorded numbers.
    expect(rep.g0m.rule).toMatch(/FLOOR\[q\]/);
    expect(rep.g0m.rule).toMatch(/sensitivity/i);
    expect(rep.g0m.kept).toContain("logY_face");
    expect(rep.g0m.kept).toContain("CdivL");
    for (const [q, v] of Object.entries(rep.g0m.per_quantity)) {
      expect(v.mirror_max_move).toBeLessThanOrEqual(rep.g0m.floors[q]);
      expect(v.sens_move).toBeGreaterThan(rep.g0m.floors[q]);
      expect(rep.g0m.kept.includes(q)).toBe(v.kept);
    }
    // One-sided lateral gates for probe-moved quantities stay in the table,
    // report-only, photo key; CdivL/hue are not probe-moved (HANDBACK 1).
    const lateral = rep.gates.filter((g) => g.kind === "(b)" &&
      (g.region === "L_cheek" || g.region === "R_cheek"));
    expect(lateral.length).toBeGreaterThan(0);
    const movedQs = new Set(Object.entries(rep.g0m.per_quantity)
      .filter(([, v]) => v.onesided_moved).map(([q]) => q));
    for (const g of lateral.filter((h) => movedQs.has(h.channel_or_quantity))) {
      expect(g.enforced).toBe(false);
      expect(g.unenforced_reason ?? "").toMatch(/photo lateral key/);
    }
    // Upper lip: every gate enforced under the split report stays enforced.
    const split = JSON.parse(fs.readFileSync(SPLIT_REPORT, "utf8")) as { g3: Gate[] };
    const splitUpper = split.g3.filter((g) => g.region === "upperlip_skin" && g.enforced);
    expect(splitUpper.length).toBeGreaterThan(0);
    for (const s of splitUpper) {
      const now = rep.gates.find((g) => g.gate_id === s.gate_id);
      expect(now?.enforced).toBe(true);
    }
    // Enforcement rule holds for every enforced gate; overrides only demote.
    for (const g of rep.gates.filter((h) => h.enforced)) checkGateEnforced(g);
    for (const g of rep.gates) {
      // Coordinator overrides may only demote, never promote.
      if (g.enforced) expect(g.enforced_by_rule).toBe(true);
    }
    // HANDBACK 1: CdivL is exposure-invariant per pixel (probe onesided
    // still), so a lateral key cannot move it: cheek CdivL gates are back
    // under the normal rule and enforced.
    for (const id of ["G2/L_cheek/CdivL", "G2/R_cheek/CdivL"]) {
      expect(rep.gates.find((g) => g.gate_id === id)?.enforced).toBe(true);
    }
    // The "photo lateral key" demotion is probe-derived: no gate carries
    // it for a quantity whose one-sided probe change was <= floor.
    const moved = new Set(Object.entries(rep.g0m.per_quantity)
      .filter(([, v]) => v.onesided_moved).map(([q]) => q));
    for (const g of rep.gates) {
      if ((g.unenforced_reason ?? "").match(/photo lateral key/)) {
        expect(moved.has(g.channel_or_quantity)).toBe(true);
      }
    }
    // Body2/Aisha enforced pass counts re-report consistently.
    const enf = rep.gates.filter((g) => g.enforced);
    expect(rep.body2_summary.enforced_total).toBe(enf.length);
    expect(rep.body2_summary.enforced_pass).toBe(
      enf.filter((g) => g.body2_pass).length);
    expect(rep.aisha_summary.enforced_total).toBe(enf.length);
    expect(rep.aisha_summary.enforced_pass).toBe(
      enf.filter((g) => rep.aisha_eval[g.gate_id]?.pass).length);
    expect(rep.status_changes.length).toBeGreaterThan(0);
    for (const g of lateral.filter((h) => h.enforced_by_rule && !h.enforced)) {
      expect(rep.status_changes.map((c) => c.gate_id)).toContain(g.gate_id);
    }
    expect(rep.red_first).toMatch(/RED/);
  });

  it("one mirrored value recomputes from the store images when present", () => {
    const render = path.join(STORE_IOR, "skinior-aisha-14-front.png");
    if (!fs.existsSync(render)) return;
    const rq = JSON.parse(py(["--render-quantities", render])) as {
      quantities: Record<string, Record<string, number>>;
    };
    const rep = loadReport();
    const stored = (rep as unknown as {
      g2m_per_image: Record<string, { mirror: Record<string, number> }>;
    }).g2m_per_image.render_aisha.mirror;
    for (const q of rep.g0m.kept) {
      const recomputed = (rq.quantities.L_cheek[q] + rq.quantities.R_cheek[q]) / 2;
      expect(Math.abs(recomputed - stored[q])).toBeLessThan(0.001);
    }
  }, 300000);
});
