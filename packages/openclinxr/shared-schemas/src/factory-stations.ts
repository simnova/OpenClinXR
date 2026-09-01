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

type FieldDef = { type: "string" | "number" | "boolean"; description?: string; required?: boolean };

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
};

export function productionStationIds(): ProductionStationId[] {
  return [...PRODUCTION_STATION_IDS];
}
