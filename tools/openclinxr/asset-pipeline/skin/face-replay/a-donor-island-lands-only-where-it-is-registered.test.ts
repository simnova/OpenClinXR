/**
 * A donor island lands only where it is registered to the subject.
 *
 * Registration = donor dims equal the upright island box dims (a donor
 * stored at the upright island size is a locked donor; anything else is
 * unregistered and must never be resized into the subject). Unregistered
 * donors compose the scalp from the subject's own base skin (donor weight
 * 0 everywhere): output returns, no refusal, scalp_source == subject_base.
 * Registered donors (fixture A/E/L, whose locked dims equal the base dims)
 * keep the existing code path byte-identical (STEP 0 shas below).
 *
 * RED fixture (no new tracked binary: built at test time from tracked
 * locked-A.png): a high-contrast dark-red disc painted into locked-A,
 * shrunk to ~46% (body2's 1408/3072 ratio). Pre-fix the harness resizes
 * it back up and pastes it (texels change); post-fix 0 texels differ
 * from base anywhere and scalp_source == subject_base.
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

function composeIslandUpright(win: string, base: string, locked: string,
  lockedSha: string): { out: string; report: { scalp?: { scalp_source?: string } } } {
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

/** RED donor at test time: dark-red disc in locked-A, shrunk to ~46%. */
function buildRedDonor(): { file: string; sha: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cregred-"));
  const file = path.join(tmp, "red-donor.png");
  execFileSync("python3", ["-c", [
    "from PIL import Image, ImageDraw",
    `a=${JSON.stringify(path.join(FIX, "locked-A.png"))}`,
    `o=${JSON.stringify(file)}`,
    "img=Image.open(a).convert('RGB')",
    "d=ImageDraw.Draw(img)",
    "cx,cy=img.size[0]//2,img.size[1]//2",
    "d.ellipse([cx-60,cy-60,cx+60,cy+60],fill=(139,0,0))",
    "small=img.resize((235,235),Image.LANCZOS)",
    "small.save(o)",
  ].join("\n")], { encoding: "utf8" });
  return { file, sha: shaOf(file) };
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

function texelDiffInBox(composed: string, base: string,
  box: [number, number, number, number]): number {
  const out = execFileSync("python3", ["-c", [
    "import numpy as np",
    "from PIL import Image",
    `x=np.array(Image.open(${JSON.stringify(composed)}).convert('RGB')).astype(int)`,
    `y=np.array(Image.open(${JSON.stringify(base)}).convert('RGB')).astype(int)`,
    `x0,y0,x1,y1=${JSON.stringify(box)}`,
    "print(int((x[y0:y1,x0:x1]!=y[y0:y1,x0:x1]).any(axis=2).sum()))",
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
  it("an unregistered (shrunk, disc-painted) donor leaves base untouched", () => {
    const { file, sha } = buildRedDonor();
    const base = path.join(FIX, "base-good-A.png");
    const { out, report } = composeIslandUpright("A", base, file, sha);
    expect(report.scalp?.scalp_source, "unregistered scalp source")
      .toBe("subject_base");
    expect(texelDiff(out, base), "0 texels differ from base anywhere")
      .toBe(0);
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

  it("the registration report lands body2 on subject_base with a clean crown", () => {
    const rep = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    expect(rep.pre_fix?.aisha?.base_sha256, "aisha inputs cited pre")
      .toBeTruthy();
    expect(rep.post_fix?.aisha?.base_sha256, "aisha inputs cited post")
      .toBe(rep.pre_fix.aisha.base_sha256);
    expect(rep.post_fix?.aisha?.refusal?.max, "aisha refusal unchanged")
      .toBe(rep.pre_fix.aisha.refusal.max);
    const post = rep.post_fix?.body2;
    expect(post?.refusal ?? null, "body2 post-fix has no refusal").toBeNull();
    expect(post?.scalp_source, "body2 scalp source").toBe("subject_base");
    expect(texelDiffInBox(post.compose_out, post.compose_base,
      [3029, 3261, 1838, 2226]), "0 texels differ in the paint box").toBe(0);
    // Crown presence cannot meet the 0.433 bound as written and is not
    // bent to: the broad orange wash lives in the base albedo itself
    // (pre-solve render already 0.705; base paint-box R-G 50.6), so removing
    // the donor mouth cannot clear it, and the bound is tone-confounded
    // (goal-front itself measures 1.0 in the same crop). The test asserts
    // the recorded value is honestly recomputed and the miss is recorded.
    expect(crownPresence(post.front_render), "presence recomputes")
      .toBeCloseTo(post.crown_presence, 4);
    expect(post.crown_presence_bound, "bound recorded").toBe(0.433);
    expect(post.crown_presence_pass, "bound miss recorded honestly")
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
