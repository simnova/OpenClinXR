/**
 * The skin detail bands match the goal.
 *
 * Card tsk_5d4e39424a56502e (skin-wrinkle-scale): the render must carry
 * softer creases and stronger pores. STEP 0 instruments exposure-invariant
 * band energies of log luminance (log Y, linear-light), with each band in
 * face-height units (FaceLandmarker 10-152) converted to pixels per image;
 * STEP 1 ablates which chain layer carries each band; STEP 2 adds the
 * deterministic detail_bands station stage (crease attenuate, pore boost)
 * with per-case solved gains in chain-manifest.json subject overrides.
 *
 * Fixture-scale stage contract (detail_bands.py, no subject literals):
 * identity at zero strength is a byte copy; two runs are bit-identical; a
 * known in-band crease sinusoid is attenuated by the stated gain
 * (1.0 -> ~gone, 0.5 -> ~half); a pore gain adds calibrated RMS
 * (added RMS ~= pore_gain on unclipped mid-gray); the script names no
 * subject. Report validation recomputes G1 (midpoint rule) from recorded
 * numbers, checks G2 (no new FFT peak per the stated rule), G3 (tone gate
 * (a) still passes on frozen thresholds, both subjects), and recomputes
 * render shas when present. Mirrored cheek L* is report-only (reason in
 * report: photo regional shading).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STAGE = path.join(DIR, "detail_bands.py");
const REPORT = path.join(DIR, "wrinkle-scale-report.json");

const SUBJECT_WORDS = ["body2", "aisha", "adult_male", "warm_medium", "warm_light"];

function shaOf(file: string): string {
  return execFileSync("shasum", ["-a", "256", file], { encoding: "utf8" })
    .split(" ")[0]!;
}

function makeFixture(tmp: string): { albedo: string; facecore: string } {
  const albedo = path.join(tmp, "albedo.png");
  const facecore = path.join(tmp, "facecore.png");
  execFileSync("python3", ["-c", [
    "import numpy as np",
    "from PIL import Image",
    `N=256`,
    // Mid-gray base + in-band crease sinusoid (period 48px: inside the
    // crease band G(1.43)-G(12.2) at the 4.079 fixture texel density).
    `yy,xx=np.mgrid[0:N,0:N]`,
    `a=np.ones((N,N,3),np.float64)*180.0`,
    `a[:,:,0]+=18.0*np.sin(2*np.pi*xx/48.0)`,
    `a[:,:,1]+=10.0*np.sin(2*np.pi*xx/48.0)`,
    `a=np.clip(a,0,255).astype(np.uint8)`,
    `Image.fromarray(a).save(${JSON.stringify(albedo)})`,
    `m=np.zeros((N,N),np.uint8); m[32:224,32:224]=255`,
    `Image.fromarray(m).save(${JSON.stringify(facecore)})`,
  ].join("\n")], { encoding: "utf8" });
  return { albedo, facecore };
}

function runStage(tmp: string, albedo: string, facecore: string,
  extra: string[], outName: string): string {
  const out = path.join(tmp, outName);
  execFileSync("python3", [STAGE, albedo, out,
    "--facecore-mask", facecore,
    "--texels-per-mm", "4.079",
    "--seed", "11",
    ...extra], { encoding: "utf8" });
  return out;
}

function bandEnergies(before: string, after: string,
  facecore: string): { creaseRatio: number; addedRms: number } {
  const raw = execFileSync("python3", ["-c", [
    "import sys, json",
    `sys.path.insert(0, ${JSON.stringify(DIR)})`,
    "import numpy as np",
    "from PIL import Image",
    "import cv2",
    "from fix_lips import rgb_to_lab",
    `a=rgb_to_lab(np.array(Image.open(${JSON.stringify(before)}).convert('RGB')))[...,0]`,
    `b=rgb_to_lab(np.array(Image.open(${JSON.stringify(after)}).convert('RGB')))[...,0]`,
    // Lab-L crease-band energy with the same G(1.43)-G(12.2) split the
    // stage uses at 4.079 tex/mm; added RMS over the gated region. The
    // measurement erodes the fixture block by 16 px: the stage gate
    // feathers 1.0 mm (4 texels), so the transition ring is edge
    // behavior, not attenuation (edges are covered by the byte-copy and
    // no-hard-edge tests; the forehead region is deep interior).
    "def band(l): return cv2.GaussianBlur(l,(0,0),1.43)-cv2.GaussianBlur(l,(0,0),12.2)",
    `m0=(np.array(Image.open(${JSON.stringify(facecore)}).convert('L'))>127)`,
    "m=cv2.erode(m0.astype(np.uint8),np.ones((33,33),np.uint8))>0",
    "ea=float(np.sqrt((band(a)[m]**2).mean()))",
    "eb=float(np.sqrt((band(b)[m]**2).mean()))",
    "rms=float(np.sqrt(((b-a)[m]**2).mean()))",
    "print(json.dumps({'creaseRatio':eb/ea,'addedRms':rms}))",
  ].join("\n")], { encoding: "utf8" });
  return JSON.parse(raw);
}

describe("detail_bands stage is generic, deterministic, calibrated", () => {
  it("identity at zero strength is a byte copy", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "detail-id-"));
    const { albedo, facecore } = makeFixture(tmp);
    const out = runStage(tmp, albedo, facecore,
      ["--crease-gain", "0", "--pore-gain", "0"], "out.png");
    expect(shaOf(out)).toBe(shaOf(albedo));
  });

  it("is deterministic across two runs", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "detail-det-"));
    const { albedo, facecore } = makeFixture(tmp);
    const args = ["--crease-gain", "1.0", "--pore-gain", "2.0"];
    const o1 = runStage(tmp, albedo, facecore, args, "o1.png");
    const o2 = runStage(tmp, albedo, facecore, args, "o2.png");
    expect(shaOf(o1)).toBe(shaOf(o2));
  });

  it("attenuates a known crease-band signal by the stated gain", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "detail-crease-"));
    const { albedo, facecore } = makeFixture(tmp);
    const full = runStage(tmp, albedo, facecore,
      ["--crease-gain", "1.0", "--pore-gain", "0"], "full.png");
    const half = runStage(tmp, albedo, facecore,
      ["--crease-gain", "0.5", "--pore-gain", "0"], "half.png");
    const rFull = bandEnergies(albedo, full, facecore).creaseRatio;
    const rHalf = bandEnergies(albedo, half, facecore).creaseRatio;
    expect(rFull).toBeLessThanOrEqual(0.05);
    expect(rHalf).toBeGreaterThan(0.4);
    expect(rHalf).toBeLessThan(0.6);
  });

  it("adds darkening-only pore structure at the stated RMS (no bright pores)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "detail-pore-"));
    const { albedo, facecore } = makeFixture(tmp);
    const out = runStage(tmp, albedo, facecore,
      ["--crease-gain", "0", "--pore-gain", "3.0"], "pore.png");
    const { addedRms } = bandEnergies(albedo, out, facecore);
    expect(Math.abs(addedRms - 3.0) / 3.0).toBeLessThan(0.15);
    // No LOCAL positive excursions: pores are dark pits (handback 1).
    // The stage preserves the facecore L mean exactly (uniform lift =
    // -field mean, tone-neutral by construction), so excursions are
    // measured against the uniform level (median over the block); the
    // uint8 round-trip admits half-LSB dust, not bright dots.
    const raw = execFileSync("python3", ["-c", [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(DIR)})`,
      "import numpy as np",
      "from PIL import Image",
      "from fix_lips import rgb_to_lab",
      `a=rgb_to_lab(np.array(Image.open(${JSON.stringify(albedo)}).convert('RGB')))[...,0]`,
      `b=rgb_to_lab(np.array(Image.open(${JSON.stringify(out)}).convert('RGB')))[...,0]`,
      `m=(np.array(Image.open(${JSON.stringify(facecore)}).convert('L'))>127)`,
      "d=b-a",
      "lvl=float(np.median(d[m]))",
      "print(json.dumps({'maxUp':float((d-lvl)[m].max()),'minDown':float((d-lvl)[m].min())}))",
    ].join("\n")], { encoding: "utf8" });
    const s = JSON.parse(raw) as { maxUp: number; minDown: number };
    expect(s.maxUp).toBeLessThanOrEqual(0.5);
    expect(s.minDown).toBeLessThan(-1.0);
  });

  it("leaves no hard edge at the support border", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "detail-edge-"));
    const { albedo, facecore } = makeFixture(tmp);
    const out = runStage(tmp, albedo, facecore,
      ["--crease-gain", "0", "--pore-gain", "3.0"], "pore.png");
    const raw = execFileSync("python3", ["-c", [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(DIR)})`,
      "import numpy as np",
      "from PIL import Image",
      "import cv2",
      "from fix_lips import rgb_to_lab",
      `b=rgb_to_lab(np.array(Image.open(${JSON.stringify(out)}).convert('RGB')))[...,0]`,
      // support = dilate(facecore, feather_tex=4) at 4.079 tex/mm;
      // ring = transition zone, interior = eroded deep field.
      `fc=(np.array(Image.open(${JSON.stringify(facecore)}).convert('L'))>127).astype(np.uint8)`,
      "sup=cv2.dilate(fc,np.ones((9,9),np.uint8))>0",
      "ring=(cv2.dilate(fc,np.ones((13,13),np.uint8))>0)&(cv2.erode(fc,np.ones((13,13),np.uint8))==0)",
      "inter=(cv2.erode(fc,np.ones((29,29),np.uint8))>0)",
      "lap=np.abs(cv2.Laplacian(b.astype(np.float32),cv2.CV_32F))",
      "print(json.dumps({'ring':float(lap[ring].max()),'inter':float(lap[inter].max())}))",
    ].join("\n")], { encoding: "utf8" });
    const s = JSON.parse(raw) as { ring: number; inter: number };
    expect(s.ring).toBeLessThanOrEqual(s.inter);
  });

  it("names no subject (generic, case-driven)", () => {
    const src = fs.readFileSync(STAGE, "utf8");
    for (const w of SUBJECT_WORDS) {
      expect(src.toLowerCase().includes(w)).toBe(false);
    }
  });
});

type WrinkleReport = {
  card: string;
  instrument: {
    exposure_invariant: string;
    face_height_landmarks: [number, number];
    crease_band_face_fraction: [number, number];
    pore_band_face_fraction: [number, number];
    pixel_radii_per_image: Record<string, unknown>;
    forehead_landmarks: string;
    nasolabial_landmarks: { L: [number, number]; R: [number, number]; width_px: number };
    legacy_column: Record<string, unknown>;
    invariance_probe: { max_move: number; bound: number };
    fft_prominence_rule: string;
  };
  pre: Record<string, Record<string, Record<string, { render: number; goal: number; ratio: number }>>>;
  step1: {
    rows: {
      subject: string;
      albedo_borne_frac: Record<string, Record<string, number>>;
    }[];
  };
  gates: {
    g1: { rows: { subject: string; region: string; band: string; pre_ratio: number; post_ratio: number; midpoint: number; pass: boolean; route: string }[]; verdict: string };
    g2: { new_peaks: unknown[]; pass: boolean };
    g3: { rows: { subject: string; region: string; channel: string; direction: string; d_eval: number; d_eval_pre: number; pre_pass: boolean; threshold: number; enforced: boolean; pass: boolean; frozen_pre_reproduces?: boolean }[]; verdict: string; regressions: unknown[] };
    g4: { strips: string[]; lane_manager: string };
    mirror_cheek_report_only: { reason: string };
  };
  renders: { path: string; sha256: string }[];
};

function loadReport(): WrinkleReport {
  return JSON.parse(fs.readFileSync(REPORT, "utf8")) as WrinkleReport;
}

describe("wrinkle-scale report validates from recorded numbers", () => {
  it("instrument is defined before PRE (bands, scales, regions, rules)", () => {
    const r = loadReport();
    expect(r.card).toBe("tsk_5d4e39424a56502e");
    const ins = r.instrument;
    expect(ins.exposure_invariant).toMatch(/log/i);
    expect(ins.face_height_landmarks).toEqual([10, 152]);
    expect(ins.forehead_landmarks).toMatch(/brow/);
    expect(ins.nasolabial_landmarks.L).toEqual([98, 61]);
    expect(ins.nasolabial_landmarks.R).toEqual([327, 291]);
    expect(ins.fft_prominence_rule.length).toBeGreaterThan(20);
    expect(ins.invariance_probe.max_move)
      .toBeLessThanOrEqual(ins.invariance_probe.bound);
    // legacy column reproduces the IOR-card G5 numbers within tolerance
    const leg = (ins.legacy_column as { values: Record<string, Record<string, number>> }).values;
    expect(Math.abs(leg.render_body2.forehead_crease - 1.447)).toBeLessThan(0.05);
    expect(Math.abs(leg.render_body2.forehead_pore - 1.095)).toBeLessThan(0.05);
    expect(Math.abs(leg.goal_body2.forehead_pore - 6.459)).toBeLessThan(0.05);
    expect(Math.abs(leg.goal_body2.forehead_crease - 1.254)).toBeLessThan(0.05);
  });

  it("G1 (corrected): forehead fix rows move closer in log ratio past the midpoint without excess overshoot", () => {
    // Handback 1 corrects the gate: past-the-midpoint alone let body2's
    // forehead crease overshoot (0.819 -> 1.631, farther in |log|).
    // Corrected: POST closer to goal than PRE in log ratio AND past the
    // midpoint toward the goal; overshooting the goal by more than the
    // PRE gap fails. Nasolabial rows stay routed to mesh geometry.
    const r = loadReport();
    expect(r.gates.g1.rows.length).toBe(8);
    const fracOf = (subject: string, region: string, band: string): number => {
      const row = r.step1.rows.find((x) => x.subject === subject)!;
      return row.albedo_borne_frac[region][band];
    };
    for (const row of r.gates.g1.rows) {
      const expectedMid = (row.pre_ratio + 1) / 2;
      expect(Math.abs(row.midpoint - expectedMid)).toBeLessThan(1e-3);
      if (row.region === "forehead") {
        expect(row.route).toBe("fix");
        const pastMid = row.pre_ratio > 1
          ? row.post_ratio <= row.midpoint
          : row.post_ratio >= row.midpoint;
        const closer = Math.abs(Math.log(row.post_ratio)) <
          Math.abs(Math.log(row.pre_ratio)) - 1e-9;
        let overshootOk = true;
        if (row.pre_ratio < 1 && row.post_ratio > 1) {
          overshootOk = (row.post_ratio - 1) <= (1 - row.pre_ratio) + 1e-3;
        }
        if (row.pre_ratio > 1 && row.post_ratio < 1) {
          overshootOk = (1 - row.post_ratio) <= (row.pre_ratio - 1) + 1e-3;
        }
        expect(row.pass).toBe(pastMid && closer && overshootOk);
        expect(row.pass).toBe(true);
      } else {
        expect(row.region).toBe("nasolabial");
        expect(row.route).toBe("falsifier-geometry");
        expect(row.pass).toBe(false);
        expect(fracOf(row.subject, row.region, row.band))
          .toBeLessThanOrEqual(0.25);
      }
    }
    expect(r.gates.g1.verdict).toMatch(/FAIL as written/);
  });

  it("G2 records no new isolated spectral peak", () => {
    const r = loadReport();
    expect(r.gates.g2.pass).toBe(true);
    expect(r.gates.g2.new_peaks).toEqual([]);
  });

  it("G3 tone gate (a): no PRE-pass row regresses on frozen thresholds", () => {
    // G3 is executable only as no-regressions: the frozen evaluation
    // already fails 11/48 enforced rows on the PRE chain albedo. Body2
    // PRE d_evals must reproduce the frozen split-report numbers (the
    // reuse check); pass flags recompute from direction + threshold.
    const r = loadReport();
    const enforced = r.gates.g3.rows.filter((x) => x.enforced);
    expect(enforced.length).toBe(48);
    const subjects = new Set(enforced.map((x) => x.subject));
    expect(subjects.has("body2")).toBe(true);
    expect(subjects.has("aisha")).toBe(true);
    expect(r.gates.g3.regressions).toEqual([]);
    for (const row of enforced) {
      const expectPass = row.direction === "lt"
        ? row.d_eval < row.threshold
        : row.d_eval > row.threshold;
      expect(row.pass).toBe(expectPass);
      if (row.pre_pass) expect(row.pass).toBe(true);
      if (row.subject === "body2") {
        expect(row.frozen_pre_reproduces).toBe(true);
      }
    }
  });

  it("G4 sheet strips exist at native pixels, lane-manager grade pending", () => {
    const r = loadReport();
    expect(r.gates.g4.strips.length).toBe(4);
    for (const p of r.gates.g4.strips) {
      expect(fs.existsSync(p)).toBe(true);
      expect(shaOf(p).length).toBe(64);
    }
    expect(r.gates.g4.lane_manager).toBe("pending");
  });

  it("render shas recompute when present", () => {
    const r = loadReport();
    expect(r.renders.length).toBeGreaterThan(0);
    for (const rec of r.renders) {
      expect(fs.existsSync(rec.path)).toBe(true);
      expect(shaOf(rec.path)).toBe(rec.sha256);
    }
  });

  it("mirrored cheek ratio is report-only with the photo-shading reason", () => {
    const r = loadReport();
    expect(r.gates.mirror_cheek_report_only.reason).toMatch(/photo regional shading/);
  });
});
