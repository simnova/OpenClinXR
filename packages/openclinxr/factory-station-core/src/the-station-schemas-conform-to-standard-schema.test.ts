import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import { factoryStationSchemas, PRODUCTION_STATION_IDS } from "./index.js";

/**
 * factory-stations publishes `~standard` and has since it was written, but it was shaped like
 * Standard Schema rather than conforming to it. Measured against the spec source
 * (standard-schema/standard-schema, packages/spec/src/index.ts) on 2026-09-08, three gaps:
 *
 *  1. the success branch had no `issues?: undefined`, so the spec's documented consumption
 *     `if (result.issues) { ... } else { result.value }` did not typecheck against our type —
 *     every consumer in this package used `"issues" in result` instead, which is our own
 *     private idiom and not what a foreign tool would write;
 *  2. the result was not generic, so a consumer received Record<string, unknown>;
 *  3. `~standard` carried no `types`, so StandardSchemaV1.InferOutput resolved to nothing.
 *
 * @standard-schema/spec is a DEVDEPENDENCY, not a runtime one: the schemas conform
 * structurally and this test asserts assignability against the real interface, so the package's
 * public surface takes no dependency while drift is still caught rather than assumed.
 */
describe("the station schemas conform to Standard Schema V1", () => {
  it("(1) every station schema is assignable to StandardSchemaV1", () => {
    for (const id of PRODUCTION_STATION_IDS) {
      // The assignment IS the assertion: it fails to compile if `~standard` drifts from the spec.
      const conforming: StandardSchemaV1 = factoryStationSchemas[id];
      expect(conforming["~standard"].version).toBe(1);
      expect(conforming["~standard"].vendor).toBe("openclinxr");
    }
  });

  it("(2) a consumer written against the SPEC, not against our types, can validate", () => {
    // This is exactly the shape the spec documents. It is written against StandardSchemaV1 only,
    // so it would work against zod, valibot or arktype without change — which is the whole point
    // of conforming rather than merely resembling.
    const run = (schema: StandardSchemaV1, value: unknown): string[] | "ok" => {
      const result = schema["~standard"].validate(value);
      if (result instanceof Promise) throw new Error("these schemas are synchronous");
      if (result.issues) return result.issues.map((issue) => issue.message);
      return "ok";
    };

    expect(run(factoryStationSchemas["body_param"], {})).not.toBe("ok");
    expect(run(factoryStationSchemas["body_param"], 42)).toEqual(["expected object"]);
  });

  it("(3) POSITIVE CONTROL: the spec's success branch is reachable and reports ok", () => {
    // A conformance test that only ever sees failures would pass against a validator that
    // rejects everything, which is the shape this repo has been bitten by before.
    const schema: StandardSchemaV1 = factoryStationSchemas["body_param"];
    const required = factoryStationSchemas["body_param"].jsonSchema.input().required;
    const value: Record<string, unknown> = {};
    const properties = factoryStationSchemas["body_param"].jsonSchema.input().properties;
    for (const name of required) {
      const type = properties[name]?.type;
      value[name] = type === "number" ? 1 : type === "boolean" ? true : "x";
    }
    const result = schema["~standard"].validate(value);
    if (result instanceof Promise) throw new Error("these schemas are synchronous");
    expect(result.issues, JSON.stringify(result)).toBeUndefined();
    expect((result as { value: unknown }).value).toEqual(value);
  });

  it("(4) an issue path is a spec path: PropertyKey or { key }", () => {
    const schema: StandardSchemaV1 = factoryStationSchemas["body_param"];
    const result = schema["~standard"].validate({});
    if (result instanceof Promise) throw new Error("these schemas are synchronous");
    expect(result.issues).toBeDefined();
    for (const issue of result.issues ?? []) {
      expect(typeof issue.message).toBe("string");
      for (const segment of issue.path ?? []) {
        const ok = typeof segment === "string" || typeof segment === "number"
          || typeof segment === "symbol" || (typeof segment === "object" && "key" in segment);
        expect(ok, JSON.stringify(segment)).toBe(true);
      }
    }
  });
});
