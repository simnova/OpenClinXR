/**
 * The brow follows the case brow_form.
 *
 * CARD tsk_b438966217dd814e (skin-brow-clear-and-colour): the skin chain
 * carries one brow stage whose behaviour follows cases.<case>.brow_form in
 * packages/openclinxr/factory-stations/src/face_realism/case-inputs.json
 * (mesh for aisha, texture for body2) — never a subject literal in code.
 *
 * - mesh: the painted brow is cleared from the albedo under the derive brow
 *   masks (Telea inpaint from the surrounding skin, bounded-inside
 *   smoothstep feather: zero writes outside the mask union), so only the
 *   fitted mesh brow shows. Fixture: a synthetic dark painted brow is gone
 *   (in-mask L* back inside the forehead spread) with max|dLab| == 0
 *   outside the union and a 2..12-texel halo band changed-frac <= 0.10.
 * - texture: the painted brow's L* and chroma move by the per-case (dL, dC)
 *   recorded in chain-manifest.json subject overrides (solved against that
 *   case's one-brow goal), applied under the same bounded-inside feather.
 *   Fixture: in-mask mean dL/dC equal the stated values within 0.5.
 * - the mode is resolved from case-inputs.json via the manifest subject key
 *   (chain_subject reverse lookup); brow_form.py and the replay branch carry
 *   no subject literals (grep).
 * - brow-form-report.json validates: per-case values, gate table, and every
 *   cited sha recomputes from bytes when the store is present.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const MANIFEST = path.join(DIR, "chain-manifest.json");
const REPLAY = path.join(DIR, "replay.py");
const SCRIPT = path.join(DIR, "brow_form.py");
const REPORT = path.join(DIR, "brow-form-report.json");
const CASE_INPUTS = path.join(
  DIR, "..", "..", "..", "..", "..",
  "packages", "openclinxr", "factory-stations", "src", "face_realism", "case-inputs.json",
);
const ONE_BROW = path.join(
  DIR, "..", "..", "..", "evidence", "face-defects", "one-brow", "report.json",
);

function loadJson(abs: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(abs, "utf8")) as Record<string, unknown>;
}

function pyMeasure(lines: string[]): string {
  return execFileSync("python3", ["-c", lines.join("\n")], { encoding: "utf8" });
}

/** Synthetic forehead crop: grainy skin + partial dark painted brow + dark lid band below + masks. */
function stageBrowFixture(tmp: string): { albedo: string; maskL: string; maskR: string; facecore: string; eyesL: string; eyesR: string; paintCore: string; skinLab: number[] } {
  const albedo = path.join(tmp, "albedo.png");
  const maskL = path.join(tmp, "mask-brows-L.png");
  const maskR = path.join(tmp, "mask-brows-R.png");
  const facecore = path.join(tmp, "mask-facecore.png");
  const eyesL = path.join(tmp, "mask-eyes-L.png");
  const eyesR = path.join(tmp, "mask-eyes-R.png");
  const paintCore = path.join(tmp, "paint-core.png");
  pyMeasure([
    "import numpy as np",
    "from PIL import Image",
    `S=256`,
    "rng=np.random.default_rng(11)",
    `a=(np.ones((S,S,3))*[168,128,110])+rng.normal(0,3.5,size=(S,S,3))`,
    "a=np.clip(a,0,255)",
    "a[96:116,60:150]=[150,60,40]",   // painted left brow: dark, chromatic, partial (right of mask is bare skin)
    "a[96:116,196:200]=[150,60,40]",
    "a[130:145,40:220]=[60,40,38]",    // lid-crease dark below the brow (smear source)
    "a=np.clip(a,0,255).astype(np.uint8)",
    `Image.fromarray(a).save(${JSON.stringify(albedo)})`,
    `mL=np.zeros((S,S),np.uint8); mL[96:116,60:200]=255`,
    `Image.fromarray(mL).save(${JSON.stringify(maskL)})`,
    `mR=np.zeros((S,S),np.uint8)`,
    `Image.fromarray(mR).save(${JSON.stringify(maskR)})`,
    `fc=np.ones((S,S),np.uint8)*255`,
    `Image.fromarray(fc).save(${JSON.stringify(facecore)})`,
    `eL=np.zeros((S,S),np.uint8); eL[125:150,40:220]=255`,
    `Image.fromarray(eL).save(${JSON.stringify(eyesL)})`,
    `eR=np.zeros((S,S),np.uint8)`,
    `Image.fromarray(eR).save(${JSON.stringify(eyesR)})`,
    `pc=np.zeros((S,S),np.uint8); pc[100:112,70:140]=255`,
    `Image.fromarray(pc).save(${JSON.stringify(paintCore)})`,
  ]);
  const skinLab = JSON.parse(pyMeasure([
    "import numpy as np",
    "from PIL import Image",
    "from skimage.color import rgb2lab",
    `a=np.array(Image.open(${JSON.stringify(albedo)}).convert('RGB')).astype(float)/255.0`,
    "lab=rgb2lab(a)",
    "skin=lab[0:80,:,:].reshape(-1,3)",
    "import json",
    "print(json.dumps({'L':float(skin[:,0].mean()),'C':float(np.hypot(skin[:,1],skin[:,2]).mean())}))",
  ])) as { L: number; C: number };
  return { albedo, maskL, maskR, facecore, eyesL, eyesR, paintCore, skinLab: [skinLab.L, skinLab.C] };
}

function labStats(albedo: string, mask: string, erode = 0): { meanL: number; meanC: number; n: number } {
  return JSON.parse(pyMeasure([
    "import numpy as np, json",
    "from PIL import Image",
    "from scipy import ndimage",
    "from skimage.color import rgb2lab",
    `a=np.array(Image.open(${JSON.stringify(albedo)}).convert('RGB')).astype(float)/255.0`,
    `m=np.array(Image.open(${JSON.stringify(mask)}).convert('L'))>127`,
    erode > 0 ? `m=ndimage.binary_erosion(m,iterations=${erode})` : "m=m",
    "lab=rgb2lab(a)",
    "print(json.dumps({'meanL':float(lab[m][:,0].mean()),'meanC':float(np.hypot(lab[m][:,1],lab[m][:,2]).mean()),'n':int(m.sum())}))",
  ])) as { meanL: number; meanC: number; n: number };
}

function maxDLabOutside(before: string, after: string, maskL: string, maskR: string): { max: number; haloFrac: number; haloN: number } {
  return JSON.parse(pyMeasure([
    "import numpy as np, json",
    "from PIL import Image",
    "from scipy import ndimage",
    "from skimage.color import rgb2lab",
    `b=np.array(Image.open(${JSON.stringify(before)}).convert('RGB')).astype(float)/255.0`,
    `c=np.array(Image.open(${JSON.stringify(after)}).convert('RGB')).astype(float)/255.0`,
    `mL=np.array(Image.open(${JSON.stringify(maskL)}).convert('L'))>127`,
    `mR=np.array(Image.open(${JSON.stringify(maskR)}).convert('L'))>127`,
    "u=(mL|mR)",
    "d=np.abs(rgb2lab(b)-rgb2lab(c)).max(axis=2)",
    "outside=~u",
    "band=ndimage.binary_dilation(u,iterations=12)&~ndimage.binary_dilation(u,iterations=2)",
    "print(json.dumps({'max':float(d[outside].max()),'haloFrac':float((d[band]>3).mean()),'haloN':int(band.sum())}))",
  ])) as { max: number; haloFrac: number; haloN: number };
}

