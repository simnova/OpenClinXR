/**
 * KD per-pixel verdict (card WKD stage 2, S2 pure module).
 *
 * Pure: no fs, no browser, no PNG decoding. Callers pass decoded RGBA buffers
 * ({ width, height, rgba }) and a region rect ({ x, y, width, height }).
 *
 * K2 provenance: changed pixel := max channel |delta| > 24
 * (jobs/glbprobe per-pixel diff>24, the measure behind the 1235-2039 px floor).
 * in(X,Y) / out(X,Y) = changed-pixel counts inside / outside the expected region.
 *
 * K3 floor_in = max over the 3 A pairs of in(Ai,Aj); floor_out = max of out(Ai,Aj).
 * K4 INSIDE: min over i of in(Ai,B) > 2 x floor_in (margin = floor itself).
 * K5 OUTSIDE: max over i of out(Ai,B) <= floor_out.
 * ratio = min in(Ai,B) / floor_in (the audit; null when floor_in is 0).
 */

export const KD_CHANGE_THRESHOLD = 24;
export const KD_SPOUSE_ACTOR_ID = "spouse_anna_hayes_v1";
export const KD_FRAME = { width: 960, height: 600 };
/** The single capture path id every arm of a pinned run must carry (stage 4b). */
export const KD_PINNED_DRIVER = "kd-pinned-driver";

function assertImage(image, label) {
  if (!image || typeof image.width !== "number" || typeof image.height !== "number") {
    throw new Error(`kd-diff: bad ${label}: width/height missing`);
  }
  const { width, height, rgba } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`kd-diff: bad ${label}: non-positive size ${width}x${height}`);
  }
  if (rgba == null || rgba.length < width * height * 4) {
    throw new Error(`kd-diff: bad ${label}: rgba too short for ${width}x${height}`);
  }
}

function assertRect(rect, label) {
  if (!rect || typeof rect.x !== "number" || typeof rect.y !== "number" ||
    typeof rect.width !== "number" || typeof rect.height !== "number") {
    throw new Error(`kd-diff: bad ${label}: {x,y,width,height} required`);
  }
  if (!(rect.width >= 0 && rect.height >= 0)) {
    throw new Error(`kd-diff: bad ${label}: negative size`);
  }
}

function inRegion(rect, x, y) {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

function inAnyRect(rects, x, y) {
  return (Array.isArray(rects) ? rects : []).some((rect) => rect != null && inRegion(rect, x, y));
}

function numArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number") ? value : null;
}

function maxAbsDiff(a, b) {
  const x = numArray(a);
  const y = numArray(b);
  if (x == null || y == null || x.length !== y.length) return Number.POSITIVE_INFINITY;
  let worst = 0;
  for (let i = 0; i < x.length; i += 1) {
    const delta = Math.abs(x[i] - y[i]);
    if (!(delta >= 0)) return Number.POSITIVE_INFINITY;
    if (delta > worst) worst = delta;
  }
  return worst;
}

function scalarDiff(a, b) {
  if (typeof a !== "number" || typeof b !== "number") return Number.POSITIVE_INFINITY;
  const delta = Math.abs(a - b);
  return delta >= 0 ? delta : Number.POSITIVE_INFINITY;
}

/**
 * Max-abs component diffs for the three live-gated camera fields
 * (__openClinXrGazeCamera report: position, quaternion, fov).
 */
export function liveCameraDiff(a, b) {
  return {
    position: maxAbsDiff(a?.position, b?.position),
    quaternion: maxAbsDiff(a?.quaternion, b?.quaternion),
    fov: scalarDiff(a?.fov, b?.fov),
  };
}

/** Live-gate equality: position + quaternion + fov all within tol (default 1e-6). */
export function liveCamerasEqual(a, b, tol = 1e-6) {
  const d = liveCameraDiff(a, b);
  return d.position <= tol && d.quaternion <= tol && d.fov <= tol;
}

