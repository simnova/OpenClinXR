import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { factoryStationSchemas } from "../catalog.js";
import { repoRoot } from "../repo-root.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";
import { spawnBlenderProcess } from "../spawn-blender.js";

/**
 * lighting_design: deterministic lighting-rig factory station (no LLM in the
 * path). Same room + cast + mood + seed -> same rig JSON.
 *
 * Consumers: the room albedo bake reads rig light positions via --rig-json
 * (probe lights come from the rig instead of hardcoded placement); the ui-xr
 * runtime overlays rig lights/exposure via
 * apps/ui-xr/src/lighting-rig-runtime.ts
 * (applyStationInteriorLightingForEnvironment over the raised_hemisphere_ground
 * base, fail closed to variant constants when no rig exists).
 *
 * No Quest, animation, or clinical claims. Energies stay in comfortable indoor
 * ranges (same order as the room distributed bake rig).
 */

export const LIGHTING_RIG_STAGE_REL =
  "packages/openclinxr/factory-stations/src/lighting_design/lighting-rig.py";

export const LIGHTING_RIG_SCHEMA_VERSION = "openclinxr.lighting-rig.v1";

/** Closed scenario-mood enum. No free text: the factory stays deterministic. */
export const LIGHTING_MOODS = ["ed_exam_bright", "clinic_day", "evening_calm"] as const;

export type LightingMood = (typeof LIGHTING_MOODS)[number];

/**
 * Known room ids, mirrored from
 * apps/ui-xr/src/infinigen-environment-assets.ts
 * (INFINIGEN_ENVIRONMENT_ASSETS keys). Embedded here so the station package
 * does not import app sources.
 */
export const KNOWN_ROOM_IDS = [
  "ed_exam_bay_v1",
  "pediatric_urgent_care_bay_v1",
  "primary_care_clinic_room_v1",
  "ed_stroke_bay_v1",
  "adult_ed_abdominal_bay_v1",
  "telehealth_home_visit_v1",
  "behavioral_health_private_room_v1",
  "oncology_consult_room_v1",
  "urgent_care_clinic_room_v1",
  "surgical_ward_room_v1",
  "stepdown_room_v1",
  "ob_triage_room_v1",
  "inpatient_ward_room_v1",
  "pediatric_fever_urgent_care_bay_v1",
] as const;

export type LightingBBox = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export type CastMember = { actorId: string; position: [number, number, number] };

export type RigLightType = "point" | "area" | "directional";

export type RigLight = {
  name: string;
  type: RigLightType;
  position: [number, number, number];
  /** Aim point for directional lights; absent otherwise. */
  target?: [number, number, number];
  energy: number;
  size: number;
  colorTemperatureK: number;
};

export type LightingRig = {
  schemaVersion: typeof LIGHTING_RIG_SCHEMA_VERSION;
  room: { environmentId?: string; roomGlbPath?: string };
  bbox: LightingBBox;
  cast: CastMember[];
  mood: LightingMood;
  seed: number;
  exposure: number;
  lights: RigLight[];
  bakePathLlm: false;
};

type MoodPreset = {
  keyEnergy: number;
  fillEnergy: number;
  washEnergy: number;
  keyTempK: number;
  fillTempK: number;
  exposure: number;
};

const MOOD_PRESETS: Record<LightingMood, MoodPreset> = {
  ed_exam_bright: { keyEnergy: 1.0, fillEnergy: 1.0, washEnergy: 1.0, keyTempK: 5000, fillTempK: 5000, exposure: 1.0 },
  clinic_day: { keyEnergy: 0.85, fillEnergy: 0.9, washEnergy: 0.85, keyTempK: 4000, fillTempK: 4200, exposure: 0.9 },
  evening_calm: { keyEnergy: 0.45, fillEnergy: 0.5, washEnergy: 0.4, keyTempK: 2700, fillTempK: 3000, exposure: 0.7 },
};

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseBBox(raw: string): LightingBBox | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  const keys = ["minX", "minY", "minZ", "maxX", "maxY", "maxZ"] as const;
  for (const key of keys) {
    if (!isFiniteNumber(rec[key])) return null;
  }
  const bbox = rec as unknown as LightingBBox;
  if (!(bbox.maxX > bbox.minX && bbox.maxY > bbox.minY && bbox.maxZ > bbox.minZ)) return null;
  return bbox;
}

function parseCast(raw: string): CastMember[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const out: CastMember[] = [];
  for (const entry of parsed) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
    const rec = entry as Record<string, unknown>;
    if (typeof rec["actorId"] !== "string" || (rec["actorId"] as string).length === 0) return null;
    const position = rec["position"];
    if (!Array.isArray(position) || position.length !== 3 || !position.every(isFiniteNumber)) return null;
    out.push({ actorId: rec["actorId"] as string, position: [position[0] as number, position[1] as number, position[2] as number] });
  }
  return out;
}

