import { ROOM_CHAIN_RECIPES } from "@openclinxr/factory-stations/room-chain";
import { describe, expect, it } from "vitest";
import { occlusionExcludeFlags, validateRoomGenerateOptions } from "../room_generate/run.js";
import { paintedCeilingOcclusionExcludes } from "./recipes.js";

/**
 * Brown-band pin: a painted-ceiling finish deletes the shell cornice and
 * the shell ceiling plane after the occlusion bake, so the stage-1 bake
 * must exclude both as occluders. Pure: no Blender. Acoustic-tbar rooms
 * keep no excludes (identical stage-1 keys, byte-identical GLBs).
 */
describe("painted-ceiling bakes exclude the finish-removed occluders", () => {
  it("returns both excludes for the two painted-ceiling recipes", () => {
    const painted = Object.values(ROOM_CHAIN_RECIPES).filter(
      (recipe) => recipe.finish?.ceiling?.kind === "painted",
    );
    expect(painted.map((recipe) => recipe.environmentId).sort()).toEqual([
      "behavioral_health_private_room_v1",
      "telehealth_home_visit_v1",
    ]);
    for (const recipe of painted) {
      expect(paintedCeilingOcclusionExcludes(recipe.finish)).toEqual({
        shellCornice: true,
        shellCeiling: true,
      });
    }
  });

  it("returns undefined for every acoustic-tbar recipe", () => {
    for (const recipe of Object.values(ROOM_CHAIN_RECIPES)) {
      if (recipe.finish?.ceiling?.kind === "painted") continue;
      expect(paintedCeilingOcclusionExcludes(recipe.finish)).toBeUndefined();
    }
  });

  it("translates excludes into bake CLI flags", () => {
    expect(
      occlusionExcludeFlags({ occlusionExcludes: { shellCornice: true, shellCeiling: true } }),
    ).toEqual(["--exclude-shell-cornice", "--exclude-shell-ceiling"]);
    expect(occlusionExcludeFlags({})).toEqual([]);
    expect(occlusionExcludeFlags({ occlusionExcludes: { shellCornice: false } })).toEqual([]);
  });

  it("refuses non-boolean or unknown exclude fields at plan time", () => {
    expect(
      validateRoomGenerateOptions({ occlusionExcludes: { shellCornice: "yes" } }),
    ).not.toHaveLength(0);
    expect(
      validateRoomGenerateOptions({ occlusionExcludes: { skylight: true } }),
    ).not.toHaveLength(0);
    expect(
      validateRoomGenerateOptions({ occlusionExcludes: { shellCornice: true } }),
    ).toHaveLength(0);
  });
});
