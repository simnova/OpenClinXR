import type { GateReading } from "../evidence/station-capture/gate-geometry.js";

export type LayoutQualityScore = {
  score: number;
  gatePass: boolean;
  components: {
    containment: number;
    visibility: number;
    facing: number;
    nearOcclusion: number;
  };
};

function bounded(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Scores the runtime gate on a 100-point scale. Actor containment and readable
 * crown/chest visibility carry 40 points each. Facing and near-camera
 * occlusion carry 10 points each and receive full credit at the existing gate
 * thresholds (<=90 degrees and <=10%).
 */
export function scoreLayoutGate(gate: GateReading): LayoutQualityScore {
  const denominator = Math.max(1, gate.totalActors);
  const containment = 40 * bounded(gate.containedActors / denominator);
  const visibility = 40 * bounded(gate.visibleActors / denominator);
  const facing = 10 * bounded((180 - gate.meanFacingDeg) / 90);
  const nearOcclusion = 10 * bounded((0.2 - gate.nearOcclusionFraction) / 0.1);
  const components = { containment, visibility, facing, nearOcclusion };
  return {
    score: Number(Object.values(components).reduce((sum, value) => sum + value, 0).toFixed(2)),
    gatePass: gate.gatePass,
    components: {
      containment: Number(containment.toFixed(2)),
      visibility: Number(visibility.toFixed(2)),
      facing: Number(facing.toFixed(2)),
      nearOcclusion: Number(nearOcclusion.toFixed(2)),
    },
  };
}
