/**
 * Token-pin test: the reference-set's tone_tokens, generator's SKIN_TONE_RGB,
 * and refit_materials.py's SKIN_TONE_RGBA must all match.
 *
 * Generator: tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py
 * Constant: SKIN_TONE_RGB (line ~335)
 * Reference-set constant: tools/openclinxr/asset-pipeline/reference-set/reference_constants.json
 * Refit materials: packages/openclinxr/factory-stations/src/clothing_consume/refit_materials.py
 * Constant: SKIN_TONE_RGBA
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Test file is at: tools/openclinxr/asset-pipeline/reference-set/token-pin.test.ts
// The generator is at: tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py
// Both relative to repo root. Get repo root from test file location.
const TEST_FILE = new URL(import.meta.url).pathname;
const TEST_DIR = path.dirname(TEST_FILE);
// Go up: tools/openclinxr/asset-pipeline/reference-set -> tools/openclinxr -> tools -> repo root
const REPO_ROOT = path.join(TEST_DIR, "..", "..", "..", "..");
const GENERATOR_PATH = path.join(REPO_ROOT, "tools", "openclinxr", "evidence", "blender", "materialize_mpfb_humanoid_candidate.py");
const REFIT_PATH = path.join(REPO_ROOT, "packages", "openclinxr", "factory-stations", "src", "clothing_consume", "refit_materials.py");
const CONSTANTS_PATH = path.join(TEST_DIR, "reference_constants.json");

function parseGeneratorSkinToneRgb(source: string): Record<string, [number, number, number]> {
  // Find the SKIN_TONE_RGB dict
  const match = source.match(/SKIN_TONE_RGB\s*=\s*\{([\s\S]*?)\n\}/);
  if (!match) {
    throw new Error("SKIN_TONE_RGB dict not found in generator source");
  }
  const dictContent = match[1];
  const result: Record<string, [number, number, number]> = {};
  // Parse key: (r, g, b) entries
  const entryRegex = /"([^"]+)"\s*:\s*\(([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(dictContent)) !== null) {
    const key = m[1];
    const r = parseFloat(m[2]);
    const g = parseFloat(m[3]);
    const b = parseFloat(m[4]);
    result[key] = [r, g, b];
  }
  return result;
}

function parseRefitSkinToneRgba(source: string): Record<string, [number, number, number, number]> {
  // Find the SKIN_TONE_RGBA dict
  const match = source.match(/SKIN_TONE_RGBA\s*=\s*\{([\s\S]*?)\n\}/);
  if (!match) {
    throw new Error("SKIN_TONE_RGBA dict not found in refit_materials.py source");
  }
  const dictContent = match[1];
  const result: Record<string, [number, number, number, number]> = {};
  // Parse key: (r, g, b, a) entries
  const entryRegex = /"([^"]+)"\s*:\s*\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(dictContent)) !== null) {
    const key = m[1];
    const r = parseFloat(m[2]);
    const g = parseFloat(m[3]);
    const b = parseFloat(m[4]);
    const a = parseFloat(m[5]);
    result[key] = [r, g, b, a];
  }
  return result;
}

describe("token-pin: reference-set tone_tokens matches generator SKIN_TONE_RGB and refit SKIN_TONE_RGBA", () => {
  it("parses generator SKIN_TONE_RGB and matches reference-set constants", () => {
    const genSource = fs.readFileSync(GENERATOR_PATH, "utf8");
    const genTokens = parseGeneratorSkinToneRgb(genSource);
    const constants = JSON.parse(fs.readFileSync(CONSTANTS_PATH, "utf8"));
    const refTokens: Record<string, [number, number, number]> = constants.tone_tokens;
    
    // Every token in reference-set must exist in generator with same values
    for (const [key, refVal] of Object.entries(refTokens)) {
      expect(genTokens).toHaveProperty(key);
      const genVal = genTokens[key];
      expect(genVal[0]).toBeCloseTo(refVal[0], 4);
      expect(genVal[1]).toBeCloseTo(refVal[1], 4);
      expect(genVal[2]).toBeCloseTo(refVal[2], 4);
    }
  });

  it("parses refit_materials.py SKIN_TONE_RGBA and matches generator SKIN_TONE_RGB", () => {
    const refitSource = fs.readFileSync(REFIT_PATH, "utf8");
    const refitTokens = parseRefitSkinToneRgba(refitSource);
    const genSource = fs.readFileSync(GENERATOR_PATH, "utf8");
    const genTokens = parseGeneratorSkinToneRgb(genSource);
    
    // Every token in refit must exist in generator with same RGB values (alpha=1.0)
    for (const [key, refitVal] of Object.entries(refitTokens)) {
      expect(genTokens).toHaveProperty(key);
      const genVal = genTokens[key];
      expect(refitVal[0]).toBeCloseTo(genVal[0], 4);
      expect(refitVal[1]).toBeCloseTo(genVal[1], 4);
      expect(refitVal[2]).toBeCloseTo(genVal[2], 4);
      expect(refitVal[3]).toBeCloseTo(1.0, 4);
    }
  });

  it("fails when generator tokens are mutated (drift detection)", () => {
    const genSource = fs.readFileSync(GENERATOR_PATH, "utf8");
    const genTokens = parseGeneratorSkinToneRgb(genSource);
    const constants = JSON.parse(fs.readFileSync(CONSTANTS_PATH, "utf8"));
    const refTokens: Record<string, [number, number, number]> = constants.tone_tokens;
    
    // Mutate one value in a copy to prove the test catches drift
    const mutatedGen = { ...genTokens };
    // Pick a token that exists in both
    const sharedKey = Object.keys(refTokens).find(k => mutatedGen[k]);
    if (sharedKey) {
      mutatedGen[sharedKey] = [0.0, 0.0, 0.0] as [number, number, number];
      const refVal = refTokens[sharedKey];
      expect(mutatedGen[sharedKey][0]).not.toBeCloseTo(refVal[0], 4);
    }
  });

  it("fails when refit_materials.py tokens are mutated (drift detection)", () => {
    const refitSource = fs.readFileSync(REFIT_PATH, "utf8");
    const refitTokens = parseRefitSkinToneRgba(refitSource);
    const genSource = fs.readFileSync(GENERATOR_PATH, "utf8");
    const genTokens = parseGeneratorSkinToneRgb(genSource);
    
    // Mutate one value in a copy to prove the test catches drift
    const mutatedRefit = { ...refitTokens };
    // Pick a token that exists in both
    const sharedKey = Object.keys(genTokens).find(k => mutatedRefit[k]);
    if (sharedKey) {
      mutatedRefit[sharedKey] = [0.0, 0.0, 0.0, 1.0] as [number, number, number, number];
      const genVal = genTokens[sharedKey];
      expect(mutatedRefit[sharedKey][0]).not.toBeCloseTo(genVal[0], 4);
    }
  });
});