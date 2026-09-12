/**
 * Head-to-foot occupancy of a station-environment capture.
 *
 * The 3D canvas is the left ~68% of the 1440×900 screenshot. The defect is SHAPE:
 * oncology_bad_news_family_v1's interior-2026-09-12 frame photographs a doorway-side
 * actor from the shin down (pink trousers + shoes, no head), because reframeCameraForRoom
 * set eyeY = actors.max[1] (crown height) from a close +Z candidate.
 *
 * Measured 2026-09-12 on station-rooms-interior-2026-09-12/ native 1440×900 PNGs,
 * 3D region x[0, 0.68) y[0.08, 0.88), step 2. Figure = chroma≥28, luma 25..230,
 * not purple furniture (B>G+20 and B≥R, the oncology chair) and not the green
 * floor-accent strip (G>R+25 and G>B+15). Floor = chroma<22 and luma>140, or
 * that green accent.
 *
 *   case                                      headFig%
 *   oncology_bad_news_family_v1                  1.91     SHIN-CROP (no heads)
 *   clinic_abdominal_pain_interpreter_v1         9.11     next full-body interior
 *   stepdown_sepsis_nurse_escalation_v1         14.91     known-good (named)
 *   peds_asthma_parent_anxiety_v1               24.45     known-good (named)
 *
 * head floor = geometric midpoint of crop 1.91 vs next full-body 9.11
 *   = sqrt(1.91 × 9.11) = 4.17. Equal-ratio gap; not fitted to a recapture.
 * Named known-good sit well above the floor. A far full-room frame (clinic) is
 * the binding interior, not the close-nurse peds/stepdown pair.
 * Floor occupancy is reported, not gated: the crop frame is 94% floor (looking
 * down at shins), so a floor floor would invert the defect. Interior-wall
 * occupancy stays on measureInteriorCenter; this instrument asks whether heads
 * occupy the upper canvas.
 *
 * Live values are re-read from the PNGs. The vacuity guard refuses a restated 15.
 */
import { decodePng } from "../decode-png.js";
import { INTERIOR_CELLS_DIR_REL } from "./interior-frame-metrics.js";

/** Left 68% is the 3D canvas; the Pre-Encounter board starts ~x=1020 of 1440. */
export const ACTOR_CANVAS = {
  left: 0,
  right: 0.68,
  top: 0.08,
  bottom: 0.88,
} as const;

/** Upper 70% of the 3D canvas — a full-room frame puts heads mid-canvas, a shin-crop does not. */
export const HEAD_BAND = { top: 0.08, bottom: 0.64 } as const;
/** Bottom 12% of the 3D canvas, above the HUD — floor, not shins. */
export const FLOOR_BAND = { top: 0.784, bottom: 0.88 } as const;

export const ACTOR_KNOWN_GOOD_CASE_IDS = [
  "peds_asthma_parent_anxiety_v1",
  "stepdown_sepsis_nurse_escalation_v1",
] as const;

export const ACTOR_CROP_CASE_ID = "oncology_bad_news_family_v1";

/** oncology interior-2026-09-12 head-band figure occupancy (binding crop, band y 0.08..0.64). */
export const CROP_HEAD_FIGURE_MAX = 1.91;
/** clinic interior-2026-09-12, next-lowest full-body interior occupancy on the same band. */
export const NEXT_FULL_BODY_HEAD_FIGURE_MIN = 9.11;
/** sqrt(CROP_HEAD_FIGURE_MAX × NEXT_FULL_BODY_HEAD_FIGURE_MIN). */
export const HEAD_FIGURE_FLOOR = Math.sqrt(CROP_HEAD_FIGURE_MAX * NEXT_FULL_BODY_HEAD_FIGURE_MIN);
/** stepdown interior-2026-09-12, lower named known-good occupancy on the same band. */
export const KNOWN_GOOD_HEAD_FIGURE_MIN = 14.91;

export const ACTOR_CELLS_DIR_REL =
  "docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12";
export const ACTOR_CONTACT_SHEET_REL =
  "docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-contact-sheet-2026-09-12.png";
export const ACTOR_FRAMING_REPORT_REL =
  "tools/openclinxr/evidence/station-capture/station-room-actor-framing-2026-09-12.md";

export { INTERIOR_CELLS_DIR_REL };

