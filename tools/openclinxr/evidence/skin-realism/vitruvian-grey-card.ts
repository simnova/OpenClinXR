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
