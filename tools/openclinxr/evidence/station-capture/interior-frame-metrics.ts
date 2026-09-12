/**
 * Center-viewport occupancy of a station-environment capture.
 *
 * The 3D canvas is the left ~68% of the 1440×900 screenshot. The Pre-Encounter
 * board sits on the left of that canvas in every doorway-side frame, so a
 * full-viewport luminance sd cannot tell a wall from a room (peds_asthma
 * full-viewport sd 37.4 vs known-good ward 61.7). The landmark is the CENTER
 * of the canvas, where an interior frame shows furniture/actors and a
 * doorway-wall frame shows plaster.
 *
 * Measured 2026-09-12 on station-rooms-2026-09-12/ native 1440×900 PNGs,
 * region {left:0.22, top:0.12, width:0.44, height:0.70}, step 2, Rec.601 luma
 * via decodePng:
 *
 *   case                                      sd    beige%   edge%
 *   peds_asthma_parent_anxiety_v1            7.4    100.0     0.0   WALL
 *   stepdown_sepsis_nurse_escalation_v1     24.5     93.0     0.6   WALL
 *   ob_headache_preeclampsia_triage_v1      44.9      5.9     1.6   interior
 *   peds_fever_v1                           56.8     47.1     5.2   interior
 *   postop_fever_consult_pressure_v1        63.6     29.8     8.2   known-good
 *   ward_delirium_med_rec_v1                60.7     43.6     5.8   known-good
 *
 * sd floor = geometric midpoint of the binding pair (wall max 24.5 vs next
 * interior 44.9) = sqrt(24.5 × 44.9) = 33.17. Equal-ratio gap; not fitted to
 * clear the observation.
 *
 * beige ceiling = arithmetic midpoint of wall min 93.0 and the highest
 * interior beige 47.1 (peds_fever) = 70.05. Counterweight: a noisy plaster
 * wall can raise sd without becoming a room.
 *
 * beige luma band 140..210 is the Rec.601 range of the two wall frames' plaster
 * (peds mean 188.9, stepdown mean 166.0); it is a colour proxy, not a grade.
 */
import { decodePng } from "../decode-png.js";

export const INTERIOR_CENTER_REGION = {
  left: 0.22,
  top: 0.12,
  width: 0.44,
  height: 0.7,
} as const;

export const KNOWN_GOOD_CASE_IDS = [
  "postop_fever_consult_pressure_v1",
  "ward_delirium_med_rec_v1",
] as const;

/** stepdown wall frame, measured 2026-09-12, decodePng Rec.601, center region. */
export const WALL_SD_MAX = 24.5;
/** ob_headache, lowest non-wall sd in the same 15-station set. */
export const NEXT_INTERIOR_SD_MIN = 44.9;
/** sqrt(WALL_SD_MAX × NEXT_INTERIOR_SD_MIN). */
export const INTERIOR_SD_FLOOR = Math.sqrt(WALL_SD_MAX * NEXT_INTERIOR_SD_MIN);

/** stepdown wall beige occupancy. */
export const WALL_BEIGE_MIN = 93.0;
/** peds_fever, highest interior beige occupancy in the same set. */
export const NEXT_INTERIOR_BEIGE_MAX = 47.1;
/** Midpoint of WALL_BEIGE_MIN and NEXT_INTERIOR_BEIGE_MAX. */
export const BEIGE_CEILING = (WALL_BEIGE_MIN + NEXT_INTERIOR_BEIGE_MAX) / 2;

/** Rec.601 luma band of the two wall-plaster frames (means 166 and 189). */
export const BEIGE_LUMA_MIN = 140;
export const BEIGE_LUMA_MAX = 210;

export const INTERIOR_CELLS_DIR_REL =
  "docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12";
export const INTERIOR_CONTACT_SHEET_REL =
  "docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-contact-sheet-2026-09-12.png";
export const FRAMING_REPORT_REL =
  "tools/openclinxr/evidence/station-capture/station-room-framing-2026-09-12.md";

export type InteriorFrameMetrics = {
  samples: number;
  mean: number;
  sd: number;
  beigePct: number;
  edgePct: number;
  framesInterior: boolean;
};

export function measureInteriorCenter(bytes: Uint8Array): InteriorFrameMetrics | null {
  const decoded = decodePng(bytes);
  if (!decoded) return null;
  const { w, h, lum } = decoded;
  const x0 = Math.max(0, Math.floor(INTERIOR_CENTER_REGION.left * w));
  const y0 = Math.max(0, Math.floor(INTERIOR_CENTER_REGION.top * h));
  const x1 = Math.min(w, x0 + Math.floor(INTERIOR_CENTER_REGION.width * w));
  const y1 = Math.min(h, y0 + Math.floor(INTERIOR_CENTER_REGION.height * h));
  const step = 2;
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let beige = 0;
  let edges = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const L = lum[y * w + x];
      if (L === undefined) continue;
      sum += L;
      sumSq += L * L;
      n += 1;
      if (L >= BEIGE_LUMA_MIN && L <= BEIGE_LUMA_MAX) beige += 1;
      if (x + step < x1 && y + step < y1) {
        const right = lum[y * w + (x + step)];
        const down = lum[(y + step) * w + x];
        if (right === undefined || down === undefined) continue;
        if (Math.abs(L - right) + Math.abs(L - down) > 28) edges += 1;
      }
    }
  }
  if (n === 0) return null;
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  const beigePct = (100 * beige) / n;
  const edgePct = (100 * edges) / n;
  return {
    samples: n,
    mean,
    sd,
    beigePct,
    edgePct,
    framesInterior: sd > INTERIOR_SD_FLOOR && beigePct < BEIGE_CEILING,
  };
}

export type FramingStationRow = {
  caseId: string;
  imageRel: string;
  environmentId: string;
  bytes: number;
  sd: number;
  beigePct: number;
  edgePct: number;
  framesInterior: boolean;
};

export function parseFramingHeadline(body: string): number | null {
  const match = body.match(/^- cells: (\d+)$/m);
  if (!match) return null;
  return Number(match[1]);
}

export function parseFramingStations(body: string): FramingStationRow[] {
  const rows: FramingStationRow[] = [];
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
    const sd = Number(block.match(/^- centerSd: ([0-9.]+)$/m)?.[1] ?? "NaN");
    const beigePct = Number(block.match(/^- beigePct: ([0-9.]+)$/m)?.[1] ?? "NaN");
    const edgePct = Number(block.match(/^- edgePct: ([0-9.]+)$/m)?.[1] ?? "NaN");
    const framesInterior = (block.match(/^- framesInterior: (true|false)$/m)?.[1] ?? "") === "true";
    rows.push({
      caseId: start.id,
      imageRel,
      environmentId,
      bytes,
      sd,
      beigePct,
      edgePct,
      framesInterior,
    });
  }
  return rows;
}
