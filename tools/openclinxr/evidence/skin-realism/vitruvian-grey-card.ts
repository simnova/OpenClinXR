import { createHash } from "node:crypto";

export type NdcPoint = { x: number; y: number; z?: number };

export type LightSortRecord = {
  role: string | null;
  type: string;
  worldPosition: readonly [number, number, number] | readonly number[];
};

export function isHudSafeNdc(ndc: NdcPoint): boolean {
  return Math.abs(ndc.x) <= 0.9 && Math.abs(ndc.y) <= 0.8 && (ndc.z == null || ndc.z <= 1);
}

export function compareLights(a: LightSortRecord, b: LightSortRecord): number {
  const role = (a.role ?? "").localeCompare(b.role ?? "");
  if (role !== 0) return role;
  const type = a.type.localeCompare(b.type);
  if (type !== 0) return type;
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = (a.worldPosition[axis] ?? 0) - (b.worldPosition[axis] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function sortLightsStable<T extends LightSortRecord>(lights: readonly T[]): T[] {
  return lights
    .map((light, sourceIndex) => ({ light, sourceIndex }))
    .sort((a, b) => compareLights(a.light, b.light) || a.sourceIndex - b.sourceIndex)
    .map(({ light }) => light);
}

export function multiplyMatrix4(a: readonly number[], b: readonly number[]): number[] {
  if (a.length !== 16 || b.length !== 16) throw new Error("matrix must have 16 elements");
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let k = 0; k < 4; k += 1) value += a[k * 4 + row]! * b[column * 4 + k]!;
      out[column * 4 + row] = value;
    }
  }
  return out;
}

export function invertMatrix4(matrix: readonly number[]): number[] {
  if (matrix.length !== 16) throw new Error("matrix must have 16 elements");
  const augmented = Array.from({ length: 4 }, (_unused, row) => [
    ...Array.from({ length: 4 }, (_unusedColumn, column) => matrix[column * 4 + row]!),
    ...Array.from({ length: 4 }, (_unusedColumn, column) => Number(row === column)),
  ]);
  for (let column = 0; column < 4; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 4; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(augmented[pivot]![column]!) < 1e-15) throw new Error("matrix is singular");
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const pivotRow = augmented[column]!;
    const divisor = pivotRow[column]!;
    for (let i = 0; i < 8; i += 1) pivotRow[i] = pivotRow[i]! / divisor;
    for (let row = 0; row < 4; row += 1) {
      if (row === column) continue;
      const targetRow = augmented[row]!;
      const factor = targetRow[column]!;
      for (let i = 0; i < 8; i += 1) targetRow[i] = targetRow[i]! - factor * pivotRow[i]!;
    }
  }
  return Array.from({ length: 16 }, (_unused, index) => {
    const row = index % 4;
    const column = Math.floor(index / 4);
    return augmented[row]![column + 4]!;
  });
}

export function patientRootFrameMatrix(patientRootWorld: readonly number[], cardWorld: readonly number[]): number[] {
  return multiplyMatrix4(invertMatrix4(patientRootWorld), cardWorld);
}

export function worldFromPatientRootFrame(patientRootWorld: readonly number[], cardPatientRoot: readonly number[]): number[] {
  return multiplyMatrix4(patientRootWorld, cardPatientRoot);
}

export type CardRect = { x0: number; y0: number; x1: number; y1: number };

/**
 * Fully off frame: the projected box clipped to the frame is empty on either axis,
 * i.e. min(x1, width) <= max(x0, 0) || min(y1, height) <= max(y0, 0). An inverted box
 * (x1 < x0, seen on forearm frames) is empty under the same expression.
 */
export type FrameSize = { width: number; height: number };

export function greyCardFullyOffFrame(box: CardRect, frame: FrameSize): boolean {
  return Math.min(box.x1, frame.width) <= Math.max(box.x0, 0) || Math.min(box.y1, frame.height) <= Math.max(box.y0, 0);
}

/** Width and height from a PNG's IHDR (bytes 16-23), so the frame is the image actually written. */
export function pngFrameSize(bytes: Uint8Array): FrameSize {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 24 || view.getUint32(12) !== 0x49484452) throw new Error("not a PNG with an IHDR chunk");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * A region pass (no card camera) may frame the card off capture: record it, do not measure.
 * A card-camera pass exists to measure the card, so an empty box refuses.
 */
export function resolveCaptureCardOutcome(box: CardRect, frame: FrameSize, cardCamera: boolean): "measure" | "off_frame" {
  if (!greyCardFullyOffFrame(box, frame)) return "measure";
  if (cardCamera) throw new Error(`card-camera pass framed an empty card box ${JSON.stringify(box)}`);
  return "off_frame";
}

/**
 * Output-crop box: the cropped card box, or an empty box when the capture recorded the card
 * off frame (nothing to subtract from the skin mask). A card that was on the capture but
 * outside the crop still throws.
 */
export function resolveCardCropBox(cropped: CardRect | null, capturedOffFrame: boolean): { box: CardRect; offFrame: boolean } {
  if (cropped) return { box: cropped, offFrame: false };
  if (!capturedOffFrame) throw new Error("grey card was requested but the output crop excluded it");
  return { box: { x0: 0, y0: 0, x1: 0, y1: 0 }, offFrame: true };
}

/** The sha `git hash-object` prints for these bytes; manifests record the tool blob they ran under. */
export function gitBlobSha(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}