describe("the brow follows the case brow_form: manifest wiring", () => {
  it("chain-manifest.json ends with a brow_form stage carrying parameters and sources", () => {
    const manifest = loadJson(MANIFEST) as {
      stages: Array<{ name: string; script: string; parameters: Record<string, unknown>; parameter_sources: Record<string, unknown> }>;
    };
    const names = manifest.stages.map((s) => s.name);
    expect(names.at(-1)).toBe("brow_form");
    const stage = manifest.stages.at(-1)!;
    expect(stage.script).toBe("brow_form.py");
    expect(Object.keys(stage.parameters).length).toBeGreaterThan(0);
    expect(Object.keys(stage.parameter_sources!).length).toBeGreaterThan(0);
    expect(stage.parameters["dL"]).toBe(0.0);
    expect(stage.parameters["dC"]).toBe(0.0);
  });

  it("every manifest subject records a brow_form override pair with a sources entry", () => {
    const manifest = loadJson(MANIFEST) as {
      subjects: Record<string, { overrides?: Record<string, Record<string, number>>; sources?: Record<string, unknown> }>;
    };
    for (const [subject, rec] of Object.entries(manifest.subjects)) {
      const ov = rec.overrides?.["brow_form"];
      expect(ov, `${subject} brow_form override`).toBeDefined();
      expect(typeof ov!["dL"]).toBe("number");
      expect(typeof ov!["dC"]).toBe("number");
      expect(typeof rec.sources?.["brow_form.dL"], `${subject} sources brow_form.dL`).toBe("string");
    }
  });

  it("the texture override pair is the coverage-weighted re-solve against the one-brow goal", () => {
    const one = loadJson(ONE_BROW) as {
      subjects: Record<string, { measurements: { PRE: { mean: { dL: number; dC: number } }; goal: { mean: { dL: number; dC: number } } } }>;
    };
    const manifest = loadJson(MANIFEST) as {
      subjects: Record<string, { overrides: Record<string, Record<string, number>>; sources: Record<string, string> }>;
    };
    const pre = one.subjects["body2"]!.measurements.PRE.mean;
    const goal = one.subjects["body2"]!.measurements.goal.mean;
    const rec = manifest.subjects["adult_male_street_casual"]!;
    const ov = rec.overrides["brow_form"]!;
    // Per-hair shift goes past 100% of the mean PRE-to-goal gap (the weight
    // concentrates it on hairs), and the source records the weighted solve.
    expect(Math.abs(ov["dL"])).toBeGreaterThanOrEqual(Math.abs(goal.dL - pre.dL));
    expect(Math.abs(ov["dC"])).toBeGreaterThanOrEqual(Math.abs(goal.dC - pre.dC));
    expect(rec.sources["brow_form.dL"]).toContain("coverage");
    expect(rec.sources["brow_form.dC"]).toContain("coverage");
  });

  it("brow_form resolves from case-inputs.json chain_subject lookup (mesh/texture, no literals)", () => {
    const inputs = loadJson(CASE_INPUTS) as {
      cases: Record<string, { chain_subject?: { value?: string }; brow_form?: { value?: string } }>;
    };
    const bySubject: Record<string, string> = {};
    for (const rec of Object.values(inputs.cases)) {
      if (rec.chain_subject?.value && rec.brow_form?.value) bySubject[rec.chain_subject.value] = rec.brow_form.value;
    }
    expect(bySubject["aisha"]).toBe("mesh");
    expect(bySubject["adult_male_street_casual"]).toBe("texture");
    const replaySrc = fs.readFileSync(REPLAY, "utf8");
    expect(replaySrc).toContain("case-inputs.json");
    expect(replaySrc).toContain("brow_form");
  });

  it("brow_form.py carries no subject literals", () => {
    const src = fs.readFileSync(SCRIPT, "utf8");
    for (const lit of ["aisha", "body2", "adult_male", "peds_patient", "peds_asthma"]) {
      expect(src.includes(lit), `subject literal ${lit} in brow_form.py`).toBe(false);
    }
  });
});

describe("the brow follows the case brow_form: mesh clears, texture shifts", () => {
  it("mesh form clears a synthetic painted brow with no edge step", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brow-mesh-"));
    const fix = stageBrowFixture(tmp);
    const before = labStats(fix.albedo, fix.maskL);
    expect(fix.skinLab[0] - before.meanL).toBeGreaterThan(8); // dark paint present
    const out = path.join(tmp, "out.png");
    execFileSync("python3", [SCRIPT, fix.albedo, out,
      "--brows-mask-L", fix.maskL, "--brows-mask-R", fix.maskR,
      "--facecore-mask", fix.facecore,
      "--eyes-mask-L", fix.eyesL, "--eyes-mask-R", fix.eyesR,
      "--brow-form", "mesh"], { encoding: "utf8" });
    // Interior (past the feather ramp) is cleared skin; the ramp rows keep
    // a diminishing copy of the paint so the edge has no step (halo gate).
    const after = labStats(out, fix.maskL, 8);
    expect(Math.abs(after.meanL - fix.skinLab[0])).toBeLessThan(6); // paint gone
    expect(Math.abs(after.meanC - fix.skinLab[1])).toBeLessThan(6);
    const edge = maxDLabOutside(fix.albedo, out, fix.maskL, fix.maskR);
    expect(edge.max).toBe(0);
    expect(edge.haloN).toBeGreaterThan(0);
    expect(edge.haloFrac).toBeLessThanOrEqual(0.10);
  }, 120000);

  it("texture form shifts hair pixels by the stated pair, inside the masks only", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brow-tex-"));
    const fix = stageBrowFixture(tmp);
    const before = labStats(fix.albedo, fix.paintCore);
    const out = path.join(tmp, "out.png");
    execFileSync("python3", [SCRIPT, fix.albedo, out,
      "--brows-mask-L", fix.maskL, "--brows-mask-R", fix.maskR,
      "--facecore-mask", fix.facecore,
      "--eyes-mask-L", fix.eyesL, "--eyes-mask-R", fix.eyesR,
      "--brow-form", "texture", "--dL", "-17.0", "--dC", "-17.4"], { encoding: "utf8" });
    // Paint-core pixels (coverage ~1) carry the full stated pair; the bare
    // skin inside the mask is covered by G6 below.
    const after = labStats(out, fix.paintCore);
    expect(after.meanL - before.meanL).toBeCloseTo(-17.0, 0);
    expect(after.meanC - before.meanC).toBeCloseTo(-17.4, 0);
    const edge = maxDLabOutside(fix.albedo, out, fix.maskL, fix.maskR);
    expect(edge.max).toBe(0);
    expect(edge.haloFrac).toBeLessThanOrEqual(0.10);
  }, 120000);

  it("mesh with zero shifts is not identity on paint, texture with zero shifts is", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brow-id-"));
    const fix = stageBrowFixture(tmp);
    const meshOut = path.join(tmp, "mesh.png");
    execFileSync("python3", [SCRIPT, fix.albedo, meshOut,
      "--brows-mask-L", fix.maskL, "--brows-mask-R", fix.maskR,
      "--facecore-mask", fix.facecore,
      "--eyes-mask-L", fix.eyesL, "--eyes-mask-R", fix.eyesR,
      "--brow-form", "mesh", "--dL", "0", "--dC", "0"], { encoding: "utf8" });
    expect(labStats(meshOut, fix.maskL).meanL).toBeGreaterThan(labStats(fix.albedo, fix.maskL).meanL + 5);
    const texOut = path.join(tmp, "tex.png");
    execFileSync("python3", [SCRIPT, fix.albedo, texOut,
      "--brows-mask-L", fix.maskL, "--brows-mask-R", fix.maskR,
      "--facecore-mask", fix.facecore,
      "--eyes-mask-L", fix.eyesL, "--eyes-mask-R", fix.eyesR,
      "--brow-form", "texture", "--dL", "0", "--dC", "0"], { encoding: "utf8" });
    const same = pyMeasure([
      "import numpy as np",
      `a=np.array(open(${JSON.stringify(fix.albedo)},'rb').read())`,
      `b=np.array(open(${JSON.stringify(texOut)},'rb').read())`,
      "print(int((a==b).all()))",
    ]);
    expect(Number(same.trim())).toBe(1);
  }, 120000);

  it("refuses an unknown brow form", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brow-ref-"));
    const fix = stageBrowFixture(tmp);
    expect(() => execFileSync("python3", [SCRIPT, fix.albedo, path.join(tmp, "o.png"),
      "--brows-mask-L", fix.maskL, "--brows-mask-R", fix.maskR,
      "--brow-form", "stencil"], { encoding: "utf8" })).toThrow();
  }, 120000);
});

