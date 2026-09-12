/**
 * Per-actor occlusion + containment of a station-environment capture.
 *
 * framesActors (actor-frame-metrics.ts) is a BAND PERCENTAGE: headFigurePct in
 * y 0.08..0.64. Two 2026-09-12 actor frames still pass it while a wall or door
 * fills the camera and a standing actor is sliced on the left edge.
 *
 * Measured 2026-09-12 on station-rooms-actors-2026-09-12/ native 1440×900,
 * 3D canvas x[0, 0.68) y[0.08, 0.88), step 2. Figure = chroma≥28, luma 25..230,
 * not purple furniture, not floor-accent green, not saturated door (R>G+40 and
 * R>B+40 and chroma>80). Standing blob = 4-connected figure component with
 * height>width×1.05 and height>18% of the canvas. Skin in the canvas head
 * band (y 0.08..0.50) inside that blob.
 *
 *   case                         cPlas%  cFig%  door%  largestStand  skin%  touchL
 *   adult_abdominal_pain_v1        59.13   0.00   0.15  n=9952          0.3  true   WALL+SLICE
 *   ed_chest_pain_priority_v1      27.93   6.14  26.20  n=1900         37.3  false  DOOR
 *   ed_chest_pain_priority_v2      27.86   6.27  25.93  n=1941         34.7  false  DOOR
 *   oncology_bad_news_family_v1     5.71   0.03   7.69  n=8548         63.4  false  next door%
 *   peds_asthma_parent_anxiety_v1  34.90  11.01   0.00  n=44203         9.4  false  known-good
 *   stepdown_sepsis_nurse_esc._v1   9.92  17.94   0.00  n=9296         26.1  false  known-good
 *
 * wallOccluded = centerPlasterPct > 45.43 AND centerFigPct < 2
 *   45.43 = sqrt(59.13 × 34.90) (adult wall vs peds known-good center plaster)
 * doorOccluded = doorPct > 14.19
 *   14.19 = sqrt(26.20 × 7.69) (ed_chest door vs oncology next-door occupancy)
 * standing contained = !touchL AND skinInHeadBandPct > 2.80
 *   2.80 = sqrt(0.3 × 26.1) (adult sliced crown vs stepdown known-good standing)
 *
 * framesClear = !wallOccluded && !doorOccluded && largest standing blob contained.
 * Recumbent (bed) blobs may touch the left edge — stepdown's patient does.
 * The HUD right edge is not a frame edge (UI overlay); named, not gated.
 *
 * four-edge (2026-09-12 #0): framesClear still gates LEFT only. framesWhole
 * requires the largest skinned standing blob (skinInHeadBandPct >
 * STANDING_SKIN_FLOOR) !touchLeft && !touchRight && !touchBottom &&
 * !touchTop. CLEAR after-frames: 11/15 anyStandingTouchBottom. Known-good
 * four-edge column is clinic / ob / primary_care / telehealth / ward.
 * peds_asthma is NOT known-good. Residual: adult_abdominal_pain_v1.
 */
import { decodePng } from "../decode-png.js";
import { ACTOR_CANVAS, ACTOR_CELLS_DIR_REL, ACTOR_KNOWN_GOOD_CASE_IDS } from "./actor-frame-metrics.js";

export const CLEAR_KNOWN_GOOD_CASE_IDS = ACTOR_KNOWN_GOOD_CASE_IDS;

export const WALL_OCCLUDED_CASE_ID = "adult_abdominal_pain_v1";
export const DOOR_OCCLUDED_CASE_IDS = [
  "ed_chest_pain_priority_v1",
  "ed_chest_pain_priority_v2",
] as const;

/** adult actor-2026-09-12 center plaster (binding wall). */
export const WALL_CENTER_PLASTER_MAX = 59.13;
/** peds known-good center plaster on the same instrument. */
export const KNOWN_GOOD_CENTER_PLASTER = 34.9;
/** sqrt(WALL_CENTER_PLASTER_MAX × KNOWN_GOOD_CENTER_PLASTER). */
export const WALL_CENTER_PLASTER_FLOOR = Math.sqrt(WALL_CENTER_PLASTER_MAX * KNOWN_GOOD_CENTER_PLASTER);
/** figure occupancy that still counts as "no one in the look centre". */
export const WALL_CENTER_FIG_CEILING = 2;

