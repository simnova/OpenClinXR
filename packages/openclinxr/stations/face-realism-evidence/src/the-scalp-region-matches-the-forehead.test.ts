/**
 * The scalp region matches the forehead on the same image.
 *
 * Runs the replayable face-replay compositor (join refresh + locked-island
 * scalp apply, mesh-derived masks, mesh-side halves) on small tracked
 * fixture crops and asserts the mechanism with self-calibrated bounds:
 * chroma against the forehead-temple spread, chroma coverage, the interior
 * crown step, mesh-side midline asymmetry, and bit-exact keep-outs.
 * Counterweights, each its own fixture-backed test in this suite: the
 * stubble-cap composite fires chroma/coverage/step, the rejected midline
 * seam fires asymmetry/step, a wrong locked-island sha refuses, and every
 * asserted region spans many rows (never one scanline).
 *
 * Window roles (manifest): A carries chroma/coverage/step/keep-outs (it
 * sits 80% on one mesh side, so asymmetry lives in M); E carries ears;
 * L carries lips/eyes; M is the balanced midline window for asymmetry.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "@openclinxr/factory-station-core/runner";
/** Relocated evidence: skin sources stay under tools/ (S4); anchor via the repo-root helper (S5). */
const DIR = path.join(repoRoot(), "tools/openclinxr/asset-pipeline/skin/face-replay");
const MODULE = path.join(DIR, "face_replay_compose.py");
const FIX = path.join(DIR, "fixtures");

function shaOf(file: string): string {
  return execFileSync("shasum", ["-a", "256", file], { encoding: "utf8" })
    .split(" ")[0]!;
}

function masksDir(win: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `frm-${win}-`));
  for (const role of ["facecore", "scalp", "ears-L", "ears-R", "neck",
    "brows-L", "brows-R", "lips", "eyes-L", "eyes-R"]) {
    fs.copyFileSync(path.join(FIX, `mask-${role}-${win}.png`),
      path.join(dir, `mask-${role}.png`));
  }
  return dir;
}

function sideOf(win: string, dir: string): string {
  const dest = path.join(dir, "side.png");
  fs.copyFileSync(path.join(FIX, `side-${win}.png`), dest);
  return dest;
}

function compose(win: string, mode: "full" | "scalp"): {
  out: string; report: Report;
} {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `frout-${win}-`));
  const masks = masksDir(win);
  const argv = [MODULE,
    "--base-skin", path.join(FIX, `base-good-${win}.png`),
    "--locked-island", path.join(FIX, `locked-${win}.png`),
    "--locked-sha", shaOf(path.join(FIX, `locked-${win}.png`)),
    "--masks", masks, "--side-map", sideOf(win, tmp),
    "--input-space", "island-upright",
    "--out", path.join(tmp, "out.png"),
    "--report", path.join(tmp, "report.json")];
  if (mode === "full") {
    const tile = path.join(tmp, "tile.png");
    execFileSync("python3", ["-c",
      `from PIL import Image;Image.open(${JSON.stringify(path.join(FIX, "base-good-A.png"))}).crop((35,382,35+477,382+130)).save(${JSON.stringify(tile)})`],
    { encoding: "utf8" });
    argv.push("--face-tile", tile, "--face-box", "35", "382", "477", "130");
  } else {
    argv.push("--skip-join");
  }
  execFileSync("python3", argv, { encoding: "utf8" });
  return {
    out: path.join(tmp, "out.png"),
    report: JSON.parse(
      fs.readFileSync(path.join(tmp, "report.json"), "utf8")),
  };
}

function evaluate(image: string, win: string): Report {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "freval-"));
  const reportPath = path.join(tmp, "report.json");
  execFileSync("python3", [MODULE, "--evaluate-only",
    "--input", image, "--masks", masksDir(win),
    "--side-map", sideOf(win, tmp), "--report", reportPath],
  { encoding: "utf8" });
  return JSON.parse(fs.readFileSync(reportPath, "utf8")) as Report;
}

type Region = { n: number; mean_Lab: [number, number, number] | null };
type Report = {
  parameters: { join_ran: boolean };
  region_table: {
    regions: Record<string, Region>;
    forehead_temple_spread: { da: number; db: number; dab: number };
    crown_minus_forehead: { dab: number } | null;
    sides_minus_temple: { dab: number } | null;
    chroma_coverage_over_forehead: Record<string, number | null>;
    asymmetry: Record<string, {
      dL: number; da: number; db: number;
      n_left: number; n_right: number; ratio: number;
    } | null>;
    crown_step: { max: number | null; bound: number };
  };
  exact_zero: Record<string,
    { n: number; rule: string; max_dLab: number | null }>;
};

