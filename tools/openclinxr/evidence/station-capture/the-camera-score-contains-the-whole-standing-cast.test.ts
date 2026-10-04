import { describe, expect, it } from "vitest";
import {
  cameraConstraintsMet,
  cameraScoreIsBetter,
  legacyPrimaryOnlyScoreIsBetter,
  type CameraCandidateScore,
} from "./camera-candidate-scoring.js";

type Box = { min: [number, number, number]; max: [number, number, number] };

describe("station capture camera candidate scoring", () => {
  it("rejects wall-hugging, behind-the-cast and patient-cropping eyes", () => {
    const actors: Box[] = [
      { min: [-0.4, 0, -0.2], max: [0.4, 1.8, 0.2] },
      { min: [1.2, 0, -0.2], max: [1.9, 1.7, 0.2] },
      { min: [-0.2, 0.5, -1.1], max: [1.2, 1.1, -0.3] },
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
      containedActors: 1,
      totalActors: actors.length,
      nearOcclusionFraction: 84 / 144,
      minMargin: 0.3,
      meanFacing: 76,
      placardBack: false,
    };
    const behindScore: CameraCandidateScore = {
      containedActors: 3,
      totalActors: actors.length,
      nearOcclusionFraction: 0,
      minMargin: 0.3,
      meanFacing: 170,
      placardBack: false,
    };
    const patientCroppingScore: CameraCandidateScore = {
      containedActors: 2,
      totalActors: actors.length,
      nearOcclusionFraction: 0,
      minMargin: 0.4,
      meanFacing: 20,
      placardBack: false,
    };
    const centredScore: CameraCandidateScore = {
      containedActors: 3,
      totalActors: actors.length,
      nearOcclusionFraction: 0,
      minMargin: 0.2,
      meanFacing: 35,
      placardBack: false,
    };

    expect(legacyPrimaryOnlyScoreIsBetter(wallScore, null)).toBe(true);
    expect(cameraConstraintsMet(wallScore)).toBe(false);
    expect(cameraConstraintsMet(behindScore)).toBe(false);
    expect(cameraConstraintsMet(patientCroppingScore)).toBe(false);
    expect(cameraConstraintsMet(centredScore)).toBe(true);
    expect(cameraScoreIsBetter(centredScore, wallScore)).toBe(true);
    expect(cameraScoreIsBetter(centredScore, behindScore)).toBe(true);
    expect(cameraScoreIsBetter(centredScore, patientCroppingScore)).toBe(true);
    expect(cameraScoreIsBetter(wallScore, centredScore)).toBe(false);
    expect(cameraScoreIsBetter(behindScore, centredScore)).toBe(false);
    expect(cameraScoreIsBetter(patientCroppingScore, centredScore)).toBe(false);
  });
});
