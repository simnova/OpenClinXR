/**
 * Production factory station interfaces (Standard Schema V1 + JSON Schema).
 * `instrument` is a gate, not a production station card.
 *
 * ~standard.validate is the contract. jsonSchema.input/output list fields so
 * admin cards can be derived (V1 validate has no field inventory).
 */

export const PRODUCTION_STATION_IDS = [
  "body_param",
  "clothing_generate",
  "clothing_consume",
  "motion_retarget",
  "lip_sync",
  "room_generate",
  "equipment_generate",
  "staging",
  "dialogue_runtime",
  "lighting_design",
] as const;

export type ProductionStationId = (typeof PRODUCTION_STATION_IDS)[number];

export type StandardIssue = { message: string; path?: PropertyKey[] };

export type StandardResult =
  | { value: Record<string, unknown> }
  | { issues: readonly StandardIssue[] };

export type StationPropertySchema = {
  type: "string" | "number" | "boolean";
  description?: string;
};

export type StationJsonSchema = {
  $schema: string;
  type: "object";
  additionalProperties: false;
  required: string[];
  properties: Record<string, StationPropertySchema>;
};

export type FactoryStationSchema = {
  stationId: ProductionStationId;
  "~standard": {
    version: 1;
    vendor: "openclinxr";
    validate: (value: unknown) => StandardResult;
  };
  jsonSchema: {
    input: (opts?: { target?: string }) => StationJsonSchema;
    output: (opts?: { target?: string }) => StationJsonSchema;
  };
};

type FieldDef = { type: "string" | "number" | "boolean"; description?: string; required?: boolean; nullable?: boolean };

function defineStation(stationId: ProductionStationId, fields: Record<string, FieldDef>): FactoryStationSchema {
  const required = Object.entries(fields)
    .filter(([, def]) => def.required !== false)
    .map(([name]) => name);

  const properties: Record<string, StationPropertySchema> = {};
  for (const [name, def] of Object.entries(fields)) {
    properties[name] = { type: def.type, ...(def.description ? { description: def.description } : {}) };
  }

  const toJson = (target = "draft-2020-12"): StationJsonSchema => ({
    $schema: `https://json-schema.org/${target}/schema`,
    type: "object",
    additionalProperties: false,
    required,
    properties,
  });

  const validate = (value: unknown): StandardResult => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { issues: [{ message: "expected object" }] };
    }
    const rec = value as Record<string, unknown>;
    const issues: StandardIssue[] = [];
    for (const name of required) {
      if (!(name in rec) || rec[name] === undefined) {
        issues.push({ message: `missing ${name}`, path: [name] });
      }
    }
    for (const [name, def] of Object.entries(fields)) {
      if (!(name in rec) || rec[name] === undefined) continue;
      if (rec[name] === null && def.nullable === true) continue;
      const got = typeof rec[name];
      if (got !== def.type) {
        issues.push({ message: `${name} expected ${def.type}`, path: [name] });
      }
    }
    for (const name of Object.keys(rec)) {
      if (!(name in fields)) {
        issues.push({ message: `unknown ${name}`, path: [name] });
      }
    }
    if (issues.length > 0) return { issues };
    return { value: { ...rec } };
  };

  return {
    stationId,
    "~standard": { version: 1, vendor: "openclinxr", validate },
    jsonSchema: { input: (opts) => toJson(opts?.target), output: (opts) => toJson(opts?.target) },
  };
}

