import { describe, expect, it } from "vitest";
import {
  extendLocoGroundRoute,
  locoGroundTapBoneNames,
  parseLocoGroundEnabled,
  parseLocoGroundNoStanceLock,
  probeMixerActions,
} from "../../../../packages/openclinxr/xr-humanoid-animation/dist/loco-ground-tap-mod.js";

/**
 * Unit test for the loco-ground `locoGround=1` / `noStanceLock=1` opt-in
 * query parsers, the 6 m route extension, and the tap bone list.
 *
 * WHY IT LIVES HERE, AND WHY IT IMPORTS dist. Same discipline as
 * `ccd-stance-lock-query-flag.test.ts` in foot-plant/: the tap module is
 * deliberately private (nothing outside @openclinxr/xr-humanoid-animation
 * binds it, so exporting it would fail the reviewed-surface gate), a
 * co-located test would raise that package's shrink-only test-internal-import
 * ceiling, and a relative import into the package's src/ would trip the
 * cross-boundary freeze. Tools-side tests are outside both gates' scope.
 * dist because the boundary freeze tracks src only; `test` dependsOn
 * `^build`, so dist is fresh under the repo's own test pipeline.
 */
describe("loco-ground query flags", () => {
  it("reads exactly locoGround=1 as true", () => {
    expect(parseLocoGroundEnabled("?locoGround=1")).toBe(true);
    expect(parseLocoGroundEnabled("")).toBe(false);
    expect(parseLocoGroundEnabled("?locoGround=0")).toBe(false);
  });

  it("reads exactly noStanceLock=1 as true", () => {
    expect(parseLocoGroundNoStanceLock("?noStanceLock=1")).toBe(true);
    expect(parseLocoGroundNoStanceLock("")).toBe(false);
    expect(parseLocoGroundNoStanceLock("?locoGround=1")).toBe(false);
  });
});

describe("extendLocoGroundRoute", () => {
  it("extends a short route to 6 m with the target fixed", () => {
    const out = extendLocoGroundRoute({
      start: { x: 0, y: 0, z: 0 },
      target: { x: 1.2, y: 0, z: 0 },
      waypoints: [{ position: { x: 0, y: 0, z: 0 }, headingRadians: 0 }],
    });
    expect(out).not.toBe(null);
    expect(Math.hypot(1.2 - out!.start.x, 0 - out!.start.z)).toBeCloseTo(6, 5);
    expect(out!.start.x).toBeCloseTo(-4.8, 5);
    expect(out!.waypoints.length).toBeGreaterThan(1);
  });

  it("returns null when the route is already long enough", () => {
    expect(extendLocoGroundRoute({
      start: { x: 0, y: 0, z: 0 },
      target: { x: 7, y: 0, z: 0 },
      waypoints: [],
    })).toBe(null);
  });
});

describe("locoGroundTapBoneNames", () => {
  it("covers both legs, both pelvis bones, and root", () => {
    const names = locoGroundTapBoneNames();
    for (const bone of ["upperleg01L", "lowerleg01R", "footL", "toe1-1R", "pelvisL", "pelvisR", "root"]) {
      expect(names).toContain(bone);
    }
  });
});

describe("probeMixerActions", () => {
  const action = (over: Partial<{ running: boolean; weight: number; time: number }>) => ({
    isRunning: () => over.running ?? true,
    getEffectiveWeight: () => over.weight ?? 1,
    time: over.time ?? 0,
  });
  it("reports one row per response clip with running, weight, and time", () => {
    const clips = [{ name: "idle" }, { name: "walk" }];
    const slot = {
      responseClips: clips,
      mixer: { existingAction: (clip: unknown) => (clips.includes(clip as { name: string }) ? action({}) : null) },
    };
    expect(probeMixerActions(slot)).toEqual([
      { clip: "idle", running: true, effectiveWeight: 1, timeSeconds: 0 },
      { clip: "walk", running: true, effectiveWeight: 1, timeSeconds: 0 },
    ]);
  });
  it("marks a missing action as not running with null weight and time", () => {
    const slot = { responseClips: [{ name: "walk" }], mixer: { existingAction: () => null } };
    expect(probeMixerActions(slot)).toEqual([
      { clip: "walk", running: false, effectiveWeight: null, timeSeconds: null },
    ]);
  });
  it("returns null with no mixer or no clip list, and never throws", () => {
    expect(probeMixerActions({})).toBe(null);
    expect(probeMixerActions({ mixer: {} })).toBe(null);
    expect(probeMixerActions(null)).toBe(null);
    expect(
      probeMixerActions({
        responseClips: [{ name: "x" }],
        mixer: {
          existingAction: () => {
            throw new Error("boom");
          },
        },
      }),
    ).toEqual([{ clip: "x", running: false, effectiveWeight: null, timeSeconds: null }]);
  });
});