/** ed_chest_pain_priority_v1 door occupancy (binding door). */
export const DOOR_PCT_MAX = 26.2;
/** oncology, next-highest door occupancy in the same 15-station set. */
export const NEXT_DOOR_PCT = 7.69;
/** sqrt(DOOR_PCT_MAX × NEXT_DOOR_PCT). */
export const DOOR_PCT_CEILING = Math.sqrt(DOOR_PCT_MAX * NEXT_DOOR_PCT);

/** adult largest-standing crown-skin in the head band. */
export const SLICE_SKIN_MAX = 0.3;
/** stepdown known-good largest-standing crown-skin. */
export const KNOWN_GOOD_STANDING_SKIN_MIN = 26.1;
/** sqrt(SLICE_SKIN_MAX × KNOWN_GOOD_STANDING_SKIN_MIN). */
export const STANDING_SKIN_FLOOR = Math.sqrt(SLICE_SKIN_MAX * KNOWN_GOOD_STANDING_SKIN_MIN);

export const CLEAR_CELLS_DIR_REL =
  "docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12";
export const CLEAR_CONTACT_SHEET_REL =
  "docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-contact-sheet-2026-09-12.png";
export const CLEAR_REPORT_REL =
  "tools/openclinxr/evidence/station-capture/station-room-occlusion-and-containment-2026-09-12.md";
/** Actor-frame recapture this branch replaced; tree fba57fb9. */
export const BEFORE_CELLS_DIR_REL = ACTOR_CELLS_DIR_REL;
export const BEFORE_TREE_SHA = "fba57fb91a507295bdafa847be5c0858d65c2831";

export const WHOLE_CELLS_DIR_REL =
  "docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12";
export const WHOLE_CONTACT_SHEET_REL =
  "docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-contact-sheet-2026-09-12.png";
export const WHOLE_REPORT_REL =
  "tools/openclinxr/evidence/station-capture/station-room-four-edge-containment-2026-09-12.md";
export const WHOLE_KNOWN_GOOD_CASE_IDS = [
  "clinic_abdominal_pain_interpreter_v1",
  "ob_headache_preeclampsia_triage_v1",
  "primary_care_dyslipidemia_joint_pain_v1",
  "telehealth_diabetes_health_literacy_v1",
  "ward_delirium_med_rec_v1",
] as const;
/** CLEAR after-frame: largest standing touches right and bottom. */
export const WHOLE_NAMED_FAIL_CASE_ID = "peds_asthma_parent_anxiety_v1";

export { ACTOR_CELLS_DIR_REL };

const STEP = 2;
const HEAD_BAND = { top: 0.08, bottom: 0.5 } as const;