export const factoryStationSchemas: Record<ProductionStationId, FactoryStationSchema> = {
  body_param: defineStation("body_param", {
    actorId: { type: "string", required: true },
    ageYears: { type: "number", required: true },
    sex: { type: "string", required: true },
    heightCm: { type: "number", required: true },
    garmentLayers: { type: "string", required: true },
  }),
  clothing_generate: defineStation("clothing_generate", {
    actorId: { type: "string", required: true },
    garmentToken: { type: "string", required: true },
  }),
  clothing_consume: defineStation("clothing_consume", {
    actorId: { type: "string", required: true },
    mhcloPath: { type: "string", required: true },
    // Refit contract (pants-fit proof 2026-09-05). All optional; absent = legacy path.
    garmentSourceHash: { type: "string", required: false, description: "sha256 of the authored .mhclo" },
    bodyIdentity: { type: "string", required: false, description: "MPFB macro set id or materialized body asset id" },
    bindingTopologyId: { type: "string", required: false, description: "basemesh topology the .mhclo binding indexes" },
    licenseToken: { type: "string", required: false },
    licenseSource: { type: "string", required: false },
    // Per-actor body definition (2026-09-05). JSON string: { macros?, statureTargetM?, bodyAssetId? }.
    // Canonical source is the MPFB macro dict + stature target derived from the case-authored
    // phenotype (body_param/phenotype_macros.py); actor-casting/cast-asset-constants map
    // role->shipped GLB (artifacts, no params), so bodyAssetId is provenance only.
    // Absent = legacy default-body behavior.
    bodyDefinition: { type: "string", required: false, description: "JSON per-actor body definition (macros + stature target + body asset reference)" },
    // Authored-material assignment. Phenotype skin_tone key; absent/unknown = legacy Display colour + recorded reason.
    skinTone: { type: "string", required: false, description: "phenotype skin_tone for the body material" },
    // Rig-refit expansion: refit GLB + report -> rigged figure. All optional;
    // absent = legacy fit-only behavior.
    refitGlbPath: { type: "string", required: false, description: "unrigged refit GLB to rig" },
    refitReportPath: { type: "string", required: false, description: "refit station report JSON to extend" },
    clipSourceGlbPath: { type: "string", required: false, description: "optional rigged GLB whose clips ride by bone-name match" },
    topologyPreserved: { type: "boolean", required: false },
    uvPreserved: { type: "boolean", required: false },
    displacementMeanM: { type: "number", required: false },
    displacementMaxM: { type: "number", required: false },
    refusalReason: { type: "string", required: false, nullable: true, description: "null on success" },
  }),
  motion_retarget: defineStation("motion_retarget", {
    actorId: { type: "string", required: true },
    clipId: { type: "string", required: true },
  }),
  lip_sync: defineStation("lip_sync", {
    actorId: { type: "string", required: true },
    visemeBank: { type: "string", required: true },
  }),
  room_generate: defineStation("room_generate", {
    environmentId: { type: "string", required: true },
    infinigenPrompt: { type: "string", required: true },
    seed: { type: "number", required: true },
    layoutVariant: { type: "string", required: true, description: "schema-only field for card derivation" },
  }),
  equipment_generate: defineStation("equipment_generate", {
    subjectId: { type: "string", required: true },
    packId: { type: "string", required: true },
    seed: { type: "number", required: true },
    remesh: { type: "boolean", required: true },
    viewCount: { type: "number", required: true },
    decimationTarget: { type: "number", required: true, description: "schema-only field for card derivation" },
  }),
  staging: defineStation("staging", {
    actorId: { type: "string", required: true },
    supportSurface: { type: "string", required: true },
    plantOffsetMeters: { type: "number", required: true },
  }),
  dialogue_runtime: defineStation("dialogue_runtime", {
    actorId: { type: "string", required: true },
    openingUtterance: { type: "string", required: true },
    policyId: { type: "string", required: true },
  }),
  lighting_design: defineStation("lighting_design", {
    // Room identity: environmentId (known shipped room) or roomGlbPath (.glb);
    // at least one required (refused at plan time, not schema time).
    environmentId: { type: "string", required: false, description: "known shipped room id" },
    roomGlbPath: { type: "string", required: false, description: "room GLB path (must end in .glb)" },
    // Deterministic JSON inputs (both required; parsed at plan time).
    // bboxJson: {minX,minY,minZ,maxX,maxY,maxZ} with max > min.
    bboxJson: { type: "string", required: true, description: "room bounding box JSON" },
    // castJson: non-empty [{actorId, position:[x,y,z]}].
    castJson: { type: "string", required: true, description: "cast positions JSON" },
    // Closed mood enum (plan-time refusal on unknown values): ed_exam_bright, clinic_day, evening_calm.
    mood: { type: "string", required: true, description: "scenario mood (closed enum)" },
    seed: { type: "number", required: true },
  }),
};

export function productionStationIds(): ProductionStationId[] {
  return [...PRODUCTION_STATION_IDS];
}
