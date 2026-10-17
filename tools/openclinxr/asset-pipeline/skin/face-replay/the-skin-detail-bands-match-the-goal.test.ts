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

function makeFixture(tmp: string): { albedo: string; facecore: string; scalp: string; vermilion: string } {
  const albedo = path.join(tmp, "albedo.png");
  const facecore = path.join(tmp, "facecore.png");
  const scalp = path.join(tmp, "scalp.png");
  const vermilion = path.join(tmp, "vermilion.png");
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
    // Scalp block sits above the facecore (forehead skin above the
    // facecore top); the fringe must carry the grain too.
    `s=np.zeros((N,N),np.uint8); s[0:48,32:224]=255`,
    `Image.fromarray(s).save(${JSON.stringify(scalp)})`,
    // Vermilion block (lipuv hard-core analog): the grain must hug it
    // with the 0.5 mm hug + 0.5 mm feather, not retreat behind a ring.
    `v=np.zeros((N,N),np.uint8); v[150:170,100:156]=255`,
    `Image.fromarray(v).save(${JSON.stringify(vermilion)})`,
  ].join("\n")], { encoding: "utf8" });
  return { albedo, facecore, scalp, vermilion };
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

  it("adds dark-biased dense grain at the stated RMS (goal-like micro-contrast)", () => {
    // Handback 2: dense, continuous, low-contrast micro-texture with no
    // individually resolvable dots. Calibrated against the goal
    // forehead crops (goal_body2: 0.389/0.411 of texels beyond +-1 L;
    // goal_aisha: 0.296/0.338): the grain is dense both sides (not the
    // handback-1 dots at 0.13 cover), dark-biased (asymmetric caps),
    // tone shift bounded (near-zero support mean).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "detail-pore-"));
    const { albedo, facecore, scalp } = makeFixture(tmp);
    const out = runStage(tmp, albedo, facecore,
      ["--crease-gain", "0", "--pore-gain", "3.0",
        "--scalp-mask", scalp, "--scalp-fringe-mm", "2.0"], "pore.png");
    const { addedRms } = bandEnergies(albedo, out, facecore);
    expect(Math.abs(addedRms - 3.0) / 3.0).toBeLessThan(0.15);
    const raw = execFileSync("python3", ["-c", [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(DIR)})`,
      "import numpy as np",
      "from PIL import Image",
      "import cv2",
      "from fix_lips import rgb_to_lab",
      `a=rgb_to_lab(np.array(Image.open(${JSON.stringify(albedo)}).convert('RGB')))[...,0]`,
      `b=rgb_to_lab(np.array(Image.open(${JSON.stringify(out)}).convert('RGB')))[...,0]`,
      `m0=(np.array(Image.open(${JSON.stringify(facecore)}).convert('L'))>127)`,
      "m=cv2.erode(m0.astype(np.uint8),np.ones((33,33),np.uint8))>0",
      "d=b-a",
      "print(json.dumps({'maxUp':float(d[m].max()),'minDown':float(d[m].min()),'brightFrac':float((d[m]>1.0).mean()),'darkFrac':float((d[m]<-1.0).mean()),'mean':float(d[m].mean())}))",
    ].join("\n")], { encoding: "utf8" });
    const s = JSON.parse(raw) as { maxUp: number; minDown: number; brightFrac: number; darkFrac: number; mean: number };
    expect(s.maxUp).toBeLessThanOrEqual(5.0);
    expect(s.minDown).toBeLessThan(-3.0);
    expect(s.brightFrac).toBeGreaterThan(0.2);
    expect(s.brightFrac).toBeLessThan(0.5);
    expect(s.darkFrac).toBeGreaterThan(0.2);
    expect(s.darkFrac).toBeLessThan(0.5);
    expect(Math.abs(s.mean)).toBeLessThan(1.0);
  });

  it("carries the grain into the scalp fringe with no edge", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "detail-fringe-"));
    const { albedo, facecore, scalp } = makeFixture(tmp);
    const out = runStage(tmp, albedo, facecore,
      ["--crease-gain", "0", "--pore-gain", "3.0",
        "--scalp-mask", scalp, "--scalp-fringe-mm", "2.0"], "pore.png");
    const raw = execFileSync("python3", ["-c", [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(DIR)})`,
      "import numpy as np",
      "from PIL import Image",
      "import cv2",
      "from fix_lips import rgb_to_lab",
      `a=rgb_to_lab(np.array(Image.open(${JSON.stringify(albedo)}).convert('RGB')))[...,0]`,
      `b=rgb_to_lab(np.array(Image.open(${JSON.stringify(out)}).convert('RGB')))[...,0]`,
      `fc=(np.array(Image.open(${JSON.stringify(facecore)}).convert('L'))>127).astype(np.uint8)`,
      `sc=(np.array(Image.open(${JSON.stringify(scalp)}).convert('L'))>127).astype(np.uint8)`,
      // extended hard mask, same construction as the stage
      "hard=(fc>0)|((sc>0)&(cv2.dilate(fc,np.ones((17,17),np.uint8))>0))",
      "sup=cv2.dilate(hard.astype(np.uint8),np.ones((9,9),np.uint8))>0",
      "ring=(cv2.dilate(hard.astype(np.uint8),np.ones((13,13),np.uint8))>0)&(cv2.erode(hard.astype(np.uint8),np.ones((13,13),np.uint8))==0)",
      "inter=(cv2.erode(hard.astype(np.uint8),np.ones((29,29),np.uint8))>0)",
      "d=np.abs(b-a)",
      // fringe core at gate~=1 (scalp rows well inside the fringe,
      // away from both the facecore edge and the fringe outer edge;
      // fixture fringe spans rows 24:32, feather sigma is 4 tex)
      "yy=np.mgrid[0:256,0:256][0]",
      "fr=(sc>0)&(fc==0)&(yy>=28)",
      "print(json.dumps({'fringe':float(d[fr].mean()),'inter':float(d[inter].mean())}))",
      "lap=np.abs(cv2.Laplacian(b.astype(np.float32),cv2.CV_32F))",
      "print(json.dumps({'ring':float(lap[ring].max()),'inner':float(lap[inter].max())}))",
    ].join("\n")], { encoding: "utf8" });
    const lines = raw.trim().split("\n");
    const s = JSON.parse(lines[0]) as { fringe: number; inter: number };
    const e = JSON.parse(lines[1]) as { ring: number; inner: number };
    expect(s.fringe).toBeGreaterThan(0.5 * s.inter);
    expect(e.ring).toBeLessThanOrEqual(e.inner);
  });

  it("does not fill dark holes (nostril interiors stay dark)", () => {
    // Handback 5: the converged crease removal filled nostril interiors
    // (low-pass leaks skin into the hole, +tens of L, blue-grey specks).
    // Texels darker than L25 keep the input; the grain and crease work
    // still applies around the hole.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "detail-hole-"));
    const { albedo, facecore } = makeFixture(tmp);
    const hole = path.join(tmp, "hole-albedo.png");
    execFileSync("python3", ["-c", [
      "import numpy as np",
      "from PIL import Image",
      `a=np.array(Image.open(${JSON.stringify(albedo)}).convert('RGB'))`,
      "yy,xx=np.mgrid[0:256,0:256]",
      "a[((xx-200)**2+(yy-200)**2)<144]=[8,8,8]",
      `Image.fromarray(a).save(${JSON.stringify(hole)})`,
    ].join("\n")], { encoding: "utf8" });
    const out = runStage(tmp, hole, facecore,
      ["--crease-gain", "1.0", "--pore-gain", "3.0"], "hole-out.png");
    const raw = execFileSync("python3", ["-c", [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(DIR)})`,
      "import numpy as np",
      "from PIL import Image",
      "import cv2",
      "from fix_lips import rgb_to_lab",
      `a=rgb_to_lab(np.array(Image.open(${JSON.stringify(hole)}).convert('RGB')))[...,0]`,
      `b=rgb_to_lab(np.array(Image.open(${JSON.stringify(out)}).convert('RGB')))[...,0]`,
      "yy,xx=np.mgrid[0:256,0:256]",
      "disk=((xx-200)**2+(yy-200)**2)<64",
      "ring=((xx-200)**2+(yy-200)**2>=256)&((xx-200)**2+(yy-200)**2<900)",
      "d=np.abs(b-a)",
      "print(json.dumps({'disk':float(d[disk].mean()),'ring':float(d[ring].mean())}))",
    ].join("\n")], { encoding: "utf8" });
    const s = JSON.parse(raw) as { disk: number; ring: number };
    expect(s.disk).toBeLessThan(1.0);
    expect(s.ring).toBeGreaterThan(1.0);
  });

  it("hugs the vermilion with no pale ring (beard hug 0.5mm + 0.5mm)", () => {    // Handback 3: the derive lips mask carries ~3 mm of margin past the
    // vermilion (measured body2 albedo a* profile vs mask edge), which
    // left a pale untreated ring. The grain hugs the lipuv hard-core
    // vermilion with the beard_shadow hug instead: grain reaches the
    // band just outside the core while the core itself stays untreated.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "detail-hug-"));
    const { albedo, facecore, vermilion } = makeFixture(tmp);
    const out = runStage(tmp, albedo, facecore,
      ["--crease-gain", "0", "--pore-gain", "3.0",
        "--lips-mask", vermilion], "pore.png");
    const raw = execFileSync("python3", ["-c", [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(DIR)})`,
      "import numpy as np",
      "from PIL import Image",
      "import cv2",
      "from fix_lips import rgb_to_lab",
      `a=rgb_to_lab(np.array(Image.open(${JSON.stringify(albedo)}).convert('RGB')))[...,0]`,
      `b=rgb_to_lab(np.array(Image.open(${JSON.stringify(out)}).convert('RGB')))[...,0]`,
      `v=(np.array(Image.open(${JSON.stringify(vermilion)}).convert('L'))>127).astype(np.uint8)`,
      "d=np.abs(b-a)",
      // core interior stays untreated; the hug band (2-6 tex outside
      // the vermilion: 0.5mm hug + 0.5mm feather at 4.079 tex/mm)
      // carries grain like the deep interior
      "core=cv2.erode(v,np.ones((13,13),np.uint8))>0",
      "band=(cv2.dilate(v,np.ones((13,13),np.uint8))>0)&(cv2.dilate(v,np.ones((5,5),np.uint8))==0)",
      `fc0=(np.array(Image.open(${JSON.stringify(facecore)}).convert('L'))>127).astype(np.uint8)`,
      "inter=(cv2.erode(fc0,np.ones((33,33),np.uint8))>0)",
      "print(json.dumps({'core':float(d[core].mean()),'band':float(d[band].mean()),'inter':float(d[inter].mean())}))",
    ].join("\n")], { encoding: "utf8" });
    const s = JSON.parse(raw) as { core: number; band: number; inter: number };
    expect(s.core).toBeLessThan(0.2 * s.inter);
    expect(s.band).toBeGreaterThan(0.5 * s.inter);
  });

  it("finds the vermilion from the albedo, falling back to the union", () => {
    // Handback 6: the lipuv union is the lip MESH region, bigger than the
    // visible vermilion. The builder takes the steepest a* descent after
    // the vermilion peak along 360 rays: on a synthetic face (red lips on
    // mid-gray skin inside a union box) it must hug the lips (not the
    // whole union); on a flat field it falls back to the union.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "detail-verm-"));
    const raw = execFileSync("python3", ["-c", [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(DIR)})`,
      "import numpy as np",
      "from PIL import Image",
      "import detail_bands as D",
      "a=np.ones((256,256,3),np.uint8)*180",
      "a[100:156,80:176]=[200,120,130]",
      "u=np.zeros((256,256),bool); u[80:176,60:196]=True",
      "m=D.vermilion_mask_from_albedo(a,u)",
      "print(json.dumps({'frac':float(m.sum()/u.sum()),'rows':[int(np.where(m)[0].min()),int(np.where(m)[0].max())],'cols':[int(np.where(m)[1].min()),int(np.where(m)[1].max())]}))",
      "f=np.ones((256,256,3),np.uint8)*180",
      "m2=D.vermilion_mask_from_albedo(f,u)",
      "print(json.dumps({'fallback':bool((m2==u).all())}))",
    ].join("\n")], { encoding: "utf8" });
    const lines = raw.trim().split("\n");
    const s = JSON.parse(lines[0]) as { frac: number; rows: number[]; cols: number[] };
    expect(s.frac).toBeGreaterThan(0.2);
    expect(s.frac).toBeLessThan(0.9);
    expect(s.rows[0]).toBeGreaterThanOrEqual(95);
    expect(s.rows[1]).toBeLessThanOrEqual(161);
    expect(s.cols[0]).toBeGreaterThanOrEqual(75);
    expect(s.cols[1]).toBeLessThanOrEqual(181);
    expect((JSON.parse(lines[1]) as { fallback: boolean }).fallback).toBe(true);
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
    g2: { new_peaks: unknown[]; pass: boolean; verdict: string; patches: { subject: string; kind: string; new: unknown[] }[] };
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

  it("G2 records its one render peak honestly (FAIL as written, intent met)", () => {
    // Handback 3: the render leg trips on body2/render@1 (2.04x PRE, just
    // over the 2x line) while the albedo leg is clean and aisha is clean
    // with the same stage. Measured mechanism: the albedo carries NO
    // low-frequency excess (same-pixel UV FFT bins 0-3 all lower), so the
    // peak is render-side smooth broad-brightness redistribution from the
    // intended crease softening, not a seam or tiling structure (no
    // high-frequency peaks; seam steps drop). The test validates the
    // honest record (tone-test precedent), not a pass.
    const r = loadReport();
    expect(r.gates.g2.pass).toBe(false);
    expect(r.gates.g2.new_peaks).toEqual(["body2/render@1"]);
    expect(r.gates.g2.verdict).toMatch(/FAIL as written/);
    expect(r.gates.g2.verdict).toMatch(/NO low-frequency excess/);
    const alb = (r.gates.g2.patches as { subject: string; kind: string; new: unknown[] }[])
      .filter((p) => p.kind.startsWith("albedo"));
    expect(alb.every((p) => p.new.length === 0)).toBe(true);
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
    expect(r.gates.g4.strips.length).toBe(5);
    for (const p of r.gates.g4.strips) {
      expect(fs.existsSync(p)).toBe(true);
      expect(shaOf(p).length).toBe(64);
    }
    expect(r.gates.g4.strips.some((p) => p.includes("mouth"))).toBe(true);
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
