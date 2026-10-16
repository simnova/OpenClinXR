/**
 * A registered scalp source lifts the painted-scalp refusal.
 *
 * b3167aa35 scoped the input-side crown_step refusal to runs where "the
 * subject names no scalp source", but at that commit no run could name one,
 * so it fired on every stubbled base. Donors now record
 * report.scalp.scalp_source (locked_island | subject_base_tone_matched):
 * a registered locked donor IS a named scalp source, so the input-side
 * refusal fires only when scalp_source is not locked_island. The
 * output-side refusal stays for every run.
 *
 * G1 validates the tracked aisha-compose-report.json beside this test:
 * pre (33300119f) and post output shas equal, no refusal post; when the
 * store copy exists its sha recomputes. G2 is the counterweight: the same
 * bad base with an UNREGISTERED donor (locked-A shrunk to ~46% at test
 * time, as the crown test does) still throws CROWN_STEP_OVER_BOUND.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const MODULE = path.join(DIR, "face_replay_compose.py");
const FIX = path.join(DIR, "fixtures");
const RECORD = path.join(DIR, "aisha-compose-report.json");

const PRE_SHA =
  "e5b1ac1ecf9ebc808f525021677f05cb723ae82606645d4756317488732d818e";

function shaOf(file: string): string {
  return execFileSync("shasum", ["-a", "256", file], { encoding: "utf8" })
    .split(" ")[0]!;
}

function masksDir(win: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `scalpsrc-${win}-`));
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

function composeIslandUpright(base: string, locked: string,
  lockedSha: string): { out: string; report: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scalpsrcout-"));
  const out = path.join(tmp, "out.png");
  const report = path.join(tmp, "report.json");
  execFileSync("python3", [MODULE,
    "--base-skin", base, "--locked-island", locked, "--locked-sha", lockedSha,
    "--masks", masksDir("A"), "--side-map", sideOf("A", tmp),
    "--input-space", "island-upright", "--skip-join",
    "--out", out, "--report", report], { encoding: "utf8" });
  return { out, report };
}

describe("a registered scalp source lifts the painted-scalp refusal", () => {
  it("G1 aisha record: pre and post output shas equal, no refusal post", () => {
    const rec = JSON.parse(fs.readFileSync(RECORD, "utf8"));
    expect(rec.pre.out_sha256, "pre sha is the STEP 0 sha").toBe(PRE_SHA);
    expect(rec.post, "post-fix compose recorded").toBeTruthy();
    expect(rec.post.out_sha256, "pre/post output shas equal")
      .toBe(rec.pre.out_sha256);
    expect(rec.post.refusal ?? null, "no refusal post").toBeNull();
    expect(rec.post.crown_step_max, "post output crown_step in bound")
      .toBeLessThanOrEqual(rec.post.crown_step_bound);
    expect(rec.post.scalp_source, "post scalp source").toBe("locked_island");
    expect(rec.post.store_sha256, "store sha cites the output")
      .toBe(rec.post.out_sha256);
    if (fs.existsSync(rec.post.store_path)) {
      expect(shaOf(rec.post.store_path), "store copy recomputes")
        .toBe(rec.post.store_sha256);
    }
  });

  it("G2 base-bad-A with an unregistered donor still throws", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scalpsrcunreg-"));
    const shrunk = path.join(tmp, "locked-shrunk.png");
    execFileSync("python3", ["-c", [
      "from PIL import Image",
      `a=${JSON.stringify(path.join(FIX, "locked-A.png"))}`,
      `s=${JSON.stringify(shrunk)}`,
      "img=Image.open(a).convert('RGB')",
      "w,h=img.size",
      "img.resize((max(1,round(w*0.46)),max(1,round(h*0.46))),",
      "Image.LANCZOS).save(s)",
    ].join("\n")], { encoding: "utf8" });
    let msg = "";
    try {
      composeIslandUpright(path.join(FIX, "base-bad-A.png"), shrunk,
        shaOf(shrunk));
    } catch (e) {
      msg = (e as Error).message;
    }
    console.log(`KNOWN-BAD-RED G2: ${msg.split("\n").pop()}`);
    expect(msg).toMatch(/CROWN_STEP_OVER_BOUND/);
  }, 240000);
});
