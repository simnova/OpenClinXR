/**
 * The beard-shadow layer is identity at zero and matches the goal.
 *
 * beard_shadow.py adds male beard shadow (upper lip, chin, jaw stipple)
 * as a chain stage after socket: the mask derives ONLY from the subject
 * derive outputs (landmarks-uv.json + mask-lips.png + mask-facecore.png),
 * the treatment is a seeded stipple plus a low-band darken/desaturate
 * scaled by one weight, weight 0 is a byte copy, and texels outside the
 * hard mask plus its millimetre fade are bit-exact. The tracked beard-shadow-report.json carries
 * the weight sweep, the G1 aisha shas, the G2/G3 numbers, and the render
 * shas (recomputed when the files are present).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "@openclinxr/factory-station-core/runner";
/** Relocated evidence: skin sources stay under tools/ (S4); anchor via the repo-root helper (S5). */
const DIR = path.join(repoRoot(), "tools/openclinxr/asset-pipeline/skin/face-replay");
const MODULE = path.join(DIR, "beard_shadow.py");
const MANIFEST = path.join(DIR, "chain-manifest.json");
const REPORT = path.join(DIR, "beard-shadow-report.json");
const SWEEP_WEIGHTS = [0, 0.25, 0.5, 0.75, 1.0];

function shaOf(file: string): string {
  return execFileSync("shasum", ["-a", "256", file], { encoding: "utf8" })
    .split(" ")[0]!;
}

function runBeard(tmp: string, args: string[]): string {
  return execFileSync("python3", [MODULE, ...args], {
    encoding: "utf8", cwd: tmp,
  });
}

/** Synthetic 512 fixture: boxes + self-consistent landmarks (col,row). */
function writeFixture(tmp: string): {
  albedo: string; lips: string; facecore: string; landmarks: string;
} {
  const albedo = path.join(tmp, "albedo.png");
  const lips = path.join(tmp, "mask-lips.png");
  const facecore = path.join(tmp, "mask-facecore.png");
  const landmarks = path.join(tmp, "landmarks-uv.json");
  execFileSync("python3", ["-c", [
    "import json",
    "import numpy as np",
    "from PIL import Image",
    `a=np.full((512,512,3),(170,140,120),np.uint8)`,
    `Image.fromarray(a).save(${JSON.stringify(albedo)})`,
    `f=np.zeros((512,512),np.uint8); f[80:440,96:416]=255`,
    `Image.fromarray(f).save(${JSON.stringify(facecore)})`,
    `m=np.zeros((512,512),np.uint8); m[260:300,216:296]=255`,
    `Image.fromarray(m).save(${JSON.stringify(lips)})`,
    "lm={'size':512,'row':'v*S','landmarks':{}}",
    "pts={'nose-tip':(256,140),'nostril-L':(220,190),'nostril-R':(292,190),"
      + "'chin':(256,380),'ear-attach-L':(60,240),'ear-attach-R':(452,240)}",
    "lm['landmarks']={k:{'uv_texel':list(v),'method':'synthetic fixture'} for k,v in pts.items()}",
    `json.dump(lm,open(${JSON.stringify(landmarks)},'w'))`,
  ].join("\n")], { encoding: "utf8" });
  return { albedo, lips, facecore, landmarks };
}

function beardArgs(fx: { albedo: string; lips: string; facecore: string; landmarks: string },
  out: string, weight: number, extra: string[] = []): string[] {
  return [fx.albedo, out, "--landmarks", fx.landmarks,
    "--lips-mask", fx.lips, "--facecore-mask", fx.facecore,
    "--weight", String(weight), "--texels-per-mm", "4.0", ...extra];
}

