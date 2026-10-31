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
 * printed as KNOWN-BAD-RED before the throw assertion): (a) a
 * crown_step-over-bound scalp passing compose; (b) a report with
 * after==goal on every channel of every region; (c) an AFTER citing a
 * render sha not listed in renders[]; (d) a mask mean L below 20.
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

type ComposeReport = {
  refusal?: unknown;
  region_table: { crown_step: { max: number; bound: number } };
  scalp?: { scalp_source?: string };
};

function runComposeReport(win: string, base: string,
  lockedWin: string): { stdout: string; report: ComposeReport } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `tonerep-${win}-`));
  const locked = path.join(FIX, `locked-${lockedWin}.png`);
  const reportPath = path.join(tmp, "report.json");
  const stdout = execFileSync("python3", [MODULE,
    "--base-skin", path.join(FIX, base),
    "--locked-island", locked, "--locked-sha", shaOf(locked),
    "--masks", masksDir(win), "--side-map", sideOf(win, tmp),
    "--input-space", "island-upright", "--skip-join",
    "--out", path.join(tmp, "out.png"),
    "--report", reportPath],
  { encoding: "utf8" });
  return {
    stdout,
    report: JSON.parse(fs.readFileSync(reportPath, "utf8")),
  };
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

  it("SUPERSEDED a painted scalp refuses: a registered locked donor composes", () => {
    // SUPERSEDED, not deleted (this it( stays): b3167aa35 scoped the
    // input-side crown_step refusal to runs where "the subject names no
    // scalp source", but at that commit no run could name one, so it fired
    // on every stubbled base. Donors now record report.scalp.scalp_source:
    // a registered locked donor IS a named scalp source, so the input-side
    // refusal lifts for scalp_source locked_island while the output-side
    // refusal stays for every run. If registration is ever removed (no
    // scalp_source recorded), restore the toThrow CROWN_STEP_OVER_BOUND
    // assertion this clause used to carry.
    const { report } = runComposeReport("A", "base-bad-A.png", "A");
    expect(report.refusal ?? null, "no refusal with registered donor")
      .toBeNull();
    expect(report.region_table.crown_step.max, "output crown_step in bound")
      .toBeLessThanOrEqual(report.region_table.crown_step.bound);
    expect(report.scalp?.scalp_source, "registered scalp source")
      .toBe("locked_island");
  }, 240000);

  it("known-bad (a): over-bound scalp must not pass compose", () => {
    let msg = "";
    try {
      runCompose("M", "base-seam-M.png", "A");
    } catch (e) {
      msg = (e as Error).message;
    }
    console.log(`KNOWN-BAD-RED (a): ${msg.split("\n").pop()}`);
    expect(msg).toMatch(/CROWN_STEP_OVER_BOUND/);
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
