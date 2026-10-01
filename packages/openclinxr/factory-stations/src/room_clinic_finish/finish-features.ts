/** Strict, data-driven feature contract consumed by the clinic-finish stage. */
export type RoomFinishFeatures = {
  preserveShell: boolean;
  floor: { kind: "vinyl-tile" | "sheet-vinyl" | "wood-plank"; moduleM: number };
  cove: { kind: "cove" | "baseboard" | "none"; heightM: number };
  door: {
    kind: "hospital" | "behavioral-solid" | "residential";
    photoPbr: boolean;
    casing: boolean;
    lite: boolean;
    lever: boolean;
    hinges: boolean;
  };
  ceiling: {
    kind: "acoustic-tbar" | "painted";
    troffer: boolean;
    tbarMm: number;
    cornice?: "none" | "wall-angle";
    corniceProfile?: "angle" | "flush";
    corniceMaterial?: "tile" | "tbar" | "wall";
    corniceWidthMm?: number;
    corniceColorSource?: "tbar" | "wall";
  };
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
  cove: ["kind", "heightM"],
  door: ["kind", "photoPbr", "casing", "lite", "lever", "hinges"],
  ceiling: ["kind", "troffer", "tbarMm", "cornice", "corniceProfile", "corniceMaterial", "corniceWidthMm", "corniceColorSource"],
  neutralTints: ["casingRgb", "coveRgb"],
} as const;

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RoomFinishFeatureValidationError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  optional: readonly string[] = [],
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new RoomFinishFeatureValidationError(`${path} has unknown field(s): ${unknown.join(", ")}`);
  }
  const missing = allowed.filter((key) => !optional.includes(key) && !(key in value));
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
  exactKeys(cove, KEYS.cove, `${path}.cove`, ["kind"]);
  exactKeys(door, KEYS.door, `${path}.door`);
  exactKeys(ceiling, KEYS.ceiling, `${path}.ceiling`, ["kind", "cornice", "corniceProfile", "corniceMaterial", "corniceWidthMm", "corniceColorSource"]);
  exactKeys(neutralTints, KEYS.neutralTints, `${path}.neutralTints`);
  if (!["vinyl-tile", "sheet-vinyl", "wood-plank"].includes(String(floor["kind"]))) throw new RoomFinishFeatureValidationError(`${path}.floor.kind must be vinyl-tile, sheet-vinyl or wood-plank`);
  const coveKind = cove["kind"] ?? "cove";
  const ceilingKind = ceiling["kind"] ?? "acoustic-tbar";
  if (!["cove", "baseboard", "none"].includes(String(coveKind))) throw new RoomFinishFeatureValidationError(`${path}.cove.kind must be cove, baseboard or none`);
  if (!["hospital", "behavioral-solid", "residential"].includes(String(door["kind"]))) throw new RoomFinishFeatureValidationError(`${path}.door.kind must be hospital, behavioral-solid or residential`);
  if (!["acoustic-tbar", "painted"].includes(String(ceilingKind))) throw new RoomFinishFeatureValidationError(`${path}.ceiling.kind must be acoustic-tbar or painted`);
  if (ceilingKind === "painted" && ceiling["troffer"] !== false) throw new RoomFinishFeatureValidationError(`${path}.ceiling.troffer must be false for a painted ceiling`);
  return {
    preserveShell: boolean(root["preserveShell"], `${path}.preserveShell`),
    floor: { kind: floor["kind"] as RoomFinishFeatures["floor"]["kind"], moduleM: finiteInRange(floor["moduleM"], `${path}.floor.moduleM`, 0, 10) },
    cove: { kind: coveKind as RoomFinishFeatures["cove"]["kind"], heightM: finiteInRange(cove["heightM"], `${path}.cove.heightM`, 0, 1) },
    door: {
      kind: door["kind"] as RoomFinishFeatures["door"]["kind"],
      photoPbr: boolean(door["photoPbr"], `${path}.door.photoPbr`),
      casing: boolean(door["casing"], `${path}.door.casing`),
      lite: boolean(door["lite"], `${path}.door.lite`),
      lever: boolean(door["lever"], `${path}.door.lever`),
      hinges: boolean(door["hinges"], `${path}.door.hinges`),
    },
    ceiling: {
      kind: ceilingKind as RoomFinishFeatures["ceiling"]["kind"],
      troffer: boolean(ceiling["troffer"], `${path}.ceiling.troffer`),
      tbarMm: finiteInRange(ceiling["tbarMm"], `${path}.ceiling.tbarMm`, 0, 100),
      ...(ceiling["cornice"] === undefined
        ? {}
        : ceiling["cornice"] === "none" || ceiling["cornice"] === "wall-angle"
          ? { cornice: ceiling["cornice"] }
          : (() => {
              throw new RoomFinishFeatureValidationError(
                `${path}.ceiling.cornice must be none or wall-angle when present`,
              );
            })()),
      ...(ceiling["corniceWidthMm"] === undefined
        ? {}
        : { corniceWidthMm: finiteInRange(ceiling["corniceWidthMm"], `${path}.ceiling.corniceWidthMm`, 0, 100) }),
      ...(ceiling["corniceMaterial"] === undefined
        ? {}
        : ceiling["corniceMaterial"] === "tile" || ceiling["corniceMaterial"] === "tbar" || ceiling["corniceMaterial"] === "wall"
          ? { corniceMaterial: ceiling["corniceMaterial"] }
          : (() => {
              throw new RoomFinishFeatureValidationError(`${path}.ceiling.corniceMaterial must be tile, tbar or wall`);
            })()),
      ...(ceiling["corniceProfile"] === undefined
        ? {}
        : ceiling["corniceProfile"] === "angle" || ceiling["corniceProfile"] === "flush"
          ? { corniceProfile: ceiling["corniceProfile"] }
          : (() => {
              throw new RoomFinishFeatureValidationError(
                `${path}.ceiling.corniceProfile must be angle or flush when present`,
              );
            })()),
      ...(ceiling["corniceColorSource"] === undefined
        ? {}
        : ceiling["corniceColorSource"] === "tbar" || ceiling["corniceColorSource"] === "wall"
          ? { corniceColorSource: ceiling["corniceColorSource"] }
          : (() => {
              throw new RoomFinishFeatureValidationError(
                `${path}.ceiling.corniceColorSource must be tbar or wall when present`,
              );
            })()),
    },
    wallMatteRoughness: finiteInRange(root["wallMatteRoughness"], `${path}.wallMatteRoughness`, 0, 1),
    neutralTints: {
      casingRgb: rgb(neutralTints["casingRgb"], `${path}.neutralTints.casingRgb`),
      coveRgb: rgb(neutralTints["coveRgb"], `${path}.neutralTints.coveRgb`),
    },
  };
}
