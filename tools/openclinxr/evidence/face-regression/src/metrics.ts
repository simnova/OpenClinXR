/**
 * Region metric record for the whole-face regression check.
 *
 * Measured ONLY by src/regions.py (skimage CIEDE2000, the proven tool), which
 * the contract test and the `check` CLI both drive through mise. This module
 * keeps the record shape so the pure decision in check.ts and the sheet writer
 * type their inputs without duplicating the table, the masks or the math.
 */
export type RegionMetric = {
  region: string;
  dE: number;
  ssimL: number;
  landmarkDispPx: number;
  pixels: number;
};

export type RegionBounds = { x0: number; y0: number; x1: number; y1: number };
