/**
 * The scalp region matches the forehead on the same image.
 *
 * Runs the replayable face-replay compositor (join refresh + locked-island
 * scalp apply, mesh-derived masks) on small tracked fixture crops and
 * asserts the mechanism with self-calibrated bounds: chroma differences
 * against the forehead-temple spread, chroma coverage, boundary gradient
 * against the forehead interior p99, midline asymmetry against the
 * forehead's own, and bit-exact keep-outs. Counterweights: the same asserts
 * fire on the stubble-cap composite, the locked island refuses a wrong sha,
 * and every asserted region spans many rows (never one scanline).
 *
 * Env overrides (RED proofs, not defaults): FACE_REPLAY_BASE=bad points the
 * main asserts at the stubble-cap fixture; FACE_REPLAY_SHA=wrong makes the
 * locked island refuse.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const MODULE = path.join(DIR, "face_replay_compose.py");
const FIX = path.join(DIR, "fixtures");
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(FIX, "manifest.json"), "utf8"),
) as { windows: Record<string, { box_upright_island: number[] }> };

const SHAS: Record<string, string> = {};
for (const win of ["A", "E", "L"]) {
  SHAS[win] = execFileSync("shasum", ["-a", "256",
    path.join(FIX, `locked-${win}.png`)], { encoding: "utf8" })
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

function compose(win: string, mode: "full" | "scalp"): {
  out: string; report: Report;
} {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `frout-${win}-`));
  const baseName = process.env["FACE_REPLAY_BASE"] === "bad" && win === "A"
    ? `base-bad-${win}.png`
    : `base-good-${win}.png`;
  const sha = process.env["FACE_REPLAY_SHA"] === "wrong"
    ? "0".repeat(64)
    : SHAS[win]!;
  const out = path.join(tmp, "out.png");
  const reportPath = path.join(tmp, "report.json");
  const argv = [MODULE,
    "--base-skin", path.join(FIX, baseName),
    "--locked-island", path.join(FIX, `locked-${win}.png`),
    "--locked-sha", sha,
    "--masks", masksDir(win),
    "--input-space", "island-upright",
    "--out", out, "--report", reportPath];
  if (mode === "full") {
    const tile = path.join(tmp, "tile.png");
    execFileSync("python3", ["-c",
      `from PIL import Image;Image.open(${JSON.stringify(path.join(FIX, baseName))}).crop((35,382,35+477,382+130)).save(${JSON.stringify(tile)})`],
    { encoding: "utf8" });
    argv.push("--face-tile", tile, "--face-box", "35", "382", "477", "130");
  } else {
    argv.push("--skip-join");
  }
  execFileSync("python3", argv, { encoding: "utf8" });
  return { out, report: JSON.parse(fs.readFileSync(reportPath, "utf8")) };
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
    asymmetry: Record<string, { dL: number; da: number } | null>;
    boundary_gradient: {
      scalp_band_max: number | null; forehead_interior_p99: number | null;
    };
  };
  exact_zero: Record<string,
    { n: number; rule: string; max_dLab: number | null }>;
};

function checkMechanism(report: Report): void {
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
  const grad = t.boundary_gradient;
  expect(grad.scalp_band_max).toBeTruthy();
  expect(grad.scalp_band_max!)
    .toBeLessThanOrEqual(grad.forehead_interior_p99! * 1.5);
  const fore = t.asymmetry["forehead"];
  if (fore) {
    for (const name of ["crown", "sides"]) {
      const asym = t.asymmetry[name];
      if (asym) {
        expect(asym.dL, `asymmetry dL ${name}`)
          .toBeLessThanOrEqual(Math.max(1.5 * fore.dL, fore.dL + 1.0));
        expect(asym.da, `asymmetry da ${name}`)
          .toBeLessThanOrEqual(Math.max(1.5 * fore.da, fore.da + 1.0));
      }
    }
  }
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

describe("the scalp region matches the forehead", () => {
  it("imports cleanly", () => {
    const out = execFileSync("python3", [MODULE, "--check"],
      { encoding: "utf8" });
    expect(out).toContain("FACE_REPLAY_CHECK ok");
  });

  it("composes window A through join plus scalp inside every bound", () => {
    const { report } = compose("A", "full");
    expect(report.parameters.join_ran).toBe(true);
    checkMechanism(report);
    checkKeepOuts(report,
      ["facecore", "lips", "eyes", "brows", "ears", "neck"]);
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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frbad-"));
    const reportPath = path.join(tmp, "report.json");
    execFileSync("python3", [MODULE, "--evaluate-only",
      "--input", path.join(FIX, "base-bad-A.png"),
      "--masks", masksDir("A"), "--report", reportPath],
    { encoding: "utf8" });
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as Report;
    if (process.env["FACE_REPLAY_RED"] === "bad") {
      checkMechanism(report);
      return;
    }
    const t = report.region_table;
    const spread = t.forehead_temple_spread.dab;
    const chromaFires = t.crown_minus_forehead!.dab > 2 * spread
      || t.sides_minus_temple!.dab > 2 * spread;
    const coverageFires = (t.chroma_coverage_over_forehead["crown"] ?? 0)
        > 0.02
      || (t.chroma_coverage_over_forehead["sides"] ?? 0) > 0.02;
    expect(chromaFires, "chroma bound fires on stubble cap").toBe(true);
    expect(coverageFires, "coverage bound fires on stubble cap").toBe(true);
  }, 240000);

  it("refuses a locked island whose sha does not match", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frsha-"));
    expect(() => execFileSync("python3", [MODULE,
      "--base-skin", path.join(FIX, "base-good-A.png"),
      "--locked-island", path.join(FIX, "locked-A.png"),
      "--locked-sha", "0".repeat(64),
      "--masks", masksDir("A"),
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
      "t=m.region_table(lab,regs)",
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
    expect(MANIFEST.windows["A"].box_upright_island[2]).toBeLessThanOrEqual(512);
  }, 240000);
});
