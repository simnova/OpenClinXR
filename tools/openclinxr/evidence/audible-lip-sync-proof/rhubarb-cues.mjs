/** Historical private legacy experiment — frozen approximate nine-shape mapping. NOT app canonical authority. */
const HISTORICAL_RHUBARB_SHAPES = { A: "PP", B: "DD", C: "E", D: "aa", E: "O", F: "U", G: "FF", H: "nn", X: "sil" };

export function convertRhubarb(doc) {
  const cues = doc?.mouthCues ?? [];
  const out = [];
  for (const cue of cues) {
    const value = String(cue?.value ?? "");
    const start = Number(cue?.start);
    const end = Number(cue?.end);
    if (!(value in HISTORICAL_RHUBARB_SHAPES) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error("invalid-rhubarb-cue");
    }
    if (out.length > 0) {
      const prev = out[out.length - 1];
      if (prev && start < prev.atSecond + prev.durationSeconds) throw new Error("overlapping-rhubarb-cues");
    }
    const phoneme = HISTORICAL_RHUBARB_SHAPES[value];
    if (!phoneme) throw new Error("invalid-rhubarb-cue");
    out.push({ phoneme, atSecond: start, durationSeconds: end - start });
  }
  return out;
}