describe("the beard-shadow layer is identity at zero and matches the goal", () => {
  it("stage script runs from the manifest path", () => {
    const out = execFileSync("python3", [MODULE, "--help"], { encoding: "utf8" });
    expect(out).toContain("usage:");
  });

  it("weight 0 is a byte copy of its input", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beard-zero-"));
    const fx = writeFixture(tmp);
    const out = path.join(tmp, "out.png");
    runBeard(tmp, beardArgs(fx, out, 0));
    expect(shaOf(out)).toBe(shaOf(fx.albedo));
  });

  it("a nonzero weight is deterministic across two runs", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beard-det-"));
    const fx = writeFixture(tmp);
    const o1 = path.join(tmp, "o1.png");
    const o2 = path.join(tmp, "o2.png");
    runBeard(tmp, beardArgs(fx, o1, 0.75));
    runBeard(tmp, beardArgs(fx, o2, 0.75));
    expect(shaOf(o1)).toBe(shaOf(o2));
    expect(shaOf(o1)).not.toBe(shaOf(fx.albedo));
  });

  it("a nonzero weight changes texels only inside the faded support", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beard-mask-"));
    const fx = writeFixture(tmp);
    const out = path.join(tmp, "out.png");
    const mask = path.join(tmp, "mask.png");
    const rep = path.join(tmp, "rep.json");
    runBeard(tmp, beardArgs(fx, out, 0.75,
      ["--mask-out", mask, "--report-out", rep]));
    const info = JSON.parse(fs.readFileSync(rep, "utf8")) as {
      mask_px: number; support_mm: number;
    };
    expect(info.mask_px).toBeGreaterThan(100);
    expect(info.support_mm).toBeGreaterThan(0);
    const raw = execFileSync("python3", ["-c", [
      "import sys, json, math",
      `sys.path.insert(0, ${JSON.stringify(DIR)})`,
      "import numpy as np",
      "from PIL import Image",
      "import cv2",
      "import face_replay_compose as C",
      `rgb1=np.array(Image.open(${JSON.stringify(fx.albedo)}).convert('RGB'))`,
      `rgb2=np.array(Image.open(${JSON.stringify(out)}).convert('RGB'))`,
      `m=np.array(Image.open(${JSON.stringify(mask)}).convert('L'))>127`,
      `rep=json.load(open(${JSON.stringify(rep)}))`,
      "r=int(math.ceil(float(rep['support_mm'])*4.0))",
      "k=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2*r+1,2*r+1))",
      "support=cv2.dilate(m.astype(np.uint8),k)>0",
      "lab1=C.lab_of(rgb1); lab2=C.lab_of(rgb2)",
      "d=np.abs(lab1-lab2).max(axis=2)",
      "outside=(~support)",
      "inside=m",
      "print(json.dumps({'n':int(outside.sum()),'max':float(d[outside].max()),"
      + "'changed':int((np.abs(rgb1.astype(int)-rgb2.astype(int)).max(axis=2)[inside]>0).sum())}))",
    ].join("\n")], { encoding: "utf8" });
    const r = JSON.parse(raw) as { n: number; max: number; changed: number };
    expect(r.n).toBeGreaterThanOrEqual(500);
    expect(r.max).toBe(0);
    expect(r.changed).toBeGreaterThan(0);
  });

  it("a vermilion mask holds the hole while geometry stays on the lips mask", () => {
    // Handback 6: --vermilion-mask moves ONLY the exclusion hole +
    // lip feather to the albedo vermilion; top edge/trim/zone stay on
    // the derive lips mask. Synthetic vermilion box strictly inside the
    // lips box: texels inside it must be bit-identical while the beard
    // zone outside still changes.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beard-verm-"));
    const fx = writeFixture(tmp);
    const verm = path.join(tmp, "vermilion.png");
    const out = path.join(tmp, "out.png");
    execFileSync("python3", ["-c", [
      "import numpy as np",
      "from PIL import Image",
      `v=np.zeros((512,512),np.uint8); v[270:290,236:276]=255`,
      `Image.fromarray(v).save(${JSON.stringify(verm)})`,
    ].join("\n")], { encoding: "utf8" });
    runBeard(tmp, [...beardArgs(fx, out, 0.75), "--vermilion-mask", verm]);
    const raw = execFileSync("python3", ["-c", [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(DIR)})`,
      "import numpy as np",
      "from PIL import Image",
      `rgb1=np.array(Image.open(${JSON.stringify(fx.albedo)}).convert('RGB'))`,
      `rgb2=np.array(Image.open(${JSON.stringify(out)}).convert('RGB'))`,
      `v=(np.array(Image.open(${JSON.stringify(verm)}).convert('L'))>127)`,
      "d=np.abs(rgb1.astype(int)-rgb2.astype(int)).max(axis=2)",
      "print(json.dumps({'in_verm_max':int(d[v].max()),'n_out':int((~v).sum()),'out_changed':int((d[~v]>0).sum())}))",
    ].join("\n")], { encoding: "utf8" });
    const r = JSON.parse(raw) as { in_verm_max: number; n_out: number; out_changed: number };
    expect(r.in_verm_max).toBe(0);
    expect(r.out_changed).toBeGreaterThan(0);
  });

  it("the stage source carries no texel constants", () => {
    const src = fs.readFileSync(MODULE, "utf8");
    const code = src.split("\n").filter((l) => !l.trimStart().startsWith("#"));
    const hits = code.filter((l) => /\b\d{4,}\b/.test(l));
    expect(hits, `texel-magnitude literals in beard_shadow.py: ${hits.join(" | ").slice(0, 400)}`)
      .toEqual([]);
  });

  it("chain manifest carries beard_shadow after socket with per-subject weights", () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as {
      stages: { name: string }[];
      subjects: Record<string, { overrides: Record<string, { weight: number }>; sources?: Record<string, string> }>;
    };
    const names = manifest.stages.map((s) => s.name);
    expect(names.indexOf("beard_shadow")).toBe(names.indexOf("socket") + 1);
    expect(names[names.length - 1]).toBe("brow_form");
    expect(manifest.subjects.aisha.overrides.beard_shadow.weight).toBe(0.0);
    const male = manifest.subjects.adult_male_street_casual;
    expect(male.overrides.beard_shadow.weight).toBeGreaterThan(0);
    expect(male.sources?.["beard_shadow.weight"] ?? "").toContain("S/beard");
  });

  it("beard-shadow-report.json validates: sweep, G1, G2/G3, render shas", () => {
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as {
      sweep: { weight: number; max_abs_dlab: number }[];
      chosen_weight: number;
      g1: { before: Record<string, string>; after: Record<string, string>; equal: boolean };
      g2: { lip_dlab: number[]; chin_dlab: number[]; bound: number; pass: boolean; falsifier?: boolean };
      g3: { cheek_l_dlab: number[]; cheek_r_dlab: number[]; forehead_dlab: number[]; bound: number; pass: boolean };
      renders: { front: string; yaw25: string; yaw40: string; shas: Record<string, string> };
    };
    for (const w of SWEEP_WEIGHTS) {
      expect(report.sweep.map((s) => s.weight)).toContain(w);
    }
    expect(report.chosen_weight).toBeGreaterThan(0);
    expect(report.g1.equal).toBe(true);
    expect(report.g1.after).toEqual(report.g1.before);
    const g2ok = [...report.g2.lip_dlab, ...report.g2.chin_dlab]
      .every((x) => Math.abs(x) <= report.g2.bound);
    expect(report.g2.pass).toBe(g2ok);
    if (!g2ok) expect(report.g2.falsifier).toBe(true);
    for (const d of [report.g3.cheek_l_dlab, report.g3.cheek_r_dlab, report.g3.forehead_dlab]) {
      expect(d.every((x) => Math.abs(x) <= report.g3.bound)).toBe(true);
    }
    expect(report.g3.pass).toBe(true);
    for (const [key, file] of Object.entries(report.renders)) {
      if (key === "shas") continue;
      if (typeof file !== "string") continue;
      if (fs.existsSync(file)) {
        expect(shaOf(file).slice(0, 16))
          .toBe(report.renders.shas[key]!.slice(0, 16));
      }
    }
  });
});
