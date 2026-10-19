/**
 * Whole-face regression module (card tsk_0e618fa5e9ac3e15). STUB: STEP 2 RED
 * commits the contract before the implementation lands in STEP 3.
 */
export type Landmark = [number, number];

export const REGION_LANDMARKS: Record<string, number[]> = {};

export function buildRegionPolygons(_landmarks: Landmark[]): Record<string, Landmark[]> {
  throw new Error("face-regression: buildRegionPolygons not implemented (STEP 3)");
}

export function measureRegions(_input: {
  goldenPng: string;
  currentPng: string;
  goldenLandmarks: Landmark[];
  currentLandmarks?: Landmark[];
  regions?: string[];
}): Array<{ region: string; dE: number; ssimL: number; landmarkDispPx: number; pixels: number }> {
  throw new Error("face-regression: measureRegions not implemented (STEP 3)");
}

export function evaluateFaceRegression(_input: {
  metrics: Array<{ region: string; dE: number; ssimL: number; landmarkDispPx: number; pixels: number }>;
  thresholds: Record<string, { dE: number; ssimL: number }>;
  declared?: string[];
}): {
  ok: boolean;
  failed: string[];
  regions: Array<{ region: string; dE: number; ssimL: number; landmarkDispPx: number; pixels: number; declared: boolean; pass: boolean }>;
} {
  throw new Error("face-regression: evaluateFaceRegression not implemented (STEP 3)");
}

export function promoteGolden(_input: {
  goldenRoot: string;
  version: string;
  approvedBy: string;
  from: string;
  cases: Record<string, Record<string, string>>;
  planted?: boolean;
}): { ok: boolean; versionDir?: string; reason?: string } {
  throw new Error("face-regression: promoteGolden not implemented (STEP 3)");
}

export function verifyInputShas(_input: {
  inputs: Array<{ path: string; sha256: string }>;
  hashFile: (p: string) => string;
}): { ok: boolean; mismatches: Array<{ path: string; expected: string; actual: string }>; missing: string[] } {
  throw new Error("face-regression: verifyInputShas not implemented (STEP 3)");
}

export function resolveCaseRun(_input: {
  caseId: string;
  caseIds: string[];
  runReport: { cases: Record<string, { runs: Record<string, { status: string }> }> };
}): { status: string; caseId: string; reason: string } {
  throw new Error("face-regression: resolveCaseRun not implemented (STEP 3)");
}
