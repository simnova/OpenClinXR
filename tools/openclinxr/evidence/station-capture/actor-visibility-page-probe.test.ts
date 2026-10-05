import { describe, expect, it } from "vitest";
import {
  ACTOR_VISIBILITY_BROWSER_FUNCTION_SOURCE,
  measureActorVisibility,
  type ActorVisibilityOccluder,
} from "./actor-visibility-page-probe.js";

describe("actor visibility probe", () => {
  it("rejects a partition-hidden actor that the old wall-and-door-only check accepts", () => {
    const actor = { id: "patient", box: { min: [-0.3, 0, -0.2], max: [0.3, 1.8, 0.2] } } as const;
    const partition: ActorVisibilityOccluder = {
      actorId: null,
      name: "privacy_partition.panel",
      box: { min: [-0.8, 0, 1.3], max: [0.8, 2.2, 1.45] },
    };

    const oldWallAndDoorBoxes: ActorVisibilityOccluder[] = [];
    expect(oldWallAndDoorBoxes).toHaveLength(0); // the previous crown test passed
    expect(measureActorVisibility([0, 1.6, 3], actor, [partition])).toMatchObject({
      crownVisible: false,
      visibleSampleCount: 0,
      visible: false,
    });
  });

  it("keeps the browser implementation pinned to crown plus three other samples", () => {
    const browserMeasure = Function(`return (${ACTOR_VISIBILITY_BROWSER_FUNCTION_SOURCE})`)() as typeof measureActorVisibility;
    const actor = { id: "patient", box: { min: [-0.3, 0, -0.2], max: [0.3, 1.8, 0.2] } } as const;
    expect(browserMeasure([0, 1.6, 3], actor, [])).toEqual(measureActorVisibility([0, 1.6, 3], actor, []));
  });
});
