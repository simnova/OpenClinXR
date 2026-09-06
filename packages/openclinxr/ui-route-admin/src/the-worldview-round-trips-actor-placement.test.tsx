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

/**
 * ## FIXED (W11, tsk_250729c006996e58)
 *
 * ORDERING, stated plainly: I did NOT observe this RED fail. The round-trip was already
 * implemented when this plant landed, so both clauses passed on arrival and vitest reported
 * "Expect test to fail". Flipping them is the honest action, not a workaround — but this
 * contract cannot claim to have caught anything.
 *
 * The DEFECT was real and measured independently before the fix: actorFromFormValue
 * constructs a fresh ActorCard and re-attaches members BY NAME (demeanor, hiddenFacts,
 * communicationProfile, bodyMechanics, phenotype), so an optional member with no branch is
 * dropped on export. The docstring at :288 promising "any future optional fields" survive
 * described intent, not mechanism.
 *
 * BEHAVIOUR PROVEN, which these source-text clauses cannot see — both slices would match a
 * variable named `placement` that did nothing:
 *   round-trip authored -> survives
 *   round-trip absent   -> stays undefined (empty is legal, emits no Placement node)
 *   BLIND FORM          -> survives via the `?? preserved?.placement` fallback
 *   faculty edit        -> form value wins over the imported one
 * The blind-form case is the one no clause here reaches: a form that never surfaces the
 * control must not strip authored staging.
 */
describe("the worldview round-trips actor placement", () => {
  it("(1) scenarioToFormValues projects actor.placement", () => {
    const slice = MODEL.slice(
      MODEL.indexOf("export function scenarioToFormValues"),
      MODEL.indexOf("function cleanStrings"),
    );
    expect(slice).toMatch(/placement/);
  });

  it("(2) actorFromFormValue copies placement onto the merged actor", () => {
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
