/**
 * A stored chroma field brings body2 regions to the goal.
 *
 * Validates the tracked regional-chroma-report.json beside this test:
 * the G1 count is recomputed from the recorded region Lab numbers (every
 * region within 3 per channel; chin recorded, not gated), the G2 fit
 * cells and evaluation-patch cells are disjoint, the G3 render-space
 * midline asymmetry of the corrected render is <= the pre_fix bound per
 * channel, and the stored front-render sha recomputes. A fixture-scale
 * replay shows a field-free params file replays byte-identically (the
 * regional field is opt-in; Aisha's path is untouched).
 *
 * Falsifier record (card tsk_3c0e55130d11b3dc): the 8-setting sweep
 * reached G1 3/4 (held-out patches generalise) but no setting holds G3
 * exactly (run-to-run noise is 0): the closest, sweepG, exceeds pre_fix
 * by a* +0.022 / b* +0.006 from key-light response at curved midline,
 * not from a created split (L passes). This test therefore pins the
 * MEASURED miss: G1 recomputes to 3, G2 holds, the G3 per-channel
 * inequality recomputes to [true, false, false], and the recorded
 * g3_pass === false. Any silent change to the numbers breaks it.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "@openclinxr/factory-station-core/runner";
/** Relocated evidence: skin sources stay under tools/ (S4); anchor via the repo-root helper (S5). */
const DIR = path.join(repoRoot(), "tools/openclinxr/asset-pipeline/skin/face-replay");
const MODULE = path.join(DIR, "face_replay_colour.py");
const FIX = path.join(DIR, "fixtures");
const TRACKED = path.join(DIR, "solve-parameters.json");
const REPORT = path.join(DIR, "regional-chroma-report.json");

const BOUND = 3;
const RECORDED_OUT_SHA =
  "d2f30005f28eff51ff2ad0037fa809019f4fd7ef0ab8cc13e24938f2817b57c2";

type RegionEntry = {
  render_Lab: [number, number, number];
  goal_Lab: [number, number, number];
  dLab_render_minus_goal: [number, number, number];
  within_3_per_channel: boolean;
};

type Report = {
  bound_per_channel: number;
  pre_fix: {
    regions: Record<string, RegionEntry>;
    g1_count: number;
    asymmetry: [number, number, number];
    run_to_run_noise: [number, number, number];
  };
  best: {
    regions: Record<string, RegionEntry>;
    g1_count: number;
    asymmetry: [number, number, number];
    fit_cells: [number, number][];
    eval_cells: [number, number][];
  };
  gates: {
    g1_count: number;
    g1_pass: boolean;
    g2_fit_eval_disjoint: boolean;
    g3_per_channel_le_pre_fix: [boolean, boolean, boolean];
    g3_pass: boolean;
  };
  renders: { front: string; front_sha256: string };
};

const REGION_NAMES = [
  "L_cheek",
  "R_cheek",
  "forehead_below_brow",
  "chin",
] as const;

function shaOf(file: string): string {
  return execFileSync("shasum", ["-a", "256", file], { encoding: "utf8" })
    .split(" ")[0]!;
}

function pythonBin(): string {
  return execFileSync("python3",
    ["-c", "import sys;print(sys.executable)"], { encoding: "utf8" }).trim();
}

/** Recompute within-3 flags from recorded Lab numbers; return pass count. */
function g1Count(regions: Record<string, RegionEntry>): {
  count: number; flags: Record<string, boolean>;
} {
  const flags: Record<string, boolean> = {};
  for (const name of REGION_NAMES) {
    const r = regions[name];
    if (!r) throw new Error(`region ${name} missing`);
    for (let c = 0; c < 3; c++) {
      const want = r.render_Lab[c]! - r.goal_Lab[c]!;
      if (Math.abs(want - r.dLab_render_minus_goal[c]!) > 0.015) {
        throw new Error(`DLAB: ${name}[${c}] recorded ${r.dLab_render_minus_goal[c]} != recomputed ${want}`);
      }
    }
    flags[name] = r.dLab_render_minus_goal.every((x) => Math.abs(x) <= BOUND);
    if (flags[name] !== r.within_3_per_channel) {
      throw new Error(`G1_FLAG: ${name} flag disagrees with recorded dLab`);
    }
  }
  return { count: Object.values(flags).filter(Boolean).length, flags };
}

function disjoint(fit: [number, number][], ev: [number, number][]): boolean {
  const s = new Set(fit.map((c) => c.join(",")));
  return !ev.some((c) => s.has(c.join(",")));
}

