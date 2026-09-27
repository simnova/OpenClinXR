/** Pure Hair Editor planner: clamp, heuristic propose, iteration rules. No Blender, no network, no LLM. */
import { COLOR_KEYS, FAMILIES, HAIR_RANGES, rangeFor } from "./ranges.js";

export type ClampError = { error: string };
export type ClampResult = number | number[] | ClampError;

export function isClampError(value: unknown): value is ClampError {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value) && "error" in (value as Record<string, unknown>)
  );
}

export function clampParam(name: string, value: unknown, family: string): ClampResult {
  if (name === "color1" || name === "color2") {
    if (!Array.isArray(value) || value.length !== 4) return { error: `${name} must be RGBA length 4` };
    for (const channel of value) {
      if (typeof channel !== "number" || !Number.isFinite(channel)) return { error: `${name} channels must be numbers` };
    }
    const clamped = (value as number[]).map((channel) => Math.min(1, Math.max(0, channel)));
    clamped[3] = 1;
    return clamped;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return { error: `${name} must be a number` };
  const range = rangeFor(name, family);
  if (range === null) return { error: `unknown slider ${name}` };
  return Math.min(range.max, Math.max(range.min, value));
}

export type TargetRead = Record<string, unknown>;

function midpoint(name: string): number {
  const range = HAIR_RANGES[name]!;
  return (range.min + range.max) / 2;
}

const COLOR_PRESETS: Record<string, { color1: number[]; color2: number[]; darken_root: number }> = {
  dark_brown: { color1: [0.117, 0.093, 0.047, 1], color2: [0.031, 0.016, 0.004, 1], darken_root: 0.5 },
  black: { color1: [0.117, 0.093, 0.047, 1], color2: [0.031, 0.016, 0.004, 1], darken_root: 0.5 },
  blonde: { color1: [0.45, 0.32, 0.12, 1], color2: [0.62, 0.48, 0.18, 1], darken_root: 0.25 },
  gray: { color1: [0.45, 0.45, 0.45, 1], color2: [0.45, 0.45, 0.45, 1], darken_root: 0.2 },
};

export function proposeFromTargetRead(read: TargetRead): Record<string, number | number[]> {
  const params: Record<string, number | number[]> = {};
  for (const key of Object.keys(HAIR_RANGES)) params[key] = midpoint(key);
  const lengthClass = String(read["length_class"] ?? "");
  const curlClass = String(read["curl_class"] ?? "");
  const densityClass = String(read["density_class"] ?? "");
  const volumeClass = String(read["volume_class"] ?? "");
  const colorName = String(read["color_name"] ?? "");

  if (lengthClass === "buzz" || lengthClass === "short") {
    params["length"] = 0.8;
    params["density"] = 0.55;
  } else if (lengthClass === "ear" || lengthClass === "jaw") {
    params["length"] = 1.6;
  } else if (lengthClass === "shoulder") {
    params["length"] = 3.5;
  } else if (lengthClass === "midback" || lengthClass === "waist") {
    params["length"] = 6.0;
  }

  if (curlClass === "straight") {
    params["curl"] = 0.06;
    params["curl_frequency"] = 1;
    params["frizz"] = 0.12;
  } else if (curlClass === "wave") {
    params["curl"] = 0.25;
    params["curl_frequency"] = 4;
    params["roll"] = 0.2;
  } else if (curlClass === "curl") {
    params["curl"] = 0.55;
    params["curl_frequency"] = 9;
    params["clump"] = 0.45;
  } else if (curlClass === "coil") {
    params["curl"] = 0.85;
    params["curl_frequency"] = 14;
    params["clump"] = 0.65;
    params["clump_distance"] = 0.006;
  }

  if (densityClass === "sparse") params["density"] = 0.35;
  else if (densityClass === "thick") params["density"] = 0.75;

  if (volumeClass === "flat") {
    params["noise"] = 0.1;
    params["frizz"] = 0.08;
  } else if (volumeClass === "huge") {
    params["noise"] = 0.45;
    params["frizz"] = 0.35;
  }

  const preset = COLOR_PRESETS[colorName] ?? COLOR_PRESETS["dark_brown"]!;
  params["color1"] = [...preset.color1];
  params["color2"] = [...preset.color2];
  params["darken_root"] = preset.darken_root;

  const family = "short";
  for (const key of Object.keys(params)) {
    if ((COLOR_KEYS as readonly string[]).includes(key)) continue;
    params[key] = clampParam(key, params[key], family) as number;
  }
  return params;
}

export type Critic = {
  silhouette: number;
  length: number;
  part_and_hairline: number;
  curl_and_clump: number;
  volume: number;
  density_temples: number;
  color: number;
  uncanny: number;
  style_mismatch: number;
};

export function criticOverall(critic: Critic): number {
  return (
    0.2 * critic.silhouette +
    0.15 * critic.length +
    0.1 * critic.part_and_hairline +
    0.15 * critic.curl_and_clump +
    0.1 * critic.volume +
    0.1 * critic.density_temples +
    0.1 * critic.color +
    0.1 * (1 - critic.uncanny)
  );
}

export type IterationInput = {
  params: Record<string, number | number[]>;
  deltas: Record<string, number>;
  critic: Critic;
  hairAsset?: string;
  nextHairAsset?: string;
  previousOverall?: number;
  plateauCount?: number;
};

export type IterationResult = {
  status: string;
  params: Record<string, number | number[]>;
  stop: boolean;
  plateauCount: number;
  issues?: string[];
};

const UNCANNY_ONLY_KEYS = ["length", "curl_radius", "thickness"];

export function applyIteration(input: IterationInput): IterationResult {
  const base: IterationResult = { status: "iterate", params: { ...input.params }, stop: false, plateauCount: input.plateauCount ?? 0 };
  if (input.critic.style_mismatch >= 0.7) {
    return { ...base, status: "reset_style" };
  }
  const deltaKeys = Object.keys(input.deltas);
  if (deltaKeys.length > 4) {
    return { ...base, issues: [`at most 4 slider keys, got ${deltaKeys.length}`] };
  }
  if (input.nextHairAsset !== undefined && input.nextHairAsset !== input.hairAsset && deltaKeys.length > 0) {
    return { ...base, issues: ["hairAsset change and slider deltas in one call are refused"] };
  }
  if (input.critic.uncanny >= 0.7) {
    for (const key of deltaKeys) {
      if (!UNCANNY_ONLY_KEYS.includes(key)) return { ...base, issues: [`uncanny >= 0.7: only ${UNCANNY_ONLY_KEYS.join(",")} allowed`] };
      if (input.deltas[key]! > 0) return { ...base, issues: [`uncanny >= 0.7: ${key} must reduce`] };
    }
  }
  for (const key of deltaKeys) {
    const range = rangeFor(key, "short");
    if (range === null) return { ...base, issues: [`unknown slider ${key}`] };
    const width = range.max - range.min;
    if (Math.abs(input.deltas[key]!) > 0.2 * width) {
      return { ...base, issues: [`delta for ${key} exceeds 20% of range`] };
    }
  }
  const next: Record<string, number | number[]> = { ...input.params };
  for (const key of deltaKeys) {
    const old = next[key];
    if (typeof old !== "number") return { ...base, issues: [`delta on non-numeric ${key}`] };
    next[key] = clampParam(key, old + input.deltas[key]!, "short") as number;
  }
  const overall = criticOverall(input.critic);
  let plateauCount = input.plateauCount ?? 0;
  if (input.previousOverall !== undefined && overall - input.previousOverall < 0.02) {
    plateauCount += 1;
  } else if (input.previousOverall !== undefined) {
    plateauCount = 0;
  }
  const stop = plateauCount >= 2;
  return { status: "iterate", params: next, stop, plateauCount };
}

export type CatalogValue = {
  actorId: string;
  family: string;
  hairAsset: string;
  targetReadJson: string;
  round: number;
};

function slotFor(family: string): string {
  if (family === "fur") return "fur_assets";
  if (family === "facial") return "facial_assets";
  if (family === "eyebrow") return "eyebrow_assets";
  return "hair_assets";
}

export function planHairEditor(catalogValue: CatalogValue): Record<string, unknown> {
  let targetRead: TargetRead;
  try {
    targetRead = JSON.parse(catalogValue.targetReadJson) as TargetRead;
  } catch {
    return { round: catalogValue.round, status: "issues", issues: ["targetReadJson is not valid JSON"] };
  }
  if (!(FAMILIES as readonly string[]).includes(catalogValue.family)) {
    return { round: catalogValue.round, status: "issues", issues: [`unknown family ${catalogValue.family}`] };
  }
  if (catalogValue.round === 0) {
    const params = proposeFromTargetRead(targetRead);
    return {
      round: 0,
      status: "propose",
      target_read: targetRead,
      apply: {
        systems: [
          { slot: slotFor(catalogValue.family), family: catalogValue.family, hair_asset: catalogValue.hairAsset, confidence: 1 },
        ],
      },
      params,
      deltas: {},
      critic: null,
      stop: false,
      stop_reason: null,
    };
  }
  return { round: catalogValue.round, status: "issues", issues: [`round ${catalogValue.round} requires critic input`] };
}
