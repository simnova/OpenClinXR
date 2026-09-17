import {it, expect} from "vitest";
import {
  ROW_BARCODE_BIT_COUNT,
  ROW_BARCODE_CELL_PX,
  ROW_BARCODE_VIEWPORT,
  encodeObservedRowMarker,
  decodeObservedRowBits,
  decodeObservedRowMarkerFromRgba,
  resolveObservedRowFromMarker,
} from "./observed-row-barcode.mjs";

const row = {
  callbackSerial: 88,
  generation: "clock-patient:turn-1:7",
  nodeSerial: 3,
};

function paint(marker) {
  const {layout, bits} = marker;
  const rgba = new Uint8Array(layout.viewport * layout.viewport * 4);
  for (let i = 0; i < bits.length; i += 1) {
    const v = bits[i] ? 255 : 0;
    const x0 = layout.x0 + i * layout.cellPx;
    for (let y = layout.y0; y < layout.y0 + layout.stripPx; y += 1) {
      for (let x = x0; x < x0 + layout.cellPx; x += 1) {
        const o = (y * layout.viewport + x) * 4;
        rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
        rgba[o + 3] = 255;
      }
    }
  }
  return rgba;
}

it("encodes and decodes a legitimate observed row including full generation", () => {
  const marker = encodeObservedRowMarker(row);
  expect(marker.bits).toHaveLength(ROW_BARCODE_BIT_COUNT);
  expect(marker.generation).toBe(row.generation);
  expect(marker.generationN).toBe(7);
  expect(marker.layout.cellPx).toBe(ROW_BARCODE_CELL_PX);
  expect(marker.layout.bitCount * marker.layout.cellPx).toBeLessThanOrEqual(ROW_BARCODE_VIEWPORT);
  const decoded = decodeObservedRowBits(marker.bits);
  expect(decoded).toMatchObject({
    callbackSerial: 88,
    generationN: 7,
    nodeSerial: 3,
    version: 1,
    checksum: marker.checksum,
  });
  const resolved = resolveObservedRowFromMarker(decoded, [
    {...row, extra: "keep"},
    {callbackSerial: 89, generation: "clock-patient:turn-1:7", nodeSerial: 3},
  ]);
  expect(resolved.generation).toBe("clock-patient:turn-1:7");
  expect(resolved.callbackSerial).toBe(88);
  expect(resolved.nodeSerial).toBe(3);
  expect(resolved.extra).toBe("keep");
});

it("roundtrips cell-center samples from a 1024 RGBA strip", () => {
  const marker = encodeObservedRowMarker(row);
  const rgba = paint(marker);
  const decoded = decodeObservedRowMarkerFromRgba(rgba, 1024, 1024, marker.layout);
  expect(decoded.callbackSerial).toBe(88);
  expect(decoded.generationN).toBe(7);
  expect(decoded.nodeSerial).toBe(3);
  expect(decoded.checksum).toBe(marker.checksum);
});

it("accepts uint32 callbackSerial above 2^31-1 as unsigned", () => {
  const marker = encodeObservedRowMarker({callbackSerial: 4294967295, generation: "a:1", nodeSerial: 65535});
  const decoded = decodeObservedRowBits(marker.bits);
  expect(decoded.callbackSerial).toBe(4294967295);
  expect(decoded.nodeSerial).toBe(65535);
  expect(decoded.generationN).toBe(1);
});

it("refuses missing, empty, and invalid generation instead of encoding 0", () => {
  expect(() => encodeObservedRowMarker({callbackSerial: 0, nodeSerial: 0})).toThrow(/row-barcode-overflow:generation/);
  expect(() => encodeObservedRowMarker({callbackSerial: 0, generation: "", nodeSerial: 0})).toThrow(/row-barcode-overflow:generation/);
  expect(() => encodeObservedRowMarker({callbackSerial: 0, generation: "actor:", nodeSerial: 0})).toThrow(/row-barcode-overflow:generation/);
  expect(() => encodeObservedRowMarker({callbackSerial: 0, generation: "not-a-number", nodeSerial: 0})).toThrow(/row-barcode-overflow:generation/);
  expect(() => encodeObservedRowMarker({callbackSerial: 0, generation: "a:1.5", nodeSerial: 0})).toThrow(/row-barcode-overflow:generation/);
});

it("refuses integer overflow", () => {
  expect(() => encodeObservedRowMarker({callbackSerial: 2 ** 32, generation: "0", nodeSerial: 0})).toThrow(/row-barcode-overflow:callbackSerial/);
  expect(() => encodeObservedRowMarker({callbackSerial: -1, generation: "0", nodeSerial: 0})).toThrow(/row-barcode-overflow:callbackSerial/);
  expect(() => encodeObservedRowMarker({callbackSerial: 0, generation: "0", nodeSerial: 65536})).toThrow(/row-barcode-overflow:nodeSerial/);
  expect(() => encodeObservedRowMarker({callbackSerial: 0, generation: "0:65536", nodeSerial: 0})).toThrow(/row-barcode-overflow:generation/);
});

it("refuses corrupt bits and missing buffers", () => {
  const marker = encodeObservedRowMarker(row);
  const flipped = marker.bits.slice();
  flipped[40] = flipped[40] ? 0 : 1;
  expect(() => decodeObservedRowBits(flipped)).toThrow(/row-barcode-corrupt/);
  expect(() => decodeObservedRowBits(marker.bits.slice(0, 80))).toThrow(/row-barcode-missing/);
  expect(() => decodeObservedRowMarkerFromRgba(new Uint8Array(16), 2, 2, marker.layout)).toThrow(/row-barcode-missing/);
});

it("allows repeated video frames only when the decoded nonce maps the exact raw row", () => {
  const marker = encodeObservedRowMarker(row);
  const decodedA = decodeObservedRowBits(marker.bits);
  const decodedB = decodeObservedRowBits(marker.bits);
  const rows = [row];
  expect(resolveObservedRowFromMarker(decodedA, rows)).toBe(row);
  expect(resolveObservedRowFromMarker(decodedB, rows)).toBe(row);
});

it("refuses generation-suffix collision instead of inferring identity from the 16-bit token", () => {
  const decoded = decodeObservedRowBits(encodeObservedRowMarker(row).bits);
  expect(() => resolveObservedRowFromMarker(decoded, [
    {callbackSerial: 88, generation: "clock-patient:turn-1:7", nodeSerial: 3},
    {callbackSerial: 88, generation: "other-actor:turn-9:7", nodeSerial: 3},
  ])).toThrow(/row-barcode-missing/);
});

it("refuses a decoded nonce with no matching observed row", () => {
  const decoded = decodeObservedRowBits(encodeObservedRowMarker(row).bits);
  expect(() => resolveObservedRowFromMarker(decoded, [
    {callbackSerial: 1, generation: "clock-patient:turn-1:7", nodeSerial: 3},
  ])).toThrow(/row-barcode-missing/);
});
