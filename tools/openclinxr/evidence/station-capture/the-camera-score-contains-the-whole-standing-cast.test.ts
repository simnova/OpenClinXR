import { describe, expect, it } from "vitest";
import {
  cameraScoreIsBetter,
  legacyPrimaryOnlyScoreIsBetter,
  type CameraCandidateScore,
} from "./camera-candidate-scoring.js";

type Box = { min: [number, number, number]; max: [number, number, number] };

describe("station capture camera candidate scoring", () => {
  it("rejects the old wall-hugging primary-only winner for a centred whole-cast eye", () => {
    const actors: Box[] = [
      { min: [-0.4, 0, -0.2], max: [0.4, 1.8, 0.2] },
      { min: [1.2, 0, -0.2], max: [1.9, 1.7, 0.2] },
    ];
    const walls: Box[] = [
      { min: [2.75, 0, -3], max: [3.05, 2.8, 3] },
    ];
    const wallHuggingEye: [number, number, number] = [2.7, 1.68, 1.8];
    const centredEye: [number, number, number] = [0.6, 1.68, 2.8];
    expect(wallHuggingEye[0]).toBeGreaterThan(walls[0]!.min[0] - 0.1);
    expect(centredEye[0]).toBeGreaterThan(actors[0]!.min[0]);
    expect(centredEye[0]).toBeLessThan(actors[1]!.max[0]);

    const wallScore: CameraCandidateScore = {
      containedStandingActors: 1,
      totalStandingActors: actors.length,
      nearOcclusionFraction: 84 / 144,
      foregroundPartitionFraction: 80 / 144,
      actorOverlapArea: 0.3,
      actorFixtureOverlapArea: 0.4,
      sideBoundaryClearance: 0.05,
      minMargin: 0.3,
      meanFacing: 76,
      placardBack: false,
    };
    const centredScore: CameraCandidateScore = {
      containedStandingActors: 2,
      totalStandingActors: actors.length,
      nearOcclusionFraction: 0,
      foregroundPartitionFraction: 0,
      actorOverlapArea: 0,
      actorFixtureOverlapArea: 0,
      sideBoundaryClearance: 2.4,
      minMargin: 0.2,
      meanFacing: 82,
      placardBack: false,
    };

    expect(legacyPrimaryOnlyScoreIsBetter(wallScore, null)).toBe(true);
    expect(legacyPrimaryOnlyScoreIsBetter(centredScore, wallScore)).toBe(false);
    expect(cameraScoreIsBetter(wallScore, null)).toBe(true);
    expect(cameraScoreIsBetter(centredScore, wallScore)).toBe(true);
    expect(cameraScoreIsBetter(wallScore, centredScore)).toBe(false);
  });
});
