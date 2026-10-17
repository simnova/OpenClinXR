/**
 * The skin gates are split by what light can change (card tsk_bd3b33a3695f8587).
 *
 * Validates tools/openclinxr/asset-pipeline/skin/face-replay/skin_gates_split.py
 * and its tracked skin-gates-split-report.json:
 * (a) absolute tone in texture space (unlit albedo Lab vs tone anchors);
 * (b) room-rig render vs photo on exposure-invariant quantities only (G0 probe).
 *
 * Unit fixture: a two-band PNG through --srgb-scale / --band-quantities proves
 * a chosen (b) quantity is unchanged under k-scaling while plain L* difference
 * is NOT (the counterexample). Report validation: each G1/G2 row names
 * known-good + known-bad, threshold lies strictly between them,
 * margin/noise is recorded, and the enforced flag is consistent with
 * margin/noise >= 1; quantities recompute from the store images when present.
 *
 * Known-bads, each asserted to fail validation (raw refusal printed as
 * KNOWN-BAD-RED before the throw assertion): (a) a threshold outside the
 * good/bad interval passes; (b) an enforced flag inconsistent with its
 * margin/noise passes; (c) plain dL claimed as a G2 quantity passes.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const MODULE = path.join(DIR, "skin_gates_split.py");
const REPORT = path.join(DIR, "skin-gates-split-report.json");

const STORE_IOR = "/Volumes/files/openclinxr-assets/store/skin-ior-room";
const STORE_FACE = "/Volumes/files/openclinxr-assets/store/face-station-cases";

function py(args: string[], timeoutMs = 180000): string {
  return execFileSync("python3", [MODULE, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
  });
}

/** Two-band fixture: warm top half, darker warm bottom half. */
function bandFixture(dir: string, name: string): string {
  const dest = path.join(dir, name);
  execFileSync("python3", ["-c",
    `from PIL import Image; im = Image.new("RGB", (160, 160), (172, 126, 92));` +
    ` px = im.load();` +
    ` [px.__setitem__((x, y), (120, 82, 60)) for y in range(80, 160) for x in range(160)];` +
    ` im.save(${JSON.stringify(dest)});`],
  { encoding: "utf8" });
  return dest;
}

function bandQuantities(png: string): Record<string, Record<string, number>> {
  return JSON.parse(py(["--band-quantities", png])) as Record<string, Record<string, number>>;
}

function scaledCopy(png: string, k: number, dir: string): string {
  const out = path.join(dir, `k${k}.png`);
  py(["--srgb-scale", png, String(k), out]);
  return out;
}

type GateRow = {
  gate: string;
  kind: string;
  region: string;
  known_good: string;
  known_bad: string;
  threshold: number;
  margin_over_noise: number | null;
  enforced: boolean;
  body2_pass?: boolean;
  d_good?: number;
  d_bad?: number;
};

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
  margin_over_noise: number | null;
  enforced: boolean;
  unenforced_reason: string | null;
  body2_match: { pair: string | null; d_eval: number | null; pass: boolean | null };
  body2_reject: { pair: string | null; d_eval: number | null; pass: boolean | null };
  body2_pass: boolean | null;
};

type SplitReport = {
  card: string;
  g0: { kept: string[]; dropped: string[]; eps: Record<string, number>; max_change: Record<string, number> };
  g1_thresholds: (GateRow & { d_good: number; d_bad: number; margin: number; noise: number; separates: boolean; row_enforceable: boolean; unenforced_reason: string | null })[];
  g2_thresholds: (GateRow & { d_good: number; d_bad: number; margin: number; noise: number; separates: boolean; row_enforceable: boolean; unenforced_reason: string | null })[];
  g3: Gate[];
  falsifier: string;
};

function loadReport(): SplitReport {
  return JSON.parse(fs.readFileSync(REPORT, "utf8")) as SplitReport;
}

