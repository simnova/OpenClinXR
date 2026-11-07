# hair-groom17 — Interpolate-stage toggle matrix

Density 850000.0 (-> ~61k children), seed 7, cleared guides from groom16, Clump/Noise/Smooth OFF, no Shrinkwrap, no outside pass. `inside%` = child samples (s>=1) with body SDF < 0 (groom16's falsifier scalar = 19.06%). `need>3mm` = children the same outside pass would move > 3 mm (gate <= 2%). `bangs` = child samples forward of the forehead plane inside the face box (geometric, world-space).

| cell | fsn | cls | ig | dtg | insideAll% | insideS1% | need>3mm% | move p90 | pari p50 | pari p90 | pari std | temp p50 | temp p90 | temp std | bangs | qual |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fsn0_cls1_ig1_dtg0.02 | 0 | 1 | 1 | 0.02 | 6.85 | 5.97 | 5.43 | 1.20 | 4.53 | 14.06 | 7.13 | 2.46 | 7.62 | 4.55 | 21 | no |
| fsn0_cls1_ig1_dtgdefault | 0 | 1 | 1 | 1.0 | 8.29 | 7.43 | 9.51 | 2.76 | 4.32 | 14.41 | 7.25 | 2.38 | 8.65 | 5.26 | 21 | no |
| fsn0_cls1_ig3_dtg0.02 | 0 | 1 | 3 | 0.02 | 18.31 | 17.71 | 27.84 | 17.75 | 3.92 | 15.84 | 10.29 | 0.88 | 8.41 | 8.54 | 5 | no |
| fsn0_cls1_ig3_dtgdefault | 0 | 1 | 3 | 1.0 | 18.49 | 17.89 | 29.92 | 16.76 | 3.77 | 15.42 | 9.88 | 1.29 | 10.25 | 8.49 | 5 | no |
| fsn0_cls1_ig6_dtg0.02 | 0 | 1 | 6 | 0.02 | 23.39 | 22.92 | 37.09 | 23.04 | 3.34 | 16.24 | 11.16 | 0.04 | 8.16 | 9.67 | 0 | no |
| fsn0_cls1_ig6_dtgdefault | 0 | 1 | 6 | 1.0 | 23.27 | 22.79 | 38.71 | 21.60 | 3.16 | 15.51 | 10.47 | 0.48 | 10.15 | 9.32 | 0 | no |
| fsn0_cls3_ig1_dtg0.02 | 0 | 3 | 1 | 0.02 | 8.65 | 7.82 | 10.87 | 3.35 | 5.04 | 15.51 | 7.17 | 3.15 | 9.81 | 5.40 | 10 | no |
| fsn0_cls3_ig1_dtgdefault | 0 | 3 | 1 | 1.0 | 13.16 | 12.43 | 21.05 | 11.19 | 5.18 | 17.84 | 7.92 | 3.68 | 15.29 | 7.51 | 819 | no |
| fsn0_cls3_ig3_dtg0.02 | 0 | 3 | 3 | 0.02 | 15.31 | 14.64 | 24.51 | 13.92 | 4.32 | 15.07 | 9.21 | 2.22 | 8.82 | 7.87 | 3 | no |
| fsn0_cls3_ig3_dtgdefault | 0 | 3 | 3 | 1.0 | 19.04 | 18.46 | 32.53 | 24.47 | 4.49 | 18.30 | 9.66 | 2.95 | 15.85 | 9.49 | 168 | no |
| fsn0_cls3_ig6_dtg0.02 | 0 | 3 | 6 | 0.02 | 18.40 | 17.81 | 30.75 | 19.56 | 3.90 | 15.05 | 9.93 | 1.84 | 8.51 | 8.65 | 0 | no |
| fsn0_cls3_ig6_dtgdefault | 0 | 3 | 6 | 1.0 | 21.64 | 21.12 | 37.60 | 28.09 | 4.17 | 18.34 | 10.22 | 2.81 | 15.93 | 10.03 | 148 | no |
| fsn1_cls1_ig1_dtg0.02 | 1 | 1 | 1 | 0.02 | 6.86 | 5.98 | 5.23 | 0.97 | 4.49 | 13.76 | 7.38 | 2.39 | 7.19 | 4.67 | 7 | no |
| fsn1_cls1_ig1_dtgdefault | 1 | 1 | 1 | 1.0 | 8.56 | 7.71 | 8.59 | 2.21 | 4.36 | 14.76 | 8.14 | 2.30 | 8.37 | 6.49 | 7 | no |
| fsn1_cls1_ig3_dtg0.02 | 1 | 1 | 3 | 0.02 | 18.52 | 17.93 | 27.97 | 18.13 | 3.84 | 15.73 | 10.68 | 0.65 | 7.24 | 8.85 | 0 | no |
| fsn1_cls1_ig3_dtgdefault | 1 | 1 | 3 | 1.0 | 18.66 | 18.07 | 29.00 | 17.67 | 3.99 | 16.58 | 10.71 | 1.21 | 10.83 | 9.60 | 0 | no |
| fsn1_cls1_ig6_dtg0.02 | 1 | 1 | 6 | 0.02 | 23.98 | 23.52 | 37.25 | 23.19 | 3.21 | 16.24 | 11.56 | -0.15 | 6.78 | 9.90 | 0 | no |
| fsn1_cls1_ig6_dtgdefault | 1 | 1 | 6 | 1.0 | 23.55 | 23.08 | 37.50 | 22.01 | 3.57 | 16.89 | 11.29 | 0.28 | 11.90 | 10.40 | 0 | no |
| fsn1_cls3_ig1_dtg0.02 | 1 | 3 | 1 | 0.02 | 6.78 | 5.90 | 7.34 | 1.86 | 4.84 | 14.81 | 7.26 | 3.19 | 8.46 | 5.20 | 85 | no |
| fsn1_cls3_ig1_dtgdefault | 1 | 3 | 1 | 1.0 | 10.86 | 10.07 | 15.69 | 7.09 | 4.80 | 18.59 | 9.39 | 3.48 | 15.24 | 9.43 | 1571 | no |
| fsn1_cls3_ig3_dtg0.02 | 1 | 3 | 3 | 0.02 | 14.21 | 13.52 | 21.72 | 12.95 | 4.19 | 14.62 | 9.41 | 1.89 | 7.74 | 7.96 | 3 | no |
| fsn1_cls3_ig3_dtgdefault | 1 | 3 | 3 | 1.0 | 17.67 | 17.05 | 28.67 | 21.08 | 4.21 | 19.55 | 11.35 | 2.45 | 17.48 | 11.79 | 90 | no |
| fsn1_cls3_ig6_dtg0.02 | 1 | 3 | 6 | 0.02 | 17.61 | 17.00 | 28.53 | 17.93 | 3.79 | 14.57 | 10.13 | 1.14 | 7.43 | 8.75 | 3 | no |
| fsn1_cls3_ig6_dtgdefault | 1 | 3 | 6 | 1.0 | 20.50 | 19.96 | 34.60 | 24.77 | 3.86 | 19.48 | 11.99 | 1.90 | 17.61 | 12.55 | 24 | no |

Cleared-guide depth reference (groom16 guide-depth.json): parietal p50 8.059 / p90 17.065 / std 6.437; temple p50 5.524 / p90 8.930 / std 2.742. Qualification band = child p50 and p90 within +-20%.

## Marginal mean by level (insideS1%, need>3mm%, bangs)

| variable | levels | insideS1% mean | need>3mm% mean | bangs mean | inside range |
|---|---|---|---|---|---|
| followSurfaceNormal | 0:0.1558 / 1:0.1498 | 15.58 / 14.98 | 25.49 / 23.51 | 100.0 / 149.2 | 0.60 pts |
| depthClasses | 1:0.1592 / 3:0.1465 | 15.92 / 14.65 | 24.50 / 24.49 | 5.5 / 243.7 | 1.27 pts |
| interpGuides | 1:0.0791 / 3:0.1691 / 6:0.2102 | 7.91 / 16.91 / 21.02 | 10.47 / 27.77 / 35.25 | 317.6 / 34.2 / 21.9 | 13.11 pts |
| distanceToGuides | 1.0:0.1634 / 0.02:0.1423 | 16.34 / 14.23 | 26.95 / 22.05 | 237.8 / 11.4 | 2.11 pts |

## Outcome

Qualifying cells (inside < 1% AND parietal+temple p50/p90 within +-20%): **0 / 24**.

- Lowest inside%: `fsn1_cls3_ig1_dtg0.02` insideS1 5.90%, need>3mm 7.34%, parietal p50 ratio 0.601 / temple p50 ratio 0.578.
- Lowest need>3mm: `fsn1_cls1_ig1_dtg0.02` insideS1 5.98%, need>3mm 5.23%.
- The variable that moves inside% most is **interpolation-guides** (marginal range 13.11 pts; ig1 7.91% vs ig3 16.91% vs ig6 21.02%). follow-surface-normal moves it 0.60 pts (0 15.58% vs 1 14.98%), depth-classes 1.27 pts, distance-to-guides 2.11 pts.