/** Mask/still desync ceiling (stage 4d, D3): pad above this refuses attribution. */
export const KD_MASK_PAD_CEILING_PX = 8;

/**
 * Chebyshev (chessboard) distance from pixel (x, y) to a rect, inclusive edges:
 * 0 inside, otherwise the max axis gap. Integer rects give integer distances.
 */
export function chebyshevToRect(rect, x, y) {
  if (rect == null) return Number.POSITIVE_INFINITY;
  const dx = x < rect.x ? rect.x - x : x > rect.x + rect.width - 1 ? x - (rect.x + rect.width - 1) : 0;
  const dy = y < rect.y ? rect.y - y : y > rect.y + rect.height - 1 ? y - (rect.y + rect.height - 1) : 0;
  return Math.max(dx, dy);
}

export function chebyshevToRects(rects, x, y) {
  let best = Number.POSITIVE_INFINITY;
  for (const rect of Array.isArray(rects) ? rects : []) {
    const d = chebyshevToRect(rect, x, y);
    if (d < best) best = d;
  }
  return best;
}

/** Changed pixels (threshold 24) between two decoded frames, as [x, y] pairs. */
export function changedPixels(a, b, threshold = KD_CHANGE_THRESHOLD) {
  assertImage(a, "a");
  assertImage(b, "b");
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("kd-diff: refusing changed pixels on mismatched still sizes");
  }
  const cut = Number(threshold);
  if (!Number.isFinite(cut) || cut < 0) throw new Error(`kd-diff: bad threshold ${threshold}`);
  const out = [];
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const at = (y * a.width + x) * 4;
      const d0 = Math.abs(a.rgba[at] - b.rgba[at]);
      const d1 = Math.abs(a.rgba[at + 1] - b.rgba[at + 1]);
      const d2 = Math.abs(a.rgba[at + 2] - b.rgba[at + 2]);
      const delta = d0 > d1 ? (d0 > d2 ? d0 : d2) : d1 > d2 ? d1 : d2;
      if (delta > cut) out.push([x, y]);
    }
  }
  return out;
}

/**
 * Mask pad (stage 4d, D1, computed never typed): max over the A-A pairs ONLY of
 * the Chebyshev distance from each changed pixel (threshold 24) to the nearest
 * actor mask rect taken from the A arms only (every actor, spouse included; B
 * never enters the pad). Pixels inside any A-arm rect score 0.
 */
export function computeMaskPad({ pairs, rects, threshold = KD_CHANGE_THRESHOLD } = {}) {
  if (!Array.isArray(pairs) || pairs.length === 0) throw new Error("kd-diff: computeMaskPad needs pairs");
  const perPairMax = {};
  let pad = 0;
  for (const pair of pairs) {
    let m = 0;
    for (const [x, y] of changedPixels(pair.a, pair.b, threshold)) {
      const d = chebyshevToRects(rects, x, y);
      if (d > m) m = d;
    }
    perPairMax[pair.name] = m;
    if (m > pad) pad = m;
  }
  return {
    pad,
    sourcePairs: pairs.map((pair) => pair.name),
    perPairMax,
    rectSource: "A1,A2,A3 mask.rect, every actor",
  };
}

/** Ceiling gate (stage 4d, D3): pad above 8 px refuses with the desync reason. */
export function checkPadCeiling(pad) {
  if (!(pad <= KD_MASK_PAD_CEILING_PX)) {
    return { refused: true, reason: "mask/still desync too large" };
  }
  return { refused: false, reason: null };
}

/** Grow a rect by pad on all sides, clamped to the frame (default 960x600). */
export function growRect(rect, pad, frame = KD_FRAME) {
  const x = Math.max(0, rect.x - pad);
  const y = Math.max(0, rect.y - pad);
  return {
    x,
    y,
    width: Math.min(frame.width, rect.x + rect.width + pad) - x,
    height: Math.min(frame.height, rect.y + rect.height + pad) - y,
  };
}

