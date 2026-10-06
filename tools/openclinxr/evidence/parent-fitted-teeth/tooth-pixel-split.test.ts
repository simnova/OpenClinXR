import { describe, expect, it } from "vitest";
import { analyzeToothPixels } from "./tooth-pixel-split.js";

const W = 240;
const H = 180;

function blank(): Uint8Array {
  // Mid skin tone: not tooth (mean<148 fails), not dark.
  const buf = new Uint8Array(W * H * 4);
  for (let p = 0; p < buf.length; p += 4) {
    buf[p] = 120;
    buf[p + 1] = 90;
    buf[p + 2] = 80;
    buf[p + 3] = 255;
  }
  return buf;
}

function paint(buf: Uint8Array, x0: number, x1: number, y0: number, y1: number, r: number, g: number, b: number): void {
  // x/y in harness coords (y 0 at window top); buffer rows are bottom-up.
  for (let y = y0; y <= y1; y += 1) {
    const row = H - 1 - y;
    for (let x = x0; x <= x1; x += 1) {
      const p = (row * W + x) * 4;
      buf[p] = r;
      buf[p + 1] = g;
      buf[p + 2] = b;
    }
  }
}

const TOOTH: [number, number, number] = [190, 185, 180];
const DARK: [number, number, number] = [40, 30, 25];
const BOX = { x0: 10, x1: 230, y0: 25, y1: 95 };

describe("tooth-pixel split", () => {
  it("counts nothing on plain skin", () => {
    const out = analyzeToothPixels(blank(), W, H, BOX, true);
    expect(out.n).toBe(0);
    expect(out.mouthTeethN).toBe(0);
    expect(out.lipGapPx).toBe(0);
    expect(out.upperTeethN).toBe(0);
    expect(out.lowerTeethN).toBe(0);
  });

  it("splits upper above the seam and lower below it", () => {
    const buf = blank();
    paint(buf, 100, 140, 30, 50, ...TOOTH);
    paint(buf, 100, 140, 51, 55, ...DARK);
    paint(buf, 100, 140, 56, 70, ...TOOTH);
    const out = analyzeToothPixels(buf, W, H, BOX, true);
    expect(out.mouthTeethN).toBe(41 * 21 + 41 * 15);
    expect(out.upperTeethN).toBe(41 * 15);
    expect(out.lowerTeethN).toBe(41 * 21);
    expect(out.lipGapPx).toBe(5);
  });

  it("omits the split fields when split is false", () => {
    const buf = blank();
    paint(buf, 100, 140, 30, 50, ...TOOTH);
    const out = analyzeToothPixels(buf, W, H, { x0: 40, x1: 100, y0: 55, y1: 85 }, false);
    expect(out.mouthTeethN).toBe(0);
    expect(out.upperTeethN).toBeUndefined();
    expect(out.lowerTeethN).toBeUndefined();
  });
});
