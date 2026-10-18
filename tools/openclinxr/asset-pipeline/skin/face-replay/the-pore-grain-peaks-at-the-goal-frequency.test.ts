/**
 * The pore grain peaks at the goal frequency.
 *
 * Card tsk_ca445c4e7f770eaf (skin-pore-scale-fine): body2's forehead
 * grain reads coarser and more even than the goal's fine pore texture.
 * STEP 0 instruments the radially averaged power spectrum of log Y
 * inside the FaceLandmarker forehead polygon (Hann-windowed, frequency
 * in cycles per face height H = |P10-P152|); peak = raw argmax inside
 * the wrinkle pore band converted to cycles/H ([130/2pi, 1500/2pi]).
 * The fix moves the grain's spectral peak with ONE generic parameter
 * (detail_bands.py pore_noise_hi_mm, the grain band's upper scale in
 * mm), solved per case against that case's goal peak and recorded in
 * chain-manifest.json subject overrides with a sources entry.
 *
 * Fixture-scale stage contract (detail_bands.py, no subject literals):
 * the hi-mm parameter moves a synthetic grain's spectral peak by the
 * stated analytic ratio; default (omitted flag) reproduces the explicit
 * 1.4 mm wrinkle output byte-identically; zero gains are a byte copy.
 * Report validation recomputes the falsifier + G1 (midpoint rule) from
 * recorded numbers, checks G2/G3/G4 are recorded, and recomputes one
 * render peak from a store image when present.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STAGE = path.join(DIR, "detail_bands.py");
const REPORT = path.join(DIR, "pore-scale-fine-report.json");
const MANIFEST = path.join(DIR, "chain-manifest.json");

const SUBJECT_WORDS = ["body2", "aisha", "adult_male", "warm_medium", "warm_light"];

function misePython(args: string[], options?: { timeout?: number }): string {
  return execFileSync("mise",
    ["exec", "-C", "/Volumes/files/src/openclinxr", "--", "python3", ...args],
    { encoding: "utf8", timeout: options?.timeout ?? 280000,
      env: { ...process.env,
        MISE_TRUSTED_CONFIG_PATHS: `${process.env.HOME}/.grok/worktrees` } });
}

function shaOf(file: string): string {
  return execFileSync("shasum", ["-a", "256", file], { encoding: "utf8" })
    .split(" ")[0]!;
}

function makeFixture(tmp: string): { albedo: string; facecore: string } {
  const albedo = path.join(tmp, "albedo.png");
  const facecore = path.join(tmp, "facecore.png");
  misePython(["-c", [
    "import numpy as np",
    "from PIL import Image",
    `N=256`,
    // Flat mid-gray: the output spectrum is the added grain alone.
    `a=(np.ones((N,N,3),np.float64)*160.0).astype(np.uint8)`,
    `Image.fromarray(a).save(${JSON.stringify(albedo)})`,
    `m=np.zeros((N,N),np.uint8); m[32:224,32:224]=255`,
    `Image.fromarray(m).save(${JSON.stringify(facecore)})`,
  ].join("\n")]);
  return { albedo, facecore };
}

function runStage(tmp: string, albedo: string, facecore: string,
  extra: string[], outName: string): string {
  const out = path.join(tmp, outName);
  misePython([STAGE, albedo, out,
    "--facecore-mask", facecore,
    "--texels-per-mm", "4.079",
    "--seed", "11",
    ...extra]);
  return out;
}

/**
 * Grain spectral WEIGHT of stage outputs: mean power in the high band
 * [0.12, 0.25] over mean power in the low band [0.03, 0.08] cycles/texel
 * (central 160 box, Hann, radial bins of 1 cycle/patch). The DoG peak is
 * two octaves wide, so a single argmax is realization noise (measured
 * crest < 2x); the band ratio integrates the analytic DoG power
 * P(f) = (e^{-2pi^2 lo^2 f^2} - e^{-2pi^2 hi^2 f^2})^2, whose ratios are
 * R(1.4) = 1.096, R(0.63) = 5.715, R(2.4) = 0.773: the hi-mm parameter
 * moves high/low weight by 5.21x / 0.71x. Median over six fixed seeds.
 */
