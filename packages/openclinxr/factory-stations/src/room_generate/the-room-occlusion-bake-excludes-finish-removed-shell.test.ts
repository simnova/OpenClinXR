import { describe, expect, it } from "vitest";
import { planRoomGenerate } from "../index.js";

/**
 * Brown-band pin: occlusionExcludes reaches the occlusion bake as CLI flags,
 * shown in the dry-run plan, and malformed excludes are refused at plan time.
 * Plan-only: no Blender, no Infinigen.
 */

const BASE = {
  environmentId: "behavioral_health_private_room_v1",
  infinigenPrompt: "clinical single room",
  seed: 211,
  layoutVariant: "single",
};

describe("the room occlusion bake excludes the finish-removed shell", () => {
  it("(1) both excludes plan as both bake flags", () => {
    const planned = planRoomGenerate({ ...BASE, occlusionExcludes: { shellCornice: true, shellCeiling: true } });
    expect(planned.issues).toBeUndefined();
    if (planned.issues !== undefined) return;
    expect(planned.plan["occlusionExcludeFlags"]).toEqual(["--exclude-shell-cornice", "--exclude-shell-ceiling"]);
  });

  it("(2) absent or false excludes plan no flags (acoustic-tbar rooms unchanged)", () => {
    for (const input of [{ ...BASE }, { ...BASE, occlusionExcludes: { shellCornice: false } }]) {
      const planned = planRoomGenerate(input);
      expect(planned.issues).toBeUndefined();
      if (planned.issues !== undefined) return;
      expect("occlusionExcludeFlags" in planned.plan).toBe(false);
    }
  });

  it("(3) a non-boolean or unknown exclude field is refused at plan time", () => {
    expect(planRoomGenerate({ ...BASE, occlusionExcludes: { shellCornice: "yes" } }).issues).toBeDefined();
    expect(planRoomGenerate({ ...BASE, occlusionExcludes: { skylight: true } }).issues).toBeDefined();
  });
});
