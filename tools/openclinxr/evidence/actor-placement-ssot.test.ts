import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#123) — the fourth humanoid slot bypasses the placement system entirely and
 * stands wherever a hardcoded literal puts it.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the first three slots are placed correctly today and
 * must not move. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * HONEST SIZE: small, and deliberately so. A peer round talked me out of a bigger slice.
 *
 * I proposed contracting actor placement across every station — inter-actor separation, distance to
 * viewer, in-frame. **That was two problems welded together and one of them was wrong.** This slice is
 * only the data-flow hole: an entity that renders without a placement record. Layout quality is a
 * separate, larger piece of work that needs measurement first.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT I ALMOST CONTRACTED, AND WHY IT WOULD HAVE BEEN WRONG
 *
 * I was going to assert that every actor is fully in frame at the room-capture camera. **The
 * room-capture camera is a debug camera** — `ui-xr-environment-room-capture.ts:489-490`, fixed at
 * `(1.35, 2.05, 3.15)`. A learner enters through a portal/doorway and then moves freely in WebXR;
 * they are never locked to that pose.
 *
 * Contracting "in frame at roomCam" would have graded my own evidence tool and called it product
 * correctness. RoomCam crops stay useful as a REGRESSION SIGNAL and as the thing I pixel-grade — they
 * are not the source of truth for where a person should stand.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, TRACED — verified against the tree
 *
 * The placement SSOT already exists:
 *   `runtime-bundles.ts:~184`  `sceneManifest.actorPlacements` — keyed by actorId
 *   `main.ts:859-864`          `runtimeActorPlacement(actorId, fallback)` reads it, else a fallback
 *   `generated-ed-station-runtime-bundle.ts:1112-1134` emits it — with **exactly three keys**:
 *                              patient, team, family
 *
 * And the fourth slot does not use it:
 *   `main.ts:3807`             `additional.position.set(0.35, 0.95, 1.15)`
 *
 * `z = 1.15` is forward of team `z = 0.55` and family `z = 0.7`, so the fourth figure stands nearer
 * the doorway and is cut off in the capture. The #122 worker confirmed this is a consequence of its
 * change and explained why: **there was no fourth placement anywhere, because the system only ever
 * authored three roles.**
 *
 * A related hole in the same producer: `:1117-1121` maps nurse / respiratory_therapist /
 * nurse_observer / consultant / interpreter into "team" — **`physician` is still absent**, which is
 * the same allow-list gap #122 fixed in the runtime resolver but not here.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * OVERLAP IS NOT AUTOMATICALLY A DEFECT — this is why contract (2) is shaped as it is
 *
 * A nurse at a bedside IS close to the patient. There is no clinical standard saying people must
 * stand 1.2 m apart, and a global separation floor would destroy bedside staging. What is wrong is
 * **coincident placement** — two full bodies at the same XZ, which is what a shared fallback produces.
 * So (2) uses a tight epsilon that catches collision, not proximity.
 *
 * Two further observations I have NOT verified and am deliberately NOT contracting: the #122 worker
 * reported ward's three standing figures nearly co-located, and oncology's patient half-occluded
 * behind a desk slab. Those are layout quality and belong to the follow-on slice, after measurement.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - Where the additional cast member goes. It should be a clinical secondary position — a bedside or
 *    team-adjacent anchor — not the doorway. You are choosing an actual spot; say what you chose and
 *    why, and do NOT pick it by nudging until one capture looks right.
 *  - Whether the factory emits N placements for N staged humanoids, or the runtime derives an extra
 *    from an existing anchor when the bundle has none. Both are defensible.
 *  - Whether `physician` is added to the factory's team-role mapping now. It is the same gap, one
 *    layer up, and leaving it means the next station with a physician gets a fallback placement.
 *  - Whether the hardcoded fallback positions in `main.ts` survive at all once placements are keyed
 *    per actor.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands every staged actor have a placement record, and is satisfiable by giving them all the
 * same one. (2) forbids that — two bodies at one XZ is the collision a shared fallback produces. (3)
 * is green today and forbids buying either by re-laying-out the three slots that already work.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectActorPlacementSsot()`. What must not
 * change: staged actors come from the LIVE scene, placements are read from the shipped bundle the
 * runtime actually loads, and stations are enumerated rather than listed.
 *
 * REQUIRED, the observable half: re-capture ward delirium and say where the fourth figure stands.
 * That capture is a REGRESSION SIGNAL, not the contract — see above.
 *
 * IN-SCOPE VISUAL, as separate slots you must fill:
 *     IN-SCOPE VISUAL: fourth figure ___ ; other three ___ ; anyone clipped or overlapping ___
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: whether every rendered person has a declared position. Says NOTHING about whether the layout
 * is good — that needs measurement and a follow-on slice — nor about what anyone wears.
 */

const load = async () => import("./actor-placement-ssot.js") as Promise<Record<string, unknown>>;

type StagedPlacement = {
  scenarioId: string;
  actorId: string;
  slotKind: string;
  /** True when sceneManifest.actorPlacements has an entry keyed by this actorId. */
  hasDeclaredPlacement: boolean;
  /** World position the actor actually occupies in the live scene. */
  worldX: number;
  worldZ: number;
};
type Inspect = () => Promise<{ stations: string[]; staged: StagedPlacement[] }>;

/** Two full bodies this close share a spot. Deliberately tight: bedside proximity is correct. */
const COINCIDENT_XZ_EPSILON_METERS = 0.15;
const FIRST_THREE = ["primary_patient", "clinical_team", "family"];

describe("every rendered person has a declared position (#123)", () => {
  it("every staged humanoid has a placement record", async () => {
    // main.ts:3807 places the fourth slot with a bare position.set and no actorPlacements key, because
    // the factory only ever authored three.
    const mod = await load();
    const inspect = mod["inspectActorPlacementSsot"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.staged.length, "no staged actors were measured").toBeGreaterThan(0);

    const orphans = report.staged
      .filter((s) => !s.hasDeclaredPlacement)
      .map((s) => `${s.scenarioId}/${s.actorId} (${s.slotKind}) at x=${s.worldX.toFixed(2)} z=${s.worldZ.toFixed(2)}`);
    expect(orphans, `staged actors with no declared placement:\n${orphans.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("no two staged humanoids stand in the same spot", async () => {
    // Kills the cheap satisfaction of the first contract: giving every actor the SAME placement record
    // satisfies (1) and puts two bodies in one place. Epsilon is tight on purpose — a nurse at a
    // bedside is legitimately close to the patient, and a separation floor would break that.
    const mod = await load();
    const inspect = mod["inspectActorPlacementSsot"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const collisions: string[] = [];
    for (const scenarioId of report.stations) {
      const here = report.staged.filter((s) => s.scenarioId === scenarioId);
      for (let i = 0; i < here.length; i += 1) {
        for (let j = i + 1; j < here.length; j += 1) {
          const dx = here[i]!.worldX - here[j]!.worldX;
          const dz = here[i]!.worldZ - here[j]!.worldZ;
          const d = Math.hypot(dx, dz);
          if (d < COINCIDENT_XZ_EPSILON_METERS) {
            collisions.push(`${scenarioId}: ${here[i]!.actorId} and ${here[j]!.actorId} are ${d.toFixed(3)}m apart`);
          }
        }
      }
    }
    expect(collisions, `people standing in the same spot:\n${collisions.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("the first three slots keep their positions (COUNTERWEIGHT — green today)", async () => {
    // The patient, clinical team and family slots are placed through the SSOT already. Adding a fourth
    // must not become an excuse to re-lay-out the three that work.
    const mod = await load();
    const inspect = mod["inspectActorPlacementSsot"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const core = report.staged.filter((s) => FIRST_THREE.includes(s.slotKind));
    expect(core.length, "no patient/team/family slots were measured").toBeGreaterThan(0);
    for (const s of core) {
      expect(s.hasDeclaredPlacement, `${s.scenarioId}/${s.actorId} lost its declared placement`).toBe(true);
    }
  }, 900_000);
});
