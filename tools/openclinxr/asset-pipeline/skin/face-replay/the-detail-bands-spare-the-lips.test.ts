/**
 * The detail bands spare the lips (card tsk_2d350bff82ccbe).
 *
 * Three generic fixes in detail_bands.py (no subject names or literals):
 * (a) the vermilion rule is the union of the lane-manager half-max edge
 *     with the pre-hb8 blurred-a* rule whose neighbourhood extends past
 *     the derive lips mask (the rendered vermilion rim lies outside that
 *     mask: run4 only10-outside-m 2042/2042, so any m-clipped rule misses
 *     it by construction);
 * (b) the grain normalisation scale is computed over the dilated hard
 *     gate alone (facecore/scalp fringe minus eyes/brows: no lips term),
 *     so two lips masks give the same scale;
 * (c) at beard weight 0 the crease-removal term is gated off the
 *     under-lower-lip band (per-column lower vermilion edge +4 mm, the
 *     B5 definition in texels at 4.079 tex/mm); the pore grain still
 *     applies there. The ablation carries the defect: g1p0 -1.56 of the
 *     -1.60 B5 darkening on run4 Aisha inputs (97.5% in
 *     detail_bands.py:280-287), g0p3 -0.04.
 *
 * Synthetic fixture (N=256, no case ids): mid-gray albedo, soft-edge red
 * block as the visible lip (true rows 150:170 cols 100:156), derive
 * analog = truth eroded by 2 (tight: the rim lies outside the base, the
 * real mechanism). G1 asserts the segmented mask covers the true rim
 * (recall >= 0.95): main's m-clipped rule gives 0.314 (RED). G3 runs the
 * stage with --beard-weight 0 over the B5 analog and asserts mean dL in
 * [-1, +1]: main's script has no such flag (RED, argparse error) and its
 * legacy path darkens the band (-2.14 on this fixture, -1.56 real g1p0).
 * G2 asserts forehead/cheek added-RMS invariance between the full and
 * eroded masks (<= 0.08): guard, green throughout. Report validation pins
 * the real-data gate numbers beside their card thresholds.
 *
 * Measured on the fixed script: union rim recall 0.9714 (main 0.3143),
 * so the gate sits at 0.95: RED-discriminating with margin both ways.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STAGE = path.join(DIR, "detail_bands.py");
const REPORT = path.join(DIR, "detail-bands-lips-report.json");

const GEO = { r0: 150, r1: 170, c0: 100, c1: 156, edge: 3 };

function py(code: string): string {
  return execFileSync("python3", ["-c", code], { encoding: "utf8" });
}

function makeSynth(tmp: string): Record<string, string> {
  const paths = {
    albedo: path.join(tmp, "albedo.png"),
    facecore: path.join(tmp, "facecore.png"),
    base: path.join(tmp, "base.png"),
    full: path.join(tmp, "full.png"),
    small: path.join(tmp, "small.png"),
  };
  py([
    "import numpy as np",
    "from PIL import Image",
    "import cv2",
    `N=256`,
    `r0,r1,c0,c1,edge=${GEO.r0},${GEO.r1},${GEO.c0},${GEO.c1},${GEO.edge}`,
    `alb=np.ones((N,N,3),np.float64)*180.0`,
    `for r in range(r0-edge,r1+edge):`,
    ` for c in range(c0-edge,c1+edge):`,
    `  dr=min(r-(r0-edge),(r1+edge)-1-r); dc=min(c-(c0-edge),(c1+edge)-1-c)`,
    `  t=np.clip(min(dr,dc)/edge,0,1)`,
    `  alb[r,c,0]=180+35*t; alb[r,c,1]=180-55*t; alb[r,c,2]=170-25*t`,
    `Image.fromarray(np.clip(alb,0,255).astype(np.uint8)).save(${JSON.stringify(paths.albedo)})`,
    `fc=np.zeros((N,N),np.uint8); fc[32:224,32:224]=255`,
    `Image.fromarray(fc).save(${JSON.stringify(paths.facecore)})`,
    `true=np.zeros((N,N),bool); true[r0:r1,c0:c1]=True`,
    `base=cv2.erode(true.astype(np.uint8),np.ones((5,5),np.uint8))>0`,
    `Image.fromarray((base.astype(np.uint8)*255)).save(${JSON.stringify(paths.base)})`,
    `Image.fromarray((true.astype(np.uint8)*255)).save(${JSON.stringify(paths.full)})`,
    `Image.fromarray((base.astype(np.uint8)*255)).save(${JSON.stringify(paths.small)})`,
  ].join("\n"));
  return paths;
}

function runDetail(tmp: string, albedo: string, facecore: string, lips: string,
  extra: string[], outName: string): string {
  const out = path.join(tmp, outName);
  execFileSync("python3", [STAGE, albedo, out,
    "--facecore-mask", facecore,
    "--lips-mask", lips,
    "--texels-per-mm", "4.079",
    "--seed", "11",
    ...extra], { encoding: "utf8" });
  return out;
}

const LAB_PRE = [
  "import numpy as np",
  "from PIL import Image",
];

function regionMean(before: string, after: string, region: string): number {
  const raw = py([
    ...LAB_PRE,
    `import sys; sys.path.insert(0, ${JSON.stringify(DIR)})`,
    "from fix_lips import rgb_to_lab",
    `a=rgb_to_lab(np.array(Image.open(${JSON.stringify(before)}).convert('RGB')))[...,0].astype(float)`,
    `b=rgb_to_lab(np.array(Image.open(${JSON.stringify(after)}).convert('RGB')))[...,0].astype(float)`,
    `m=np.zeros((256,256),bool)`,
    region,
    "d=(b-a)[m]",
    "print(float(d.mean()))",
  ].join("\n"));
  return parseFloat(raw.trim());
}

function regionRms(before: string, after: string, region: string): number {
  const raw = py([
    ...LAB_PRE,
    `import sys; sys.path.insert(0, ${JSON.stringify(DIR)})`,
    "from fix_lips import rgb_to_lab",
    `a=rgb_to_lab(np.array(Image.open(${JSON.stringify(before)}).convert('RGB')))[...,0].astype(float)`,
    `b=rgb_to_lab(np.array(Image.open(${JSON.stringify(after)}).convert('RGB')))[...,0].astype(float)`,
    `m=np.zeros((256,256),bool)`,
    region,
    "d=(b-a)[m]",
    "print(float(np.sqrt((d**2).mean())))",
  ].join("\n"));
  return parseFloat(raw.trim());
}

function rimRecall(albedo: string, base: string): number {
  const raw = py([
    ...LAB_PRE,
    "import cv2",
    `import sys; sys.path.insert(0, ${JSON.stringify(DIR)})`,
    "import detail_bands as DB",
    `alb=np.array(Image.open(${JSON.stringify(albedo)}).convert('RGB'))`,
    `bs=np.array(Image.open(${JSON.stringify(base)}).convert('L'))>127`,
    `verm=DB.vermilion_mask_from_albedo(np.array(alb),bs)`,
    `true=np.zeros(verm.shape,bool); true[${GEO.r0}:${GEO.r1},${GEO.c0}:${GEO.c1}]=True`,
    `rim=true&~(cv2.erode(true.astype(np.uint8),np.ones((7,7),np.uint8))>0)`,
    "print(float((verm&rim).sum())/max(1,int(rim.sum())))",
  ].join("\n"));
  return parseFloat(raw.trim());
}

describe("the detail bands spare the lips", () => {
  it("report validates: G1-G5 gates beside card thresholds with sources", () => {
    expect(fs.existsSync(REPORT)).toBe(true);
    const rep = JSON.parse(fs.readFileSync(REPORT, "utf8")) as {
      card: string; gates: Record<string, { value: unknown; threshold: unknown; source: string }>;
    };
    expect(rep.card).toBe("tsk_2d350bff82ccbe");
    for (const g of ["g1", "g2", "g3", "g4", "g5"]) {
      expect(rep.gates[g], `gate ${g} missing`).toBeDefined();
      expect(rep.gates[g]!.source.length).toBeGreaterThan(0);
    }
    // Card thresholds (midpoints): G1 rms <= 6.0 mean >= -2.9; G2 <= 0.08;
    // G3 in [-1, +1].
    expect(rep.gates["g1"]!.threshold).toEqual({ rms: 6.0, mean: -2.9 });
    expect(rep.gates["g2"]!.threshold).toEqual({ diff: 0.08 });
    expect(rep.gates["g3"]!.threshold).toEqual({ lo: -1, hi: 1 });
  });

  it("(G1) the segmented mask covers the rendered vermilion rim", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lips-g1-"));
    const p = makeSynth(tmp);
    expect(rimRecall(p.albedo, p.base)).toBeGreaterThanOrEqual(0.95);
  });

  it("(G3) no crease darkening under the lower lip at beard weight 0", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lips-g3-"));
    const p = makeSynth(tmp);
    const cc0 = GEO.c0 + Math.round(0.2 * (GEO.c1 - GEO.c0));
    const cc1 = GEO.c0 + Math.round(0.8 * (GEO.c1 - GEO.c0));
    const out = runDetail(tmp, p.albedo, p.facecore, p.full,
      ["--crease-gain", "1", "--pore-gain", "3.0",
        "--feather-mm", "1", "--lips-hug-mm", "0.5", "--lips-feather-mm", "0.5",
        "--scalp-fringe-mm", "25", "--beard-weight", "0"], "spared.png");
    const mean = regionMean(p.albedo, out,
      `m[${GEO.r1 + 3}:${GEO.r1 + 19},${cc0}:${cc1}]=True`);
    expect(mean).toBeGreaterThanOrEqual(-1);
    expect(mean).toBeLessThanOrEqual(1);
  });

  it("(G2) forehead/cheek grain invariant across lips masks", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lips-g2-"));
    const p = makeSynth(tmp);
    const args = ["--crease-gain", "1", "--pore-gain", "3.0",
      "--feather-mm", "1", "--lips-hug-mm", "0.5", "--lips-feather-mm", "0.5",
      "--scalp-fringe-mm", "25", "--beard-weight", "0"];
    const oFull = runDetail(tmp, p.albedo, p.facecore, p.full, args, "g2full.png");
    const oSmall = runDetail(tmp, p.albedo, p.facecore, p.small, args, "g2small.png");
    const fore = `m[32:72,32:224]=True`;
    const cheek = `m[100:140,32:224]=True`;
    const fF = regionRms(p.albedo, oFull, fore);
    const fS = regionRms(p.albedo, oSmall, fore);
    const cF = regionRms(p.albedo, oFull, cheek);
    const cS = regionRms(p.albedo, oSmall, cheek);
    expect(Math.abs(fF - fS)).toBeLessThanOrEqual(0.08);
    expect(Math.abs(cF - cS)).toBeLessThanOrEqual(0.08);
    expect(fF).toBeGreaterThan(2.0);
  });
});
