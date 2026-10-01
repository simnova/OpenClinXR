/** Strict, data-driven feature contract consumed by the clinic-finish stage. */
export type RoomFinishFeatures = {
  preserveShell: boolean;
  floor: { kind: "vinyl-tile"; moduleM: number };
  cove: { heightM: number };
  door: {
    kind: "hospital";
    photoPbr: boolean;
    casing: boolean;
    lite: boolean;
    lever: boolean;
    hinges: boolean;
  };
  ceiling: { troffer: boolean; tbarMm: number };
  wallMatteRoughness: number;
  neutralTints: {
    casingRgb: readonly [number, number, number];
    coveRgb: readonly [number, number, number];
  };
};

export class RoomFinishFeatureValidationError extends Error {
  override readonly name = "RoomFinishFeatureValidationError";
}

const KEYS = {
  root: ["preserveShell", "floor", "cove", "door", "ceiling", "wallMatteRoughness", "neutralTints"],
  floor: ["kind", "moduleM"],
  cove: ["heightM"],
  door: ["kind", "photoPbr", "casing", "lite", "lever", "hinges"],
  ceiling: ["troffer", "tbarMm"],
  neutralTints: ["casingRgb", "coveRgb"],
} as const;

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RoomFinishFeatureValidationError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new RoomFinishFeatureValidationError(`${path} has unknown field(s): ${unknown.join(", ")}`);
  }
  const missing = allowed.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw new RoomFinishFeatureValidationError(`${path} is missing field(s): ${missing.join(", ")}`);
  }
}

function finiteInRange(value: unknown, path: string, minExclusive: number, maxInclusive: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= minExclusive || value > maxInclusive) {
    throw new RoomFinishFeatureValidationError(`${path} must be > ${minExclusive} and <= ${maxInclusive}`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new RoomFinishFeatureValidationError(`${path} must be a boolean`);
  return value;
}

function rgb(value: unknown, path: string): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((channel) => typeof channel !== "number" || !Number.isFinite(channel) || channel < 0 || channel > 1)) {
    throw new RoomFinishFeatureValidationError(`${path} must be three finite channels in [0, 1]`);
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

/** Validate without defaults: a declared finish is complete or rejected. */
export function validateRoomFinishFeatures(value: unknown, path = "finish"): RoomFinishFeatures {
  const root = record(value, path);
  exactKeys(root, KEYS.root, path);
  const floor = record(root["floor"], `${path}.floor`);
  const cove = record(root["cove"], `${path}.cove`);
  const door = record(root["door"], `${path}.door`);
  const ceiling = record(root["ceiling"], `${path}.ceiling`);
  const neutralTints = record(root["neutralTints"], `${path}.neutralTints`);
  exactKeys(floor, KEYS.floor, `${path}.floor`);
  exactKeys(cove, KEYS.cove, `${path}.cove`);
  exactKeys(door, KEYS.door, `${path}.door`);
  exactKeys(ceiling, KEYS.ceiling, `${path}.ceiling`);
  exactKeys(neutralTints, KEYS.neutralTints, `${path}.neutralTints`);
  if (floor["kind"] !== "vinyl-tile") throw new RoomFinishFeatureValidationError(`${path}.floor.kind must be vinyl-tile`);
  if (door["kind"] !== "hospital") throw new RoomFinishFeatureValidationError(`${path}.door.kind must be hospital`);
  return {
    preserveShell: boolean(root["preserveShell"], `${path}.preserveShell`),
    floor: { kind: "vinyl-tile", moduleM: finiteInRange(floor["moduleM"], `${path}.floor.moduleM`, 0, 10) },
    cove: { heightM: finiteInRange(cove["heightM"], `${path}.cove.heightM`, 0, 1) },
    door: {
      kind: "hospital",
      photoPbr: boolean(door["photoPbr"], `${path}.door.photoPbr`),
      casing: boolean(door["casing"], `${path}.door.casing`),
      lite: boolean(door["lite"], `${path}.door.lite`),
      lever: boolean(door["lever"], `${path}.door.lever`),
      hinges: boolean(door["hinges"], `${path}.door.hinges`),
    },
    ceiling: {
      troffer: boolean(ceiling["troffer"], `${path}.ceiling.troffer`),
      tbarMm: finiteInRange(ceiling["tbarMm"], `${path}.ceiling.tbarMm`, 0, 100),
    },
    wallMatteRoughness: finiteInRange(root["wallMatteRoughness"], `${path}.wallMatteRoughness`, 0, 1),
    neutralTints: {
      casingRgb: rgb(neutralTints["casingRgb"], `${path}.neutralTints.casingRgb`),
      coveRgb: rgb(neutralTints["coveRgb"], `${path}.neutralTints.coveRgb`),
    },
  };
}