function chromaOf(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function isPurpleFurniture(r: number, g: number, b: number): boolean {
  return b >= r && b > g + 20 && chromaOf(r, g, b) > 35;
}

function isFloorGreenAccent(r: number, g: number, b: number, yNorm: number): boolean {
  if (yNorm < 0.78) return false;
  return g > r + 25 && g > b + 15 && chromaOf(r, g, b) > 28;
}

function isFloorSurface(r: number, g: number, b: number, lum: number): boolean {
  return chromaOf(r, g, b) < 22 && lum > 140;
}

function isSaturatedDoor(r: number, g: number, b: number): boolean {
  return chromaOf(r, g, b) > 80 && r > g + 40 && r > b + 40;
}

function isPlaster(r: number, g: number, b: number, lum: number): boolean {
  return chromaOf(r, g, b) < 28 && lum >= 140 && lum <= 210;
}

function isFigure(r: number, g: number, b: number, lum: number, yNorm: number): boolean {
  if (lum < 25 || lum > 230) return false;
  if (chromaOf(r, g, b) < 28) return false;
  if (isPurpleFurniture(r, g, b)) return false;
  if (isFloorGreenAccent(r, g, b, yNorm)) return false;
  if (isFloorSurface(r, g, b, lum)) return false;
  if (isSaturatedDoor(r, g, b)) return false;
  return true;
}

function isSkin(r: number, g: number, b: number, lum: number): boolean {
  if (lum < 50 || lum > 200) return false;
  if (chromaOf(r, g, b) > 70) return false;
  if (g > r + 20 && b > r) return false;
  if (isPurpleFurniture(r, g, b)) return false;
  return r > 60 && r >= g - 5;
}

export type StandingBlob = {
  samples: number;
  touchLeft: boolean;
  touchRight: boolean;
  touchBottom: boolean;
  touchTop: boolean;
  skinInHeadBandPct: number;
  crownY: number;
  contained: boolean;
  fourEdgeContained: boolean;
};

export type OcclusionContainmentMetrics = {
  samples: number;
  centerFigPct: number;
  centerPlasterPct: number;
  doorPct: number;
  wallOccluded: boolean;
  doorOccluded: boolean;
  unobstructed: boolean;
  standing: StandingBlob[];
  largestStandingContained: boolean;
  largestStandingTouchRight: boolean;
  largestStandingTouchBottom: boolean;
  largestStandingTouchTop: boolean;
  anyStandingTouchRight: boolean;
  anyStandingTouchBottom: boolean;
  anyStandingTouchTop: boolean;
  anyStandingTouchLeft: boolean;
  fourEdgeContained: boolean;
  framesClear: boolean;
  framesWhole: boolean;
};

export function measureOcclusionAndContainment(bytes: Uint8Array): OcclusionContainmentMetrics | null {
  const decoded = decodePng(bytes);
  if (!decoded) return null;
  const { w, h, r, g, b, lum } = decoded;
  const x0 = Math.max(0, Math.floor(ACTOR_CANVAS.left * w));
  const x1 = Math.min(w, Math.floor(ACTOR_CANVAS.right * w));
  const y0 = Math.max(0, Math.floor(ACTOR_CANVAS.top * h));
  const y1 = Math.min(h, Math.floor(ACTOR_CANVAS.bottom * h));
  const gw = Math.ceil((x1 - x0) / STEP);
  const gh = Math.ceil((y1 - y0) / STEP);
  if (gw < 4 || gh < 4) return null;
  const mask = new Uint8Array(gw * gh);
  const cx0 = Math.floor(gw * 0.3);
  const cx1 = Math.floor(gw * 0.7);
  const cy0 = Math.floor(gh * 0.2);
  const cy1 = Math.floor(gh * 0.8);
  let samples = 0;
  let door = 0;
  let centerN = 0;
  let centerFig = 0;
  let centerPlaster = 0;
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      const x = x0 + gx * STEP;
      const y = y0 + gy * STEP;
      const i = y * w + x;
      const R = r[i];
      const G = g[i];
      const B = b[i];
      const L = lum[i];
      if (R === undefined || G === undefined || B === undefined || L === undefined) continue;
      samples += 1;
      const yNorm = y / h;
      const figure = isFigure(R, G, B, L, yNorm);
      if (figure) mask[gy * gw + gx] = 1;
      else if (isSaturatedDoor(R, G, B)) door += 1;
      if (gx >= cx0 && gx < cx1 && gy >= cy0 && gy < cy1) {
        centerN += 1;
        if (figure) centerFig += 1;
        else if (isPlaster(R, G, B, L)) centerPlaster += 1;
      }
    }
  }
  if (samples === 0 || centerN === 0) return null;
  const seen = new Uint8Array(gw * gh);
  const standing: StandingBlob[] = [];
  const stack: number[] = [];
  const headGy0 = Math.floor((HEAD_BAND.top * h - y0) / STEP);
  const headGy1 = Math.floor((HEAD_BAND.bottom * h - y0) / STEP);
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || seen[start] === 1) continue;
    let n = 0;
    let minX = gw;
    let maxX = 0;
    let minY = gh;
    let maxY = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop();
      if (p === undefined) break;
      const gx = p % gw;
      const gy = (p / gw) | 0;
      n += 1;
      if (gx < minX) minX = gx;
      if (gx > maxX) maxX = gx;
      if (gy < minY) minY = gy;
      if (gy > maxY) maxY = gy;
      const neighbors = [p + 1, p - 1, p + gw, p - gw];
      for (const ni of neighbors) {
        if (ni < 0 || ni >= mask.length) continue;
        const nx = ni % gw;
        const ny = (ni / gw) | 0;
        if (Math.abs(nx - gx) + Math.abs(ny - gy) !== 1) continue;
        if (mask[ni] === 1 && seen[ni] !== 1) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    const bh = maxY - minY + 1;
    const isStanding = n >= 400 && bh > gh * 0.14;
    if (!isStanding) continue;
    let headN = 0;
    let skinN = 0;
    const gy0 = Math.max(minY, headGy0);
    const gy1 = Math.min(maxY, headGy1);
    for (let gy = gy0; gy <= gy1; gy += 1) {
      if (gy < 0 || gy >= gh) continue;
      for (let gx = minX; gx <= maxX; gx += 1) {
        if (mask[gy * gw + gx] !== 1) continue;
        headN += 1;
        const x = x0 + gx * STEP;
        const y = y0 + gy * STEP;
        const i = y * w + x;
        const R = r[i];
        const G = g[i];
        const B = b[i];
        const L = lum[i];
        if (R === undefined || G === undefined || B === undefined || L === undefined) continue;
        if (isSkin(R, G, B, L)) skinN += 1;
      }
    }
    const skinInHeadBandPct = headN === 0 ? 0 : (100 * skinN) / headN;
    const touchLeft = minX <= 1;
    const touchRight = maxX >= gw - 2;
    const touchBottom = maxY >= gh - 2;
    const touchTop = minY <= 1;
    const crownY = (y0 + minY * STEP) / h;
    const contained = !touchLeft;
    const fourEdgeContained = !touchLeft && !touchRight && !touchBottom && !touchTop;
    standing.push({
      samples: n,
      touchLeft,
      touchRight,
      touchBottom,
      touchTop,
      skinInHeadBandPct,
      crownY,
      contained,
      fourEdgeContained,
    });
  }
  standing.sort((left, right) => right.samples - left.samples);
  const centerFigPct = (100 * centerFig) / centerN;
  const centerPlasterPct = (100 * centerPlaster) / centerN;
  const doorPct = (100 * door) / samples;
  const wallOccluded = centerPlasterPct > WALL_CENTER_PLASTER_FLOOR && centerFigPct < WALL_CENTER_FIG_CEILING;
  const doorOccluded = doorPct > DOOR_PCT_CEILING;
  const unobstructed = !wallOccluded && !doorOccluded;
  const largest = standing[0];
  const largestStandingContained = largest?.contained === true;
  const largestStandingTouchRight = largest?.touchRight === true;
  const largestStandingTouchBottom = largest?.touchBottom === true;
  const largestStandingTouchTop = largest?.touchTop === true;
  const anyStandingTouchRight = standing.some((blob) => blob.touchRight);
  const anyStandingTouchBottom = standing.some((blob) => blob.touchBottom);
  const anyStandingTouchTop = standing.some((blob) => blob.touchTop);
  const anyStandingTouchLeft = standing.some((blob) => blob.touchLeft);
  const skinnedPrimary = standing.find((blob) => blob.skinInHeadBandPct > STANDING_SKIN_FLOOR);
  const fourEdgeContained = skinnedPrimary?.fourEdgeContained === true;
  return {
    samples,
    centerFigPct,
    centerPlasterPct,
    doorPct,
    wallOccluded,
    doorOccluded,
    unobstructed,
    standing,
    largestStandingContained,
    largestStandingTouchRight,
    largestStandingTouchBottom,
    largestStandingTouchTop,
    anyStandingTouchRight,
    anyStandingTouchBottom,
    anyStandingTouchTop,
    anyStandingTouchLeft,
    fourEdgeContained,
    framesClear: unobstructed && largestStandingContained,
    framesWhole: unobstructed && fourEdgeContained,
  };
}