type ParsedLightingInput = {
  room: { environmentId?: string; roomGlbPath?: string };
  bbox: LightingBBox;
  cast: CastMember[];
  mood: LightingMood;
  seed: number;
};

/** Catalog-shape validation is done by planFromCatalog; this adds the refusal rules. */
function parseLightingInput(value: Record<string, unknown>): { issues: string[] } | { parsed: ParsedLightingInput } {
  const issues: string[] = [];
  const environmentId = value["environmentId"];
  const roomGlbPath = value["roomGlbPath"];
  if (typeof environmentId === "string" && !(KNOWN_ROOM_IDS as readonly string[]).includes(environmentId)) {
    issues.push(`unknown environmentId ${environmentId}`);
  }
  if (typeof roomGlbPath === "string" && !roomGlbPath.endsWith(".glb")) {
    issues.push(`roomGlbPath must end in .glb, got ${roomGlbPath}`);
  }
  if (environmentId === undefined && roomGlbPath === undefined) {
    issues.push("either environmentId or roomGlbPath is required");
  }
  const mood = value["mood"];
  if (typeof mood !== "string" || !(LIGHTING_MOODS as readonly string[]).includes(mood)) {
    issues.push(`unknown mood ${String(mood)}; expected one of ${LIGHTING_MOODS.join(", ")}`);
  }
  const bbox = typeof value["bboxJson"] === "string" ? parseBBox(value["bboxJson"]) : null;
  if (bbox === null) issues.push("bboxJson must be JSON {minX,minY,minZ,maxX,maxY,maxZ} with max > min");
  const cast = typeof value["castJson"] === "string" ? parseCast(value["castJson"]) : null;
  if (cast === null) issues.push("castJson must be a non-empty JSON array of {actorId, position:[x,y,z]}");
  if (issues.length > 0) return { issues };
  const room: { environmentId?: string; roomGlbPath?: string } = {};
  if (typeof environmentId === "string") room.environmentId = environmentId;
  if (typeof roomGlbPath === "string") room.roomGlbPath = roomGlbPath;
  return {
    parsed: {
      room,
      bbox: bbox as LightingBBox,
      cast: cast as CastMember[],
      mood: mood as LightingMood,
      seed: Number(value["seed"]),
    },
  };
}

/**
 * Deterministic rig builder. Same room + cast + mood + seed -> identical rig
 * (seeded PRNG over the canonical input JSON; no LLM, no wall clock).
 */
export function designLightingRig(input: Record<string, unknown>): LightingRig {
  const parsed = parseLightingInput(input);
  if ("issues" in parsed) {
    throw new Error(parsed.issues.join("; "));
  }
  const { room, bbox, cast, mood, seed } = parsed.parsed;
  const preset = MOOD_PRESETS[mood];
  const canonical = JSON.stringify({ room, bbox, cast, mood, seed });
  const rng = mulberry32(fnv1a(canonical));

  const spanX = bbox.maxX - bbox.minX;
  const spanY = bbox.maxY - bbox.minY;
  const spanZ = Math.max(0.5, bbox.maxZ - bbox.minZ);
  const span = Math.max(1.0, Math.min(spanX, spanY));
  const energyScale = 6.4 / span;
  const cx = (bbox.minX + bbox.maxX) / 2.0;
  const cy = (bbox.minY + bbox.maxY) / 2.0;
  const cz = (bbox.minZ + bbox.maxZ) / 2.0;
  const jitter = (): number => (rng() - 0.5) * 0.04 * span;
  const at = (x: number, y: number, z: number): [number, number, number] => [round4(x), round4(y), round4(z)];

  const wallSize = round4(0.55 * spanZ);
  const keySize = round4(0.45 * span);
  const lights: RigLight[] = [
    {
      name: "key",
      type: "area",
      position: at(cx + jitter(), cy + jitter(), bbox.maxZ - 0.25),
      energy: round4(110.0 * energyScale * preset.keyEnergy),
      size: keySize,
      colorTemperatureK: preset.keyTempK,
    },
    {
      name: "fill",
      type: "point",
      position: at(cx + jitter(), cy + jitter(), cz),
      energy: round4(120.0 * energyScale * preset.fillEnergy),
      size: 0,
      colorTemperatureK: preset.fillTempK,
    },
    {
      name: "wash_px",
      type: "area",
      position: at(bbox.maxX - 0.2, cy + jitter(), cz),
      energy: round4(60.0 * energyScale * preset.washEnergy),
      size: wallSize,
      colorTemperatureK: preset.fillTempK,
    },
    {
      name: "wash_nx",
      type: "area",
      position: at(bbox.minX + 0.2, cy + jitter(), cz),
      energy: round4(60.0 * energyScale * preset.washEnergy),
      size: wallSize,
      colorTemperatureK: preset.fillTempK,
    },
    {
      name: "wash_py",
      type: "area",
      position: at(cx + jitter(), bbox.maxY - 0.2, cz),
      energy: round4(60.0 * energyScale * preset.washEnergy),
      size: wallSize,
      colorTemperatureK: preset.fillTempK,
    },
    {
      name: "wash_ny",
      type: "area",
      position: at(cx + jitter(), bbox.minY + 0.2, cz),
      energy: round4(60.0 * energyScale * preset.washEnergy),
      size: wallSize,
      colorTemperatureK: preset.fillTempK,
    },
    {
      name: "spill",
      type: "directional",
      position: at(bbox.minX, bbox.minY, bbox.maxZ),
      target: at(cx, cy, cz),
      energy: round4(25.0 * energyScale * preset.keyEnergy),
      size: 0,
      colorTemperatureK: preset.keyTempK,
    },
  ];

  return {
    schemaVersion: LIGHTING_RIG_SCHEMA_VERSION,
    room,
    bbox,
    cast,
    mood,
    seed,
    exposure: preset.exposure,
    lights,
    bakePathLlm: false,
  };
}

