import type { Scenario } from "@openclinxr/shared-schemas";

/** Desktop opening camera for one solved station: eye, look-at point, and field of view. */
export type AuthoredStagingCamera = {
  eye: [number, number, number];
  look: [number, number, number];
  fov: 55 | 60 | 70 | 80 | 90;
};

type Placement = NonNullable<Scenario["actors"][number]["placement"]>;
export type AuthoredStagingSolution = { camera: AuthoredStagingCamera; placements: Record<string, Placement> };

// staging-solver v1 — generated deterministically by `pnpm staging:solve`.
export const AUTHORED_STAGING_SOLUTIONS: Readonly<Record<string, AuthoredStagingSolution>> = {
  "oncology_bad_news_family_v1": {
    "camera": {
      "eye": [
        0.509141,
        2.16,
        0.371517
      ],
      "look": [
        -0.878103,
        0.97057,
        0.100791
      ],
      "fov": 70
    },
    "placements": {
      "sister_rachel_miller_v1": {
        "supportSurface": "none",
        "plantOffsetMeters": {
          "x": -1.635613,
          "y": 0,
          "z": 0.362776
        },
        "headingRadians": 1.881154
      }
    }
  },
  "peds_fever_v1": {
    "camera": {
      "eye": [
        -1.804096,
        2.16,
        -3.262557
      ],
      "look": [
        -2.631624,
        0.828027,
        -0.64664
      ],
      "fov": 90
    },
    "placements": {
      "nurse_aisha_brooks_v1": {
        "supportSurface": "none",
        "plantOffsetMeters": {
          "x": -2.702273,
          "y": 0,
          "z": 0.118944
        },
        "headingRadians": -2.541284
      },
      "parent_mei_chen_v1": {
        "supportSurface": "chair",
        "plantOffsetMeters": {
          "x": -3.345119,
          "y": 0,
          "z": 1.026838
        },
        "headingRadians": -2.572431
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
  },
  "primary_care_dyslipidemia_joint_pain_v1": {
    "camera": {
      "eye": [
        0.947026,
        2.16,
        -1.428072
      ],
      "look": [
        0.48257,
        0.948565,
        0.103033
      ],
      "fov": 90
    },
    "placements": {}
  }
};

/** Returns the solved desktop opening camera for a scenario, when one was recorded. */
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