describe("the brow follows the case brow_form: G6/G7/G8 counterweights", () => {
  function runMode(tmp: string, fix: ReturnType<typeof stageBrowFixture>, mode: "mesh" | "texture", dL: string, dC: string): { out: string; stdout: Record<string, number> } {
    const out = path.join(tmp, `${mode}.png`);
    const stdout = execFileSync("python3", [SCRIPT, fix.albedo, out,
      "--brows-mask-L", fix.maskL, "--brows-mask-R", fix.maskR,
      "--facecore-mask", fix.facecore,
      "--eyes-mask-L", fix.eyesL, "--eyes-mask-R", fix.eyesR,
      "--brow-form", mode, "--dL", dL, "--dC", dC], { encoding: "utf8" });
    return { out, stdout: JSON.parse(stdout.match(/\{[\s\S]*\}/)![0]!) as Record<string, number> };
  }

  it("G6: bare skin inside the mask (coverage < 0.2) moves by |dL|,|dC| <= 2", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brow-g6-"));
    const fix = stageBrowFixture(tmp);
    const { stdout } = runMode(tmp, fix, "texture", "-17.0", "-17.4");
    expect(stdout["coverage_mean"]).toBeGreaterThan(0);
    expect(stdout["coverage_mean"]).toBeLessThan(1);
    expect(stdout["g6_max_dL"]).toBeLessThanOrEqual(2);
    expect(stdout["g6_max_dC"]).toBeLessThanOrEqual(2);
    // And the hairs still move: high-coverage pixels carry most of the pair.
    const shift = JSON.parse(pyMeasure([
      "import numpy as np, json",
      "from PIL import Image",
      "from skimage.color import rgb2lab",
      `a=np.array(Image.open(${JSON.stringify(fix.albedo)}).convert('RGB')).astype(float)/255.0`,
      `b=np.array(Image.open(${JSON.stringify(path.join(tmp, "texture.png"))}).convert('RGB')).astype(float)/255.0`,
      "la=rgb2lab(a); lb=rgb2lab(b)",
      "skin=np.median(la[0:80,:,:].reshape(-1,3),axis=0)",
      `m=np.array(Image.open(${JSON.stringify(fix.maskL)}).convert('L'))>127`,
      "Ls=skin[0]; Lc=np.hypot(skin[1],skin[2])",
      "Lp=la[m][:,0]; Cp=np.hypot(la[m][:,1],la[m][:,2])",
      "core=np.mean(np.sort(Lp)[:max(1,int(0.1*Lp.size))])",
      "cov=np.clip((Ls-Lp)/max(1e-9,(Ls-core)),0,1)",
      "hi=cov>0.8",
      "print(json.dumps({'dL':float((lb[m][:,0][hi]-la[m][:,0][hi]).mean()),'dC':float((np.hypot(lb[m][:,1][hi],lb[m][:,2][hi])-Cp[hi]).mean())}))",
    ])) as { dL: number; dC: number };
    expect(shift.dL).toBeLessThan(-8);
    expect(shift.dC).toBeLessThan(-8);
  }, 120000);

  it("G7: no darkening smear between the brow lower edge and the lid (mean dL >= -2)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brow-g7-"));
    const fix = stageBrowFixture(tmp);
    const { out } = runMode(tmp, fix, "mesh", "0", "0");
    const change = JSON.parse(pyMeasure([
      "import numpy as np, json",
      "from PIL import Image",
      "from scipy import ndimage",
      "from skimage.color import rgb2lab",
      `a=np.array(Image.open(${JSON.stringify(fix.albedo)}).convert('RGB')).astype(float)/255.0`,
      `b=np.array(Image.open(${JSON.stringify(out)}).convert('RGB')).astype(float)/255.0`,
      `m=np.array(Image.open(${JSON.stringify(fix.maskL)}).convert('L'))>127`,
      "d=(rgb2lab(b)-rgb2lab(a))[:,:,0]",
      "ys,xs=np.where(m)",
      "band=np.zeros_like(m)",
      "band[np.maximum(0,ys.max()-12):ys.max()+1,xs.min():xs.max()+1]=True",
      "band=band&ndimage.binary_erosion(m,iterations=4)",
      "print(json.dumps({'mean_dL':float(d[band].mean()),'n':int(band.sum())}))",
    ])) as { mean_dL: number; n: number };
    expect(change.n).toBeGreaterThan(0);
    expect(change.mean_dL).toBeGreaterThanOrEqual(-2);
  }, 120000);

  it("G8: cleared grain matches the forehead strip (high-pass energy ratio 0.7-1.3)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brow-g8-"));
    const fix = stageBrowFixture(tmp);
    const { out } = runMode(tmp, fix, "mesh", "0", "0");
    const ratio = JSON.parse(pyMeasure([
      "import numpy as np, json",
      "from PIL import Image",
      "from scipy import ndimage",
      "from skimage.color import rgb2lab",
      `b=np.array(Image.open(${JSON.stringify(out)}).convert('RGB')).astype(float)/255.0`,
      `m=np.array(Image.open(${JSON.stringify(fix.maskL)}).convert('L'))>127`,
      "L=rgb2lab(b)[:,:,0]",
      "hp=L-ndimage.gaussian_filter(L,2)",
      "inside=ndimage.binary_erosion(m,iterations=8)",
      "strip=np.zeros_like(m); strip[40:80,60:200]=True",
      "print(json.dumps({'ratio':float(hp[inside].std()/hp[strip].std())}))",
    ])) as { ratio: number };
    expect(ratio.ratio).toBeGreaterThanOrEqual(0.7);
    expect(ratio.ratio).toBeLessThanOrEqual(1.3);
  }, 120000);
});

