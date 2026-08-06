/**
 * Assembled-scene composition checks for #72.
 *
 * Isolated humanoid probes cannot see floor + actor together. These helpers
 * assess world-space foot height against the station floor and report
 * runtime-bundle / selected-scenario mismatches without silent composition.
 */

export type ActorFloorSample = {
  actorId: string;
  lowestMeshWorldY: number;
  /**
   * Standing is the default. Seated / supine / lying skip the standing floor
   * check — there is no posture system yet; do not invent one here.
   */
  posture?: string;
};

export type AssessActorFloorCompositionInput = {
  actors: readonly ActorFloorSample[];
  floorTopY: number;
  /** Default 0.12 m — a few centimetres of mesh/bind-pose slack. */
  toleranceMeters?: number;
};

export type AssessActorFloorCompositionResult = {
  ok: boolean;
  violations: string[];
};

const STANDING_POSTURES = new Set(["", "standing", "stand", "upright"]);

/**
 * Live diagnosis (#72): telehealth actors with feet-near-origin GLBs were
 * placed with the ED-era pairing (slot y≈1.0 + verticalOffset≈-0.95). Clean
 * encounter framing rewrites slot y to 0 while leaving the offset, so the
 * figure sinks ~0.85–0.97 m (lowest mesh world Y measured ≈ -0.87).
 *
 * When the slot is already floor-standing (|y| small), drop large negative
 * offsets that only made sense when the slot sat near humanoid mid-height.
 */
export function resolveEffectiveVerticalOffsetMeters(input: {
  slotLocalY: number;
  verticalOffsetMeters: number;
}): number {
  const { slotLocalY, verticalOffsetMeters } = input;
  if (Math.abs(slotLocalY) < 0.2 && verticalOffsetMeters < -0.25) {
    return 0;
  }
  return verticalOffsetMeters;
}

/**
 * Standing actors: lowest skinned-mesh vertex must sit within tolerance of the
 * station floor top. Non-standing postures are skipped (posture trap — do not
 * force "feet on floor" for stretcher/chair placements).
 */
export function assessActorFloorComposition(
  input: AssessActorFloorCompositionInput,
): AssessActorFloorCompositionResult {
  const tolerance = input.toleranceMeters ?? 0.12;
  const violations: string[] = [];

  for (const actor of input.actors) {
    const posture = (actor.posture ?? "standing").trim().toLowerCase();
    if (!STANDING_POSTURES.has(posture)) {
      continue;
    }
    const delta = Math.abs(actor.lowestMeshWorldY - input.floorTopY);
    if (delta > tolerance) {
      violations.push(
        `${actor.actorId}: lowest mesh y=${actor.lowestMeshWorldY.toFixed(3)} `
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
