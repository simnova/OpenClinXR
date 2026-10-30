import { describe, expect, it } from "vitest";
import { srgbByteToLinear, linearToSrgbByte, buildAlbedoLut, bakeAlphaByte } from "../../../../../../../tools/openclinxr/asset-pipeline/trellis/albedo-linear/colour-transfer.js";
// INDEPENDENT reference (spec text, not the implementation): decode sRGB -> linear,
// multiply LINEAR factor, re-encode. Duplicated here so the test is not a mirror.
function refBake(b: number, f: number): number {
  const c = b / 255;
  const l = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const m = Math.min(1, Math.max(0, l * f));
  const s = m <= 0.0031308 ? 12.92 * m : 1.055 * Math.pow(m, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(s * 255)));
}
describe("albedo linear transfer (glTF 2.0 PBR)", () => {
  it("published example: [64,124,231]x[.2,1,.7] -> [26,124,197], not old [13,124,162]", () => {
    const lut = buildAlbedoLut([0.2, 1, 0.7]);
    expect([lut[0]![64], lut[1]![124], lut[2]![231]]).toEqual([26, 124, 197]);
    expect([Math.round(64*0.2), Math.round(124*1), Math.round(231*0.7)]).toEqual([13, 124, 162]);
    expect([lut[0]![64], lut[1]![124], lut[2]![231]]).not.toEqual([13, 124, 162]);
  });
  it("matches independent reference across grayscale/zero/white/fullRGB/tinted", () => {
    const factors: [number,number,number][] = [[1,1,1],[0,0,0],[0.2,1,0.7],[0.5,0.5,0.5],[1,0,0]];
    for (const f of factors) {
      const lut = buildAlbedoLut(f);
      for (const b of [0,1,13,64,124,128,231,255]) for (let c=0;c<3;c+=1) expect(lut[c]![b]).toBe(refBake(b,f[c]!));
    }
  });
  it("white factor is byte-identity; alpha is linear (texA x factorA)", () => {
    const lut = buildAlbedoLut([1,1,1]);
    for (let b=0;b<256;b+=1) expect(lut[0]![b]).toBe(b);
    expect(bakeAlphaByte(200,0.5)).toBe(100);
    expect(bakeAlphaByte(255,1)).toBe(255);
    expect(linearToSrgbByte(srgbByteToLinear(64))).toBe(64); // sRGB round-trip identity
  });
});