describe("the brow follows the case brow_form: G9/G10 no ghost, no stripes (hb2)", () => {
  /** Ghost fixture: strong paint plus a FAINT arch outline (coverage < 0.15,
   * which the hb1 coverage window leaves untouched) under a full brow mask. */
  function stageGhostFixture(tmp: string): { albedo: string; maskL: string; maskR: string; facecore: string; eyesL: string; eyesR: string } {
    const albedo = path.join(tmp, "albedo.png");
    const maskL = path.join(tmp, "mask-brows-L.png");
    const maskR = path.join(tmp, "mask-brows-R.png");
    const facecore = path.join(tmp, "mask-facecore.png");
    const eyesL = path.join(tmp, "mask-eyes-L.png");
    const eyesR = path.join(tmp, "mask-eyes-R.png");
    pyMeasure([
      "import numpy as np",
      "from PIL import Image",
      `S=256`,
      "rng=np.random.default_rng(11)",
      `a=(np.ones((S,S,3))*[168,128,110])+rng.normal(0,3.5,size=(S,S,3))`,
      "a=np.clip(a,0,255)",
      "a[96:116,60:150]=[150,60,40]",
      "a[96:116,196:200]=[150,60,40]",
      "faint=np.zeros((S,S),bool); faint[84:96,60:200]=True; faint[116:132,60:200]=True",
      "a[faint]=np.clip(a[faint]-[6,3,2],0,255)",
      "a[150:165,40:220]=[60,40,38]",
      "a=np.clip(a,0,255).astype(np.uint8)",
      `Image.fromarray(a).save(${JSON.stringify(albedo)})`,
      `mL=np.zeros((S,S),np.uint8); mL[84:132,60:200]=255`,
      `Image.fromarray(mL).save(${JSON.stringify(maskL)})`,
      `mR=np.zeros((S,S),np.uint8)`,
      `Image.fromarray(mR).save(${JSON.stringify(maskR)})`,
      `fc=np.ones((S,S),np.uint8)*255`,
      `Image.fromarray(fc).save(${JSON.stringify(facecore)})`,
      `eL=np.zeros((S,S),np.uint8); eL[145:170,40:220]=255`,
      `Image.fromarray(eL).save(${JSON.stringify(eyesL)})`,
      `eR=np.zeros((S,S),np.uint8)`,
      `Image.fromarray(eR).save(${JSON.stringify(eyesR)})`,
    ]);
    return { albedo, maskL, maskR, facecore, eyesL, eyesR };
  }

  const G9_HEAD = [
    "import numpy as np, json",
    "from PIL import Image",
    "from scipy import ndimage",
    "from skimage.color import rgb2lab",
  ];
  const G9_TAIL = [
    "u=(mL|mR)",
    "ys,xs=np.where(u); top,bottom=int(ys.min()),int(ys.max()); H=bottom-top+1",
    // Erosion clears the feather ramp (stage feather is 6 px): the ramp
    // legitimately keeps diminishing paint, so the ghost/coherence read must
    // start past it.
    "erode=max(2,min(8,H//6)); gap=max(2,H//60)",
    "strip=np.zeros_like(u); s1=max(0,top-gap-H); s0=max(0,top-gap); strip[s1:s0,:]=True",
    "strip&=fc; strip&=~ndimage.binary_dilation(u,iterations=gap)",
    "interior=ndimage.binary_erosion(u,iterations=erode)",
    "Lp=rgb2lab(pre)[:,:,0]; Lc=rgb2lab(post)[:,:,0]",
    "skin_med=float(np.median(Lp[strip]))",
    "painted=u&(Lp<skin_med-8.0)",
    "stroke_w=float(2.0*np.median(ndimage.distance_transform_edt(painted)[painted])) if painted.any() else 0.0",
    "sig=max(1.5,stroke_w/2.0)",
    "bp_pre=Lp-ndimage.gaussian_filter(Lp,sig); bp_post=Lc-ndimage.gaussian_filter(Lc,sig)",
    "ratio=float(bp_post[interior].std()/bp_pre[strip].std())",
    "def coh(L):",
    " gx=ndimage.sobel(L,axis=1); gy=ndimage.sobel(L,axis=0)",
    " Jxx=ndimage.gaussian_filter(gx*gx,sig); Jyy=ndimage.gaussian_filter(gy*gy,sig); Jxy=ndimage.gaussian_filter(gx*gy,sig)",
    " return np.sqrt((Jxx-Jyy)**2+4*Jxy**2)/(Jxx+Jyy+1e-9)",
    "margin=float(coh(Lc)[interior].mean()-coh(Lp)[strip].mean())",
    "print(json.dumps({'stroke_w':stroke_w,'ratio':ratio,'margin':margin,'H':H,'skin_med':skin_med,'paint_frac':float(painted.sum()/u.sum()),'n_interior':int(interior.sum()),'n_strip':int(strip.sum())}))",
  ];

  function g9Stats(pre: string, post: string, maskL: string, maskR: string, facecore: string): { stroke_w: number; ratio: number; margin: number; H: number; skin_med: number; paint_frac: number; n_interior: number; n_strip: number } {
    const lines = [
      ...G9_HEAD,
      `pre=np.array(Image.open(${JSON.stringify(pre)}).convert('RGB')).astype(float)/255.0`,
      `post=np.array(Image.open(${JSON.stringify(post)}).convert('RGB')).astype(float)/255.0`,
      `mL=np.array(Image.open(${JSON.stringify(maskL)}).convert('L'))>127`,
      `mR=np.array(Image.open(${JSON.stringify(maskR)}).convert('L'))>127`,
      `fc=np.array(Image.open(${JSON.stringify(facecore)}).convert('L'))>127`,
      ...G9_TAIL,
    ];
    return JSON.parse(pyMeasure(lines)) as { stroke_w: number; ratio: number; margin: number; H: number; skin_med: number; paint_frac: number; n_interior: number; n_strip: number };
  }

  const G10_TAIL = [
    "u=(mL|mR)",
    "ys,xs=np.where(u); top,bottom=int(ys.min()),int(ys.max()); H=bottom-top+1",
    "erode=max(2,min(8,H//6)); gap=max(2,H//60)",
    "strip=np.zeros_like(u); s1=max(0,top-gap-H); s0=max(0,top-gap); strip[s1:s0,:]=True",
    "strip&=fc; strip&=~ndimage.binary_dilation(u,iterations=gap)",
    "interior=ndimage.binary_erosion(u,iterations=erode)",
    "Lp=rgb2lab(pre)[:,:,0]; Lc=rgb2lab(post)[:,:,0]",
    // G10 reads the FFT max over RENDER-RESOLVABLE periods (>= 8 px texture:
    // the 4096-px albedo minifies 3.2x into 1280-px renders, so finer periods
    // alias away and the visible stripes live at >= 8 px). A global all-bin
    // max/median is statistically unreachable on 505-row profiles even for
    // white noise (extreme-value floor mean 2.93, min 2.28/200 trials) and
    // for natural narrow-region skin (2.09-2.14 at 60 rows); the band
    // restriction keeps the gate's separating power (the reference strip
    // passes, the hb1 output fails) while admitting faithful texture.
    // Totals print for transparency.
    "def rowfft(L,region):",
    " hp=L-ndimage.gaussian_filter(L,2)",
    " rys=sorted(set(np.where(region)[0]))",
    " p=np.array([hp[y,region[y]].mean() for y in rys]); p=p-p.mean()",
    " spec=np.abs(np.fft.rfft(p))[1:]; n=len(p)",
    " per=n/(np.arange(len(spec))+1)",
    " vis=per>=8",
    " return float(spec.max()/np.median(spec)),float(spec[vis].max()/np.median(spec)),int(n)",
    "tc,vc,nc=rowfft(Lc,interior); ts,vs,ns=rowfft(Lp,strip)",
    "print(json.dumps({'cleared_total':tc,'cleared':vc,'n_cleared':nc,'strip_total':ts,'strip':vs,'n_strip':ns}))",
  ];

  function g10Stats(pre: string, post: string, maskL: string, maskR: string, facecore: string): { cleared_total: number; cleared: number; n_cleared: number; strip_total: number; strip: number; n_strip: number } {
    const lines = [
      ...G9_HEAD,
      `pre=np.array(Image.open(${JSON.stringify(pre)}).convert('RGB')).astype(float)/255.0`,
      `post=np.array(Image.open(${JSON.stringify(post)}).convert('RGB')).astype(float)/255.0`,
      `mL=np.array(Image.open(${JSON.stringify(maskL)}).convert('L'))>127`,
      `mR=np.array(Image.open(${JSON.stringify(maskR)}).convert('L'))>127`,
      `fc=np.array(Image.open(${JSON.stringify(facecore)}).convert('L'))>127`,
      ...G10_TAIL,
    ];
    return JSON.parse(pyMeasure(lines)) as { cleared_total: number; cleared: number; n_cleared: number; strip_total: number; strip: number; n_strip: number };
  }

  function runMesh(tmp: string, fix: { albedo: string; maskL: string; maskR: string; facecore: string; eyesL: string; eyesR: string }): { out: string; stdout: string } {
    const out = path.join(tmp, "mesh.png");
    const stdout = execFileSync("python3", [SCRIPT, fix.albedo, out,
      "--brows-mask-L", fix.maskL, "--brows-mask-R", fix.maskR,
      "--facecore-mask", fix.facecore,
      "--eyes-mask-L", fix.eyesL, "--eyes-mask-R", fix.eyesR,
      "--brow-form", "mesh"], { encoding: "utf8" });
    return { out, stdout };
  }

  it("G9: a faint painted outline under the full mask leaves no ghost", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brow-g9-"));
    const fix = stageGhostFixture(tmp);
    const { out, stdout } = runMesh(tmp, fix);
    const info = JSON.parse(stdout.match(/\{[\s\S]*\}/)![0]!) as { outside_max_dLab: number };
    expect(info.outside_max_dLab).toBe(0);
    const g9 = g9Stats(fix.albedo, out, fix.maskL, fix.maskR, fix.facecore);
    expect(g9.stroke_w).toBeGreaterThan(0); // painted strokes present in PRE
    // Stroke-scale high-pass energy matches the forehead strip (ghost gone).
    expect(g9.ratio).toBeGreaterThanOrEqual(0.7);
    expect(g9.ratio).toBeLessThanOrEqual(1.3);
    // No oriented structure left behind.
    expect(g9.margin).toBeLessThanOrEqual(0.05);
    const edge = maxDLabOutside(fix.albedo, out, fix.maskL, fix.maskR);
    expect(edge.haloFrac).toBeLessThanOrEqual(0.10);
  }, 120000);

  it("G10: the cleared row-mean profile has no periodic peak at visible periods (real brow inputs)", () => {
    const store = "/Volumes/files/openclinxr-assets/store";
    const pre = `${store}/skin-wrinkle-scale/albedo_detail_aisha_post10.png`;
    const deriv = `${store}/face-station-cases/aisha/run2/derive_out`;
    const maskL = `${deriv}/mask-brows-L.png`;
    const maskR = `${deriv}/mask-brows-R.png`;
    const facecore = `${deriv}/mask-facecore.png`;
    const eyesL = `${deriv}/mask-eyes-L.png`;
    const eyesR = `${deriv}/mask-eyes-R.png`;
    for (const p of [pre, maskL, maskR, facecore, eyesL, eyesR]) {
      if (!fs.existsSync(p)) return;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brow-g10-"));
    const { out, stdout } = runMesh(tmp, { albedo: pre, maskL, maskR, facecore, eyesL, eyesR });
    const info = JSON.parse(stdout.match(/\{[\s\S]*\}/)![0]!) as { outside_max_dLab: number };
    expect(info.outside_max_dLab).toBe(0);
    const g10 = g10Stats(pre, out, maskL, maskR, facecore);
    expect(g10.n_cleared).toBeGreaterThan(30);
    expect(g10.n_strip).toBeGreaterThan(30);
    expect(g10.strip).toBeLessThanOrEqual(2); // known-good reference passes
    expect(g10.cleared).toBeLessThanOrEqual(2); // no visible stripes
  }, 600000);
});

