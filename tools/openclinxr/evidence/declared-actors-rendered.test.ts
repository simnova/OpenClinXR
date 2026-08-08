import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#211). Two REDs. Both flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, GRADED IN PIXELS — and the inference is labelled as an inference (§7h)
 *
 * MEASURED: `psych_suicidal_ideation_safety_v1` declares THREE actors in
 * `packages/openclinxr/scenario-fixtures/src/psychiatric-safety.ts` —
 * `patient_jordan_reed_v1`, `partner_sam_reed_v1`, `behavioral_health_nurse_owens_v1` — and
 * `psychiatric-safety.ts:142` resolves at least one to a real `assetId`. The cast is not empty.
 *
 * GRADED BY ME, not measured: in #209's live multi-station capture the psych panel shows a desk,
 * two chairs, a monitor and a floor mat, and NO humanoid geometry. Every other station in that
 * sheet renders its cast. That is a pixel observation. It establishes THAT something is wrong. It
 * does NOT establish WHY, and I have not measured the mechanism.
 *
 * WITHDRAWN, so nobody re-derives it: I originally offered `Trace 0/9` and `00:00` as evidence the
 * encounter never started. That is false — `main.ts:1797` and `main.ts:3755` both seed
 * `Trace 0/${state.requiredTraceTags.length}` AT COMPOSE TIME, and `main.ts:2721` is where the
 * count is later updated. The counter says the HUD initialised. Do not treat it as lifecycle
 * evidence.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CAUSE IS NOT KNOWN TO ME. My last several diagnoses in this area were withdrawn — #189's
 * "the parent renders nude" turned out to be an orphan humanoid loaded as the environment, and
 * #206's "the OB bed moved into the patient" was a framing bug. Take no hypothesis of mine as fact.
 *
 * A peer round proposed ONE measurement that separates every candidate without a story from me, and
 * it is what these contracts are built on: dump every scene object carrying an actor id, with
 * `visible`, `worldPosition`, `skinnedTriangleCount`. Then:
 *
 *   0 actor roots ......................... never slotted / never staged
 *   roots exist, tris ≈ 1266 or no skin ... load failed → #187's primitive dummy
 *   roots exist, full tris, outside room .. placement / frustum
 *   roots + full tris inside the room ..... actors ARE staged; the defect is capture or UI
 *
 * DO NOT rank these. The answer may be none of them (§6l). Name the interaction you actually find.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SIGNATURE IS YOURS. These read `inspectDeclaredActorsRendered()`. What must not change:
 *  - stations and actors enumerated DYNAMICALLY from what ships. A hardcoded list is what hid ten
 *    un-captured rooms for weeks, and #102 fixed a sibling of it by enumerating from the bank.
 *  - `declaredActorIds` from the scenario fixture; `renderedActorIds` from the LIVE scene graph.
 *    The whole question is whether those two agree, so a report built from one proves nothing.
 *  - Blender is never the instrument (#60). Read the live graph, or the glTF JSON.
 */

type ActorRow = {
  scenarioId: string;
  actorId: string;
  declared: boolean;
  renderedInScene: boolean;
  visible: boolean;
  skinnedTriangleCount: number;
  worldPosition: { x: number; y: number; z: number } | null;
};

type Inspect = () => Promise<{ stations: { scenarioId: string; actors: ActorRow[] }[] }>;

const load = () =>
  import("./declared-actors-rendered.js") as Promise<Record<string, unknown>>;

describe("a declared actor reaches the scene a learner sees (#211)", () => {
  it("every declared actor renders in its station", async () => {
    const mod = await load();
    const inspect = mod["inspectDeclaredActorsRendered"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.stations.length, "no stations were inspected — enumerate from the bank").toBeGreaterThan(1);

    const missing: string[] = [];
    for (const station of report.stations) {
      for (const a of station.actors) {
        if (!a.declared) continue;
        if (!a.renderedInScene) {
          missing.push(`${station.scenarioId}/${a.actorId}: declared, never reaches the scene`);
        } else if (!a.visible) {
          missing.push(`${station.scenarioId}/${a.actorId}: in the scene but visible=false`);
        }
      }
    }
    expect(missing, `declared actors a learner cannot see:\n${missing.join("\n")}`).toEqual([]);
  }, 900_000);

  it("a rendered actor carries real skinned geometry, not a load-failure dummy", async () => {
    // #187: a failed humanoid load produces a ~1266-triangle primitive dummy rather than an absence.
    // "Present" is therefore not the same as "loaded", and a contract that only counts roots would
    // pass on a room full of placeholders. This is the same class §11c named for footwear —
    // presence and position do not add up to the thing actually being there.
    const mod = await load();
    const inspect = mod["inspectDeclaredActorsRendered"] as Inspect;
    const report = await inspect();

    const dummies: string[] = [];
    for (const station of report.stations) {
      for (const a of station.actors) {
        if (!a.declared || !a.renderedInScene) continue;
        if (a.skinnedTriangleCount < 3000) {
          dummies.push(
            `${station.scenarioId}/${a.actorId}: ${a.skinnedTriangleCount} skinned triangles — `
            + `a real humanoid ships 18000+, #187's load-failure dummy is ~1266`,
          );
        }
      }
    }
    expect(dummies, `actors that are placeholders rather than humanoids:\n${dummies.join("\n")}`).toEqual([]);
  }, 900_000);
});
