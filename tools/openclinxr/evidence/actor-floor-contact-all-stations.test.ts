import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#105) — actors float above the floor in psych, and nobody had rendered that
 * station to see it.
 *
 * ALL THREE ARE `it.fails` AND ALL THREE FLIP. They are not all REDs:
 *   (1) and (2) are REDs — behaviour that does not exist.
 *   (3) is a COUNTERWEIGHT — #72 fixed actors BURYING to the hips and that must survive. It is
 *       `it.fails` only because the module is absent.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT I SAW, with my own pixel grade
 *
 * `psych_suicidal_ideation_safety_v1`: both actors hover with clear air between their feet and the
 * floor — the left figure suspended above a white block, the right one's legs ending above a green
 * one. It is a suicide-risk safety-planning encounter with two people off the ground.
 *
 * This is #72's defect in the opposite direction. #72 fixed actors burying to the hips in assembled
 * rooms; psych was never checked against it, because the evidence pipeline captured 2 of 12 stations
 * (`DEFAULT_SCENARIOS`, a hardcoded pair) and psych was not one of them.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE MEASUREMENTS THAT MAKE THIS CHEAP — verified, do not re-derive
 *
 * FLOOR TOP IS y = 0.00 IN EVERY STATION. `station-environment.ts:58-65` builds one parametric floor:
 * a box 0.08 thick positioned at y = -0.04, so its top surface is exactly 0. That is shared across
 * all twelve stations, so a single band works everywhere — no per-station threshold to tune.
 *
 * THE PROBE ALREADY EXISTS. `ui-xr-environment-room-capture.ts:149` declares `lowestVertexY` and
 * `:365` computes it from live skinned-mesh world bounds. You do not need to build a measurement
 * harness; a previous slice lost roughly a third of its session doing exactly that.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * ENUMERATE STATIONS FROM WHAT SHIPS, NEVER A LIST. This is the property that made #102 generalise
 * while #94, #96, #97 and #72 did not — each of those changed one station's data and was verified
 * against the two default captures. A hardcoded list is how a fix stays local and how ten stations
 * went unrendered for the life of the project. Measure every station the bank declares.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY (1) AND (3) PULL APART, WHICH IS THE POINT
 *
 * (1) forbids floating: no actor's lowest vertex above 0.15. Satisfiable by dropping every figure
 * through the floor. (3) forbids that — it is #72's guarantee, green today, and it fails the moment
 * anything sinks below -0.05. Together they are a band, and the only way to satisfy both is to
 * actually place feet on the floor.
 *
 * THE BAND IS DELIBERATELY WIDE. 0.15 m of clearance is far more than a correctly-placed figure
 * needs and far less than the psych figures show. It is a floor, not a description of good
 * placement — a threshold over a quantity the implementation authors becomes a design target (§7a,
 * learned when a 0.25 m height contract produced a figure sitting chin-to-chest). If you find
 * yourself adjusting geometry to clear 0.15, stop and report instead.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * SEATED ACTORS ARE STILL FEET-ON-FLOOR. #87 seated the telehealth patient with a 0.002 m
 * pelvis-to-seat gap and its feet planted; `lowestVertexY` was 0.056. So a seated figure satisfies
 * the same band and needs no exemption. If you find a posture that genuinely cannot, say so rather
 * than adding a carve-out — a carve-out is how a contract stops meaning anything.
 *
 * THE CAUSE IS NOT KNOWN TO ME BEYOND THE RENDER. Do not take a hypothesis of mine as fact; my last
 * three diagnoses in this area were each withdrawn. Candidates, UNRANKED, possibly all wrong,
 * possibly an interaction:
 *   - `actor-floor-composition` skips non-standing postures and psych's actors are declared something
 *     other than standing
 *   - the psych environment's floor sits at a different height than the parametric default
 *   - placement Y comes from a bundle that does not describe what renders (#104)
 *   - the figures rest on room props rather than the floor, and the props are mis-scaled
 * Measure the running scene. Name the interaction you actually find, even if it is not listed.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `measureActorFloorContact()`. Change the call
 * sites and say why if a different shape is better. What must not change: the number comes from live
 * skinned-mesh world bounds in the running scene, and stations are enumerated dynamically.
 *
 * MEASURE ONCE into an artifact under `.openclinxr/evidence/`, then assert against it. A previous
 * slice paid three cold Vite boots because each test spawned its own dev server.
 *
 * IN-SCOPE VISUAL VERDICT required, naming the station: "in psych the two figures are ___". Capture
 * with `--scenario psych_suicidal_ideation_safety_v1`. Separately name any out-of-scope wrongness —
 * the object and what it looks like, not the word "deformed".
 *
 * SCOPE: whether actors touch the floor. Says NOTHING about posture quality, wardrobe, or whether a
 * figure is clinically plausible — the last needs a clinician.
 *
 * ## FIXED (#105)
 *
 * LIVE (scene-overview, full bank via listShippedCastScenarioIds, 2026-08-07):
 * Floor top y=0 every station. Psych was already in-band after #72 floor-standing plant:
 *   patient_morgan_lee_v1 y0≈0.014, nurse_observer_jamie_v1 y0≈0.006 / -0.002.
 * Pixel capture (psych_suicidal_ideation_safety_v1-room.png): both figures stand with feet on the
 * floor plane (left on the purple pad at floor level, right feet at the gray floor).
 *
 * Real interaction found: not psych posture skip, not a different floor height, not bundle URLs.
 * OB elevated framing (slot y=0.58, scale≈0.42) kept ED-era verticalOffset≈-0.98 because
 * resolveEffectiveVerticalOffsetMeters only zeroed offsets when |slotY|<0.2 — scale shrank the
 * offset so it no longer cancelled slot height → patient_aisha_khan_v1 lowestVertexY=0.180.
 * Only floater across 14 stations / 42 actors; sink count 0.
 *
 * Product: resolveEffectiveVerticalOffsetMeters(slotScaleY) re-solves elevated+sub-unity-scale
 * slots so slotY + offset*scaleY ≈ 0. measureActorFloorContact() one Vite boot, enumerates
 * listShippedCastScenarioIds() → `.openclinxr/evidence/actor-floor-contact/`.
 * Post-fix: OB patient y0≈0.006, psych still in-band.
 *
 * IN-SCOPE VISUAL VERDICT: in psych the two figures are standing with feet on the floor plane.
 * OUT-OF-SCOPE: incomplete teal gown shells leaving bare thighs/shoulders; floating beige room
 * prop boxes mid-air on the back wall; family slot reuses nurse_observer actor id.
 */

const load = async () =>
  import("./actor-floor-contact-all-stations.js") as Promise<Record<string, unknown>>;

type ActorFloorContact = {
  scenarioId: string;
  actorId: string;
  /** Lowest skinned-mesh vertex in world space, from the running scene. Floor top is y = 0. */
  lowestVertexY: number;
  declaredPosture: string;
  framesAdvanced: number;
};
type Measure = () => Promise<{ scenarios: string[]; actors: ActorFloorContact[] }>;

/** Generous: a correctly placed figure needs nothing like this, and psych shows far more. */
const MAX_FLOAT_METERS = 0.15;
/** #72's guarantee: nothing sinks into the floor. */
const MAX_SINK_METERS = -0.05;

describe("actors stand on the floor in every station (#105)", () => {
  it("no actor floats above the floor", async () => {
    // The product assertion. Psych's figures hover with visible air beneath them.
    const mod = await load();
    const measure = mod["measureActorFloorContact"] as Measure | undefined;
    expect(measure).toBeTypeOf("function");

    const report = await measure!();
    expect(report.actors.length, "no actors were measured at all").toBeGreaterThan(0);

    const floating = report.actors.filter((a) => a.lowestVertexY > MAX_FLOAT_METERS);
    expect(
      floating.map((a) => `${a.scenarioId}/${a.actorId} y0=${a.lowestVertexY.toFixed(3)}`),
      "actors hovering above the floor",
    ).toHaveLength(0);

    for (const a of report.actors) {
      expect(a.framesAdvanced, `${a.actorId} measured before the render loop advanced`).toBeGreaterThan(0);
    }
  }, 1_800_000);

  it("every shipped station is measured, enumerated dynamically", async () => {
    // The property that made #102 generalise while four other fixes stayed local. A hardcoded list
    // is how psych went unrendered for the life of the project.
    const mod = await load();
    const measure = mod["measureActorFloorContact"] as Measure | undefined;
    expect(measure).toBeTypeOf("function");

    const report = await measure!();
    expect(report.scenarios.length, `only ${report.scenarios.length} stations measured`).toBeGreaterThan(8);
    expect(report.scenarios, "psych was not among the measured stations").toContain(
      "psych_suicidal_ideation_safety_v1",
    );
    for (const scenarioId of report.scenarios) {
      expect(
        report.actors.some((a) => a.scenarioId === scenarioId),
        `${scenarioId} was enumerated but contributed no actor measurement`,
      ).toBe(true);
    }
  }, 1_800_000);

  it("no actor sinks into the floor (COUNTERWEIGHT — #72's guarantee, green today)", async () => {
    // Kills the cheap satisfaction of the first contract. Dropping every figure through the floor
    // removes all float and re-creates the defect #72 fixed.
    const mod = await load();
    const measure = mod["measureActorFloorContact"] as Measure | undefined;
    expect(measure).toBeTypeOf("function");

    const report = await measure!();
    const sunk = report.actors.filter((a) => a.lowestVertexY < MAX_SINK_METERS);
    expect(
      sunk.map((a) => `${a.scenarioId}/${a.actorId} y0=${a.lowestVertexY.toFixed(3)}`),
      "actors buried below the floor",
    ).toHaveLength(0);
  }, 1_800_000);
});
