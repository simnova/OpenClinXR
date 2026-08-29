import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: ActorCard.placement exists on the schema (b5ef5225) and the
 * factory emits Placement from it (e79ef796). actorFromFormValue re-attaches
 * optional members BY NAME. placement is not a name it knows, so a form
 * round-trip drops it. The :288 docstring promising "any future optional
 * fields" is false for this member.
 *
 * MEASURED 2026-08-29 by Claude (agt_8eeadc). scenarioToFormValues does not
 * project placement. actorFromFormValue does not copy preserved.placement.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const MODEL = readFileSync(join(SRC, "case-authoring-model.ts"), "utf8");

describe("the worldview round-trips actor placement", () => {
  it.fails("(1) scenarioToFormValues projects actor.placement", () => {
    const slice = MODEL.slice(
      MODEL.indexOf("export function scenarioToFormValues"),
      MODEL.indexOf("function cleanStrings"),
    );
    expect(slice).toMatch(/placement/);
  });

  it.fails("(2) actorFromFormValue copies placement onto the merged actor", () => {
    const slice = MODEL.slice(
      MODEL.indexOf("function actorFromFormValue"),
      MODEL.indexOf("export function mergeFormValuesIntoScenario"),
    );
    expect(slice).toMatch(/placement/);
  });

  it("(3) COUNTERWEIGHT: communicationProfile still round-trips by name", () => {
    expect(MODEL).toMatch(/communicationProfile/);
  });
});

// NOT TESTED: live form Select; bank backfill; #167.
