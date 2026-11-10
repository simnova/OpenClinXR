import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "@openclinxr/factory-station-core/runner";

export const ACTORS = [
  "mpfb-clinical-nurse-adult.glb",
  "mpfb-clinical-physician-adult.glb",
  "mpfb-family-partner-adult.glb",
  "mpfb-gown-adult-patient.glb",
  "mpfb-gown-ed-robert-hayes.glb",
  "mpfb-gown-inspect.glb",
  "mpfb-ob-patient-aisha.glb",
  "mpfb-peds-nurse-kevin.glb",
  "mpfb-peds-parent-aisha.glb",
  "mpfb-peds-patient-child.glb",
  "mpfb-street-adult-male.glb",
  "mpfb-viseme-inspect.glb",
] as const;

export const ROOT = repoRoot();
export const GLB_DIR = join(ROOT, "apps/ui-xr/public/generated-humanoids");
// The pre-follow lash every gate compares against: main just before the follow bake landed (59980e7f6).
// It is pinned because origin/main now carries the followed lashes, so an origin/main baseline compares
// the shipped lash with itself and G1/F1 fail on every fresh checkout. Repin only on a new lash bake.
export const BASELINE_REF = "a1944f7c219c124ad851d18c77195d50e4c528d0";
export const TRACKED_REPORT_PATH = join(
  ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eye-lash/shipped-lash-follow-report.json",
);
// A test run writes to a temp file; only OPENCLINXR_WRITE_LASH_REPORT=1 rewrites the tracked report.
export const REPORT_PATH = process.env["OPENCLINXR_WRITE_LASH_REPORT"] === "1"
  ? TRACKED_REPORT_PATH
  : join(tmpdir(), "openclinxr-shipped-lash-follow-report.json");
export const CLOSURE = { left: "eye-left-closure", right: "eye-right-closure" } as const;
export const MOVE_EPS_M = 1e-6;
export const WELD_TOLERANCE_M = 1e-6;
export const UP_AXIS = 1; // Raw glTF local coordinates are y-up.
export const PRESERVED_F4: Record<string, Partial<Record<Side, readonly number[]>>> = {
  "mpfb-clinical-physician-adult.glb": {
    left: [1, 8, 15, 16, 23, 25, 28, 32, 36, 52, 55, 58, 65, 78, 79, 81, 84, 92, 93, 94, 95, 107, 110, 114, 118, 121, 136, 142, 148, 156],
    right: [5, 6, 7, 17, 18, 21, 22, 26, 40, 41, 42, 43, 45, 47, 50, 70, 83, 89, 104, 115, 123, 131, 145, 154],
  },
  "mpfb-gown-adult-patient.glb": { right: [3, 4] },
  "mpfb-gown-ed-robert-hayes.glb": { right: [3, 4] },
  "mpfb-peds-nurse-kevin.glb": { right: [710] },
};
export type V3 = [number, number, number];
export type Side = keyof typeof CLOSURE;
export type Tri = [V3, V3, V3];
export type RegionTri = { tri: Tri; ids: [number, number, number]; triId: number; lid: "upper" | "lower" };
export type Card = { indices: number[]; points: V3[] };
export type Distribution = { p50: number; p90: number; max: number };
export type HullVertex = { vertexId: number; x: number; dyMm: number; source: "body" };
export type EnvelopeCard = {
  cardId: number;
  rootCentroidX: number;
  rootDyMm: number;
  marginDyMm: number | null;
  travelPct: number | null;
  sameDirection: boolean;
  noMarginReason?: string;
};
export type EnvelopeSummary = {
  hullVertexCount: number;
  hullVertices: HullVertex[];
  count: number;
  p10: number;
  p50: number;
  p90: number;
  under80: number[];
  over120: number[];
  noMargin: number[];
  sameDirection: boolean;
  cards: EnvelopeCard[];
};
export type F4Diagnostic = {
  cardId: number;
  nearestGeneralBodyTriId: number;
  closureMeanAbsDyMm: number;
  centroid: "above" | "below";
  distanceToRootBandMm: number;
  movement: "all" | "some" | "static";
};