describe("the brow follows the case brow_form: G11 mid-frequency mottle (hb3)", () => {
  /** G11: the cleared region must carry the full skin band (4-16 px mottle),
   * not just fine grain. M = changed L* pixels, closed + hole-filled, split
   * into one component per side; bp = gauss2 - gauss8; core = inside depth >
   * 15 px, ring = outside distance in (5, 40] px; ratio = std(bp[core]) /
   * std(bp[ring]) per component; gate 0.65 <= ratio <= 1.35. dL is report
   * only. Known-good = the same component masks translated onto untouched
   * forehead skin of the PRE albedo; known-bad = the frozen hb2 output. */
  const STORE = "/Volumes/files/openclinxr-assets/store";
  const PRE = `${STORE}/skin-wrinkle-scale/albedo_detail_aisha_post10.png`;
  const HB2_POST = `${STORE}/skin-brow-form/hb2/albedo_browform_aisha.png`;
  const DERIV = `${STORE}/face-station-cases/aisha/run2/derive_out`;
  const G11_TRANSLATIONS: Array<[number, number]> = [[-180, -60], [-180, 0], [-180, 30]];

  // Eye-exclusion dilation for the skin-to-skin G11 gate (hb3): the
  // brief-literal ring reaches upper-lash/lid energy (bandpass std 5.5 vs
  // 0.55 for adjacent skin, measured), which no honest skin transplant
  // should match; excluding it keeps core and ring on skin, consistent with
  // the known-good clean-forehead protocol and the G8/G9 clean-strip
  // references. 8 px covers the gauss(8) bleed halo of lash dark.
  const G11_EYE_DIL = 8;

  const G11_HEAD = [
    "import numpy as np, json",
    "from PIL import Image",
    "from scipy import ndimage",
    "from skimage.color import rgb2lab",
    "def Lstar(p):",
    " a=np.array(Image.open(p).convert('RGB')).astype(float)/255.0",
    " return rgb2lab(a)[:,:,0]",
    "def comps(pre,post):",
    " Lp=Lstar(pre); Lc=Lstar(post)",
    " M=np.abs(Lc-Lp)>1e-6",
    " M=ndimage.binary_closing(M,iterations=3); M=ndimage.binary_fill_holes(M)",
    " lab,n=ndimage.label(M)",
    " order=sorted(range(1,n+1),key=lambda i: ndimage.center_of_mass(lab==i)[1])",
    " cs=[(lab==i) for i in order]",
    " cs=[c for c in cs if (c& (ndimage.distance_transform_edt(c)>15)).any()]",
    " return Lp,Lc,cs",
    "def loadexcl(lpath,rpath,dil):",
    " el=np.array(Image.open(lpath).convert('L'))>127",
    " er=np.array(Image.open(rpath).convert('L'))>127",
    " return ndimage.binary_dilation(el|er,iterations=dil)",
    "def g11(L,comp,excl):",
    " bp=ndimage.gaussian_filter(L,2)-ndimage.gaussian_filter(L,8)",
    " core=(comp&(ndimage.distance_transform_edt(comp)>15))&~excl",
    " ring=((~comp)&(ndimage.distance_transform_edt(~comp)>5)&(ndimage.distance_transform_edt(~comp)<=40))&~excl",
    " return float(bp[core].std()/bp[ring].std()),float(L[core].mean()-L[ring].mean()),int(core.sum()),int(comp.sum())",
  ];

  function realInputs(): boolean {
    for (const p of [PRE, HB2_POST, `${DERIV}/mask-brows-L.png`, `${DERIV}/mask-brows-R.png`,
      `${DERIV}/mask-facecore.png`, `${DERIV}/mask-eyes-L.png`, `${DERIV}/mask-eyes-R.png`,
      `${DERIV}/mask-brows-L.png`]) if (!fs.existsSync(p)) return false;
    return true;
  }

  it("G11 calibration (brief-literal): known-good ~1.08, known-bad hb2 0.29 FAILS", () => {
    if (!realInputs()) return;
    const got = JSON.parse(pyMeasure([
      ...G11_HEAD,
      `Lp,Lc,cs=comps(${JSON.stringify(PRE)},${JSON.stringify(HB2_POST)})`,
      `mL=np.array(Image.open(${JSON.stringify(`${DERIV}/mask-brows-L.png`)}).convert('L'))>127`,
      `mR=np.array(Image.open(${JSON.stringify(`${DERIV}/mask-brows-R.png`)}).convert('L'))>127`,
      "dil40=ndimage.binary_dilation(mL|mR,iterations=40)",
      "bp=ndimage.gaussian_filter(Lp,2)-ndimage.gaussian_filter(Lp,8)",
      "zero=np.zeros_like(mL)",
      "out=[]",
      `ts=${JSON.stringify(G11_TRANSLATIONS)}`,
      "for comp in cs:",
      " for dx,dy in ts:",
      "  t=np.roll(np.roll(comp,dy,axis=0),dx,axis=1)",
      "  assert not (t&dil40).any(), 'translated mask overlaps the brow union'",
      "  r,d,_,_=g11(Lp,t,zero)",
      "  out.append([round(r,3),round(d,2)])",
      "bad=[g11(Lc,c,zero) for c in cs]",
      "print(json.dumps({'good':out,'bad':[[round(r,3),round(d,2)] for r,d,_,_ in bad]}))",
    ])) as { good: Array<[number, number]>; bad: Array<[number, number]> };
    // Lane-manager known-good: ratio 1.006-1.133, mean 1.082, sd 0.042, n=6.
    expect(got.good).toHaveLength(6);
    const rs = got.good.map(([r]) => r);
    expect(Math.min(...rs)).toBeGreaterThanOrEqual(0.99);
    expect(Math.max(...rs)).toBeLessThanOrEqual(1.17);
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    expect(mean).toBeCloseTo(1.082, 1);
    expect(got.good.every(([, d]) => d >= -0.7 && d <= 0.5)).toBe(true);
    // Lane-manager known-bad: hb2 ratio 0.292/0.290, dL -1.79/-1.14.
    const badR = got.bad.map(([r]) => r).sort((a, b) => a - b);
    expect(badR[0]).toBeCloseTo(0.290, 1);
    expect(badR[1]).toBeCloseTo(0.292, 1);
    const badD = got.bad.map(([, d]) => d).sort((a, b) => a - b);
    expect(badD[0]).toBeCloseTo(-1.79, 0);
    expect(badD[1]).toBeCloseTo(-1.14, 0);
    // RED: the frozen hb2 output fails the brief-literal G11 gate on both
    // sides (defect record; the ring carries lash energy, see ceiling).
    expect(badR.every((r) => r < 0.65)).toBe(true);
  }, 300000);

  it("G11 ceiling: perfect skin reads < 0.65 on the literal ring, so the literal gate is unpassable honestly", () => {
    if (!realInputs()) return;
    const got = JSON.parse(pyMeasure([
      ...G11_HEAD,
      `Lp,Lc,cs=comps(${JSON.stringify(PRE)},${JSON.stringify(HB2_POST)})`,
      `excl=loadexcl(${JSON.stringify(`${DERIV}/mask-eyes-L.png`)},${JSON.stringify(`${DERIV}/mask-eyes-R.png`)},${G11_EYE_DIL})`,
      "bp=ndimage.gaussian_filter(Lp,2)-ndimage.gaussian_filter(Lp,8)",
      // Adjacent clean skin (literal ring minus eyes, on PRE) vs the
      // literal ring: the best honest transplant target, still far under
      // the gate, because the ring is lash-dominated (5.5 vs 0.55).
      "def ceiling(comp):",
      " ring=(~comp)&(ndimage.distance_transform_edt(~comp)>5)&(ndimage.distance_transform_edt(~comp)<=40)",
      " return round(float(bp[ring&~excl].std())/float(bp[ring].std()),3)",
      "print(json.dumps([ceiling(c) for c in cs]))",
    ])) as Array<number>;
    expect(got).toHaveLength(2);
    for (const r of got) expect(r).toBeLessThan(0.65);
  }, 300000);

  it("G11 gate (skin-to-skin): the mesh-stage output carries mid-frequency mottle (0.65-1.35 both sides)", () => {
    if (!realInputs()) return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brow-g11-"));
    const out = path.join(tmp, "mesh.png");
    const stdout = execFileSync("python3", [SCRIPT, PRE, out,
      "--brows-mask-L", `${DERIV}/mask-brows-L.png`,
      "--brows-mask-R", `${DERIV}/mask-brows-R.png`,
      "--facecore-mask", `${DERIV}/mask-facecore.png`,
      "--eyes-mask-L", `${DERIV}/mask-eyes-L.png`,
      "--eyes-mask-R", `${DERIV}/mask-eyes-R.png`,
      "--brow-form", "mesh"], { encoding: "utf8" });
    const info = JSON.parse(stdout.match(/\{[\s\S]*\}/)![0]!) as { outside_max_dLab: number };
    expect(info.outside_max_dLab).toBe(0);
    const got = JSON.parse(pyMeasure([
      ...G11_HEAD,
      `Lp,Lc,cs=comps(${JSON.stringify(PRE)},${JSON.stringify(out)})`,
      `excl=loadexcl(${JSON.stringify(`${DERIV}/mask-eyes-L.png`)},${JSON.stringify(`${DERIV}/mask-eyes-R.png`)},${G11_EYE_DIL})`,
      "print(json.dumps([{'ratio':g11(Lc,c,excl)[0],'dL':g11(Lc,c,excl)[1]} for c in cs]))",
    ])) as Array<{ ratio: number; dL: number }>;
    expect(got).toHaveLength(2);
    for (const g of got) {
      expect(g.ratio).toBeGreaterThanOrEqual(0.65);
      expect(g.ratio).toBeLessThanOrEqual(1.35);
    }
  }, 600000);
});

