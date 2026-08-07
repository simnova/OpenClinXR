/**
 * Assembled-scene composition checks for #72 / #105.
 *
 * Isolated humanoid probes cannot see floor + actor together. These helpers
 * assess world-space foot height against the station floor and report
 * runtime-bundle / selected-scenario mismatches without silent composition.
 *
 * Floor top is y=0 in every station (station-environment parametric box).
 * #105 band is deliberately wide: float ≤0.15 m, sink ≥ -0.05 m — a floor,
 * not a design target. Seated actors are inside the band when feet plant
 * (#87 telehealth patient lowestVertexY≈0.056) and need no carve-out.
 */

/** Parametric floor top in every station shell. */
export const FLOOR_TOP_Y_METERS = 0;
/** #105: clear air under feet above this is a float violation. */
export const MAX_FLOAT_METERS = 0.15;
/** #72 / #105: burial below this is a sink violation. */
export const MAX_SINK_METERS = -0.05;

export type ActorFloorSample = {
  actorId: string;
  lowestMeshWorldY: number;
  /**
   * Declared posture is recorded for diagnosis; #105 measures all postures
   * against the same floor band (seated feet still touch the floor).
   */
  posture?: string;
};

export type AssessActorFloorCompositionInput = {
  actors: readonly ActorFloorSample[];
  floorTopY: number;
  /**
   * Legacy symmetric tolerance (default 0.12). Prefer maxFloatMeters /
   * maxSinkMeters for the #105 asymmetric band when both are set.
   */
  toleranceMeters?: number;
  maxFloatMeters?: number;
  maxSinkMeters?: number;
};

export type AssessActorFloorCompositionResult = {
  ok: boolean;
  violations: string[];
};

/**
 * Live diagnosis (#72): telehealth actors with feet-near-origin GLBs were
 * placed with the ED-era pairing (slot y≈1.0 + verticalOffset≈-0.95). Clean
 * encounter framing rewrites slot y to 0 while leaving the offset, so the
 * figure sinks ~0.85–0.97 m (lowest mesh world Y measured ≈ -0.87).
 *
 * When the slot is already floor-standing (|y| small), drop large negative
 * offsets that only made sense when the slot sat near humanoid mid-height.
 *
 * #105: elevated slots that still carry those ED mid-body offsets AND a
 * sub-unity scale (OB patient: slot y=0.58, scale≈0.42, offset≈-0.98) leave
 * feet above the float band — scale shrinks the offset so it no longer cancels
 * the slot height. Re-solve offset so feet-near-origin origins land near y=0:
 *   slotY + offset * scaleY ≈ 0  →  offset = -slotY / scaleY
 */
export function resolveEffectiveVerticalOffsetMeters(input: {
  slotLocalY: number;
  verticalOffsetMeters: number;
  /** Slot scale Y when non-uniform (default 1). */
  slotScaleY?: number;
}): number {
  const { slotLocalY, verticalOffsetMeters } = input;
  const scaleY = input.slotScaleY ?? 1;
  if (Math.abs(slotLocalY) < 0.2 && verticalOffsetMeters < -0.25) {
    return 0;
  }
  if (
    Math.abs(slotLocalY) >= 0.2
    && verticalOffsetMeters < -0.25
    && Math.abs(scaleY) > 1e-6
    && Math.abs(scaleY) < 0.85
  ) {
    return -slotLocalY / scaleY;
  }
  return verticalOffsetMeters;
}

export type FloorBandPlantInput = {
  humanoidLocalY: number;
  /** Live lowest skinned/mesh vertex world Y after the humanoid is parented. */
  lowestMeshWorldY: number;
  /**
   * Parent slot world scale Y (local humanoid Δy maps to world as Δy * scaleY).
   * Use 1 when the slot is unscaled.
   */
  parentWorldScaleY: number;
  floorTopY?: number;
  maxFloatMeters?: number;
  maxSinkMeters?: number;
  /** Residual clearance after plant (default 0.02 m — inside the band). */
  plantClearanceMeters?: number;
};