function checkChroma(report: Report): void {
  const t = report.region_table;
  const spread = t.forehead_temple_spread.dab;
  expect(t.crown_minus_forehead, "crown region present").toBeTruthy();
  expect(t.crown_minus_forehead!.dab)
    .toBeLessThanOrEqual(2 * spread);
  expect(t.sides_minus_temple, "sides region present").toBeTruthy();
  expect(t.sides_minus_temple!.dab).toBeLessThanOrEqual(2 * spread);
  for (const name of ["crown", "sides", "back"]) {
    const cov = t.chroma_coverage_over_forehead[name];
    if (cov !== null && cov !== undefined) {
      expect(cov, `coverage ${name}`).toBeLessThanOrEqual(0.02);
    }
  }
}

function checkStep(report: Report): void {
  const step = report.region_table.crown_step;
  expect(step.max, "crown step measured").not.toBeNull();
  expect(step.max!).toBeLessThanOrEqual(step.bound);
}

function checkKeepOuts(report: Report, roles: string[]): void {
  for (const role of roles) {
    const entry = report.exact_zero[role];
    expect(entry, `keep-out ${role} reported`).toBeTruthy();
    if (entry.n > 0) {
      expect(entry.max_dLab, `keep-out ${role} bit-exact`).toBe(0);
    }
  }
}

function checkAsymmetry(report: Report): void {
  const asym = report.region_table.asymmetry;
  for (const name of ["forehead", "crown", "sides"]) {
    const entry = asym[name];
    expect(entry, `halves present for ${name}`).toBeTruthy();
    expect(entry!.n_left).toBeGreaterThanOrEqual(500);
    expect(entry!.n_right).toBeGreaterThanOrEqual(500);
    expect(entry!.ratio, `half balance ${name}`).toBeGreaterThanOrEqual(0.9);
    expect(entry!.ratio, `half balance ${name}`).toBeLessThanOrEqual(1.1);
  }
  const fore = asym["forehead"]!;
  const crown = asym["crown"]!;
  expect(crown.dL, "crown midline step within forehead's")
    .toBeLessThanOrEqual(fore.dL);
}