describe("the brow follows the case brow_form: G12 bright-tail speckle (hb4)", () => {
  /** G12: the cleared core must keep natural skin's dark-skewed high-pass,
   * not the symmetric fill the hb3 overlap-average + ~1.6 gain imprints.
   * Tail = L* minus gaussian-3 high-pass; per side, s = std of the same
   * high-pass over the eye-excluded ring (eyes dilated 8 px, as G11):
   * bright = frac(core with hp > +2s) <= 0.0096 (midpoint of known-good max
   * 0.0027 ring / 0.0017 forehead and known-bad min 0.0165 hb3 core).
   * Counterweights: dark = frac(core with hp < -2s) >= 0.5 x the ring's
   * own dark tail (a pore-killing blur that passes G12 fails), and the
   * eye-excluded G11 ratio stays in 0.65-1.35. dL core-minus-ring is
   * report only. */
  const STORE = "/Volumes/files/openclinxr-assets/store";
  const PRE = `${STORE}/skin-wrinkle-scale/albedo_detail_aisha_post10.png`;
  const HB3_POST = `${STORE}/skin-brow-form/hb3/albedo_browform_aisha.png`;
  const DERIV = `${STORE}/face-station-cases/aisha/run2/derive_out`;
  const G12_BOUND = 0.0096;

  const G12_HEAD = [
    "import numpy as np, json",
    "from PIL import Image",
    "from scipy import ndimage",
    "from skimage.color import rgb2lab",
    "def Lstar(p):",
    " a=np.array(Image.open(p).convert('RGB')).astype(float)/255.0",
    " return rgb2lab(a)[:,:,0]",
    "def comps(pre,post):",
    " Lp=Lstar(pre); Lc=Lstar(post)",
    " M=np.abs(Lc-Lp)>1e-6",
    " M=ndimage.binary_closing(M,iterations=3); M=ndimage.binary_fill_holes(M)",
    " lab,n=ndimage.label(M)",
    " order=sorted(range(1,n+1),key=lambda i: ndimage.center_of_mass(lab==i)[1])",
    " cs=[(lab==i) for i in order]",
    " cs=[c for c in cs if (c& (ndimage.distance_transform_edt(c)>15)).any()]",
    " return Lp,Lc,cs",
    "def loadexcl(lpath,rpath,dil):",
    " el=np.array(Image.open(lpath).convert('L'))>127",
    " er=np.array(Image.open(rpath).convert('L'))>127",
    " return ndimage.binary_dilation(el|er,iterations=dil)",
    "def hp3(L):",
    " return L-ndimage.gaussian_filter(L,3)",
    "def g12(Lpre,Lpost,comp,excl):",
    " core=(comp&(ndimage.distance_transform_edt(comp)>15))&~excl",
    " ring=((~comp)&(ndimage.distance_transform_edt(~comp)>5)&(ndimage.distance_transform_edt(~comp)<=40))&~excl",
    " s=float(hp3(Lpre)[ring].std())",
    " hp=hp3(Lpost); hpre=hp3(Lpre)",
    " return [float((hp[core]>2*s).mean()),float((hp[core]<-2*s).mean()),float((hpre[ring]>2*s).mean()),float((hpre[ring]<-2*s).mean())]",
  ];

  function g12Inputs(): boolean {
    for (const p of [PRE, HB3_POST, `${DERIV}/mask-brows-L.png`, `${DERIV}/mask-brows-R.png`,
      `${DERIV}/mask-eyes-L.png`, `${DERIV}/mask-eyes-R.png`]) if (!fs.existsSync(p)) return false;
    return true;
  }

  function runLiveMesh(tmp: string): string {
    const out = path.join(tmp, "mesh.png");
    execFileSync("python3", [SCRIPT, PRE, out,
      "--brows-mask-L", `${DERIV}/mask-brows-L.png`,
      "--brows-mask-R", `${DERIV}/mask-brows-R.png`,
      "--facecore-mask", `${DERIV}/mask-facecore.png`,
      "--eyes-mask-L", `${DERIV}/mask-eyes-L.png`,
      "--eyes-mask-R", `${DERIV}/mask-eyes-R.png`,
      "--brow-form", "mesh"], { encoding: "utf8" });
    return out;
  }

  it("G12 calibration: PRE ring + open forehead <= 0.0096, frozen hb3 cores > 0.0096", () => {
    if (!g12Inputs()) return;
    const got = JSON.parse(pyMeasure([
      ...G12_HEAD,
      `Lp,Lc,cs=comps(${JSON.stringify(PRE)},${JSON.stringify(HB3_POST)})`,
      `excl=loadexcl(${JSON.stringify(`${DERIV}/mask-eyes-L.png`)},${JSON.stringify(`${DERIV}/mask-eyes-R.png`)},8)`,
      "tails=[g12(Lp,Lc,c,excl) for c in cs]",
      "Fh=hp3(Lp)[1700:2500,3170:3300]; Fs=float(Fh.std())",
      "fore=[float((Fh>2*Fs).mean()),float((Fh<-2*Fs).mean())]",
      "print(json.dumps({'tails':tails,'fore':fore}))",
    ])) as { tails: Array<[number, number, number, number]>; fore: [number, number] };
    expect(got.tails).toHaveLength(2);
    // Known-good: ring self bright (lane-manager 0.0011-0.0027) + open
    // forehead 0.0017, all under the bound.
    for (const [, , ringBright] of got.tails) expect(ringBright).toBeLessThanOrEqual(G12_BOUND);
    expect(got.fore[0]).toBeLessThanOrEqual(G12_BOUND);
    // Known-bad: frozen hb3 cores 0.0165/0.0308, both over the bound (RED).
    const badBright = got.tails.map(([b]) => b).sort((a, b) => a - b);
    expect(badBright[0]).toBeCloseTo(0.0165, 2);
    expect(badBright[1]).toBeCloseTo(0.0308, 2);
    expect(badBright.every((b) => b > G12_BOUND)).toBe(true);
  }, 300000);

  it("G12 gate: the live mesh output core bright tail <= 0.0096 per side", () => {
    if (!g12Inputs()) return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brow-g12-"));
    const out = runLiveMesh(tmp);
    const got = JSON.parse(pyMeasure([
      ...G12_HEAD,
      `Lp,Lc,cs=comps(${JSON.stringify(PRE)},${JSON.stringify(out)})`,
      `excl=loadexcl(${JSON.stringify(`${DERIV}/mask-eyes-L.png`)},${JSON.stringify(`${DERIV}/mask-eyes-R.png`)},8)`,
      "print(json.dumps([g12(Lp,Lc,c,excl) for c in cs]))",
    ])) as Array<[number, number, number, number]>;
    expect(got).toHaveLength(2);
    for (const [bright] of got) expect(bright).toBeLessThanOrEqual(G12_BOUND);
  }, 600000);

  it("G12 counterweights: dark tail >= 0.5x ring dark, G11 eye-excluded in 0.65-1.35", () => {
    if (!g12Inputs()) return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brow-g12cw-"));
    const out = runLiveMesh(tmp);
    const got = JSON.parse(pyMeasure([
      ...G12_HEAD,
      `Lp,Lc,cs=comps(${JSON.stringify(PRE)},${JSON.stringify(out)})`,
      `excl=loadexcl(${JSON.stringify(`${DERIV}/mask-eyes-L.png`)},${JSON.stringify(`${DERIV}/mask-eyes-R.png`)},8)`,
      "def g11r(L,comp,excl):",
      " bp=ndimage.gaussian_filter(L,2)-ndimage.gaussian_filter(L,8)",
      " core=(comp&(ndimage.distance_transform_edt(comp)>15))&~excl",
      " ring=((~comp)&(ndimage.distance_transform_edt(~comp)>5)&(ndimage.distance_transform_edt(~comp)<=40))&~excl",
      " return float(bp[core].std()/bp[ring].std()),float(L[core].mean()-L[ring].mean())",
      "print(json.dumps([{'tails':g12(Lp,Lc,c,excl),'g11':g11r(Lc,c,excl)} for c in cs]))",
    ])) as Array<{ tails: [number, number, number, number]; g11: [number, number] }>;
    expect(got).toHaveLength(2);
    for (const { tails: [, dark, , ringDark], g11: [ratio] } of got) {
      expect(dark).toBeGreaterThanOrEqual(0.5 * ringDark);
      expect(ratio).toBeGreaterThanOrEqual(0.65);
      expect(ratio).toBeLessThanOrEqual(1.35);
    }
  }, 600000);
});

