/**
 * Threshold design: per region and metric, threshold = max(noise, floor).
 *
 *   noise = the max delta between two from-scratch renders of identical inputs
 *           (the check must not call a re-render a regression);
 *   floor = the metric computed between the golden and the golden perturbed by
 *           one 8-bit code value in every channel, with the stated seed
 *           (the check must not call sub-code-value quantisation a regression).
 *
 * No threshold is a typed literal. Each is derived at calibration time from
 * the measurements recorded beside it, and the report cites that measurement.
 * `dE` is an upper bound (lower is better); `ssimL` is a floor expressed as an
 * allowed drop, so the model is stored as { maxDE, minSsimL }.
 */
export type MetricThreshold = { maxDE: number; minSsimL: number; source: string };

export type Calibration = {
  status: string;
  perturbation: string;
  seed: number;
  regions: Record<string, {
    dE: { noise: number; floor: number; source: string };
    ssimL: { noiseDrop: number; floorDrop: number; source: string };
  }>;
};

export function deriveMaxDE(noise: number, floor: number): number {
  return Math.max(noise, floor);
}

export function deriveMinSsimL(noiseDrop: number, floorDrop: number): number {
  return 1 - Math.max(noiseDrop, floorDrop);
}

export function thresholdsFromCalibration(cal: Calibration): Record<string, MetricThreshold> {
  const out: Record<string, MetricThreshold> = {};
  for (const [region, m] of Object.entries(cal.regions)) {
    out[region] = {
      maxDE: deriveMaxDE(m.dE.noise, m.dE.floor),
      minSsimL: deriveMinSsimL(m.ssimL.noiseDrop, m.ssimL.floorDrop),
      source: `dE max(max noise ${m.dE.noise}, floor ${m.dE.floor}) [${m.dE.source}]; ssimL 1-max(noiseDrop ${m.ssimL.noiseDrop}, floorDrop ${m.ssimL.floorDrop}) [${m.ssimL.source}]`,
    };
  }
  return out;
}