export type SideMeasurement = {
  cardsBase: number;
  cardsKeep: number;
  keepRatio: number;
  upperCards: number;
  lowerCards: number;
  rawUpperCards: number;
  rawLowerCards: number;
  classChangedCardIds: number[];
  flaggedByClass: { upper: number[]; lower: number[] };
  flaggedOver4_55mmCount: number;
  flaggedOver4_55mmCardIds: number[];
  seatFollowMismatchCards: number[];
  snap: Distribution;
  g2RestOwnRegion: Distribution;
  g2RestGeneralBody: Distribution;
  g2ClosedOwnRegion: Distribution;
  g2ClosedGeneralBody: Distribution;
  cardsOver1mmRestOwnRegion: number;
  cardsOver1mmRestGeneralBody: number;
  cardsOver1mmClosedOwnRegion: number;
  cardsOver1mmClosedGeneralBody: number;
  lidMarginVerts: number;
  bodyPrimitiveCount: number;
  boundaryLoopCount: number;
  eyeOpeningLoopVerts: number;
  eyeOpeningLoopStatus: "ok" | "margin-below-minimum" | "no-eye-opening-loop";
  marginMode: "moving-upper-lid-upper-hull";
  horizontalAxis: V3;
  ownRegionTriCountR6: number;
  ownRegionTriCountR7: number;
  g1Upper: EnvelopeSummary;
  g1Lower: EnvelopeSummary;
  f4Diagnostic: F4Diagnostic[];
  f4DiagnosticSummary: Record<string, number>;
  g1TallyExcluded: boolean;
  g1Counterweight: {
    cardId: number;
    beforeTriId: number;
    afterTriId: number;
    beforeTravelPct: number;
    afterTravelPct: number;
    beforeUnder80: boolean;
    afterUnder80: boolean;
    movingVertexId: number;
    movingVertexDyMm: number;
    hullDyMm: number;
    seatRootVertexId: number;
    seatBarycentric: V3;
  } | null;
  eyeCentre: V3;
  lowerProofAabb: { min: V3; max: V3 };
  lashMeanDyMm: number;
  lidMarginMeanDyMm: number;
  lowerLashMeanDyMm: number;
  travelPct: number;
  sameDirection: boolean;
  targetPresent: boolean;
  nonMovingCards: number;
  eyeballInsideRest: number;
  eyeballInsideClosed: number;
  eyeballInsideMainRest: number;
  eyeballInsideMainClosed: number;
  r3NoNewPenetration: boolean;
  r3ByCard: Array<{ cardId: number; mainRest: number; mainClosed: number; patchedRest: number; patchedClosed: number }>;
  pass: boolean;
};

export type Mutation = "none" | "strip" | "double-left" | "double-right" | "brow-left" | "brow-right";

export type ActorMeasurement = {
  actor: string;
  inputSha256: string;
  lashMesh: string;
  bodyMesh: string;
  sides: Record<Side, SideMeasurement>;
  counterweights: { bodyMorphsByteEqual: boolean; nonLashMeshesHashEqual: boolean };
  mutationProof?: {
    kind: Exclude<Mutation, "none">;
    beforeSha256: string;
    afterSha256: string;
    beforeTargetMatches: number;
    afterTargetMatches: number;
    targetDeltaBeforeSha256?: string;
    targetDeltaAfterSha256?: string;
    browTriangleIds?: Partial<Record<Side, [number, number, number]>>;
  };
};

export const RED_QUADS: Record<string, { quads: number; quadsOver1mm: number; p50: number; p90: number; max: number }> = {
  "mpfb-clinical-nurse-adult.glb": { quads: 159, quadsOver1mm: 2, p50: 0.21, p90: 0.48, max: 2.96 },
  "mpfb-clinical-physician-adult.glb": { quads: 173, quadsOver1mm: 4, p50: 0.12, p90: 0.31, max: 4.49 },
  "mpfb-family-partner-adult.glb": { quads: 1045, quadsOver1mm: 79, p50: 0.17, p90: 0.52, max: 3.9 },
  "mpfb-gown-adult-patient.glb": { quads: 161, quadsOver1mm: 8, p50: 0.14, p90: 0.41, max: 4.55 },
  "mpfb-gown-ed-robert-hayes.glb": { quads: 161, quadsOver1mm: 8, p50: 0.14, p90: 0.41, max: 4.55 },
  "mpfb-gown-inspect.glb": { quads: 924, quadsOver1mm: 701, p50: 0.48, p90: 2.87, max: 3.74 },
  "mpfb-ob-patient-aisha.glb": { quads: 924, quadsOver1mm: 701, p50: 0.48, p90: 2.87, max: 3.74 },
  "mpfb-peds-nurse-kevin.glb": { quads: 924, quadsOver1mm: 814, p50: 0.46, p90: 3.13, max: 3.88 },
  "mpfb-peds-parent-aisha.glb": { quads: 924, quadsOver1mm: 712, p50: 0.19, p90: 2.71, max: 3.4 },
  "mpfb-peds-patient-child.glb": { quads: 924, quadsOver1mm: 662, p50: 0.33, p90: 2.07, max: 2.51 },
  "mpfb-street-adult-male.glb": { quads: 924, quadsOver1mm: 821, p50: 0.59, p90: 2.83, max: 3.31 },
  "mpfb-viseme-inspect.glb": { quads: 924, quadsOver1mm: 701, p50: 0.48, p90: 2.87, max: 3.74 },
};
