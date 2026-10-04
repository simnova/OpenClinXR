export type CameraCandidateScore = {
  containedStandingActors: number;
  totalStandingActors: number;
  nearOcclusionFraction: number;
  foregroundPartitionFraction: number;
  actorOverlapArea: number;
  actorFixtureOverlapArea: number;
  sideBoundaryClearance: number;
  minMargin: number;
  meanFacing: number;
  placardBack: boolean;
};

/** Lexicographic gate: whole cast first, then foreground clearance, then presentation. */
export function cameraScoreIsBetter(
  candidate: CameraCandidateScore,
  incumbent: CameraCandidateScore | null,
): boolean {
  if (candidate.placardBack) return false;
  if (incumbent === null || incumbent.placardBack) return true;
  if (candidate.containedStandingActors !== incumbent.containedStandingActors) {
    return candidate.containedStandingActors > incumbent.containedStandingActors;
  }
  if (Math.abs(candidate.nearOcclusionFraction - incumbent.nearOcclusionFraction) > 1 / 144) {
    return candidate.nearOcclusionFraction < incumbent.nearOcclusionFraction;
  }
  if (Math.abs(candidate.foregroundPartitionFraction - incumbent.foregroundPartitionFraction) > 1 / 144) {
    return candidate.foregroundPartitionFraction < incumbent.foregroundPartitionFraction;
  }
  if (Math.abs(candidate.actorFixtureOverlapArea - incumbent.actorFixtureOverlapArea) > 0.01) {
    return candidate.actorFixtureOverlapArea < incumbent.actorFixtureOverlapArea;
  }
  if (Math.abs(candidate.actorOverlapArea - incumbent.actorOverlapArea) > 0.01) {
    return candidate.actorOverlapArea < incumbent.actorOverlapArea;
  }
  if (Math.abs(candidate.sideBoundaryClearance - incumbent.sideBoundaryClearance) > 0.05) {
    return candidate.sideBoundaryClearance > incumbent.sideBoundaryClearance;
  }
  if (Math.abs(candidate.meanFacing - incumbent.meanFacing) > 4) {
    return candidate.meanFacing < incumbent.meanFacing;
  }
  return candidate.minMargin > incumbent.minMargin + 0.01;
}

/** Previous selection rule, retained only as an explicit regression counterweight. */
export function legacyPrimaryOnlyScoreIsBetter(
  candidate: Pick<CameraCandidateScore, "containedStandingActors" | "minMargin" | "meanFacing" | "placardBack">,
  incumbent: Pick<CameraCandidateScore, "containedStandingActors" | "minMargin" | "meanFacing" | "placardBack"> | null,
): boolean {
  if (candidate.placardBack || candidate.containedStandingActors === 0) return false;
  if (incumbent === null || incumbent.placardBack || incumbent.containedStandingActors === 0) return true;
  if (candidate.meanFacing < incumbent.meanFacing - 4) return true;
  return Math.abs(candidate.meanFacing - incumbent.meanFacing) <= 4
    && candidate.minMargin > incumbent.minMargin + 0.01;
}

export const CAMERA_SCORE_IS_BETTER_BROWSER_SOURCE = String.raw`function (candidate, incumbent) {
  if (candidate.placardBack) return false;
  if (incumbent === null || incumbent.placardBack) return true;
  if (candidate.n !== incumbent.n) return candidate.n > incumbent.n;
  if (Math.abs(candidate.nearOcclusion - incumbent.nearOcclusion) > 1 / 144) {
    return candidate.nearOcclusion < incumbent.nearOcclusion;
  }
  if (Math.abs(candidate.foregroundOcclusion - incumbent.foregroundOcclusion) > 1 / 144) {
    return candidate.foregroundOcclusion < incumbent.foregroundOcclusion;
  }
  if (Math.abs(candidate.actorFixtureOverlap - incumbent.actorFixtureOverlap) > 0.01) {
    return candidate.actorFixtureOverlap < incumbent.actorFixtureOverlap;
  }
  if (Math.abs(candidate.actorOverlap - incumbent.actorOverlap) > 0.01) {
    return candidate.actorOverlap < incumbent.actorOverlap;
  }
  if (Math.abs(candidate.sideClearance - incumbent.sideClearance) > 0.05) {
    return candidate.sideClearance > incumbent.sideClearance;
  }
  if (Math.abs(candidate.meanFacing - incumbent.meanFacing) > 4) {
    return candidate.meanFacing < incumbent.meanFacing;
  }
  return candidate.minMargin > incumbent.minMargin + 0.01;
}`;
