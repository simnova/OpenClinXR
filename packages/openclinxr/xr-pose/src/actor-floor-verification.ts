/** Private verification of assembled actor/floor measurements; absent from production entrypoints. */
import { MAX_FLOAT_METERS, MAX_SINK_METERS } from "./actor-floor-composition-mod.js";

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
