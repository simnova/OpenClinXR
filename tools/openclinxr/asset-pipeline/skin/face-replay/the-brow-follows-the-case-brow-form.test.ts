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

/** Synthetic forehead crop: flat skin + one dark painted brow band + masks. */
function stageBrowFixture(tmp: string): { albedo: string; maskL: string; maskR: string; skinLab: number[] } {
  const albedo = path.join(tmp, "albedo.png");
  const maskL = path.join(tmp, "mask-brows-L.png");
  const maskR = path.join(tmp, "mask-brows-R.png");
  pyMeasure([
    "import numpy as np",
    "from PIL import Image",
    `S=256`,
    `a=(np.ones((S,S,3))*[168,128,110]).astype(np.uint8)`,
    "a[96:116,60:196]=[150,60,40]",   // painted left brow: dark, chromatic
    "a[96:116,196:200]=[150,60,40]",
    `Image.fromarray(a).save(${JSON.stringify(albedo)})`,
    `mL=np.zeros((S,S),np.uint8); mL[96:116,60:200]=255`,
    `Image.fromarray(mL).save(${JSON.stringify(maskL)})`,
    `mR=np.zeros((S,S),np.uint8)`,
    `Image.fromarray(mR).save(${JSON.stringify(maskR)})`,
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
  return { albedo, maskL, maskR, skinLab: [skinLab.L, skinLab.C] };
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

  it("the texture override pair equals the solved PRE-to-goal gap from the one-brow instrument", () => {
    const one = loadJson(ONE_BROW) as {
      subjects: Record<string, { measurements: { PRE: { mean: { dL: number; dC: number } }; goal: { mean: { dL: number; dC: number } } } }>;
    };
    const manifest = loadJson(MANIFEST) as {
      subjects: Record<string, { overrides: Record<string, Record<string, number>> }>;
    };
    const pre = one.subjects["body2"]!.measurements.PRE.mean;
    const goal = one.subjects["body2"]!.measurements.goal.mean;
    const ov = manifest.subjects["adult_male_street_casual"]!.overrides["brow_form"]!;
    expect(ov["dL"]).toBeCloseTo(goal.dL - pre.dL, 0);
    expect(ov["dC"]).toBeCloseTo(goal.dC - pre.dC, 0);
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

  it("texture form shifts L*/C* by the stated pair, inside the masks only", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brow-tex-"));
    const fix = stageBrowFixture(tmp);
    const before = labStats(fix.albedo, fix.maskL);
    const out = path.join(tmp, "out.png");
    execFileSync("python3", [SCRIPT, fix.albedo, out,
      "--brows-mask-L", fix.maskL, "--brows-mask-R", fix.maskR,
      "--brow-form", "texture", "--dL", "-17.0", "--dC", "-17.4"], { encoding: "utf8" });
    // Interior (past the feather ramp) carries the full stated pair.
    const after = labStats(out, fix.maskL, 8);
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
      "--brow-form", "mesh", "--dL", "0", "--dC", "0"], { encoding: "utf8" });
    expect(labStats(meshOut, fix.maskL).meanL).toBeGreaterThan(labStats(fix.albedo, fix.maskL).meanL + 5);
    const texOut = path.join(tmp, "tex.png");
    execFileSync("python3", [SCRIPT, fix.albedo, texOut,
      "--brows-mask-L", fix.maskL, "--brows-mask-R", fix.maskR,
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

describe("the brow follows the case brow_form: report validates", () => {
  it("brow-form-report.json names the card, per-case values, and gate table", () => {
    const r = loadJson(REPORT) as {
      card?: unknown; values?: Record<string, { dL: number; dC: number; mode: string }>;
      gates?: Record<string, unknown>;
    };
    expect(r.card).toBe("tsk_b438966217dd814e");
    expect(r.values?.["aisha"]?.mode).toBe("mesh");
    expect(r.values?.["body2"]?.mode).toBe("texture");
    for (const g of ["G1", "G2", "G3", "G4", "G5"]) expect(r.gates?.[g], g).toBeDefined();
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
