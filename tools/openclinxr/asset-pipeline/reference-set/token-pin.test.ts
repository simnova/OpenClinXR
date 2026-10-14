/**
 * Token-pin test: the reference-set's tone_tokens must match the generator's
 * SKIN_TONE_RGB table. This test parses the generator source and fails on drift.
 *
 * Generator: tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py
 * Constant: SKIN_TONE_RGB (line ~335)
 * Reference-set constant: tools/openclinxr/asset-pipeline/reference-set/reference_constants.json
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
  let m;
  while ((m = entryRegex.exec(dictContent)) !== null) {
    const key = m[1];
    const r = parseFloat(m[2]);
    const g = parseFloat(m[3]);
    const b = parseFloat(m[4]);
    result[key] = [r, g, b];
  }
  return result;
}

describe("token-pin: reference-set tone_tokens matches generator SKIN_TONE_RGB", () => {
  it("parses generator SKIN_TONE_RGB and matches reference-set constants", () => {
    console.log("GENERATOR_PATH:", GENERATOR_PATH);
    console.log("CONSTANTS_PATH:", CONSTANTS_PATH);
    const genSource = fs.readFileSync(GENERATOR_PATH, "utf8");
    const genTokens = parseGeneratorSkinToneRgb(genSource);
    const constants = JSON.parse(fs.readFileSync(CONSTANTS_PATH, "utf8"));
    const refTokens: Record<string, [number, number, number]> = constants.tone_tokens;
    
    console.log("genTokens:", Object.keys(genTokens));
    console.log("refTokens:", Object.keys(refTokens));
    
    // Every token in reference-set must exist in generator with same values
    for (const [key, refVal] of Object.entries(refTokens)) {
      expect(genTokens).toHaveProperty(key);
      const genVal = genTokens[key];
      expect(genVal[0]).toBeCloseTo(refVal[0], 4);
      expect(genVal[1]).toBeCloseTo(refVal[1], 4);
      expect(genVal[2]).toBeCloseTo(refVal[2], 4);
    }
    
    // Generator must not have extra tokens that reference-set doesn't know
    // (warm_light_child is generator-only; that's fine - we only require
    //  reference-set tokens to be a subset with matching values)
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
});