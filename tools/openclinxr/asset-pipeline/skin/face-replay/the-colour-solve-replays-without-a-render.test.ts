/**
 * The colour solve replays without a render.
 *
 * Runs the replayable global colour solve (Lab mean/std affine of the
 * masked face core, sourced in albedo space with the recorded
 * render-to-albedo offset) on small tracked fixture crops and asserts
 * the mechanism: bit-exact determinism against a recorded output sha,
 * a replay path with no renderer/browser/model (PATH-stripped run plus
 * a static import scan), hard refusal on a wrong input sha, a live
 * transfer function (a stored-image cheat fails the uniform-shift
 * probe), and no created left/right split on the balanced midline
 * window. Counterweights, each its own fixture-backed test in this
 * suite: the wrong-sha refusal fires, the shifted input moves the
 * output, and the half-face tint fires the symmetry bound.
 *
 * The symmetry clause uses fixture-matched near-unity params on purpose:
 * the tracked Aisha six carries render-scale spread that would amplify
 * any crop-level halves difference, so the +0.5 clause here guards that
 * a global transfer creates no split of its own. Full-scale behaviour
 * (six numbers, offset, per-region table, cheek difference) is evidenced
 * in solve-report.json, not here. No new tracked fixtures: shifted and
 * tinted inputs are synthesised in /tmp at runtime.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const MODULE = path.join(DIR, "face_replay_colour.py");
const FIX = path.join(DIR, "fixtures");
const TRACKED = path.join(DIR, "solve-parameters.json");

const RECORDED_OUT_SHA =
  "a05596c7360473f92c3277cd81c0414f25160a271c10768c31ae38a5eaf87cbd";

function shaOf(file: string): string {
  return execFileSync("shasum", ["-a", "256", file], { encoding: "utf8" })
    .split(" ")[0]!;
}

function pythonBin(): string {
  return execFileSync("python3",
    ["-c", "import sys;print(sys.executable)"], { encoding: "utf8" }).trim();
}

function trackedSix(): number[] {
  return (JSON.parse(fs.readFileSync(TRACKED, "utf8")) as {
    six: number[];
  }).six;
}

function fixtureParams(inputPng: string, maskPng: string,
  six: number[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frp-"));
  const tracked = JSON.parse(fs.readFileSync(TRACKED, "utf8")) as {
    source_albedo: { mean: number[]; std: number[]; n: number };
  };
  const params = {
    subject: "fixture",
    method: "global-lab6-v1",
    six,
    offset_D_render_minus_albedo: [0, 0, 0],
    source_albedo: tracked.source_albedo,
    shas: {
      input_albedo: shaOf(inputPng),
      albedo_mask: shaOf(maskPng),
    },
    files: {
      input_albedo: path.basename(inputPng),
      albedo_mask: path.basename(maskPng),
    },
  };
  const dest = path.join(dir, "params.json");
  fs.writeFileSync(dest, `${JSON.stringify(params, null, 1)}\n`);
  return dest;
}

function replay(inputPng: string, maskPng: string, six: number[],
  opts: { side?: string; env?: NodeJS.ProcessEnv } = {}): {
  out: string; report: ReplayReport;
} {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frco-"));
  const out = path.join(tmp, "out.png");
  const reportPath = path.join(tmp, "report.json");
  const argv = [MODULE, "--replay",
    "--input-albedo", inputPng, "--albedo-mask", maskPng,
    "--params", fixtureParams(inputPng, maskPng, six),
    "--out", out, "--report", reportPath];
  if (opts.side) {
    argv.push("--side-map", opts.side);
  }
  execFileSync(pythonBin(), argv,
    { encoding: "utf8", env: opts.env ?? process.env });
  return {
    out,
    report: JSON.parse(fs.readFileSync(reportPath, "utf8")),
  };
}

function meanLab(image: string): [number, number, number] {
  const raw = execFileSync("python3", ["-c", [
    "import sys, json",
    `sys.path.insert(0, ${JSON.stringify(DIR)})`,
    "import numpy as np",
    "from PIL import Image",
    "import face_replay_compose as C",
    `lab=C.lab_of(np.array(Image.open(${JSON.stringify(image)})` +
      ".convert('RGB')))",
    "print(json.dumps([float(v) for v in lab.reshape(-1,3).mean(0)]))",
  ].join("\n")], { encoding: "utf8" });
  return JSON.parse(raw) as [number, number, number];
}

function srcStats(image: string, mask: string): {
  mean: number[]; std: number[];
} {
  const raw = execFileSync("python3", ["-c", [
    "import sys, json",
    `sys.path.insert(0, ${JSON.stringify(DIR)})`,
    "import numpy as np",
    "from PIL import Image",
    "import face_replay_compose as C",
    `rgb=np.array(Image.open(${JSON.stringify(image)}).convert('RGB'))`,
    `m=(np.array(Image.open(${JSON.stringify(mask)}).convert('L'))>127)`,
    "lab=C.lab_of(rgb)",
    "px=lab[m]",
    "print(json.dumps({'mean':[float(v) for v in px.mean(0)]," +
      "'std':[float(v)+1e-6 for v in px.std(0)]}))",
  ].join("\n")], { encoding: "utf8" });
  return JSON.parse(raw) as { mean: number[]; std: number[] };
}

type ReplayReport = {
  cheek_delta_L: {
    before: number | null; after: number | null;
    n_left: number; n_right: number;
  };
};

describe("the colour solve replays without a render", () => {
  it("imports cleanly", () => {
    const out = execFileSync("python3", [MODULE, "--check"],
      { encoding: "utf8" });
    expect(out).toContain("FACE_REPLAY_COLOUR_CHECK ok");
  });

  it("replays window A bit-identically to the recorded sha", () => {
    const first = replay(path.join(FIX, "base-good-A.png"),
      path.join(FIX, "mask-facecore-A.png"), trackedSix());
    const second = replay(path.join(FIX, "base-good-A.png"),
      path.join(FIX, "mask-facecore-A.png"), trackedSix());
    expect(shaOf(second.out), "two runs agree bit-exactly")
      .toBe(shaOf(first.out));
    expect(shaOf(first.out), "replay equals the recorded output")
      .toBe(RECORDED_OUT_SHA);
  }, 240000);

  it("replays with no renderer, browser, or model on the path", () => {
    const src = fs.readFileSync(MODULE, "utf8");
    for (const symbol of ["playwright", "chromium", "puppeteer",
      "subprocess", "Popen", "socket", "urllib", "requests",
      "turntable", "browser", "Imagine", "capture"]) {
      expect(src.includes(symbol), `no ${symbol} in the replay module`)
        .toBe(false);
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env, PATH: "/nonexistent",
    };
    const { out } = replay(path.join(FIX, "base-good-A.png"),
      path.join(FIX, "mask-facecore-A.png"), trackedSix(), { env });
    expect(shaOf(out), "PATH-stripped replay still lands")
      .toBe(RECORDED_OUT_SHA);
  }, 240000);

  it("refuses an input whose sha does not match", () => {
    const input = path.join(FIX, "base-good-A.png");
    const mask = path.join(FIX, "mask-facecore-A.png");
    const bad = JSON.parse(fs.readFileSync(
      fixtureParams(input, mask, trackedSix()), "utf8")) as {
      shas: Record<string, string>;
    };
    bad.shas["input_albedo"] = "0".repeat(64);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frcs-"));
    const params = path.join(dir, "params.json");
    fs.writeFileSync(params, JSON.stringify(bad));
    expect(() => execFileSync(pythonBin(), [MODULE, "--replay",
      "--input-albedo", input, "--albedo-mask", mask,
      "--params", params, "--out", path.join(dir, "out.png")],
    { encoding: "utf8" })).toThrow(/COLOUR_INPUT_SHA_MISMATCH/);
    const badMask = JSON.parse(fs.readFileSync(
      fixtureParams(input, mask, trackedSix()), "utf8")) as {
      shas: Record<string, string>;
    };
    badMask.shas["albedo_mask"] = "0".repeat(64);
    const params2 = path.join(dir, "params2.json");
    fs.writeFileSync(params2, JSON.stringify(badMask));
    expect(() => execFileSync(pythonBin(), [MODULE, "--replay",
      "--input-albedo", input, "--albedo-mask", mask,
      "--params", params2, "--out", path.join(dir, "out2.png")],
    { encoding: "utf8" })).toThrow(/COLOUR_MASK_SHA_MISMATCH/);
  }, 240000);

  it("moves the output when the input shifts uniformly", () => {
    const input = path.join(FIX, "base-good-A.png");
    const mask = path.join(FIX, "mask-facecore-A.png");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frcu-"));
    const shifted = path.join(tmp, "shifted.png");
    execFileSync("python3", ["-c", [
      "import numpy as np",
      "from PIL import Image",
      `a=np.array(Image.open(${JSON.stringify(input)}).convert('RGB'))` +
        ".astype(int)",
      `Image.fromarray(((a+14).clip(0,255)).astype(np.uint8)).save(${JSON.stringify(shifted)})`,
    ].join("\n")], { encoding: "utf8" });
    const { out } = replay(shifted, mask, trackedSix());
    expect(shaOf(out), "a stored image would return identical bytes")
      .not.toBe(RECORDED_OUT_SHA);
    const base = replay(input, mask, trackedSix());
    const dL = meanLab(out)[0] - meanLab(base.out)[0];
    expect(dL, "uniform input shift propagates through the transfer")
      .toBeGreaterThan(2);
  }, 240000);

  it("creates no left/right split on the balanced window", () => {
    const input = path.join(FIX, "base-good-M.png");
    const mask = path.join(FIX, "mask-facecore-M.png");
    const side = path.join(FIX, "side-M.png");
    const src = srcStats(input, mask);
    const six = [src.mean[0] + 2, src.mean[1], src.mean[2],
      ...src.std];
    const { report } = replay(input, mask, six, { side });
    expect(report.cheek_delta_L.before, "halves measured").not.toBeNull();
    expect(report.cheek_delta_L.n_left).toBeGreaterThanOrEqual(500);
    expect(report.cheek_delta_L.n_right).toBeGreaterThanOrEqual(500);
    expect(report.cheek_delta_L.after!,
      "global transfer creates no split")
      .toBeLessThanOrEqual(report.cheek_delta_L.before! + 0.5);
  }, 240000);

  it("fires the symmetry bound on a half-face tint", () => {
    const input = path.join(FIX, "base-good-M.png");
    const mask = path.join(FIX, "mask-facecore-M.png");
    const side = path.join(FIX, "side-M.png");
    const src = srcStats(input, mask);
    const six = [src.mean[0] + 2, src.mean[1], src.mean[2],
      ...src.std];
    const clean = replay(input, mask, six, { side });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frct-"));
    const tinted = path.join(tmp, "tinted.png");
    execFileSync("python3", ["-c", [
      "import numpy as np",
      "from PIL import Image",
      `a=np.array(Image.open(${JSON.stringify(input)}).convert('RGB'))` +
        ".astype(int)",
      `s=np.array(Image.open(${JSON.stringify(side)}).convert('L'))`,
      "t=a.copy()",
      "left=(s>200)[...,None]",
      "t=np.where(left,(t+[60,0,0]).clip(0,255),t)",
      `Image.fromarray(t.astype(np.uint8)).save(${JSON.stringify(tinted)})`,
    ].join("\n")], { encoding: "utf8" });
    const bad = replay(tinted, mask, six, { side });
    expect(bad.report.cheek_delta_L.after!,
      "half-face tint fires the symmetry bound")
      .toBeGreaterThan(clean.report.cheek_delta_L.before! + 0.5);
  }, 240000);
});
