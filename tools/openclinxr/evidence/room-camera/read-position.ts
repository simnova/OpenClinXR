/**
 * Position-attribute reader for the room-camera surface-triangle extraction.
 * The fixed page.evaluate IIFE injects this exact function via `toString`, so the
 * browser runs this code. Type annotations and interfaces are compile-time only
 * (erased by esbuild/tsx before runtime), so the injected source stays plain JS.
 * Uses only the public getX/getY/getZ accessors, correct for packed BufferAttribute
 * and strided/offset InterleavedBufferAttribute alike. Direct `pos.array[i * 3]`
 * indexing is wrong for interleaved attributes (stride 12 in the shipped rooms,
 * deltas to ~2.0 local units on nonzero indices) and produced phantom wall triangles
 * that rejected every candidate (primary tri 6, psych tri 24).
 */
interface PositionReadable {
  getX(i: number): number;
  getY(i: number): number;
  getZ(i: number): number;
}
export type PositionTuple = [number, number, number];
export function readPositionAttribute(pos: PositionReadable, i: number): PositionTuple {
  return [pos.getX(i), pos.getY(i), pos.getZ(i)];
}
