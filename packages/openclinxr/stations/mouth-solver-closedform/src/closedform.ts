/**
 * Pure closed-form kernels moved out of the producer
 * (tools/openclinxr/asset-pipeline/makeclothes/seat-teeth-on-lip-rim.ts).
 *
 * Only the GLB-free math moves: fixed-point steps, falloff weights and stop
 * rules, copied formula-for-formula so producer bytes are unchanged. Skinning,
 * headless posing and accessor writes stay in the producer. Units are metres
 * unless the name says Mm, matching the producer.
 */

/** Rest-offset fixed-point step: shift the lower arch by gap minus target [ref:seat-teeth-on-lip-rim.ts:840-849]. */
export function rimSeatStepM(restGapM: number, targetM: number): number {
  return restGapM - targetM;
}

/** Rest-offset stop: the fixed point holds within the producer tolerance [ref:seat-teeth-on-lip-rim.ts:74]. */
export function rimSeatSettledM(restGapM: number, targetM: number): boolean {
  return Math.abs(restGapM - targetM) <= 1e-4;
}

/** Face-crossing test: a tooth vertex ahead of the clearance plane moves [ref:seat-teeth-on-lip-rim.ts:871-879]. */
export function isFaceCrossing(bindZM: number, planeZM: number): boolean {
  return bindZM - planeZM > 1e-6;
}

/**
 * Quadratic pullback drop for one crossing vertex: the square of its own
 * excess over the plane divided by the pass maximum excess [ref:seat-teeth-on-lip-rim.ts:880-888].
 */
export function quadraticPullbackDropM(excessM: number, excessMaxM: number): number {
  return (excessM * excessM) / excessMaxM;
}

/** Pullback stop: the residual max is at or below float32-safe nothing [ref:seat-teeth-on-lip-rim.ts:874]. */
export function pullbackSettledM(excessMaxM: number): boolean {
  return excessMaxM <= 1e-6;
}

/** Rest drop applies exactly when the knob is non-zero; zero is a no-op [ref:seat-teeth-on-lip-rim.ts:905]. */
export function restDropApplies(restDropMm: number): boolean {
  return restDropMm !== 0;
}

/** Press falloff weight over BFS hop-rings: cosine C1 from 1 to 0 [ref:seat-teeth-on-lip-rim.ts:618]. */
export function pressRingWeight(hop: number, rings: number): number {
  return 0.5 * (1 + Math.cos((Math.PI * hop) / rings));
}

/**
 * Committed press-ring count: smallest of the rung-3 set whose predicted peak
 * adjacent jump clears the internal budget [ref:seat-teeth-on-lip-rim.ts:603-610].
 */
export function selectPressRings(gapM: number): number {
  for (const candidate of [8, 10, 12]) {
    if ((gapM * Math.PI) / (2 * candidate) <= 3.0 / 1000) return candidate;
  }
  return 12;
}

/** Press accept band: the fixed point lands inside the contact gate [ref:seat-teeth-on-lip-rim.ts:86-89]. */
export function pressGapAcceptedM(gapM: number): boolean {
  return gapM >= 0.00015 && gapM <= 0.00035;
}
