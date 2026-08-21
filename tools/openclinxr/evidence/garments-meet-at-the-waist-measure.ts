/**
 * Shared waist-meet instrument for garments-meet-at-the-waist + waist-fit-coverage (#549).
 *
 * Classification is slot-derived (D1): isUpperGarmentName / isPantsName — never a substring
 * race that lets scrub_pants match both UPPER and LOWER.
 */
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { isUpperGarmentName } from "./garment-slot.ts";
import { isPantsName } from "./waistband-ring.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = pathResolve(HERE, "../../..");
export const CANDIDATES = `${REPO_ROOT}/apps/ui-xr/public/xr-assets/humanoids/candidates`;

/**
 * Kept as named patterns so the-waist-gate-covers-the-shipped-cast can read them.
 * Must not dual-match scrub_pants (#549). Actual classification uses slot helpers below.
 */
export const UPPER = /shirt|top|scrub_shirt|gown|tshirt|sweater|cardigan|lab_coat/i;
export const LOWER = /pants|trouser|short/i;

export const BUCKETS = 36;
/** Fraction of a garment's own Y range treated as its rim band. */
export const RIM_FRACTION = 0.12;
/** Zero is the definition of "the garments meet". Not tuned. */
export const MIN_OVERLAP_M = 0;
/** Refuses turning a shirt into a tunic to clear the floor. Loose by design; see header. */
export const MAX_OVERLAP_M = 0.1;

export type WaistFit = {
  id: string;
  overlaps: number[];
  gapped: number;
  upperName: string | null;
  lowerName: string | null;
};

export type WaistCoverageRow = {
  id: string;
  source: "library" | "cast";
  overlapMm?: number;
  bucketCount?: number;
  upperName?: string | null;
  lowerName?: string | null;
  skipped?: boolean;
  skipReason?: string;
  overlaps: number[];
  gapped: number;
};

const io = new NodeIO();

type EdgeCandidate = { name: string; edge: number[] };

function rimEdge(
  verts: [number, number, number][],
  isUpper: boolean,
): number[] {
  const ys = verts.map((v) => v[1]);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const ref = isUpper ? lo : hi;
  const edge = new Array<number>(BUCKETS).fill(isUpper ? Infinity : -Infinity);
  for (const [x, y, z] of verts) {
    if (Math.abs(y - ref) > (hi - lo) * RIM_FRACTION) continue;
    const angle = Math.atan2(z, x);
    const b = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * BUCKETS) % BUCKETS;
    edge[b] = isUpper ? Math.min(edge[b]!, y) : Math.max(edge[b]!, y);
  }
  return edge;
}

function overlapsFor(hem: number[], waist: number[]): number[] {
  const overlaps: number[] = [];
  for (let b = 0; b < BUCKETS; b += 1) {
    if (Number.isFinite(hem[b]!) && Number.isFinite(waist[b]!)) {
      overlaps.push(waist[b]! - hem[b]!);
    }
  }
  return overlaps;
}

/**
 * When several upper meshes exist (e.g. scrub_shirt + lab_coat), pick the one whose hem
 * best meets the waistband inside [MIN, MAX] — not the lowest coat hem (that clears the
 * meet floor as a tunic and fails the counterweight).
 */
function pickUpperHem(uppers: EdgeCandidate[], waist: number[]): EdgeCandidate | null {
  if (uppers.length === 0) return null;
  if (uppers.length === 1) return uppers[0]!;

  let best: EdgeCandidate | null = null;
  let bestScore = -Infinity;
  for (const u of uppers) {
    const overs = overlapsFor(u.edge, waist);
    if (overs.length < 12) continue;
    const inBand = overs.filter((o) => o >= MIN_OVERLAP_M && o <= MAX_OVERLAP_M).length;
    const median = [...overs].sort((a, b) => a - b)[Math.floor(overs.length / 2)]!;
    // Prefer most in-band buckets; break ties toward small positive median overlap.
    const score = inBand * 1000 - Math.abs(median);
    if (score > bestScore) {
      bestScore = score;
      best = u;
    }
  }
  return best ?? uppers[0]!;
}

/**
 * Per-angle overlap between the upper garment's hem and the lower garment's waistband.
 * Positive means the waistband sits ABOVE the hem — they overlap. Negative is a gap.
 */
export async function measureWaistFit(glbPath: string, id: string): Promise<WaistFit> {
  const doc = await io.read(glbPath);
  const uppers: EdgeCandidate[] = [];
  let waist: number[] | null = null;
  let lowerName: string | null = null;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      // Slot-derived — scrub_pants is lower only (#549).
      const isUpper = isUpperGarmentName(name);
      const isLower = isPantsName(name);
      if (!isUpper && !isLower) continue;

      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const el: [number, number, number] = [0, 0, 0];
      const verts: [number, number, number][] = [];
      for (let i = 0; i < pos.getCount(); i += 1) {
        const [x, y, z] = pos.getElement(i, el);
        verts.push([x!, y!, z!]);
      }
      const edge = rimEdge(verts, isUpper);
      if (isUpper) uppers.push({ name, edge });
      else {
        waist = edge;
        lowerName = name;
      }
    }
  }

  if (!waist) {
    return { id, overlaps: [], gapped: 0, upperName: uppers[0]?.name ?? null, lowerName: null };
  }
  const picked = pickUpperHem(uppers, waist);
  if (!picked) {
    return { id, overlaps: [], gapped: 0, upperName: null, lowerName };
  }
  const overlaps = overlapsFor(picked.edge, waist);
  return {
    id,
    overlaps,
    gapped: overlaps.filter((o) => o < MIN_OVERLAP_M).length,
    upperName: picked.name,
    lowerName,
  };
}

export async function measureWaistAt(
  id: string,
  glbPath: string,
  source: "library" | "cast",
): Promise<WaistCoverageRow> {
  const fit = await measureWaistFit(glbPath, id);
  if (!fit.lowerName) {
    return {
      id,
      source,
      skipped: true,
      skipReason:
        "no lower trouser mesh — gowned or single-layer wardrobe; waist meet is not applicable",
      upperName: fit.upperName,
      lowerName: null,
      overlaps: [],
      gapped: 0,
    };
  }
  if (fit.overlaps.length < 12) {
    return {
      id,
      source,
      skipped: true,
      skipReason:
        "lower garment present but fewer than 12 comparable hem/waistband buckets — not a silent pass",
      upperName: fit.upperName,
      lowerName: fit.lowerName,
      overlaps: fit.overlaps,
      gapped: fit.gapped,
    };
  }
  const minOverlap = Math.min(...fit.overlaps);
  return {
    id,
    source,
    overlapMm: Math.round(minOverlap * 1000 * 10) / 10,
    bucketCount: fit.overlaps.length,
    upperName: fit.upperName,
    lowerName: fit.lowerName,
    overlaps: fit.overlaps,
    gapped: fit.gapped,
  };
}

export const LIBRARY_WAIST_SUBJECTS = [
  {
    id: "body-param-adult_lean_female-library",
    glbPath: `${CANDIDATES}/body-param-adult_lean_female-library.glb`,
  },
  {
    id: "body-param-adult_heavy_male-library",
    glbPath: `${CANDIDATES}/body-param-adult_heavy_male-library.glb`,
  },
] as const;