function checkRow(row: GateRow & { d_good: number; d_bad: number; margin: number; noise: number; separates: boolean; row_enforceable: boolean; unenforced_reason: string | null }): void {
  expect(row.known_good.length).toBeGreaterThan(0);
  expect(row.known_bad.length).toBeGreaterThan(0);
  expect(row.known_bad).not.toBe(row.known_good);
  const lo = Math.min(row.d_good, row.d_bad);
  const hi = Math.max(row.d_good, row.d_bad);
  expect(row.threshold).toBeGreaterThan(lo);
  expect(row.threshold).toBeLessThan(hi);
  expect(row.margin_over_noise === null || typeof row.margin_over_noise === "number").toBe(true);
  const consistent = row.noise > 0 && row.margin / row.noise >= 1 && row.d_bad > row.d_good;
  expect(row.enforced).toBe(consistent);
  // RULE 1: no enforced row with d_bad <= d_good.
  expect(row.separates).toBe(row.d_bad > row.d_good);
  expect(row.row_enforceable).toBe(row.enforced);
  if (row.enforced) {
    expect(row.d_bad).toBeGreaterThan(row.d_good);
  } else if (row.d_bad <= row.d_good) {
    expect(row.unenforced_reason ?? "").toMatch(/does not separate/);
  }
}

/** RULE 2: no enforced gate with a non-separating row; threshold is the smallest midpoint. */
function checkGate(gate: Gate): void {
  expect(gate.known_bads.length).toBe(2);
  expect(gate.row_thresholds.length).toBe(2);
  expect(gate.row_enforceable.length).toBe(2);
  if (gate.threshold !== null) {
    expect(gate.threshold).toBe(Math.min(...gate.row_thresholds));
  }
  const allRowsGood = gate.row_enforceable.every(Boolean) &&
    gate.d_bads.every((b) => b !== null && b > gate.d_good);
  expect(gate.enforced).toBe(allRowsGood && gate.threshold !== null);
  if (gate.threshold !== null) {
    const m = gate.body2_match;
    const r = gate.body2_reject;
    if (m.d_eval !== null) expect(m.pass).toBe(m.d_eval < gate.threshold);
    if (r.d_eval !== null) expect(r.pass).toBe(r.d_eval > gate.threshold);
    if (m.pass !== null && r.pass !== null) {
      expect(gate.body2_pass).toBe(m.pass && r.pass);
    }
  }
}

function red(label: string, fn: () => void, want: RegExp): void {
  try {
    fn();
  } catch (e) {
    const msg = (e as Error).message;
    console.log(`KNOWN-BAD-RED ${label}: ${msg.split("\n").pop()}`);
    expect(msg).toMatch(want);
    return;
  }
  throw new Error(`known-bad ${label} passed validation`);
}

