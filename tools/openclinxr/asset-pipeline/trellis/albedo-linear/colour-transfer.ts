/** HB-02 linear albedo transfer (glTF 2.0 PBR metallic-roughness).
 * baseColorTexture bytes are sRGB-encoded; baseColorFactor RGB is LINEAR.
 * Correct fold: decode texel -> linear, multiply by factor, re-encode to sRGB.
 * Alpha is already linear: outA = round(texA * factorA). No sRGB curve.
 * Pure module: no fs, no CLI side effects on import.
 */
export function srgbByteToLinear(v: number): number {
  const c = Math.min(255, Math.max(0, Math.round(v))) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function linearToSrgbByte(l: number): number {
  const c = Math.min(1, Math.max(0, l));
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(s * 255)));
}
/** Per-material 3x256 LUT: lut[c][byte] = linear-correct baked sRGB byte. */
export function buildAlbedoLut(factor3: [number, number, number]): Uint8Array[] {
  return [0, 1, 2].map((c) => {
    const lut = new Uint8Array(256);
    for (let b = 0; b < 256; b += 1) lut[b] = linearToSrgbByte(srgbByteToLinear(b) * factor3[c]!);
    return lut;
  });
}
export function bakeAlphaByte(texA: number, factorA: number): number {
  return Math.min(255, Math.max(0, Math.round(texA * factorA)));
}
