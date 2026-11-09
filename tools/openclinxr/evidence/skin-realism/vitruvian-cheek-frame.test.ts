import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodePngRgb } from "./runtime-portrait-capture.js";
import { withRecordedSubjectCrop } from "./vitruvian-grey-card.js";

type Rect = { x0: number; y0: number; x1: number; y1: number };
type MaskResult = {
  bbox?: Rect;
  method?: string;
  pixelCount?: number;
  unmeasurable: boolean;
  unmeasurableReason?: string;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const FIXTURE_DIR = path.join(ROOT, ".openclinxr/openclaw/ceo/st-skinref/cheekA/vitest");
const SCRIPT = path.join(ROOT, "tools/openclinxr/evidence/skin-realism/i2_measure.py");
const TILE = path.join(FIXTURE_DIR, "tile.png");
const NUMBERS = path.join(FIXTURE_DIR, "numbers.json");
const WIDTH = 380;
const HEIGHT = 280;
const SUBJECT = { x0: 20, y0: 20, x1: 100, y1: 100 };
const MOVED_SUBJECT = { x0: 120, y0: 20, x1: 200, y1: 100 };
const CARD = { x0: 230, y0: 235, x1: 350, y1: 270 };

function paint(rgb: Uint8Array, box: Rect, colour: readonly [number, number, number]): void {
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      const offset = (y * WIDTH + x) * 3;
      rgb.set(colour, offset);
    }
  }
}

function writeNumbers(subjectCropPx?: Rect): void {
  writeFileSync(NUMBERS, `${JSON.stringify({
    greyCardBoxPx: CARD,
    ...(subjectCropPx ? { subjectCropPx } : {}),
  }, null, 2)}\n`);
}

function measure(subjectCropPx?: Rect): MaskResult {
  writeNumbers(subjectCropPx);
  return JSON.parse(execFileSync("mise", [
    "exec", "--", "python3", SCRIPT,
    "--cheek-mask-json", TILE, NUMBERS,
  ], { cwd: ROOT, encoding: "utf8" })) as MaskResult;
}

beforeAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const rgb = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let offset = 0; offset < rgb.length; offset += 3) rgb.set([0x18, 0x21, 0x1d], offset);
  paint(rgb, SUBJECT, [176, 118, 91]);
  paint(rgb, MOVED_SUBJECT, [176, 118, 91]);
  paint(rgb, { x0: 220, y0: 10, x1: 370, y1: 230 }, [176, 118, 91]);
  paint(rgb, CARD, [118, 118, 118]);
  writeFileSync(TILE, encodePngRgb(WIDTH, HEIGHT, rgb));
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("recorded subject crop frame", () => {
  it("records source and crop-relative subject rectangles beside an off-frame card", () => {
    const cropPx = { x0: 100, y0: 200, x1: 1000, y1: 700 };
    const subjectCrop = { x0: 100, y0: 200, x1: 530, y1: 630 };
    const greyCardBoxPx = { x0: 600, y0: 20, x1: 850, y1: 450 };
    const record = withRecordedSubjectCrop({ greyCardBoxPx, cardLab: { srgbMedian: [118, 118, 118] } }, cropPx, subjectCrop);

    expect(record.cropPx).toEqual(cropPx);
    expect(record.subjectCropPx).toEqual({ x0: 0, y0: 0, x1: 430, y1: 430 });
    expect(record.subjectCropPx.x0).toBeGreaterThanOrEqual(0);
    expect(record.subjectCropPx.y0).toBeGreaterThanOrEqual(0);
    expect(record.subjectCropPx.x1).toBeLessThanOrEqual(cropPx.x1 - cropPx.x0);
    expect(record.subjectCropPx.y1).toBeLessThanOrEqual(cropPx.y1 - cropPx.y0);
  });

  it("preserves the grey-card box and card statistics", () => {
    const greyCardBoxPx = { x0: 600, y0: 20, x1: 850, y1: 450 };
    const cardLab = { srgbMedian: [118, 118, 118], rawMedianLab: [49.64, 0, 0] };
    const record = withRecordedSubjectCrop(
      { greyCardBoxPx, cardLab },
      { x0: 100, y0: 200, x1: 1000, y1: 700 },
      { x0: 100, y0: 200, x1: 530, y1: 630 },
    );
    expect(record.greyCardBoxPx).toEqual(greyCardBoxPx);
    expect(record.cardLab).toEqual(cardLab);
  });
});

describe("tracked i2 runtime cheek mask", () => {
  it("keeps the mask inside the recorded central 64% and excludes a larger decoy", () => {
    const result = measure(SUBJECT);
    expect(result.unmeasurable).toBe(false);
    expect(result.pixelCount).toBeGreaterThan(0);
    expect(result.bbox).toEqual({ x0: 35, y0: 35, x1: 86, y1: 86 });
    expect(result.bbox!.x1).toBeLessThan(220);
    expect(result.method).toContain("central 64% of numbers.json subjectCropPx");
  });

  it("moves the mask with subjectCropPx instead of recomputing a head-box constant", () => {
    const original = measure(SUBJECT);
    const moved = measure(MOVED_SUBJECT);
    expect(moved.bbox!.x0 - original.bbox!.x0).toBe(100);
    expect(moved.bbox!.x1 - original.bbox!.x1).toBe(100);
    expect(moved.bbox!.y0 - original.bbox!.y0).toBe(0);
    expect(moved.bbox!.y1 - original.bbox!.y1).toBe(0);
  });

  it("refuses a pre-fix manifest without a recorded subject rectangle", () => {
    const result = measure();
    expect(result.unmeasurable).toBe(true);
    expect(result.unmeasurableReason).toBe("no recorded subject rect");
  });

  it("refuses zero-area and zero-skin recorded domains without fallback", () => {
    const zeroArea = measure({ x0: 20, y0: 20, x1: 20, y1: 100 });
    expect(zeroArea.unmeasurableReason).toBe("recorded subject rect has zero area");
    const backgroundOnly = measure({ x0: 0, y0: 150, x1: 100, y1: 250 });
    expect(backgroundOnly.unmeasurableReason).toBe("recorded cheek domain has 0 skin pixels");
  });
});
