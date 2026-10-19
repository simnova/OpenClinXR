/**
 * Shared landmark point type for the whole-face regression check.
 *
 * The region index table lives ONLY in src/regions.py (single implementation):
 * TypeScript never names landmark indices, builds no masks and does no colour
 * math. Sheets compose the per-region dE heatmap PNGs regions.py writes, using
 * the bboxes in its metrics JSON.
 */
export type Landmark = [number, number];