export function planLightingDesign(input: unknown): StationPlanResult {
  const checked = factoryStationSchemas.lighting_design["~standard"].validate(input);
  if ("issues" in checked) return checked;
  const parsed = parseLightingInput(checked.value);
  if ("issues" in parsed) {
    return { issues: parsed.issues.map((message) => ({ message })) };
  }
  const rig = designLightingRig(checked.value);
  return {
    value: checked.value,
    plan: {
      mode: "dry-run",
      stationId: "lighting_design",
      environmentId: rig.room.environmentId ?? null,
      roomGlbPath: rig.room.roomGlbPath ?? null,
      mood: rig.mood,
      seed: rig.seed,
      exposure: rig.exposure,
      lightCount: rig.lights.length,
      rig,
      bakerId: "lighting_rig",
      stageId: "lighting_rig",
      stageScript: path.join(repoRoot(), LIGHTING_RIG_STAGE_REL),
      stageScriptRel: LIGHTING_RIG_STAGE_REL,
      processIsolation: "fresh_subprocess",
    },
  };
}

export type LightingDesignRunOptions = {
  blender: string;
  outRigJson: string;
  report: string;
  roomGlb?: string;
  extraStageFlags?: string[];
  cwd?: string;
  timeoutMs?: number;
};

/**
 * Unique spawn of lighting-rig.py. Tests must call plan(), not run().
 * Writes the deterministic rig JSON, then the baker materializes the rig
 * lights in Blender and writes the placement report.
 */
export async function runLightingDesign(
  input: unknown,
  options: LightingDesignRunOptions,
): Promise<Record<string, unknown>> {
  const planned = planLightingDesign(input);
  if ("issues" in planned) {
    throw new Error(planned.issues.map((issue) => issue.message).join("; "));
  }
  const stageScript = String(planned.plan["stageScript"]);
  if (!existsSync(stageScript)) {
    throw new Error(`lighting rig stage script missing: ${stageScript}`);
  }
  const rig = designLightingRig(planned.value);
  writeFileSync(options.outRigJson, `${JSON.stringify(rig, null, 2)}\n`, "utf8");
  const roomGlb = options.roomGlb ?? rig.room.roomGlbPath;
  const blenderArgs = [
    "--background",
    "--python",
    stageScript,
    "--",
    "--rig-json",
    options.outRigJson,
    "--report",
    options.report,
    ...(roomGlb !== undefined ? ["--room-glb", roomGlb] : []),
    ...(options.extraStageFlags ?? []),
  ];
  const result = await spawnBlenderProcess(options.blender, blenderArgs, {
    cwd: options.cwd ?? repoRoot(),
    timeoutMs: options.timeoutMs ?? 600_000,
  });
  return {
    stationId: "lighting_design",
    stageScript,
    rigPath: options.outRigJson,
    report: options.report,
    blenderExit: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export const lightingDesignRunner: StationRunner = {
  stationId: "lighting_design",
  validate: (value) => factoryStationSchemas.lighting_design["~standard"].validate(value),
  plan: planLightingDesign,
  run: (value) => runLightingDesign(value, { blender: "blender", outRigJson: "", report: "" }),
};