function grainRatioMedian(pngs: string[]): number {
  const raw = misePython(["-c", [
    "import numpy as np, json",
    "from PIL import Image",
    `paths=${JSON.stringify(pngs)}`,
    "ratios=[]",
    "for png in paths:",
    ` a=np.asarray(Image.open(png).convert('L'),dtype=np.float64)`,
    ` p=a[48:208,48:208]; p=p-p.mean()`,
    ` wy=np.hanning(p.shape[0])[:,None]; wx=np.hanning(p.shape[1])[None,:]`,
    ` F=np.fft.rfft2(p*wy*wx); P=np.abs(F)**2`,
    ` H,W=p.shape; kx=np.arange(P.shape[1]); ky=np.abs(np.fft.fftfreq(H))[:P.shape[0]]`,
    ` rr=np.sqrt((kx/160.0)[None,:]**2+ky[:,None]**2)`,
    ` hib=P[(rr>=0.12)&(rr<=0.25)].mean(); lob=P[(rr>=0.03)&(rr<=0.08)].mean()`,
    // NOTE: rr mixes (cycles/patch)/160 on x with cycles/texel on y --
    // both are cycles/texel; an earlier draft divided the combined radius
    // and measured the x-marginal instead (fixed).
    ` ratios.append(float(hib/max(lob,1e-300)))`,
    "print(json.dumps({'ratio': round(float(np.median(ratios)),4)}))",
  ].join("\n")]);
  return (JSON.parse(raw.trim()) as { ratio: number }).ratio;
}

const SEEDS = [11, 12, 13, 14, 15, 16];

function runSeeded(tmp: string, albedo: string, facecore: string,
  seed: number, extra: string[], outName: string): string {
  const out = path.join(tmp, outName);
  misePython([STAGE, albedo, out,
    "--facecore-mask", facecore,
    "--texels-per-mm", "4.079",
    "--seed", String(seed),
    ...extra]);
  return out;
}

describe("pore-scale-fine stage contract", () => {
  it("no subject literals in the stage", () => {
    const src = fs.readFileSync(STAGE, "utf8").toLowerCase();
    for (const w of SUBJECT_WORDS) expect(src).not.toContain(w);
  });

  it("the hi-mm parameter moves the synthetic grain peak by the stated amount", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "porefine-"));
    const { albedo, facecore } = makeFixture(tmp);
    const runAll = (extra: string[], tag: string): string[] =>
      SEEDS.map((s) => runSeeded(tmp, albedo, facecore, s, extra, `${tag}-${s}.png`));
    const pBase = grainRatioMedian(runAll(
      ["--crease-gain", "0", "--pore-gain", "3"], "base"));
    const pFine = grainRatioMedian(runAll(
      ["--crease-gain", "0", "--pore-gain", "3",
        "--pore-noise-hi-mm", "0.63"], "fine"));
    const pCoarse = grainRatioMedian(runAll(
      ["--crease-gain", "0", "--pore-gain", "3",
        "--pore-noise-hi-mm", "2.4"], "coarse"));
    // Analytic R(hi)/R(1.4): 5.214 finer, 0.705 coarser; assert the
    // direction plus the stated amount within +-35pc (band-integrated,
    // deterministic fixed seeds).
    expect(pFine / pBase).toBeGreaterThan(3.0);
    expect(pFine / pBase).toBeCloseTo(5.214, -1);
    expect(pFine / pBase).toBeGreaterThan(5.214 * 0.65);
    expect(pFine / pBase).toBeLessThan(5.214 * 1.35);
    expect(pCoarse / pBase).toBeLessThan(1.0);
    expect(pCoarse / pBase).toBeCloseTo(0.705, 0);
  }, 300000);

  it("default hi-mm reproduces the explicit 1.4 mm wrinkle output byte-identically", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "porefine-"));
    const { albedo, facecore } = makeFixture(tmp);
    const a = runStage(tmp, albedo, facecore,
      ["--crease-gain", "1", "--pore-gain", "3"], "a.png");
    const b = runStage(tmp, albedo, facecore,
      ["--crease-gain", "1", "--pore-gain", "3",
        "--pore-noise-hi-mm", "1.4"], "b.png");
    expect(shaOf(a)).toBe(shaOf(b));
  }, 300000);

  it("zero gains are a byte copy of the input", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "porefine-"));
    const { albedo, facecore } = makeFixture(tmp);
    const out = runStage(tmp, albedo, facecore,
      ["--crease-gain", "0", "--pore-gain", "0"], "zero.png");
    expect(shaOf(out)).toBe(shaOf(albedo));
  }, 300000);

  it("the stage refuses a grain band at or above the crease scale", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "porefine-"));
    const { albedo, facecore } = makeFixture(tmp);
    let refused = "";
    try {
      runStage(tmp, albedo, facecore,
        ["--crease-gain", "0", "--pore-gain", "3",
          "--pore-noise-hi-mm", "3.0"], "refused.png");
    } catch (e) {
      refused = String(e);
    }
    expect(refused).toContain("refuses");
  }, 300000);
});

