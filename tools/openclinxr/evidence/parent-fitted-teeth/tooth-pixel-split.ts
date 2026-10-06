/**
 * Tooth-pixel classifier shared by the mouth-dynamics capture and its unit
 * test (U1 mouth-front). Pure function on a pixel buffer — no DOM, no GL —
 * so the browser page embeds it by source text while the test imports it
 * normally. Thresholds are the long-standing capture values; do not retune
 * them here (any change moves every committed toothSamples row).
 */
export type ToothPixelBox = {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
};

export type ToothPixelCounts = {
  n: number;
  cx: number;
  cy: number;
  mouthTeethN: number;
  lipGapPx: number;
  upperTeethN?: number;
  lowerTeethN?: number;
};

export function analyzeToothPixels(
  buf: ArrayLike<number>,
  width: number,
  height: number,
  box: ToothPixelBox,
  split: boolean,
): ToothPixelCounts {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let lipGapPx = 0;
  let mouthTeethN = 0;
  const isTooth: boolean[] = [];
  for (let p = 0, pixel = 0; p < buf.length; p += 4, pixel += 1) {
    const r = buf[p] ?? 0;
    const g = buf[p + 1] ?? 0;
    const b = buf[p + 2] ?? 0;
    const mean = (r + g + b) / 3;
    const x = pixel % width;
    const y = height - 1 - Math.floor(pixel / width);
    const tooth =
      mean > 148 && Math.abs(r - g) < 16 && Math.abs(g - b) < 16 && r > 140 && r < 220;
    isTooth.push(tooth);
    if (tooth) {
      n += 1;
      sx += x;
      sy += y;
      if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) mouthTeethN += 1;
    }
  }
  for (let x = box.x0; x <= box.x1; x += 1) {
    let run = 0;
    for (let y = box.y0; y <= box.y1; y += 1) {
      const row = height - 1 - y;
      const p = (row * width + x) * 4;
      const mean = ((buf[p] ?? 0) + (buf[p + 1] ?? 0) + (buf[p + 2] ?? 0)) / 3;
      if (mean < 70) {
        run += 1;
        lipGapPx = Math.max(lipGapPx, run);
      } else run = 0;
    }
  }
  let upperTeethN: number | undefined;
  let lowerTeethN: number | undefined;
  if (split) {
    let seamY = Math.round((box.y0 + box.y1) / 2);
    let seamDark = -1;
    for (let y = box.y0; y <= box.y1; y += 1) {
      let dark = 0;
      for (let x = box.x0; x <= box.x1; x += 1) {
        const row = height - 1 - y;
        const p = (row * width + x) * 4;
        const mean = ((buf[p] ?? 0) + (buf[p + 1] ?? 0) + (buf[p + 2] ?? 0)) / 3;
        if (mean < 70) dark += 1;
      }
      if (dark > seamDark) {
        seamDark = dark;
        seamY = y;
      }
    }
    upperTeethN = 0;
    lowerTeethN = 0;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      if (!isTooth[pixel]) continue;
      const x = pixel % width;
      const y = height - 1 - Math.floor(pixel / width);
      if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) continue;
      if (y > seamY) upperTeethN += 1;
      else lowerTeethN += 1;
    }
  }
  return {
    n,
    cx: n ? sx / n : 0,
    cy: n ? sy / n : 0,
    mouthTeethN,
    lipGapPx,
    ...(upperTeethN !== undefined ? { upperTeethN, lowerTeethN: lowerTeethN ?? 0 } : {}),
  };
}
