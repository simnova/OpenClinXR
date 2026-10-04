import { scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";
import { describe, expect, it } from "vitest";

const TARGETS = [
  "adult_abdominal_pain_v1",
  "peds_fever_v1",
  "ed_chest_pain_priority_v1",
  "ed_chest_pain_priority_v2",
  "ward_delirium_med_rec_v1",
  "psych_suicidal_ideation_safety_v1",
  "stepdown_sepsis_nurse_escalation_v1",
] as const;

type Point = { x: number; z: number };
type Actor = (typeof scenarioBank)[number]["actors"][number];

const STRETCHER_CENTER: Point = { x: -0.9, z: -0.1 };
const PATIENT_CHAIR_CENTER: Point = { x: -1.55, z: -0.85 };
const FAMILY_CHAIR_CENTER: Point = { x: -0.55, z: -0.75 };
const FOOTPRINT_RADIUS_METERS = { standing: 0.235, seated: 0.3, supine: 0.48 } as const;

function resolvedFootprint(actor: Actor): { center: Point; radius: number } {
  const placement = actor.placement;
  expect(placement, `${actor.actorId}: placement`).toBeDefined();
  const offset = placement?.plantOffsetMeters;
  expect(offset, `${actor.actorId}: plantOffsetMeters`).toBeDefined();
  expect([offset?.x, offset?.y, offset?.z].every(Number.isFinite), `${actor.actorId}: finite offset`).toBe(true);

  if (placement?.supportSurface === "stretcher" || placement?.supportSurface === "bed") {
    return {
      center: { x: STRETCHER_CENTER.x + (offset?.x ?? 0), z: STRETCHER_CENTER.z + (offset?.z ?? 0) },
      radius: FOOTPRINT_RADIUS_METERS.supine,
    };
  }
  if (placement?.supportSurface === "chair") {
    const chair = actor.role === "patient" ? PATIENT_CHAIR_CENTER : FAMILY_CHAIR_CENTER;
    return {
      center: { x: chair.x + (offset?.x ?? 0), z: chair.z + (offset?.z ?? 0) },
      radius: FOOTPRINT_RADIUS_METERS.seated,
    };
  }
  expect(placement?.supportSurface, `${actor.actorId}: declared support`).toBe("none");
  return {
    center: { x: offset?.x ?? 0, z: offset?.z ?? 0 },
    radius: FOOTPRINT_RADIUS_METERS.standing,
  };
}

describe("the seven failed stations carry complete collision-free staging intent", () => {
  it.each(TARGETS)("%s authors every cast member on a declared support without footprint overlap", (scenarioId) => {
    const fixtureScenarioId = scenarioId === "ed_chest_pain_priority_v2"
      ? "ed_chest_pain_priority_v1"
      : scenarioId;
    const scenario = scenarioBank.find((candidate) => candidate.scenarioId === fixtureScenarioId);
    expect(scenario, scenarioId).toBeDefined();
    const footprints = (scenario?.actors ?? []).map((actor) => ({
      actorId: actor.actorId,
      ...resolvedFootprint(actor),
    }));
    expect(footprints).toHaveLength(scenario?.actors.length ?? 0);

    for (let left = 0; left < footprints.length; left += 1) {
      for (let right = left + 1; right < footprints.length; right += 1) {
        const a = footprints[left]!;
        const b = footprints[right]!;
        const distance = Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z);
        expect(
          distance,
          `${scenarioId}: ${a.actorId} and ${b.actorId} footprints overlap`,
        ).toBeGreaterThanOrEqual(a.radius + b.radius);
      }
    }
  });
});