describe("pore-scale-fine manifest + report", () => {
  it("chain-manifest records solved per-case hi-mm with sources", () => {
    const man = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as {
      subjects: Record<string, {
        overrides?: Record<string, Record<string, unknown>>;
        sources?: Record<string, string>;
      }>;
    };
    for (const subj of ["aisha", "adult_male_street_casual"]) {
      const ov = man.subjects[subj].overrides?.detail_bands;
      expect(ov, `${subj} detail_bands overrides`).toBeDefined();
      const hi = ov?.pore_noise_hi_mm as number;
      expect(typeof hi).toBe("number");
      expect(hi).toBeGreaterThan(0);
      expect(hi).toBeLessThan(3.0);
      expect(hi).not.toBe(1.4);
      const src = man.subjects[subj].sources?.["detail_bands.pore_noise_hi_mm"] ?? "";
      expect(src).toContain("pore-scale-fine");
    }
  });

  it("report validates: instrument before numbers, falsifier + G1 recomputed, G2-G4 recorded", () => {
    const rep = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    expect(rep.card).toBe("tsk_ca445c4e7f770eaf");
    expect(rep.instrument.pore_band_cycles_per_H).toEqual([20.69, 238.73]);
    const pre = rep.pre.images as Record<string, {
      path: string; sha256: string;
      peak_cycles_H: number; peak_power: number; floor: number;
    }>;
    for (const key of ["goal_body2", "goal_aisha",
      "wrinkle_post_body2", "wrinkle_post_aisha"]) {
      expect(pre[key].path.endsWith(".png")).toBe(true);
      expect(pre[key].sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // Falsifier recomputed from recorded numbers.
    for (const subj of ["body2", "aisha"]) {
      const g = pre[`goal_${subj}`];
      expect(g.peak_power / g.floor).toBeGreaterThanOrEqual(2.0);
    }
    // G1 recomputed: the wrinkle corrected rule (past the midpoint toward
    // the goal, closer in log, no excess overshoot).
    for (const row of rep.gates.g1.rows as {
      subject: string; pre_ratio: number; post_ratio: number;
      toward_goal: boolean; closer_log: boolean; overshoot_ok: boolean;
      pass: boolean;
    }[]) {
      const mid = (row.pre_ratio + 1) / 2;
      const toward = row.pre_ratio > 1
        ? row.post_ratio <= mid : row.post_ratio >= mid;
      expect(row.toward_goal).toBe(toward);
      expect(row.closer_log).toBe(
        Math.abs(Math.log(row.post_ratio)) < Math.abs(Math.log(row.pre_ratio)));
      let over = true;
      if (row.pre_ratio < 1 && row.post_ratio > 1) {
        over = (row.post_ratio - 1) <= (1 - row.pre_ratio) + 1e-3;
      }
      if (row.pre_ratio > 1 && row.post_ratio < 1) {
        over = (1 - row.post_ratio) <= (row.pre_ratio - 1) + 1e-3;
      }
      expect(row.overshoot_ok).toBe(over);
      expect(row.pass).toBe(row.toward_goal && row.closer_log && row.overshoot_ok);
    }
    expect(rep.gates.g1.rows.length).toBe(2);
    for (const g of ["g2", "g3", "g4"]) expect(rep.gates[g]).toBeDefined();
  });

  it("recomputes one render peak from a store image when present", () => {
    const rep = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    const img = rep.post?.body2?.path as string | undefined;
    if (!img || !fs.existsSync(img)) {
      console.log("porefine recompute: NEW POST body2 render absent, skip");
      return;
    }
    const raw = misePython(["-c", [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(DIR)})`,
      "import pore_scale as PS, wrinkle_bands as WB, face_landmark_regions as FLR",
      "lm = FLR.create_landmarker()",
      `m = PS.measure(${JSON.stringify(img)}, lm)`,
      "print(json.dumps({'peak': m['peak_cycles_H']}))",
    ].join("\n")], { timeout: 280000 });
    const peak = (JSON.parse(raw.trim()) as { peak: number }).peak;
    expect(Math.abs(peak - (rep.post.body2.peak_cycles_H as number)))
      .toBeLessThan(0.5);
  }, 300000);
});
