/**
 * The tone is solved per region and a painted scalp refuses.
 *
 * Validates the tracked regional-report.json beside this test: the AFTER render
 * sha is cited from renders[], no fabricated after==goal pass, mask
 * means stay out of the dark (L>=20, n>=500), and the G1 verdict matches
 * the per-region flags. Compose-level: window A passes inside the bound
 * while a painted scalp (bad-A, seam-M) refuses with crown_step over
 * bound naming no scalp source.
 *
 * Known-bads, each asserted to fail validation (the raw refusal is
 * printed as KNOWN-BAD-RED before the throw assertion): (a) is now the
 * unregistered-donor contract (cross-window donor returns the base with
 * scalp_source subject_base, pixel-identical); (b) a report with
 * after==goal on every channel of every region; (c) an AFTER citing a
 * render sha not listed in renders[]; (d) a mask mean L below 20.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const MODULE = path.join(DIR, "face_replay_compose.py");
const FIX = path.join(DIR, "fixtures");
const REPORT = path.join(
  DIR, "regional-report.json");

const REGIONS = ["L_cheek", "R_cheek", "forehead", "chin"] as const;
const BOUND = 3;

function shaOf(file: string): string {
  return execFileSync("shasum", ["-a", "256", file], { encoding: "utf8" })
    .split(" ")[0]!;
}

type RegionalReport = {
  renders: Record<string, string>;
  after: { render: string; render_sha: string };
  regions: Record<string, {
    goal: [number, number, number];
    before: { Lab: [number, number, number]; dLab_vs_goal: [number, number, number]; pass: boolean };
    after_v2: { Lab: [number, number, number]; dLab_vs_goal: [number, number, number]; pass: boolean };
  }>;
  g1: { bound_Lab_per_channel: number; per_region: Record<string, boolean>; verdict: string };
  masks: Record<string, {
    keep_n: number;
    regions: Record<string, [number, number]>;
  }>;
};

/** Throws on any contract breach; returns the G1 verdict on valid input. */
function validateRegional(report: RegionalReport): string {
  for (const name of REGIONS) {
    const r = report.regions[name];
    if (!r || !Array.isArray(r.goal) || r.goal.length !== 3) {
      throw new Error(`region ${name} missing goal triple`);
    }
  }
  if (!Object.values(report.renders).includes(report.after.render_sha)) {
    throw new Error("NOT_IN_RENDERS: AFTER sha cites no listed render");
  }
  const allZero = REGIONS.every((name) =>
    report.regions[name].after_v2.dLab_vs_goal.every((x) => x === 0));
  if (allZero) {
    throw new Error("FABRICATED_PASS: after==goal every channel " +
      "every region is a painted pass, not a measurement");
  }
  for (const [tag, m] of Object.entries(report.masks)) {
    for (const [name, [n, meanL]] of Object.entries(m.regions)) {
      if (n < 500) throw new Error(`MASK_COUNT: ${tag}/${name} n=${n}`);
      if (meanL < 20) {
        throw new Error(`MASK_DARK: ${tag}/${name} mean L=${meanL}`);
      }
    }
  }
  for (const name of REGIONS) {
    const d = report.regions[name].after_v2.dLab_vs_goal;
    const pass = d.every((x) => Math.abs(x) <= BOUND);
    if (report.g1.per_region[name] !== pass) {
      throw new Error(`G1_FLAG: ${name} flag disagrees with dLab`);
    }
  }
  const verdict = Object.values(report.g1.per_region).every(Boolean)
    ? "PASS" : "FAIL";
  if (report.g1.verdict !== verdict) {
    throw new Error(`G1_VERDICT: report says ${report.g1.verdict}`);
  }
  return verdict;
}

function loadReport(file: string): RegionalReport {
  return JSON.parse(fs.readFileSync(file, "utf8")) as RegionalReport;
}