export type ActorFrameMetrics = {
  samples: number;
  headFigurePct: number;
  floorFloorPct: number;
  bottomFigurePct: number;
  framesActors: boolean;
};

function chromaOf(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function isPurpleFurniture(r: number, g: number, b: number): boolean {
  return b >= r && b > g + 20 && chromaOf(r, g, b) > 35;
}

/** Clinic/stepdown floor accent strip — saturated green, not a person. */
function isGreenAccent(r: number, g: number, b: number): boolean {
  return g > r + 25 && g > b + 15 && chromaOf(r, g, b) > 28;
}

function isFloorSurface(r: number, g: number, b: number, lum: number): boolean {
  return chromaOf(r, g, b) < 22 && lum > 140;
}

function isFigure(r: number, g: number, b: number, lum: number): boolean {
  if (lum < 25 || lum > 230) return false;
  if (chromaOf(r, g, b) < 28) return false;
  if (isPurpleFurniture(r, g, b)) return false;
  if (isGreenAccent(r, g, b)) return false;
  if (isFloorSurface(r, g, b, lum)) return false;
  return true;
}

function bandStats(
  decoded: NonNullable<ReturnType<typeof decodePng>>,
  band: { top: number; bottom: number },
): { samples: number; figure: number; floor: number } {
  const { w, h, lum, r, g, b } = decoded;
  const x0 = Math.max(0, Math.floor(ACTOR_CANVAS.left * w));
  const x1 = Math.min(w, Math.floor(ACTOR_CANVAS.right * w));
  const y0 = Math.max(0, Math.floor(band.top * h));
  const y1 = Math.min(h, Math.floor(band.bottom * h));
  const step = 2;
  let samples = 0;
  let figure = 0;
  let floor = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = y * w + x;
      const R = r[i];
      const G = g[i];
      const B = b[i];
      const L = lum[i];
      if (R === undefined || G === undefined || B === undefined || L === undefined) continue;
      samples += 1;
      if (isFigure(R, G, B, L)) figure += 1;
      else if (isFloorSurface(R, G, B, L) || isGreenAccent(R, G, B)) floor += 1;
    }
  }
  return { samples, figure, floor };
}

export function measureActorFrame(bytes: Uint8Array): ActorFrameMetrics | null {
  const decoded = decodePng(bytes);
  if (!decoded) return null;
  const head = bandStats(decoded, HEAD_BAND);
  const floor = bandStats(decoded, FLOOR_BAND);
  if (head.samples === 0 || floor.samples === 0) return null;
  const headFigurePct = (100 * head.figure) / head.samples;
  const floorFloorPct = (100 * floor.floor) / floor.samples;
  const bottomFigurePct = (100 * floor.figure) / floor.samples;
  return {
    samples: head.samples + floor.samples,
    headFigurePct,
    floorFloorPct,
    bottomFigurePct,
    framesActors: headFigurePct > HEAD_FIGURE_FLOOR,
  };
}

export type ActorFramingStationRow = {
  caseId: string;
  imageRel: string;
  environmentId: string;
  bytes: number;
  headFigurePct: number;
  floorFloorPct: number;
  bottomFigurePct: number;
  framesActors: boolean;
};

export function parseActorFramingHeadline(body: string): number | null {
  const match = body.match(/^- cells: (\d+)$/m);
  if (!match) return null;
  return Number(match[1]);
}

export function parseActorFramingStations(body: string): ActorFramingStationRow[] {
  const rows: ActorFramingStationRow[] = [];
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
    const headFigurePct = Number(block.match(/^- headFigurePct: ([0-9.]+)$/m)?.[1] ?? "NaN");
    const floorFloorPct = Number(block.match(/^- floorFloorPct: ([0-9.]+)$/m)?.[1] ?? "NaN");
    const bottomFigurePct = Number(block.match(/^- bottomFigurePct: ([0-9.]+)$/m)?.[1] ?? "NaN");
    const framesActors = (block.match(/^- framesActors: (true|false)$/m)?.[1] ?? "") === "true";
    rows.push({
      caseId: start.id,
      imageRel,
      environmentId,
      bytes,
      headFigurePct,
      floorFloorPct,
      bottomFigurePct,
      framesActors,
    });
  }
  return rows;
}