export type FloorBandPlantResult = {
  localY: number;
  planted: boolean;
  reason?: "float" | "sink";
  previousLowestMeshWorldY: number;
  targetLowestMeshWorldY: number;
};

/**
 * #105: only correct figures that sit outside the floor band. In-band actors
 * (including seated telehealth at ~0.06–0.12) are left alone so the plant
 * does not become a design target or break chair contact.
 */
export function resolveFloorBandPlantLocalY(input: FloorBandPlantInput): FloorBandPlantResult {
  const floorTopY = input.floorTopY ?? FLOOR_TOP_Y_METERS;
  const maxFloat = input.maxFloatMeters ?? MAX_FLOAT_METERS;
  const maxSink = input.maxSinkMeters ?? MAX_SINK_METERS;
  const clearance = input.plantClearanceMeters ?? 0.02;
  const y0 = input.lowestMeshWorldY;
  const scaleY = Math.abs(input.parentWorldScaleY) < 1e-6 ? 1 : input.parentWorldScaleY;
  const target = floorTopY + clearance;

  if (y0 <= maxFloat && y0 >= maxSink) {
    return {
      localY: input.humanoidLocalY,
      planted: false,
      previousLowestMeshWorldY: y0,
      targetLowestMeshWorldY: y0,
    };
  }

  const reason: "float" | "sink" = y0 > maxFloat ? "float" : "sink";
  return {
    localY: input.humanoidLocalY + (target - y0) / scaleY,
    planted: true,
    reason,
    previousLowestMeshWorldY: y0,
    targetLowestMeshWorldY: target,
  };
}

/**
 * Lowest mesh vertex must sit inside the floor band (float/sink). Default
 * keeps the legacy symmetric tolerance for #72 unit fixtures; pass
 * maxFloatMeters/maxSinkMeters for the #105 asymmetric band.
 */
export function assessActorFloorComposition(
  input: AssessActorFloorCompositionInput,
): AssessActorFloorCompositionResult {
  const violations: string[] = [];
  const useAsymmetric =
    typeof input.maxFloatMeters === "number" || typeof input.maxSinkMeters === "number";
  const maxFloat = input.maxFloatMeters ?? MAX_FLOAT_METERS;
  const maxSink = input.maxSinkMeters ?? MAX_SINK_METERS;
  const tolerance = input.toleranceMeters ?? 0.12;

  for (const actor of input.actors) {
    const y0 = actor.lowestMeshWorldY;
    if (useAsymmetric) {
      if (y0 > input.floorTopY + maxFloat || y0 < input.floorTopY + maxSink) {
        violations.push(
          `${actor.actorId}: lowest mesh y=${y0.toFixed(3)} `
            + `floorTopY=${input.floorTopY.toFixed(3)} outside band `
            + `[${(input.floorTopY + maxSink).toFixed(3)}, ${(input.floorTopY + maxFloat).toFixed(3)}]`,
        );
      }
      continue;
    }
    const delta = Math.abs(y0 - input.floorTopY);
    if (delta > tolerance) {
      violations.push(
        `${actor.actorId}: lowest mesh y=${y0.toFixed(3)} `
          + `floorTopY=${input.floorTopY.toFixed(3)} delta=${delta.toFixed(3)}m `
          + `exceeds standing tolerance ${tolerance}m`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

export type RuntimeBundleScenarioMatch = {
  matches: boolean;
  reason?: string;
};

/**
 * Report when the loaded runtime bundle belongs to a different scenario than
 * the one the learner selected — the #57 silence one layer down (roster/assets).
 */
export function describeRuntimeBundleScenarioMatch(input: {
  selectedScenarioId: string;
  bundleScenarioId: string;
}): RuntimeBundleScenarioMatch {
  if (input.selectedScenarioId === input.bundleScenarioId) {
    return { matches: true };
  }
  return {
    matches: false,
    reason:
      `runtime bundle scenario "${input.bundleScenarioId}" does not match `
      + `selected scenario "${input.selectedScenarioId}"`,
  };
}