function masksDir(win: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tone-${win}-`));
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

function runCompose(win: string, base: string, lockedWin: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `toneout-${win}-`));
  const locked = path.join(FIX, `locked-${lockedWin}.png`);
  return execFileSync("python3", [MODULE,
    "--base-skin", path.join(FIX, base),
    "--locked-island", locked, "--locked-sha", shaOf(locked),
    "--masks", masksDir(win), "--side-map", sideOf(win, tmp),
    "--input-space", "island-upright", "--skip-join",
    "--out", path.join(tmp, "out.png"),
    "--report", path.join(tmp, "report.json")],
  { encoding: "utf8" });
}

function red(label: string, bad: RegionalReport): void {
  try {
    validateRegional(bad);
  } catch (e) {
    console.log(`KNOWN-BAD-RED ${label}: ${(e as Error).message}`);
    return;
  }
  throw new Error(`known-bad ${label} passed validation`);
}

function clone(): RegionalReport {
  return JSON.parse(fs.readFileSync(REPORT, "utf8")) as RegionalReport;
}

describe("tone solved per region, painted scalp refuses", () => {
  it("the tracked regional report validates and lands G1 FAIL honestly", () => {
    expect(validateRegional(loadReport(REPORT))).toBe("FAIL");
  });

  it("good scalp passes compose inside the bound", () => {
    const out = runCompose("A", "base-good-A.png", "A");
    expect(out).not.toMatch(/CROWN_STEP_OVER_BOUND/);
  }, 240000);

  it("a painted scalp refuses: crown_step over bound, no scalp source", () => {
    expect(() => runCompose("A", "base-bad-A.png", "A"))
      .toThrow(/CROWN_STEP_OVER_BOUND/);
  }, 240000);

  it("unregistered donor (a): cross-window donor returns base, no refusal", () => {
    // Registration contract (crown-registered card): a donor whose dims
    // differ from the upright island is never resized; the scalp comes
    // from the subject base with no refusal. base-seam-M (448) with
    // locked-A (512) is that case: it previously threw
    // CROWN_STEP_OVER_BOUND and now returns the base untouched.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toneunreg-"));
    const out = path.join(tmp, "out.png");
    const reportPath = path.join(tmp, "report.json");
    const locked = path.join(FIX, "locked-A.png");
    execFileSync("python3", [MODULE,
      "--base-skin", path.join(FIX, "base-seam-M.png"),
      "--locked-island", locked, "--locked-sha", shaOf(locked),
      "--masks", masksDir("M"), "--side-map", sideOf("M", tmp),
      "--input-space", "island-upright", "--skip-join",
      "--out", out, "--report", reportPath], { encoding: "utf8" });
    const rep = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    expect(rep.scalp?.scalp_source).toBe("subject_base");
    const diff = execFileSync("python3", ["-c", [
      "import numpy as np",
      "from PIL import Image",
      `x=np.array(Image.open(${JSON.stringify(out)}).convert('RGB')).astype(int)`,
      `y=np.array(Image.open(${JSON.stringify(path.join(FIX, "base-seam-M.png"))}).convert('RGB')).astype(int)`,
      "print(int((x!=y).any(axis=2).sum()))",
    ].join("\n")], { encoding: "utf8" });
    expect(parseInt(diff.trim(), 10)).toBe(0);
  }, 240000);

  it("known-bad (b): after==goal every channel every region fails", () => {
    const bad = clone();
    for (const name of REGIONS) {
      const r = bad.regions[name];
      r.after_v2 = {
        Lab: [...r.goal] as [number, number, number],
        dLab_vs_goal: [0, 0, 0],
        pass: true,
      };
    }
    red("(b)", bad);
    expect(() => validateRegional(bad)).toThrow(/FABRICATED_PASS/);
  });

  it("known-bad (c): AFTER citing an unlisted render sha fails", () => {
    const bad = clone();
    bad.after.render_sha = "f".repeat(64);
    red("(c)", bad);
    expect(() => validateRegional(bad)).toThrow(/NOT_IN_RENDERS/);
  });

  it("known-bad (d): mask mean L below 20 fails", () => {
    const bad = clone();
    bad.masks["goal"].regions["chin"] = [708, 10.0];
    red("(d)", bad);
    expect(() => validateRegional(bad)).toThrow(/MASK_DARK/);
  });
});
