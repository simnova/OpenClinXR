import type { Scenario } from "@openclinxr/shared-schemas";

export type AuthoredStagingCamera = {
  eye: [number, number, number];
  look: [number, number, number];
  fov: 70 | 80 | 90;
};

type Placement = NonNullable<Scenario["actors"][number]["placement"]>;
export type AuthoredStagingSolution = { camera: AuthoredStagingCamera; placements: Record<string, Placement> };

// staging-solver v1 — generated deterministically by `pnpm staging:solve`.
export const AUTHORED_STAGING_SOLUTIONS: Readonly<Record<string, AuthoredStagingSolution>> = {
  "peds_fever_v1": {
    "camera": {
      "eye": [
        -2.64,
        2.16,
        -3.324973
      ],
      "look": [
        -2.442242,
        0.662342,
        0.541822
      ],
      "fov": 70
    },
    "placements": {
      "nurse_aisha_brooks_v1": {
        "supportSurface": "none",
        "plantOffsetMeters": {
          "x": -2.703386,
          "y": 0,
          "z": 0.118675
        },
        "headingRadians": -2.721731
      },
      "parent_mei_chen_v1": {
        "supportSurface": "chair",
        "plantOffsetMeters": {
          "x": -3.345235,
          "y": 0,
          "z": 1.026661
        },
        "headingRadians": -2.680988
      },
      "patient_noah_chen_v1": {
        "supportSurface": "stretcher",
        "plantOffsetMeters": {
          "x": 0,
          "y": 0,
          "z": 0
        },
        "headingRadians": -0.26
      }
    }
  }
};

export function authoredStagingCameraForScenario(scenarioId: string): AuthoredStagingCamera | undefined {
  return AUTHORED_STAGING_SOLUTIONS[scenarioId]?.camera;
}

export function applyAuthoredStagingSolution(scenario: Scenario): Scenario {
  const solution = AUTHORED_STAGING_SOLUTIONS[scenario.scenarioId];
  if (!solution) return scenario;
  return { ...scenario, actors: scenario.actors.map((actor) => ({
    ...actor, ...(solution.placements[actor.actorId] ? { placement: solution.placements[actor.actorId] }
      : actor.placement ? { placement: actor.placement } : {}),
  })) };
}