describe("the brow follows the case brow_form: G13 boundary tone step (hb5)", () => {
  /** G13: the low-frequency fill must meet its boundary. Per component M
   * (as G11), signed distance sd = +inside depth / -outside distance,
   * restricted to the forehead side (columns left of the component
   * centroid column minus 5, eyes dilated 12 px excluded); mean L* in 3-px
   * bands sd in [-12,-9),..., [12,15); minus the mean of the four outside
   * bands (-12..0). T = midpoint of the natural max |band| (>= 6
   * translations, dx -160..-180, dy -60..60, no overlap with the
   * 40-px-dilated brow union, eyes excluded) and the known-bad hb4 worst
   * band on the better side. If margin / natural sd < 1 the gate is
   * report-only. RED: the frozen hb4 file fails the bound. */
  const STORE = "/Volumes/files/openclinxr-assets/store";
  const PRE = `${STORE}/skin-wrinkle-scale/albedo_detail_aisha_post10.png`;
  const HB4_POST = `${STORE}/skin-brow-form/hb4/albedo_browform_aisha.png`;
  const DERIV = `${STORE}/face-station-cases/aisha/run2/derive_out`;
  const G13_BOUND_HINT = 1.39; // lane-manager known-bad hb4 worst, better side
  const G13_EDGES: Array<[number, number]> = [[-12, -9], [-9, -6], [-6, -3], [-3, 0], [0, 3], [3, 6], [6, 9], [9, 12], [12, 15]];
  const G13_DX = [-160, -170, -180];
  const G13_DY = [-60, -45, -30, -15, 0, 15, 30, 45, 60];

  const G13_HEAD = [
    "import numpy as np, json, itertools",
    "from PIL import Image",
    "from scipy import ndimage",
    "from skimage.color import rgb2lab",
    "def Lstar(p):",
    " a=np.array(Image.open(p).convert('RGB')).astype(float)/255.0",
    " return rgb2lab(a)[:,:,0]",
    "def comps(pre,post):",
    " Lp=Lstar(pre); Lc=Lstar(post)",
    " M=np.abs(Lc-Lp)>1e-6",
    " M=ndimage.binary_closing(M,iterations=3); M=ndimage.binary_fill_holes(M)",
    " lab,n=ndimage.label(M)",
    " order=sorted(range(1,n+1),key=lambda i: ndimage.center_of_mass(lab==i)[1])",
    " cs=[(lab==i) for i in order]",
    " cs=[c for c in cs if (c&(ndimage.distance_transform_edt(c)>15)).any()]",
    " return Lp,Lc,cs",
    "def loadexcl(lpath,rpath,dil):",
    " el=np.array(Image.open(lpath).convert('L'))>127",
    " er=np.array(Image.open(rpath).convert('L'))>127",
    " return ndimage.binary_dilation(el|er,iterations=dil)",
    "def profile_roi(L,comp,excl):",
    " ys,xs=np.where(comp)",
    " y0,y1=max(0,ys.min()-260),min(L.shape[0],ys.max()+260)",
    " x0,x1=max(0,xs.min()-300),min(L.shape[1],xs.max()+80)",
    " c=comp[y0:y1,x0:x1]; Lc=L[y0:y1,x0:x1]; ex=excl[y0:y1,x0:x1]",
    " cy,cx=ndimage.center_of_mass(comp)",
    " din=ndimage.distance_transform_edt(c); dout=ndimage.distance_transform_edt(~c)",
    " sd=np.where(c,din,-dout)",
    " colok=(np.arange(x0,x1)[None,:]<=(int(cx)-5))",
    " keep=colok&~ex",
    " bands=[float(Lc[(sd>=lo)&(sd<hi)&keep].mean()) for lo,hi in " + JSON.stringify(G13_EDGES) + "]",
    " ref=float(np.mean(bands[:4]))",
    " return [round(v-ref,4) for v in bands]",
  ];

  function g13Inputs(): boolean {
    for (const p of [PRE, HB4_POST, `${DERIV}/mask-brows-L.png`, `${DERIV}/mask-brows-R.png`,
      `${DERIV}/mask-eyes-L.png`, `${DERIV}/mask-eyes-R.png`]) if (!fs.existsSync(p)) return false;
    return true;
  }

  function calibrate(): { nat: Array<{ n: number; max: number; sd: number }>; bad: [number, number]; badprof: number[][] } {
    return JSON.parse(pyMeasure([
      ...G13_HEAD,
      `Lp,Lc,cs=comps(${JSON.stringify(PRE)},${JSON.stringify(HB4_POST)})`,
      `excl=loadexcl(${JSON.stringify(`${DERIV}/mask-eyes-L.png`)},${JSON.stringify(`${DERIV}/mask-eyes-R.png`)},12)`,
      `mL=np.array(Image.open(${JSON.stringify(`${DERIV}/mask-brows-L.png`)}).convert('L'))>127`,
      `mR=np.array(Image.open(${JSON.stringify(`${DERIV}/mask-brows-R.png`)}).convert('L'))>127`,
      "dil40=ndimage.binary_dilation(mL|mR,iterations=40)",
      "out=[]",
      `dxs=${JSON.stringify(G13_DX)}; dys=${JSON.stringify(G13_DY)}`,
      "for comp in cs:",
      " vals=[]; nn=0",
      " for dx,dy in itertools.product(dxs,dys):",
      "  t=np.roll(np.roll(comp,dy,axis=0),dx,axis=1)",
      "  if (t&dil40).any(): continue",
      "  nn+=1",
      "  vals+=profile_roi(Lp,t,excl)",
      " out.append({'n':nn,'max':round(float(max(abs(v) for v in vals)),4),'sd':round(float(np.std(vals)),4)})",
      "bad=[round(float(max(abs(v) for v in profile_roi(Lc,c,excl))),4) for c in cs]",
      "badprof=[profile_roi(Lc,c,excl) for c in cs]",
      "print(json.dumps({'nat':out,'bad':bad,'badprof':badprof}))",
    ])) as { nat: Array<{ n: number; max: number; sd: number }>; bad: [number, number]; badprof: number[][] };
  }

  function liveProfile(tmp: string): { prof: number[][]; outside: number } {
    const out = path.join(tmp, "mesh.png");
    const stdout = execFileSync("python3", [SCRIPT, PRE, out,
      "--brows-mask-L", `${DERIV}/mask-brows-L.png`,
      "--brows-mask-R", `${DERIV}/mask-brows-R.png`,
      "--facecore-mask", `${DERIV}/mask-facecore.png`,
      "--eyes-mask-L", `${DERIV}/mask-eyes-L.png`,
      "--eyes-mask-R", `${DERIV}/mask-eyes-R.png`,
      "--brow-form", "mesh"], { encoding: "utf8" });
    const info = JSON.parse(stdout.match(/\{[\s\S]*\}/)![0]!) as { outside_max_dLab: number };
    const prof = JSON.parse(pyMeasure([
      ...G13_HEAD,
      `Lp,Lc,cs=comps(${JSON.stringify(PRE)},${JSON.stringify(out)})`,
      `excl=loadexcl(${JSON.stringify(`${DERIV}/mask-eyes-L.png`)},${JSON.stringify(`${DERIV}/mask-eyes-R.png`)},12)`,
      "print(json.dumps([profile_roi(Lc,c,excl) for c in cs]))",
    ])) as number[][];
    return { prof, outside: info.outside_max_dLab };
  }

  function worst(prof: number[]): number {
    return Math.max(...prof.map((v) => Math.abs(v)));
  }

  function worstInterior(prof: number[]): number {
    // Bands [0,15) only: the four outside bands are byte-identical PRE /
    // POST by construction (zero writes outside the union), so only the
    // interior can move. The pre-existing outside rim (-1.39 on comp1)
    // reproduces exactly in every output.
    return Math.max(...prof.slice(4).map((v) => Math.abs(v)));
  }

  it("G13 calibration: natural spread, T, and the frozen hb4 file RED", () => {
    if (!g13Inputs()) return;
    const cal = calibrate();
    expect(cal.nat).toHaveLength(2);
    for (const n of cal.nat) expect(n.n).toBeGreaterThanOrEqual(6);
    // Lane-manager numbers, reproduced: natural max 0.93/1.32, hb4 2.95/1.39.
    const nmax = cal.nat.map((n) => n.max).sort((a, b) => a - b);
    expect(nmax[0]).toBeCloseTo(0.93, 1);
    expect(nmax[1]).toBeCloseTo(1.32, 1);
    const bad = [...cal.bad].sort((a, b) => a - b);
    expect(bad[0]).toBeCloseTo(G13_BOUND_HINT, 1);
    expect(bad[1]).toBeCloseTo(2.95, 1);
    // T = midpoint of the global natural max and the known-bad better side.
    const naturalMax = Math.max(...cal.nat.map((n) => n.max));
    const better = Math.min(...cal.bad);
    const T = (naturalMax + better) / 2;
    expect(T).toBeGreaterThan(naturalMax);
    expect(T).toBeLessThan(better + 0.5);
    // RED: the frozen hb4 file fails the bound on the worse side.
    expect(Math.max(...cal.bad)).toBeGreaterThan(T);
    // Margin / natural sd < 1: the bound has no separating power over
    // natural forehead tone, so hb5 reports G13 instead of enforcing it.
    const all = cal.nat.flatMap((n, i) => [n.sd]);
    const sd = Math.max(...all);
    const margin = T - naturalMax;
    expect(margin / sd).toBeLessThan(1);
  }, 300000);

  it("G13 gate (report-only): the live mesh output improves the boundary profile per side, zero writes outside", () => {
    if (!g13Inputs()) return;
    const cal = calibrate();
    const naturalMax = Math.max(...cal.nat.map((n) => n.max));
    const better = Math.min(...cal.bad);
    const T = (naturalMax + better) / 2;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brow-g13-"));
    const { prof, outside } = liveProfile(tmp);
    expect(outside).toBe(0);
    expect(prof).toHaveLength(2);
    // Report-only (margin/sd < 1, see calibration): the Dirichlet-pinned
    // fill strictly improves the worst interior band on both sides (the
    // outside bands are frozen PRE bytes, excluded from the comparison).
    const hb4Interior = cal.badprof.map(worstInterior);
    for (let i = 0; i < 2; i++) {
      expect(worstInterior(prof[i])).toBeLessThan(hb4Interior[i]);
    }
    // Recorded beside hb4 in the report; printed here for the log.
    console.log(JSON.stringify({ T: Math.round(T * 1000) / 1000, liveInteriorWorst: prof.map(worstInterior), hb4InteriorWorst: hb4Interior }));
  }, 600000);
});