describe("the scalp region matches the forehead", () => {
  it("imports cleanly", () => {
    const out = execFileSync("python3", [MODULE, "--check"],
      { encoding: "utf8" });
    expect(out).toContain("FACE_REPLAY_CHECK ok");
  });

  it("composes window A through join plus scalp inside every bound", () => {
    const { report } = compose("A", "full");
    expect(report.parameters.join_ran).toBe(true);
    checkChroma(report);
    checkStep(report);
    checkKeepOuts(report,
      ["facecore", "lips", "eyes", "brows", "ears", "neck"]);
  }, 240000);

  it("matches halves on the balanced midline window", () => {
    const report = evaluate(path.join(FIX, "base-good-M.png"), "M");
    checkAsymmetry(report);
    checkStep(report);
  }, 240000);

  it("fires step on the rejected patchy seam, records its halves", () => {
    // Texture-space finding (see module docstring): the rejected attempt
    // is bilateral-central patchiness plus a unilateral flank patch. A
    // 512-crop that balances halves necessarily excludes most of the
    // flank patch, so L/R tone here agrees (0.05 vs 0.12, recorded not
    // gated); the blotch edges fire the step clause instead. Full-size
    // halves diverge 2.22 vs forehead 1.89 (see G1 evidence).
    const report = evaluate(path.join(FIX, "base-seam-M.png"), "M");
    const asym = report.region_table.asymmetry;
    const fore = asym["forehead"]!;
    const crown = asym["crown"]!;
    expect(fore.ratio).toBeGreaterThanOrEqual(0.9);
    expect(fore.ratio).toBeLessThanOrEqual(1.1);
    expect(crown.ratio).toBeGreaterThanOrEqual(0.9);
    expect(crown.ratio).toBeLessThanOrEqual(1.1);
    const step = report.region_table.crown_step;
    expect(step.max!, "seam step fires").toBeGreaterThan(step.bound);
  }, 240000);

  it("keeps ears exact on window E", () => {
    const { report } = compose("E", "scalp");
    checkKeepOuts(report, ["facecore", "ears", "brows", "neck"]);
    expect(report.exact_zero["ears"].n).toBeGreaterThan(1000);
  }, 240000);

  it("keeps lips and eyes exact on window L", () => {
    const { report } = compose("L", "scalp");
    checkKeepOuts(report,
      ["facecore", "lips", "eyes", "brows", "ears", "neck"]);
    expect(report.exact_zero["lips"].n).toBeGreaterThan(1000);
    expect(report.exact_zero["eyes"].n).toBeGreaterThan(1000);
  }, 240000);

  it("fires every mechanism bound on the stubble-cap composite", () => {
    const report = evaluate(path.join(FIX, "base-bad-A.png"), "A");
    const t = report.region_table;
    const spread = t.forehead_temple_spread.dab;
    const chromaFires = t.crown_minus_forehead!.dab > 2 * spread
      || t.sides_minus_temple!.dab > 2 * spread;
    const coverageFires = (t.chroma_coverage_over_forehead["crown"] ?? 0)
        > 0.02
      || (t.chroma_coverage_over_forehead["sides"] ?? 0) > 0.02;
    expect(chromaFires, "chroma bound fires on stubble cap").toBe(true);
    expect(coverageFires, "coverage bound fires on stubble cap").toBe(true);
    expect(t.crown_step.max!, "step bound fires on stubble cap")
      .toBeGreaterThan(t.crown_step.bound);
  }, 240000);

  it("refuses a locked island whose sha does not match", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frsha-"));
    const masks = masksDir("A");
    expect(() => execFileSync("python3", [MODULE,
      "--base-skin", path.join(FIX, "base-good-A.png"),
      "--locked-island", path.join(FIX, "locked-A.png"),
      "--locked-sha", "0".repeat(64),
      "--masks", masks, "--side-map", sideOf("A", tmp),
      "--input-space", "island-upright", "--skip-join",
      "--out", path.join(tmp, "out.png"),
      "--report", path.join(tmp, "report.json")],
    { encoding: "utf8" })).toThrow(/LOCKED_ISLAND_SHA_MISMATCH/);
  }, 240000);

  it("measures regions across many rows, never one scanline", () => {
    const probe = execFileSync("python3", ["-c", [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(DIR)})`,
      "import numpy as np",
      "import face_replay_compose as m",
      `F=${JSON.stringify(FIX)}`,
      "img=m.load_rgb(F+'/base-bad-A.png')",
      "roles=['facecore','scalp','ears-L','ears-R','neck','brows-L'," +
        "'brows-R','lips','eyes-L','eyes-R']",
      "masks={r:m.load_mask(F+'/mask-'+r+'-A.png') for r in roles}",
      "regs=m.regions_from_masks(masks)",
      "lab=m.lab_of(img)",
      "t=m.region_table(lab,regs,m.load_side(F+'/side-A.png'),0.125)",
      "ch=(lab[:,:,1]**2+lab[:,:,2]**2)**0.5",
      "cr=regs['crown']",
      "rows=[r for r in range(cr.shape[0]) if cr[r].any()]",
      "per=[float((ch[r][cr[r]]>t['chroma_threshold']).mean()) for r in rows]",
      "mid=per[len(per)//2]",
      "print(json.dumps({'rows':len(rows),'std':float(np.std(per))," +
        "'gap':abs(mid-t['chroma_coverage_over_forehead']['crown'])}))",
    ].join("\n")], { encoding: "utf8" });
    const scan = JSON.parse(probe) as {
      rows: number; std: number; gap: number;
    };
    expect(scan.rows, "crown region row span").toBeGreaterThanOrEqual(16);
    expect(scan.std, "scanlines disagree across the region")
      .toBeGreaterThan(0.05);
    expect(scan.gap, "one middle scanline misjudges the region")
      .toBeGreaterThan(0.05);
    for (const role of ["facecore", "scalp", "brows-R", "eyes-R"]) {
      const mask = `mask-${role}-A.png`;
      const rows = execFileSync("python3", ["-c",
        `import numpy as np;from PIL import Image;a=np.array(Image.open(${JSON.stringify(path.join(FIX, mask))}).convert('L'));print((a>127).any(axis=1).sum())`],
      { encoding: "utf8" });
      expect(parseInt(rows.trim(), 10), `rows in ${mask}`)
        .toBeGreaterThanOrEqual(16);
    }
  }, 240000);
});