function g3Le(
  asym: [number, number, number],
  bound: [number, number, number],
): [boolean, boolean, boolean] {
  return [0, 1, 2].map((c) => asym[c]! <= bound[c]!) as [boolean, boolean, boolean];
}

function fixtureParams(inputPng: string, maskPng: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rchr-"));
  const tracked = JSON.parse(fs.readFileSync(TRACKED, "utf8")) as {
    six: number[];
    offset_D_render_minus_albedo: number[];
    source_albedo: { mean: number[]; std: number[]; n: number };
  };
  const params = {
    subject: "fixture",
    method: "global-lab6-v1",
    six: tracked.six,
    offset_D_render_minus_albedo: tracked.offset_D_render_minus_albedo,
    source_albedo: tracked.source_albedo,
    shas: { input_albedo: shaOf(inputPng), albedo_mask: shaOf(maskPng) },
    files: {
      input_albedo: path.basename(inputPng),
      albedo_mask: path.basename(maskPng),
    },
  };
  const dest = path.join(dir, "params.json");
  fs.writeFileSync(dest, `${JSON.stringify(params, null, 1)}\n`);
  return dest;
}

function replayFieldFree(inputPng: string, maskPng: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rchf-"));
  const out = path.join(tmp, "out.png");
  execFileSync(pythonBin(), [MODULE, "--replay",
    "--input-albedo", inputPng, "--albedo-mask", maskPng,
    "--params", fixtureParams(inputPng, maskPng), "--out", out],
  { encoding: "utf8" });
  return out;
}

describe("a stored chroma field brings body2 regions to the goal", () => {
  it("pre_fix candidate fails G1 (RED, recorded)", () => {
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    const { count, flags } = g1Count(report.pre_fix.regions);
    console.log(`KNOWN-BAD-RED pre_fix G1: ${count}/4 passes ` +
      `(L_cheek/forehead/chin over bound; defect recorded)`);
    expect(count, "pre_fix reaches only 1 of 4 regions").toBe(1);
    expect(flags["R_cheek"], "only R_cheek passes pre_fix").toBe(true);
  });

  it("best section honestly measures G1 3/4 with G2 disjoint", () => {
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    const { count, flags } = g1Count(report.best.regions);
    expect(count, "G1: 3 of 4 regions within 3 per channel").toBe(3);
    expect(report.gates.g1_count, "recorded G1 count matches").toBe(3);
    expect({ ...flags, chin: undefined },
      "L/R cheek + forehead pass, chin recorded not gated").toEqual({
      L_cheek: true, R_cheek: true, forehead_below_brow: true,
      chin: undefined,
    });
    expect(flags["chin"], "chin recorded as failing (stubble)").toBe(false);
    expect(disjoint(report.best.fit_cells, report.best.eval_cells),
      "G2: fit cells and evaluation-patch cells are disjoint").toBe(true);
    expect(report.gates.g2_fit_eval_disjoint).toBe(true);
    expect(shaOf(report.renders.front),
      "stored front render recomputes to the recorded sha")
      .toBe(report.renders.front_sha256);
  });

  it("G3 miss pinned: [true,false,false], g3_pass false", () => {
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    expect(report.pre_fix.run_to_run_noise, "zero measured noise").toEqual([0, 0, 0]);
    const le = g3Le(report.best.asymmetry, report.pre_fix.asymmetry);
    console.log(`G3-PIN best ${report.best.asymmetry} vs pre_fix ` +
      `${report.pre_fix.asymmetry} -> [${le}] (a* +0.022, b* +0.006)`);
    expect(le, "G3 inequality recomputes from recorded numbers")
      .toEqual([true, false, false]);
    expect(report.gates.g3_per_channel_le_pre_fix).toEqual([true, false, false]);
    expect(report.gates.g3_pass, "recorded G3 verdict is the measured miss")
      .toBe(false);
  });

  it("fixture-scale field-free params replay byte-identically", () => {
    const input = path.join(FIX, "base-good-A.png");
    const mask = path.join(FIX, "mask-facecore-A.png");
    const first = replayFieldFree(input, mask);
    const second = replayFieldFree(input, mask);
    expect(shaOf(second), "two runs agree bit-exactly").toBe(shaOf(first));
    expect(shaOf(first), "field-free replay equals the recorded Aisha sha")
      .toBe(RECORDED_OUT_SHA);
  }, 240000);
});