describe("the brow follows the case brow_form: report validates", () => {
  it("brow-form-report.json names the card, per-case values, and gate table", () => {
    const r = loadJson(REPORT) as {
      card?: unknown; values?: Record<string, { dL: number; dC: number; mode: string }>;
      gates?: Record<string, unknown>;
    };
    expect(r.card).toBe("tsk_b438966217dd814e");
    expect(r.values?.["aisha"]?.mode).toBe("mesh");
    expect(r.values?.["body2"]?.mode).toBe("texture");
    for (const g of ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "G13"]) expect(r.gates?.[g], g).toBeDefined();
  });

  it("report mode values match case-inputs.json brow_form", () => {
    const r = loadJson(REPORT) as { values?: Record<string, { mode: string }> };
    const inputs = loadJson(CASE_INPUTS) as {
      cases: Record<string, { chain_subject?: { value?: string }; brow_form?: { value?: string } }>;
    };
    const bySubject: Record<string, string> = {};
    for (const rec of Object.values(inputs.cases)) {
      if (rec.chain_subject?.value && rec.brow_form?.value) bySubject[rec.chain_subject.value] = rec.brow_form.value;
    }
    const manifest = loadJson(MANIFEST) as { subjects: Record<string, unknown> };
    for (const subject of Object.keys(manifest.subjects)) {
      if (bySubject[subject] && r.values?.[subject]) {
        expect(r.values[subject]!.mode).toBe(bySubject[subject]);
      }
    }
  });
});
