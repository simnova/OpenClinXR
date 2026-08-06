import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#44) — every encounter declares a room and the runtime renders the same one.
 *
 * ALL THREE `it.fails` IN THIS FILE FLIP. This header is THE RECORD, not scratch — flip them, append
 * a `## FIXED (#44)` block below, and leave the measured table intact.
 *
 * MEASURED. `environmentId` is a REQUIRED field on the scenario schema
 * (`shared-schemas/src/schemas.ts:218-222`, and on the runtime schema at `runtime-schemas.ts:85`),
 * and every shipped fixture declares a distinct one:
 *
 *   ed_chest_pain_priority_v1               ed_exam_bay_v1
 *   telehealth_diabetes_health_literacy_v1  telehealth_home_visit_v1
 *   psych_suicidal_ideation_safety_v1       behavioral_health_private_room_v1
 *   oncology_bad_news_family_v1             oncology_consult_room_v1
 *   ...14 scenarios, 14 distinct environment ids
 *
 * `grep -rn "environmentId" apps/ui-xr/src/` returns NOTHING. The room is literal geometry —
 * `main.ts:3017-3070` and `:3308` build floors, walls, jambs, a lintel and a threshold from
 * hardcoded `BoxGeometry` with literal dimensions.
 *
 * ONE THING THAT IS NOT TRUE, corrected here rather than left to be discovered: the rooms are not
 * pixel-identical. `scenarioDoorwayVisualTheme` (`main.ts:2985-3005`) varies doorway accent colours —
 * but it keys on `scenarioId`, not `environmentId`, and it tints a portal rather than changing the
 * space. A learner still walks into the same room for a home visit and a stroke bay.
 *
 * PARAMETRIC BOXES ARE A PROTOCOL DECISION, NOT AN ART DECISION. They are not the destination; they
 * are the slot a kit-bashed or generated room plugs into later. Without that slot, no bake-off over
 * room technology can be measured in this app at all — which is why #44 was re-framed away from
 * "pick a generation technology" and toward "make the declared field drive the scene". Get the
 * extension point right: shell dimensions, materials, fixture slots, lighting.
 *
 * `main.ts` HAS ONE LINE OF HEADROOM — 10230 against a 10231 ceiling (`file-size-budgets.ts:43`).
 * The builder cannot grow in place and the freeze is shrink-only; raising it is the one move that is
 * never available. Extract, then call. The last three slices all lowered budgets by splitting.
 *
 * THE THREE CONTRACTS PULL APART, and each kills a different cheap pass.
 *
 * The first demands two ids produce genuinely different geometry and materials — a descriptor whose
 * fields differ while the builder ignores them fails it. The second demands the built shell carry
 * the id it was asked for, so a builder that hardcodes one room and varies a colour by chance fails.
 * The third demands an unknown id be MARKED as a fallback rather than quietly rendering the ED bay,
 * which is the failure this project has now shipped twice under other names — a silent default that
 * looks like a working feature.
 *
 * THE CAUSE IS NOT A MYSTERY (nothing reads the field) BUT THE CUT IS NOT KNOWN TO ME. How much of
 * the existing room construction has to move for the shell to be data-driven, and whether the
 * doorway theme should move with it, is yours to determine from the code. Do not take a guess of
 * mine as fact.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `buildStationEnvironment({ environmentId })`
 * returning a three.js `Group` whose `userData` records the id and whether it fell back. Change the
 * call sites and say why if a different shape is better. What must not change: the declared id
 * selects the room, the built object knows which id it is, and an unknown id is visibly a fallback.
 *
 * SCOPE: the shell — dimensions, floor, walls, lighting. Not per-fixture equipment placement, not
 * asset acquisition, not generative 3D. And nothing here asserts either room LOOKS right; that is
 * read off two captures by a human or a model and recorded on #44.
 */

const load = async () => import("./station-environment.js") as Promise<Record<string, unknown>>;

type BuiltShell = {
  userData?: Record<string, unknown>;
  children?: unknown[];
};
type Build = (input: { environmentId: string }) => BuiltShell;

/** Real ids from shipped fixtures, deliberately two settings that should not look alike. */
const ED_BAY = "ed_exam_bay_v1";
const TELEHEALTH = "telehealth_home_visit_v1";

/** Pull a comparable scalar out of whatever shape the builder returns, without pinning its schema. */
function shellFacts(shell: BuiltShell): { floorColor: unknown; depth: unknown } {
  const data = shell.userData ?? {};
  return { floorColor: data["floorColor"], depth: data["roomDepthMeters"] };
}

describe("the declared environment drives the station shell (#44)", () => {
  it.fails("two environmentIds build shells that differ in floor colour and room depth", async () => {
    const mod = await load();
    const build = mod["buildStationEnvironment"] as Build | undefined;
    expect(build).toBeTypeOf("function");

    const ed = shellFacts(build!({ environmentId: ED_BAY }));
    const home = shellFacts(build!({ environmentId: TELEHEALTH }));

    // Both must be populated — undefined !== undefined would otherwise "differ" and prove nothing.
    expect(ed.floorColor, "the ED shell must report a floor colour").toBeDefined();
    expect(ed.depth, "the ED shell must report a room depth").toBeDefined();
    expect(home.floorColor).toBeDefined();
    expect(home.depth).toBeDefined();

    expect(home.floorColor).not.toEqual(ed.floorColor);
    expect(home.depth).not.toEqual(ed.depth);
  });

  it.fails("the built shell carries the environmentId it was asked for", async () => {
    // Kills a builder that varies something by chance while still constructing one fixed room: the
    // object has to know which environment it is.
    const mod = await load();
    const build = mod["buildStationEnvironment"] as Build | undefined;
    expect(build).toBeTypeOf("function");

    expect(build!({ environmentId: TELEHEALTH }).userData?.["environmentId"]).toBe(TELEHEALTH);
    expect(build!({ environmentId: ED_BAY }).userData?.["environmentId"]).toBe(ED_BAY);
  });

  it.fails("an unknown environmentId is marked as a fallback rather than silently rendering the ED bay", async () => {
    // This project has shipped a silent default twice under other names. An unrecognised room must
    // say so — and a recognised one must NOT be flagged, or "always fallback" passes.
    const mod = await load();
    const build = mod["buildStationEnvironment"] as Build | undefined;
    expect(build).toBeTypeOf("function");

    const unknown = build!({ environmentId: "no_such_environment_v1" });
    expect(unknown.userData?.["environmentFallbackActive"]).toBe(true);
    expect(String(unknown.userData?.["environmentFallbackReason"] ?? "")).not.toHaveLength(0);

    const known = build!({ environmentId: ED_BAY });
    expect(known.userData?.["environmentFallbackActive"]).toBe(false);
  });
});