describe("skin gates are split by what light can change", () => {
  it("a chosen (b) quantity is unchanged under k-scaling; plain dL is NOT", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gatesplit-"));
    const base = bandFixture(tmp, "base.png");
    const q0 = bandQuantities(base);
    for (const k of [0.5, 2.0]) {
      const qk = bandQuantities(scaledCopy(base, k, tmp));
      for (const band of ["top", "bottom"]) {
        expect(Math.abs(qk[band].logY_face - q0[band].logY_face)).toBeLessThan(0.01);
        expect(Math.abs(qk[band].Lratio_face - q0[band].Lratio_face)).toBeLessThan(0.005);
        // 1.5 deg: module G0_EPS.hue; the k-scaling probe adds an 8-bit
        // round-trip (sRGB toe amplifies channel rounding; RED measured 1.12).
        expect(Math.abs(qk[band].hue - q0[band].hue)).toBeLessThan(1.5);
        expect(Math.abs(qk[band].CdivL - q0[band].CdivL)).toBeLessThan(0.005);
      }
    }
    const q2 = bandQuantities(scaledCopy(base, 2.0, tmp));
    const dLmoved = Math.abs(q2.top.dL_face - q0.top.dL_face) > 0.05 ||
      Math.abs(q2.bottom.dL_face - q0.bottom.dL_face) > 0.05;
    expect(dLmoved).toBe(true);
  }, 180000);

  it("every gate row names known-good + known-bad with the threshold between them", () => {
    const rep = loadReport();
    expect(rep.card).toBe("tsk_bd3b33a3695f8587");
    const rows = [...rep.g1_thresholds, ...rep.g2_thresholds];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) checkRow(row);
    expect(rep.g3.length).toBeGreaterThan(0);
    for (const gate of rep.g3) checkGate(gate);
    // G3 covers every row's gate exactly once per kind/region/quantity.
    const keys = new Set(rows.map((r) => `${r.kind}/${r.region}/${(r as unknown as { channel?: string; quantity?: string }).channel ?? (r as unknown as { quantity?: string }).quantity}`));
    expect(rep.g3.length).toBe(keys.size);
  });

  it("the G0 counterexample (plain dL) is never a kept G2 quantity", () => {
    const rep = loadReport();
    expect(rep.g0.kept).not.toContain("dL_face");
    for (const row of rep.g2_thresholds) {
      expect(row.quantity ?? (row as unknown as { channel_or_quantity: string }).channel_or_quantity).not.toBe("dL_face");
    }
  });

  it("quantities recompute from the store images when present", () => {
    const rep = loadReport();
    const render = path.join(STORE_IOR, "skinior-body2-14a-front.png");
    if (!fs.existsSync(render)) return;
    // Whole-image halves mix skin with dark background (Lab linear segment:
    // hue unstable there), so the recompute runs the module's own region
    // pipeline (--render-quantities) against the report's per-image numbers.
    const rq = JSON.parse(py(["--render-quantities", render])) as {
      Lab: Record<string, [number, number, number]>;
      quantities: Record<string, Record<string, number>>;
    };
    const stored = (rep as unknown as {
      g2_per_image: Record<string, {
        Lab: Record<string, [number, number, number]>;
        quantities: Record<string, Record<string, number>>;
      }>;
    }).g2_per_image.render_body2;
    for (const region of ["forehead", "L_cheek", "R_cheek", "chin", "upperlip_skin"]) {
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(rq.Lab[region][c] - stored.Lab[region][c])).toBeLessThan(0.05);
      }
      expect(Math.abs(rq.quantities[region].hue - stored.quantities[region].hue)).toBeLessThan(0.5);
      expect(Math.abs(rq.quantities[region].CdivL - stored.quantities[region].CdivL)).toBeLessThan(0.005);
      expect(Math.abs(rq.quantities[region].logY_face - stored.quantities[region].logY_face)).toBeLessThan(0.01);
    }
    const albedo = path.join(STORE_FACE, "body2", "run2", "albedo_beard.png");
    if (!fs.existsSync(albedo)) return;
    const means = JSON.parse(py(["--band-quantities", albedo])) as Record<string, Record<string, number>>;
    expect(Object.keys(means)).toContain("top");
  }, 300000);

  it("known-bads fail validation", () => {
    const rep = loadReport();
    const row = rep.g1_thresholds[0];
    red("threshold-outside-interval", () => {
      checkRow({ ...row, threshold: Math.max(row.d_good, row.d_bad) + 1 });
    }, /less than|greater than/);
    red("enforced-flag-flip", () => {
      checkRow({ ...row, enforced: !row.enforced });
    }, /to be true|to be false|Object\.is/);
    red("dL-as-G2-quantity", () => {
      expect(rep.g0.kept).toContain("dL_face");
    }, /to include/);
    const invRow = rep.g1_thresholds.find((r) => r.d_bad <= r.d_good);
    if (invRow) {
      red("inverted-row-enforced", () => {
        checkRow({ ...invRow, enforced: true, row_enforceable: true });
      }, /toBeGreaterThan|to be greater than|to be false/);
    }
    const invGate = rep.g3.find((g) => !g.enforced && g.threshold !== null);
    if (invGate) {
      red("gate-enforced-with-bad-row", () => {
        checkGate({ ...invGate, enforced: true });
      }, /toBe\(false\)|to be false|Object\.is/);
    }
  });
});
