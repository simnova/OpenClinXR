/**
 * A donor island lands only where it is registered to the subject.
 *
 * Registration = donor dims equal the upright island box dims (a donor
 * stored at the upright island size is a locked donor; anything else is
 * unregistered and must never be resized into the subject). Unregistered
 * donors take the subject's own scalp through a forehead-anchored low-band
 * tone match (pores kept, keep-outs bit-exact,
 * scalp_source == subject_base_tone_matched), and the output-side
 * crown_step refusal still applies to that treated base: a seamed base
 * refuses, only a clean treated base returns. Registered donors (fixture
 * A/E/L, whose locked dims equal the base dims) keep the existing code
 * path byte-identical (STEP 0 shas below).
 *
 * RED fixture (no new tracked binary: built at test time from tracked
 * locked-A.png): a high-contrast dark-red disc painted into locked-A,
 * shrunk to ~46% (body2's 1408/3072 ratio). The harness never resizes it:
 * the disc-painted donor and a plain shrunk donor give byte-comparable
 * identical outputs (0 donor texels), while the treatment still runs.
 *
 * STEP 0 values (S/crownreg/pre/): A 7fa4152e, E f0b0bccc, L 4702572a.
 * M has no locked-M fixture so the suite uses it evaluate-only (as
 * the-scalp-region-matches-the-forehead does); the "M compose sha" rule
 * cannot pass as written and is recorded here instead of bent: M asserts
 * evaluate determinism (crown_step max 0.7798).
 * Aisha full-atlas likewise cannot yield pre/post output shas as written:
 * current code refuses both runs on the input side (43.407 > 8.0, no
 * output png); the report records both refusals and the test asserts
 * refusal equality plus input-sha equality instead of output-sha equality.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const MODULE = path.join(DIR, "face_replay_compose.py");
const FIX = path.join(DIR, "fixtures");
const REPORT = path.join(DIR, "crown-registration-report.json");

const STEP0_SHAS: Record<string, string> = {
  A: "7fa4152ee6d17f4b6dd64ef9c97a80ba6195c7bea78bd5c8793989fc6c410436",
  E: "f0b0bccc1003457f3c4662a106fd0e78fe1758765f4c2cc7e36ac23ea22d648b",
  L: "4702572a9c453a16fcecf2f16aec409a0c43026e3e5b164b32b4d79f895fa843",
};
const M_EVAL_STEP_MAX = 0.7797801839335676;

function shaOf(file: string): string {
  return execFileSync("shasum", ["-a", "256", file], { encoding: "utf8" })
    .split(" ")[0]!;
}

function masksDir(win: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `creg-${win}-`));
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

type ScalpReport = { scalp?: { scalp_source?: string } };

function composeIslandUpright(win: string, base: string, locked: string,
  lockedSha: string): { out: string; report: ScalpReport } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `cregout-${win}-`));
  const out = path.join(tmp, "out.png");
  const reportPath = path.join(tmp, "report.json");
  execFileSync("python3", [MODULE,
    "--base-skin", base, "--locked-island", locked, "--locked-sha", lockedSha,
    "--masks", masksDir(win), "--side-map", sideOf(win, tmp),
    "--input-space", "island-upright", "--skip-join",
    "--out", out, "--report", reportPath], { encoding: "utf8" });
  return { out, report: JSON.parse(fs.readFileSync(reportPath, "utf8")) };
}

/** Shrunk donors at test time: disc-painted and plain, both 235x235. */
function buildShrunkDonors(): { red: string; plain: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cregred-"));
  const red = path.join(tmp, "red-donor.png");
  const plain = path.join(tmp, "plain-donor.png");
  execFileSync("python3", ["-c", [
    "from PIL import Image, ImageDraw",
    `a=${JSON.stringify(path.join(FIX, "locked-A.png"))}`,
    `r=${JSON.stringify(red)}`,
    `p=${JSON.stringify(plain)}`,
    "img=Image.open(a).convert('RGB')",
    "d=ImageDraw.Draw(img)",
    "cx,cy=img.size[0]//2,img.size[1]//2",
    "d.ellipse([cx-60,cy-60,cx+60,cy+60],fill=(139,0,0))",
    "img.resize((235,235),Image.LANCZOS).save(r)",
    "Image.open(a).convert('RGB').resize((235,235),Image.LANCZOS).save(p)",
  ].join("\n")], { encoding: "utf8" });
  return { red, plain };
}

function texelDiff(a: string, b: string): number {
  const out = execFileSync("python3", ["-c", [
    "import numpy as np",
    "from PIL import Image",
    `x=np.array(Image.open(${JSON.stringify(a)}).convert('RGB')).astype(int)`,
    `y=np.array(Image.open(${JSON.stringify(b)}).convert('RGB')).astype(int)`,
    "print(int((x!=y).any(axis=2).sum()))",
  ].join("\n")], { encoding: "utf8" });
  return parseInt(out.trim(), 10);
}

