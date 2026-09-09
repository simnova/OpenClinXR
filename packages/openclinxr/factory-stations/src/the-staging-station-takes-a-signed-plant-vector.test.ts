import { describe, expect, it } from "vitest";
import { factoryStationSchemas, productionStationIds, type ProductionStationId } from "./index.js";

/**
 * OBSERVABLE: The staging station schema diverges from the authored case schema in
 * two ways: (1) `plantOffsetMeters` is a required bare `number` in the station but
 * an optional `{x,y,z}` vector in the case (shared-schemas/src/schemas.ts:235-241).
 * Three clinic-knee-pain vectors use signed components including `x: -0.55`
 * (scenario-fixtures/src/clinic-knee-pain.ts:76). The admin panel writes a
 * bare scalar `number` with `min={0}` which cannot express negative x
 * (ui-route-admin/src/environment-generation-queue-panel.tsx:123,459-460).
 * (2) `supportSurface` is an open `string` in the station (factory-stations/src/catalog.ts:203-207)
 * but a closed union `stretcher|chair|none` in the case. The dark-factory runner
 * currently passes a POSTURE value ("supine") for supportSurface
 * (tools/openclinxr/dark-factory/multi-case-runner.ts:806).
 *
 * MEASURED 2026-09-09. Case schema lines 235-241 declare optional {x,y,z}; three
 * authored vectors at clinic-knee-pain.ts:53,76,99 include negative x. Admin type
 * line 123 is `plantOffsetMeters?: number` with InputNumber min={0} at 459-460.
 * Station schema at catalog.ts:203-207 has `plantOffsetMeters: {type:"number",required:true}`
 * and `supportSurface: {type:"string",required:true}`. Pass-through at staging/run.ts:8
 * is untyped. Compile spec write at apply-station-payload.ts:19 writes flat scalar.
 *
 * known-good: The case schema is already correct: shared-schemas/src/schemas.ts:235-241
 * declares {x,y,z} and three real vectors are authored against it, one with negative x.
 * That is the shape everything else must match. Do NOT change the case schema.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED (<card>)
 * below. Never rewrite the diagnosis or the measured anchors. A rejection still
 * flips: the clause asserts the report, not the outcome. Never delete an
 * inverted guard.
 *
 * CONTRACTED EXPORT (the honest slice adds exactly this):
 * // factory-stations/src/catalog.ts — the staging station field types change:
 * staging: defineStation("staging", {
 *   actorId: { type: "string", required: true },
 *   // {x,y,z} in metres, SIGNED. Matches ScenarioSchema plantOffsetMeters
 *   // (shared-schemas/src/schemas.ts:235-241). A bare number is refused.
 *   plantOffsetMeters: { type: "vector3", required: <THE DECISION, see below> },
 *   // closed union, matching the case. A POSTURE ("supine") is refused.
 *   supportSurface: { type: "enum", values: ["stretcher", "chair", "none"], required: true },
 * });
 * If defineStation's field-type vocabulary has no vector3/enum, EXTEND IT — that extension
 * is in scope and is the point of the card. Read catalog.ts for the actual defineStation shape
 * and follow it.
 *
 * THE DECISION THIS CARD MUST RECORD
 * The station marks the offset required: true; the case marks it optional. Pick one,
 * assert it in the RED, and record the reason in a comment beside the field. Both
 * answers are defensible; picking neither leaves the disagreement in place.
 * STATE YOUR CHOICE at the top of the test file in a // DECISION: comment so the
 * orchestrator can review it.
 *
 * DECISION: Make plantOffsetMeters optional in the station schema (required: false)
 * to match the case schema which declares it as Type.Optional. The case is the
 * authoritative source for authored placement data; the station must accept what
 * the case provides. An actor without placement is valid per ActorPlacementSchema
 * docs (shared-schemas/src/schemas.ts:210-220). Making it optional in the station
 * aligns with the case and avoids refusing valid cases that omit the offset.
 *
 * IN-SCOPE: ui-route-admin/src/environment-generation-queue-panel.tsx, ui-route-admin/src/the-worldview-placement-nodes-author-plant-and-support.test.tsx,
 * factory-stations/src/{catalog.ts,staging/run.ts,apply-station-payload.ts}, shared-schemas/src/the-factory-station-schemas-validate.test.ts
 * OUT-OF-SCOPE: The compile node, the dark-factory stage, the runtime bundle, apps/ui-xr, and the CASE schema.
 */
describe("the staging station takes a signed plant vector", () => {
  // Helper to get the staging schema
  const stagingSchema = factoryStationSchemas.staging;

  // Helper to get a valid base object and override specific fields
  const baseValid = (overrides: Record<string, unknown> = {}) => ({
    actorId: "actor_a",
    supportSurface: "stretcher",
    plantOffsetMeters: { x: 0.1, y: 0, z: 0 },
    ...overrides,
  });

  it("(1) The staging station ACCEPTS the authored clinic vector {x:-0.55,y:0,z:0.2}", () => {
    const result = stagingSchema["~standard"].validate(
      baseValid({ plantOffsetMeters: { x: -0.55, y: 0, z: 0.2 } })
    );
    expect(result).toEqual({ value: baseValid({ plantOffsetMeters: { x: -0.55, y: 0, z: 0.2 } }) });
  });

  it("(2) The staging station REFUSES a bare scalar for plantOffsetMeters", () => {
    // The existing test at shared-schemas/src/the-factory-station-schemas-validate.test.ts:33
    // asserts plantOffsetMeters: 0.1 is VALID today. This clause must fail (refuse the scalar).
    const result = stagingSchema["~standard"].validate(
      baseValid({ plantOffsetMeters: 0.1 })
    );
    expect(result.issues).toBeDefined();
    if (result.issues !== undefined) {
      expect(result.issues[0]?.message).toMatch(/plantOffsetMeters|expected|number/);
    }
  });

  it("(3) The staging station REFUSES supportSurface: 'supine' (POSTURE value)", () => {
    const result = stagingSchema["~standard"].validate(
      baseValid({ supportSurface: "supine" })
    );
    expect(result.issues).toBeDefined();
    if (result.issues !== undefined) {
      expect(result.issues[0]?.message).toMatch(/supportSurface|unknown|supine/);
    }
  });

  it("(4) The staging station ACCEPTS supportSurface: 'stretcher'", () => {
    const result = stagingSchema["~standard"].validate(
      baseValid({ supportSurface: "stretcher" })
    );
    expect(result).toEqual({ value: baseValid({ supportSurface: "stretcher" }) });
  });

  it("(5) The staging station ACCEPTS supportSurface: 'chair'", () => {
    const result = stagingSchema["~standard"].validate(
      baseValid({ supportSurface: "chair" })
    );
    expect(result).toEqual({ value: baseValid({ supportSurface: "chair" }) });
  });

  it("(6) The staging station ACCEPTS supportSurface: 'none'", () => {
    const result = stagingSchema["~standard"].validate(
      baseValid({ supportSurface: "none" })
    );
    expect(result).toEqual({ value: baseValid({ supportSurface: "none" }) });
  });

  it("(7) plantOffsetMeters is optional in the station schema (matching case schema)", () => {
    // DECISION: plantOffsetMeters should be optional in the station schema to match
    // the case schema (ActorPlacementSchema.plantOffsetMeters is Type.Optional).
    // An actor without placement is valid per shared-schemas/src/schemas.ts:210-220.
    const result = stagingSchema["~standard"].validate(
      baseValid({ plantOffsetMeters: undefined })
    );
    expect(result).toEqual({ value: baseValid({ plantOffsetMeters: undefined }) });
  });
});