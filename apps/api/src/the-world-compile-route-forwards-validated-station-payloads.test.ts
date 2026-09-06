import { describe, expect, it } from "vitest";
import { createApiApp } from "./index.js";
import { parseStationPayloads } from "./world-compile-routes.js";

/**
 * OBSERVABLE: the 10 factory station cards in the faculty UI have no path to the
 * compiler. `FactoryStationCards` validates an edit through
 * `factoryStationSchemas[stationId]["~standard"].validate` and `onApplyStation`
 * stores it as `stationPayloads` in worldview state
 * (apps/ui-admin/src/seed-worldview-queue.tsx:110). The POST body sends
 * scenarioId, compileNodes, facultyLocks, infinigenPrompt and removedNodeIds
 * (apps/ui-admin/src/compile-encounter-world.ts:32); world-compile-routes.ts
 * parses those same five fields; and `compileEncounterMaterialization` declares
 * `stationPayloads` as an option nothing supplies
 * (tools/openclinxr/factory/encounter-materialization-compile.ts:238).
 *
 * MEASURED 2026-09-06 on main 1775b95b:
 *   grep -rn stationPayloads apps/api  -> 0 matches
 *   grep -rn stationPayloads apps/ui-admin/src/compile-encounter-world.ts -> 0 matches
 *   compile runner option declared at encounter-materialization-compile.ts:238
 *
 * KNOWN-GOOD COLUMN: the route already refuses a malformed scenarioId with 400
 * before any work (world-compile-routes.ts SCENARIO_ID_PATTERN). Station payload
 * validation mirrors that shape: refuse at the edge, name the reason, never
 * forward an unvalidated body into the compiler.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED.
 *
 * claimScope: request-edge validation and forwarding of stationPayloads.
 * notEvidenceFor: that the compiler acts on a non-equipment payload
 * (applyStationPayloadToCompileSpec has a production caller for
 * equipment_generate only); live Blender; Quest; clinical validity.
 */

const VALID_ROOM_PAYLOAD = {
  environmentId: "ed_exam_bay_v1",
  infinigenPrompt: "emergency department exam bay",
  seed: 7,
  layoutVariant: "default",
};

/** A scenario id that is well-formed but has no dated evidence JSON, so the route
 * reaches validation and then refuses with 409 rather than compiling anything. */
const SHAPED_BUT_UNCOMPILABLE = "station_payload_probe_no_evidence";

describe("the world-compile route forwards validated station payloads", () => {
  it("(1) parseStationPayloads accepts a valid station payload keyed by station id", () => {
    const parsed = parseStationPayloads({ room_generate: VALID_ROOM_PAYLOAD });
    expect(parsed).toEqual({ ok: true, value: { room_generate: VALID_ROOM_PAYLOAD } });
  });

  it("(2) parseStationPayloads refuses a payload whose field has the wrong type", () => {
    const parsed = parseStationPayloads({ room_generate: { ...VALID_ROOM_PAYLOAD, seed: "seven" } });
    expect(parsed).toMatchObject({ ok: false });
    expect(JSON.stringify(parsed)).toContain("room_generate");
    expect(JSON.stringify(parsed)).toContain("seed");
  });

  it("(3) parseStationPayloads refuses an unknown station id", () => {
    const parsed = parseStationPayloads({ not_a_station: { anything: true } });
    expect(parsed).toMatchObject({ ok: false });
    expect(JSON.stringify(parsed)).toContain("not_a_station");
  });

  it("(4) COUNTERWEIGHT: an absent stationPayloads stays legal (legacy body shape)", () => {
    expect(parseStationPayloads(undefined)).toEqual({ ok: true, value: undefined });
  });

  it("(5) POST with an invalid stationPayloads is 400 before any compile work", async () => {
    const app = createApiApp();
    const response = await app.request("/internal/world-compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenarioId: SHAPED_BUT_UNCOMPILABLE,
        stationPayloads: { room_generate: { ...VALID_ROOM_PAYLOAD, seed: "seven" } },
      }),
    });
    expect(response.status).toBe(400);
  });

  it("(6) COUNTERWEIGHT: a VALID stationPayloads is not refused at the edge", async () => {
    const app = createApiApp();
    const response = await app.request("/internal/world-compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenarioId: SHAPED_BUT_UNCOMPILABLE,
        stationPayloads: { room_generate: VALID_ROOM_PAYLOAD },
      }),
    });
    expect(response.status).not.toBe(400);
  });

  it("(7) the route hands stationPayloads to compileEncounterMaterialization", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const route = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "world-compile-routes.ts"),
      "utf8",
    );
    expect(route).toMatch(/stationPayloads\s*\?\s*\{\s*stationPayloads\s*\}\s*:/);
  });

  it("(8) the faculty client sends stationPayloads in the POST body", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const client = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../ui-admin/src/compile-encounter-world.ts"),
      "utf8",
    );
    expect(client).toMatch(/stationPayloads/);
  });
});

// NOT TESTED: that the compiler changes its plan for a non-equipment station payload;
// that the worldview passes its stationPayloads into compileEncounterWorld (that wire is
// asserted by the ui-admin suite, not here); live Blender; Quest readiness.