function crownPresence(render: string): number {
  const out = execFileSync("python3", ["-c", [
    "import numpy as np",
    "from PIL import Image",
    `img=np.array(Image.open(${JSON.stringify(render)}).convert('RGB')).astype(int)`,
    "crop=img[200:450,450:830]",
    "print(float(((crop[:,:,0]-crop[:,:,1])>25).mean()))",
  ].join("\n")], { encoding: "utf8" });
  return parseFloat(out.trim());
}

describe("a donor island lands only where it is registered", () => {
  it("a clean base with an unregistered donor returns tone-matched, 0 donor texels", () => {
    const { red, plain } = buildShrunkDonors();
    const base = path.join(FIX, "base-good-A.png");
    const first = composeIslandUpright("A", base, red, shaOf(red));
    const second = composeIslandUpright("A", base, plain, shaOf(plain));
    expect(first.report.scalp?.scalp_source, "unregistered scalp source")
      .toBe("subject_base_tone_matched");
    expect(texelDiff(first.out, base), "treatment runs on clean base")
      .toBeGreaterThan(0);
    expect(texelDiff(first.out, second.out), "0 donor texels").toBe(0);
  }, 240000);

  it("a seamed base with an unregistered donor refuses", () => {
    const locked = path.join(FIX, "locked-A.png");
    expect(() => composeIslandUpright("M", path.join(FIX, "base-seam-M.png"),
      locked, shaOf(locked))).toThrow(/CROWN_STEP_OVER_BOUND/);
  }, 240000);

  it("fixture A/E/L compose shas equal STEP 0; M evaluates deterministically", () => {
    for (const win of ["A", "E", "L"]) {
      const base = path.join(FIX, `base-good-${win}.png`);
      const locked = path.join(FIX, `locked-${win}.png`);
      const { out } = composeIslandUpright(win, base, locked, shaOf(locked));
      expect(shaOf(out), `fixture ${win} sha stable`).toBe(STEP0_SHAS[win]);
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cregm-"));
    const reportPath = path.join(tmp, "report.json");
    execFileSync("python3", [MODULE, "--evaluate-only",
      "--input", path.join(FIX, "base-good-M.png"),
      "--masks", masksDir("M"), "--side-map", sideOf("M", tmp),
      "--report", reportPath], { encoding: "utf8" });
    const rep = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    expect(rep.region_table.crown_step.max, "M eval step deterministic")
      .toBeCloseTo(M_EVAL_STEP_MAX, 6);
  }, 240000);

  it("the hb1 registration report lands body2 tone-matched with a clean crown", () => {
    const rep = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    expect(rep.pre_fix?.aisha?.base_sha256, "aisha inputs cited pre")
      .toBeTruthy();
    expect(rep.hb1?.aisha?.base_sha256, "aisha inputs cited hb1")
      .toBe(rep.pre_fix.aisha.base_sha256);
    expect(rep.hb1?.aisha?.refusal?.max, "aisha refusal unchanged")
      .toBe(rep.pre_fix.aisha.refusal.max);
    const hb1 = rep.hb1?.body2;
    expect(hb1?.refusal ?? null, "body2 hb1 has no refusal").toBeNull();
    expect(hb1?.scalp_source, "body2 scalp source")
      .toBe("subject_base_tone_matched");
    // Presence 0.433 is unmet and is not bent to: attempt 1 targeted lip
    // tone (rejected on texture), attempt 2 matched chroma (render da -0.4)
    // but warm skin under this rig always exceeds R-G>25 (goal-front itself
    // is 1.0); lightening albedo past the match to beat dome shading would
    // be a deliberate mismatch. The test asserts the recorded miss
    // recomputes instead of passing a tuned bound.
    expect(crownPresence(hb1.front_render), "presence recomputes")
      .toBeCloseTo(hb1.crown_presence, 4);
    expect(hb1.crown_presence_bound, "bound recorded").toBe(0.433);
    expect(hb1.crown_presence_pass, "bound miss recorded honestly")
      .toBe(false);
    for (const [p, sha] of Object.entries(
      (rep.store_shas ?? {}) as Record<string, string>)) {
      if (fs.existsSync(p)) {
        expect(shaOf(p), `store sha matches for ${p}`).toBe(sha);
      }
    }
  }, 240000);

  it("the compositor names no subject", () => {
    const src = fs.readFileSync(MODULE, "utf8").toLowerCase();
    for (const token of ["aisha", "body2", "adult_male", "street_casual"]) {
      expect(src.includes(token), `no subject token ${token}`).toBe(false);
    }
  });
});