export type ClearStationRow = {
  caseId: string;
  imageRel: string;
  environmentId: string;
  bytes: number;
  centerFigPct: number;
  centerPlasterPct: number;
  doorPct: number;
  wallOccluded: boolean;
  doorOccluded: boolean;
  unobstructed: boolean;
  standingCount: number;
  largestStandingSkinPct: number;
  largestStandingTouchLeft: boolean;
  largestStandingTouchRight: boolean;
  largestStandingTouchBottom: boolean;
  largestStandingTouchTop: boolean;
  anyStandingTouchRight: boolean;
  anyStandingTouchBottom: boolean;
  anyStandingTouchTop: boolean;
  anyStandingTouchLeft: boolean;
  largestStandingContained: boolean;
  fourEdgeContained: boolean;
  framesClear: boolean;
  framesWhole: boolean;
};

export function parseClearHeadline(body: string): number | null {
  const match = body.match(/^- cells: (\d+)$/m);
  if (!match) return null;
  return Number(match[1]);
}

function parseStationBlocks(body: string): ClearStationRow[] {
  const rows: ClearStationRow[] = [];
  const heading = /^### `([^`]+)`$/gm;
  const ids: Array<{ id: string; index: number }> = [];
  for (const match of body.matchAll(heading)) {
    const id = match[1];
    if (id === undefined || match.index === undefined) continue;
    ids.push({ id, index: match.index });
  }
  for (let i = 0; i < ids.length; i += 1) {
    const start = ids[i];
    if (start === undefined) continue;
    const end = ids[i + 1]?.index ?? body.length;
    const block = body.slice(start.index, end);
    const imageRel = block.match(/^- image: (.+)$/m)?.[1]?.trim() ?? "";
    const environmentId = block.match(/^- environmentId: (.+)$/m)?.[1]?.trim() ?? "";
    const bytes = Number(block.match(/^- bytes: (\d+)$/m)?.[1] ?? "NaN");
    const centerFigPct = Number(block.match(/^- centerFigPct: ([0-9.]+)$/m)?.[1] ?? "NaN");
    const centerPlasterPct = Number(block.match(/^- centerPlasterPct: ([0-9.]+)$/m)?.[1] ?? "NaN");
    const doorPct = Number(block.match(/^- doorPct: ([0-9.]+)$/m)?.[1] ?? "NaN");
    const wallOccluded = (block.match(/^- wallOccluded: (true|false)$/m)?.[1] ?? "") === "true";
    const doorOccluded = (block.match(/^- doorOccluded: (true|false)$/m)?.[1] ?? "") === "true";
    const unobstructed = (block.match(/^- unobstructed: (true|false)$/m)?.[1] ?? "") === "true";
    const standingCount = Number(block.match(/^- standingCount: (\d+)$/m)?.[1] ?? "NaN");
    const largestStandingSkinPct = Number(block.match(/^- largestStandingSkinPct: ([0-9.]+)$/m)?.[1] ?? "NaN");
    const largestStandingTouchLeft =
      (block.match(/^- largestStandingTouchLeft: (true|false)$/m)?.[1] ?? "") === "true";
    const largestStandingTouchRight =
      (block.match(/^- largestStandingTouchRight: (true|false)$/m)?.[1] ?? "") === "true";
    const largestStandingTouchBottom =
      (block.match(/^- largestStandingTouchBottom: (true|false)$/m)?.[1] ?? "") === "true";
    const largestStandingTouchTop =
      (block.match(/^- largestStandingTouchTop: (true|false)$/m)?.[1] ?? "") === "true";
    const anyStandingTouchRight =
      (block.match(/^- anyStandingTouchRight: (true|false)$/m)?.[1] ?? "") === "true";
    const anyStandingTouchBottom =
      (block.match(/^- anyStandingTouchBottom: (true|false)$/m)?.[1] ?? "") === "true";
    const anyStandingTouchTop =
      (block.match(/^- anyStandingTouchTop: (true|false)$/m)?.[1] ?? "") === "true";
    const anyStandingTouchLeft =
      (block.match(/^- anyStandingTouchLeft: (true|false)$/m)?.[1] ?? "") === "true";
    const largestStandingContained =
      (block.match(/^- largestStandingContained: (true|false)$/m)?.[1] ?? "") === "true";
    const fourEdgeContained =
      (block.match(/^- fourEdgeContained: (true|false)$/m)?.[1] ?? "") === "true";
    const framesClear = (block.match(/^- framesClear: (true|false)$/m)?.[1] ?? "") === "true";
    const framesWhole = (block.match(/^- framesWhole: (true|false)$/m)?.[1] ?? "") === "true";
    rows.push({
      caseId: start.id,
      imageRel,
      environmentId,
      bytes,
      centerFigPct,
      centerPlasterPct,
      doorPct,
      wallOccluded,
      doorOccluded,
      unobstructed,
      standingCount,
      largestStandingSkinPct,
      largestStandingTouchLeft,
      largestStandingTouchRight,
      largestStandingTouchBottom,
      largestStandingTouchTop,
      anyStandingTouchRight,
      anyStandingTouchBottom,
      anyStandingTouchTop,
      anyStandingTouchLeft,
      largestStandingContained,
      fourEdgeContained,
      framesClear,
      framesWhole,
    });
  }
  return rows;
}

/** After-state rows under `## Stations`. */
export function parseClearStations(body: string): ClearStationRow[] {
  const start = body.search(/^## Stations\s*$/m);
  if (start < 0) return parseStationBlocks(body);
  const end = body.slice(start + 1).search(/^## /m);
  const section = end < 0 ? body.slice(start) : body.slice(start, start + 1 + end);
  return parseStationBlocks(section);
}

/** Before-state rows under `## Before`. */
export function parseBeforeStations(body: string): ClearStationRow[] {
  const start = body.search(/^## Before\b/m);
  if (start < 0) return [];
  const end = body.slice(start + 1).search(/^## /m);
  const section = end < 0 ? body.slice(start) : body.slice(start, start + 1 + end);
  return parseStationBlocks(section);
}
