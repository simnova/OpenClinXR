import { describe, expect, it } from "vitest";
import {
  BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute,
} from "three";
import { readPositionAttribute } from "./read-position.js";

/**
 * Private unit for the room-camera stride fix (candidate, parent integrates to
 * evidence/room-camera/ after review). Tests the ACTUAL exported helper the fixed
 * page.evaluate IIFE injects via toString — not a reimplementation.
 *
 * Counterexample shape (measured live): shipped room position attributes are
 * InterleavedBufferAttribute, stride 12, offset 0; direct `array[i * 3]` reads
 * drift up to ~2.0 local units on nonzero indices, so phantom wall triangles
 * rejected every candidate (primary tri 6, psych tri 24).
 */

const RING: Array<[number, number, number]> = [
  [0.5, 0.2, 1.1], [-1.3, 2.4, 0.7], [2.2, -0.6, 1.9], [0.1, 1.5, -2.3],
  [-2.1, -1.2, 0.4], [1.7, 2.9, -0.8], [-0.4, 0.9, 2.6], [3.1, 1.1, -1.4], [-1.9, 3.3, 0.2],
];
// 8-triangle fan: tri 6 = [0, 6, 7] — nonzero indices like the measured hit.
const INDEX = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6, 0, 6, 7, 0, 7, 8, 0, 8, 1];

function packedPos(): BufferAttribute {
  const flat = new Float32Array(RING.flat());
  return new BufferAttribute(flat, 3);
}

function interleavedPos(stride: number, offset: number): InterleavedBufferAttribute {
  const data = new Float32Array(RING.length * stride);
  for (let v = 0; v < RING.length; v += 1) {
    data[v * stride + offset] = RING[v]![0]!;
    data[v * stride + offset + 1] = RING[v]![1]!;
    data[v * stride + offset + 2] = RING[v]![2]!;
    for (let k = 3; k < stride; k += 1) data[v * stride + ((offset + k) % stride)] = 3.7 * (v + k) + 5;
  }
  return new InterleavedBufferAttribute(new InterleavedBuffer(data, stride), 3, offset);
}

const worldOfLocal = (e: number[], x: number, y: number, z: number): number[] => [
  e[0]! * x + e[4]! * y + e[8]! * z + e[12]!,
  e[1]! * x + e[5]! * y + e[9]! * z + e[13]!,
  e[2]! * x + e[6]! * y + e[10]! * z + e[14]!,
];
// Column-major rigid transform: 90° about Y plus translation (tx=5, ty=1.68, tz=-3).
const E = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 5, 1.68, -3, 1];

const close3 = (got: number[], want: readonly number[]): void => {
  expect(got.length).toBe(3);
  expect(got[0]).toBeCloseTo(want[0]!, 5);
  expect(got[1]).toBeCloseTo(want[1]!, 5);
  expect(got[2]).toBeCloseTo(want[2]!, 5);
};

describe("readPositionAttribute (room-camera stride fix)", () => {
  it("is injectable plain JS: toString carries no TypeScript syntax", () => {
    const src = readPositionAttribute.toString();
    expect(src).toContain("getX");
    expect(src).not.toMatch(/:\s*(number|string|boolean|\[number)/);
    const fn = new Function(`return (${src});`)() as (pos: unknown, i: number) => number[];
    expect(fn({ getX: () => 1, getY: () => 2, getZ: () => 3 }, 0)).toEqual([1, 2, 3]);
  });

  it.each([
    ["packed", () => packedPos()],
    ["interleaved stride-12 offset-0", () => interleavedPos(12, 0)],
    ["interleaved stride-12 offset-3", () => interleavedPos(12, 3)],
  ])("reads every used index exactly (%s), incl triangle 6", (_label, make) => {
    const pos = make() as BufferAttribute | InterleavedBufferAttribute;
    const geo = new BufferGeometry();
    geo.setAttribute("position", pos);
    geo.setIndex(INDEX);
    for (let q = 0; q < INDEX.length; q += 1) {
      const vi = INDEX[q]!;
      close3(readPositionAttribute(pos, vi), RING[vi]!);
    }
    // The measured hit triangle: tri 6 = vertices [0, 6, 7], all nonzero-index reads.
    for (const vi of [INDEX[18], INDEX[19], INDEX[20]] as const) {
      close3(readPositionAttribute(pos, vi!), RING[vi!]!);
    }
  });

  it("world geometry is identical across layouts (packed vs strided)", () => {
    const a = packedPos();
    const b = interleavedPos(12, 0);
    for (const vi of [0, 6, 7, 1]) {
      const pa = readPositionAttribute(a, vi);
      const pb = readPositionAttribute(b, vi);
      expect(worldOfLocal(E, pb[0]!, pb[1]!, pb[2]!)).toEqual(
        worldOfLocal(E, pa[0]!, pa[1]!, pa[2]!),
      );
    }
  });

  it("counterexample: naive array[i*3] indexing drifts on interleaved data", () => {
    const b = interleavedPos(12, 0);
    const arr = (b as unknown as { array: number[] }).array;
    const drift = Math.abs(arr[6 * 3] - (RING[6] as number[])[0]!);
    expect(drift).toBeGreaterThan(0.5); // measured class: 1.24–1.98 local units
    close3(readPositionAttribute(b, 6), RING[6]!); // the fix reads it exactly
  });
});