/**
 * Changed-pixel counts inside / outside `region` between two decoded frames.
 *
 * F4: `exclude` rects (other actors' masks) count NOWHERE — neither inside nor
 * outside — so idle motion of another actor inside the spouse union can inflate
 * neither INSIDE nor floor_out.
 */
export function countChanged(imageA, imageB, region, threshold = KD_CHANGE_THRESHOLD, exclude = []) {
  assertImage(imageA, "a");
  assertImage(imageB, "b");
  assertRect(region, "region");
  if (imageA.width !== imageB.width || imageA.height !== imageB.height) {
    throw new Error("kd-diff: refusing count on mismatched still sizes");
  }
  const cut = Number(threshold);
  if (!Number.isFinite(cut) || cut < 0) throw new Error(`kd-diff: bad threshold ${threshold}`);
  const { width, height } = imageA;
  let inside = 0;
  let outside = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const d0 = Math.abs(imageA.rgba[at] - imageB.rgba[at]);
      const d1 = Math.abs(imageA.rgba[at + 1] - imageB.rgba[at + 1]);
      const d2 = Math.abs(imageA.rgba[at + 2] - imageB.rgba[at + 2]);
      const delta = d0 > d1 ? (d0 > d2 ? d0 : d2) : d1 > d2 ? d1 : d2;
      if (delta > cut) {
        if (inAnyRect(exclude, x, y)) continue;
        if (inRegion(region, x, y)) inside += 1;
        else outside += 1;
      }
    }
  }
  return { in: inside, out: outside };
}

/**
 * Verdict over decoded RGBA buffers.
 * a: exactly [A1, A2, A3] (three samples so one lucky pair cannot set the floor).
 * exclude: other-actor mask rects, counted nowhere (F4 spouse-exclusive region).
 */
export function kdVerdict({ a, b, region, threshold = KD_CHANGE_THRESHOLD, exclude = [] } = {}) {
  if (!Array.isArray(a) || a.length !== 3) {
    throw new Error("kd-diff: kdVerdict needs exactly a:[A1,A2,A3]");
  }
  if (b == null) throw new Error("kd-diff: kdVerdict needs b");
  assertRect(region, "region");
  const aPairs = [
    { pair: [0, 1], ...countChanged(a[0], a[1], region, threshold, exclude) },
    { pair: [0, 2], ...countChanged(a[0], a[2], region, threshold, exclude) },
    { pair: [1, 2], ...countChanged(a[1], a[2], region, threshold, exclude) },
  ];
  const floor_in = Math.max(aPairs[0].in, aPairs[1].in, aPairs[2].in);
  const floor_out = Math.max(aPairs[0].out, aPairs[1].out, aPairs[2].out);
  const abPairs = [0, 1, 2].map((i) => ({ i, ...countChanged(a[i], b, region, threshold, exclude) }));
  const minIn = Math.min(abPairs[0].in, abPairs[1].in, abPairs[2].in);
  const maxOut = Math.max(abPairs[0].out, abPairs[1].out, abPairs[2].out);
  const inside = minIn > 2 * floor_in;
  const outside = maxOut <= floor_out;
  let countedRegionPx = 0;
  for (let y = Math.max(0, Math.floor(region.y)); y < region.y + region.height; y += 1) {
    for (let x = Math.max(0, Math.floor(region.x)); x < region.x + region.width; x += 1) {
      if (!inAnyRect(exclude, x, y)) countedRegionPx += 1;
    }
  }
  return {
    threshold,
    region: { ...region },
    excludedRects: (Array.isArray(exclude) ? exclude : []).map((rect) => ({ ...rect })),
    countedRegionPx,
    aPairs,
    abPairs,
    floor_in,
    floor_out,
    minIn,
    maxOut,
    inside,
    outside,
    ratio: floor_in > 0 ? minIn / floor_in : null,
    pass: inside && outside,
  };
}

