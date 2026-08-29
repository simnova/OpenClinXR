import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: ActorCardSchema has no placement / supportSurface member.
 * W11 cannot author placement onto the case without this field; ui-admin
 * case-authoring-model mirrors the schema and drops unknown keys.
 *
 * MEASURED 2026-08-29. schemas.ts:185-201. communicationProfile and
 * bodyMechanics exist; placement does not.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(SRC, "schemas.ts"), "utf8");
const SLICE = SCHEMA.slice(
  SCHEMA.indexOf("export const ActorCardSchema"),
  SCHEMA.indexOf("export const EventScheduleEntrySchema"),
);

describe("the actor card schema authors placement", () => {
  it.fails("(1) ActorCardSchema includes a placement or supportSurface member", () => {
    expect(SLICE).toMatch(/placement|supportSurface/);
  });

  it("(2) COUNTERWEIGHT: bodyMechanics and communicationProfile remain optional", () => {
    expect(SLICE).toMatch(/communicationProfile/);
    expect(SLICE).toMatch(/bodyMechanics/);
  });
});

// NOT TESTED: ui-xr consumers; backfilling 14 bank scenarios; #167.
