export type CameraCandidateScore = {
  containedActors: number;
  totalActors: number;
  nearOcclusionFraction: number;
  minMargin: number;
  meanFacing: number;
  placardBack: boolean;
};

export function cameraConstraintsMet(score: CameraCandidateScore): boolean {
  return score.totalActors > 0
    && score.containedActors === score.totalActors
    && score.meanFacing <= 90
    && !score.placardBack;
}

/** Hard-gate facing, then maximise readable cast, near clearance and margin. */
export function cameraScoreIsBetter(
  candidate: CameraCandidateScore,
  incumbent: CameraCandidateScore | null,
): boolean {
  if (candidate.placardBack || candidate.meanFacing > 90) return false;
  if (incumbent === null || incumbent.placardBack || incumbent.meanFacing > 90) return true;
  if (candidate.containedActors !== incumbent.containedActors) {
    return candidate.containedActors > incumbent.containedActors;
  }
  if (Math.abs(candidate.nearOcclusionFraction - incumbent.nearOcclusionFraction) > 1e-9) {
    return candidate.nearOcclusionFraction < incumbent.nearOcclusionFraction;
  }
  return candidate.minMargin > incumbent.minMargin + 0.01;
}

/** Previous selection rule, retained only as an explicit regression counterweight. */
export function legacyPrimaryOnlyScoreIsBetter(
  candidate: Pick<CameraCandidateScore, "containedActors" | "minMargin" | "meanFacing" | "placardBack">,
  incumbent: Pick<CameraCandidateScore, "containedActors" | "minMargin" | "meanFacing" | "placardBack"> | null,
): boolean {
  if (candidate.placardBack || candidate.containedActors === 0) return false;
  if (incumbent === null || incumbent.placardBack || incumbent.containedActors === 0) return true;
  if (candidate.meanFacing < incumbent.meanFacing - 4) return true;
  return Math.abs(candidate.meanFacing - incumbent.meanFacing) <= 4
    && candidate.minMargin > incumbent.minMargin + 0.01;
}

export const CAMERA_SCORE_IS_BETTER_BROWSER_SOURCE = String.raw`function (candidate, incumbent) {
  if (candidate.placardBack || candidate.meanFacing > 90) return false;
  if (incumbent === null || incumbent.placardBack || incumbent.meanFacing > 90) return true;
  if (candidate.n !== incumbent.n) return candidate.n > incumbent.n;
  if (Math.abs(candidate.nearOcclusion - incumbent.nearOcclusion) > 1e-9) return candidate.nearOcclusion < incumbent.nearOcclusion;
  return candidate.minMargin > incumbent.minMargin + 0.01;
}`;