function overlapAreaPx(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function rowRect(row) {
  return row?.maskRect ?? row?.rect ?? null;
}

/**
 * Refusals over two labels' regions (A1 baseline + B).
 *
 * Super-ceo ruling (stage 3): the spouse already overlaps the nurse at A, so
 * "any B overlap refuses" fires on the baseline. B refuses iff
 * overlapArea(spouse, other) in B is GREATER than the same pair's area in A1,
 * for any other actor; equal (baseline held) or smaller (moved away) passes.
 * Frame-edge refusal is unchanged (B only). Never throws for missing data: a
 * missing mask is itself a refusal. Per other actor, overlapAreaA1Px and
 * overlapAreaBPx are recorded for verdict.json.
 */
export function kdRefusals({ regionsA1 = [], regionsB, frame = KD_FRAME, spouseId = KD_SPOUSE_ACTOR_ID } = {}) {
  const refusals = [];
  const rowsB = Array.isArray(regionsB) ? regionsB : [];
  const rowsA = Array.isArray(regionsA1) ? regionsA1 : [];
  const spouseB = rowsB.find((row) => row?.actorId === spouseId);
  if (!spouseB) {
    return { ok: false, refusals: [`no ${spouseId} region in B`], overlaps: [] };
  }
  const rectB = rowRect(spouseB);
  if (rectB == null) {
    refusals.push("spouse mask missing in B");
    return { ok: false, refusals, overlaps: [] };
  }
  if (rectB.x <= 0 || rectB.y <= 0 || rectB.x + rectB.width >= frame.width || rectB.y + rectB.height >= frame.height) {
    refusals.push(
      `spouse mask touches the frame edge ${JSON.stringify(rectB)} vs ${frame.width}x${frame.height}`,
    );
  }
  const spouseA = rowsA.find((row) => row?.actorId === spouseId);
  const rectA = spouseA ? rowRect(spouseA) : null;
  const overlaps = [];
  for (const row of rowsB) {
    if (row?.actorId === spouseId) continue;
    const otherB = rowRect(row);
    if (otherB == null) continue;
    const otherA = rowsA.find((candidate) => candidate?.actorId === row.actorId);
    const otherARect = otherA ? rowRect(otherA) : null;
    const areaB = overlapAreaPx(rectB, otherB);
    const areaA = rectA != null && otherARect != null ? overlapAreaPx(rectA, otherARect) : 0;
    overlaps.push({ actorId: row.actorId, overlapAreaA1Px: areaA, overlapAreaBPx: areaB });
    if (areaB > areaA) {
      refusals.push(`spouse overlap with ${row.actorId} grew ${areaA} -> ${areaB} px^2`);
    }
  }
  return { ok: refusals.length === 0, refusals, overlaps };
}

/** Euclidean distance between the spouse mask.rect centres in two region sets. */
export function spouseCentreShiftPx(regionsA, regionsB, spouseId = KD_SPOUSE_ACTOR_ID) {
  const find = (rows) => (Array.isArray(rows) ? rows.find((row) => row?.actorId === spouseId) : null);
  const rectA = find(regionsA)?.maskRect ?? find(regionsA)?.rect ?? null;
  const rectB = find(regionsB)?.maskRect ?? find(regionsB)?.rect ?? null;
  if (rectA == null || rectB == null) {
    return { ok: false, why: `spouse mask missing in ${rectA == null ? "A" : "B"}` };
  }
  const cxA = rectA.x + rectA.width / 2;
  const cyA = rectA.y + rectA.height / 2;
  const cxB = rectB.x + rectB.width / 2;
  const cyB = rectB.y + rectB.height / 2;
  return { ok: true, dx: cxB - cxA, dy: cyB - cyA, distancePx: Math.hypot(cxB - cxA, cyB - cyA) };
}
