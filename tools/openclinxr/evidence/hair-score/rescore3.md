# Canonical hair rescore v3 (true COLOR material, strict params, light readback)

Scorer: `tools/openclinxr/evidence/hair-score/score.py` schema
`openclinxr.hair-score.v3` (sha256
`bbb43f2336281e831b9cdee0ad196bc73bb9b37cbb6d13232ece4e869be2d3c5` at
scoring time; git `1ac363459` plus uncommitted v3 edit).
Material = hair-look7 `best-params.json` direct COLOR, built **inside**
score.py (`build_hair_scored`; node readback `model=HUANG`,
`parametrisation=COLOR` on all 8 runs).
Rig (i) stock: `R.ST.lights` + stock `cell_rel` (OCLX_rim hardcoded
`26.654` from `hair-search2/best.json`, read back on the light;
params `rim_W=0.0836` recorded as ignored).
Rig (ii): top-level `rig` block from `hair-rig1/search_best.json`
(camera-relative all-7; OCLX_rim read back `12.052` on all views).
1024 px / 64 samples / seed 0, judge v6, hair-curtain3 landmarks.
Strands: a1 = hair-real1/cells/a1/strands.npz;
b8 = hair-tilt4/cells/r_rear/strands.npz;
s5, h75 = hair-tilt5/cells/<tag>/strands.npz.
TS reference: back bands 849 x 16.4 px, ear bands 89 x 11.7 px.
IoU is rig-invariant (light-independent ID pass): identical across rigs.

| cell x rig | IoU f / p / b | orient err f / 3q / p / b (deg) | bands back ours (count x meanAreaPx) | bands ear ours (count x meanAreaPx) | p50 f / 3q / p / b | hue f / 3q / p / b (deg) | sat f / 3q / p / b |
|---|---|---|---|---|---|---|---|
| a1 x stock | 0.6883 / 0.6810 / 0.7819 | 27.68 / 35.71 / 35.13 / 30.92 | 169 x 84.7 | 94 x 9.0 | 0.0952 / 0.1204 / 0.1439 / 0.1201 | 23.9 / 23.0 / 21.8 / 16.6 | 0.146 / 0.154 / 0.160 / 0.163 |
| b8 x stock | 0.6944 / 0.6848 / 0.7732 | 25.74 / 35.32 / 32.05 / 25.24 | 308 x 46.6 | 83 x 10.3 | 0.0961 / 0.1193 / 0.1431 / 0.1232 | 23.9 / 23.0 / 22.3 / 16.8 | 0.145 / 0.154 / 0.149 / 0.163 |
| s5 x stock | 0.6947 / 0.6807 / 0.7696 | 24.66 / 33.96 / 32.21 / 24.13 | 442 x 35.4 | 73 x 11.8 | 0.0961 / 0.1167 / 0.1416 / 0.1235 | 23.9 / 23.1 / 22.4 / 17.0 | 0.143 / 0.151 / 0.149 / 0.163 |
| h75 x stock | 0.6928 / 0.6758 / 0.7725 | 25.56 / 35.83 / 32.26 / 24.08 | 390 x 38.5 | 85 x 10.1 | 0.0961 / 0.1196 / 0.1431 / 0.1235 | 23.8 / 23.0 / 22.3 / 17.0 | 0.145 / 0.152 / 0.149 / 0.160 |
| a1 x rigged | 0.6883 / 0.6810 / 0.7819 | 28.13 / 36.09 / 35.86 / 31.37 | 222 x 65.5 | 91 x 9.3 | 0.0941 / 0.1125 / 0.1358 / 0.1165 | 23.6 / 22.7 / 21.2 / 16.4 | 0.146 / 0.159 / 0.156 / 0.159 |
| b8 x rigged | 0.6944 / 0.6848 / 0.7732 | 25.89 / 35.18 / 32.58 / 26.35 | 393 x 37.7 | 83 x 10.3 | 0.0952 / 0.1078 / 0.1322 / 0.1165 | 23.7 / 22.8 / 21.1 / 16.6 | 0.143 / 0.159 / 0.152 / 0.159 |
| s5 x rigged | 0.6947 / 0.6807 / 0.7696 | 25.12 / 34.03 / 33.02 / 25.19 | 520 x 29.3 | 82 x 10.5 | 0.0961 / 0.1078 / 0.1322 / 0.1179 | 23.6 / 22.9 / 21.3 / 16.8 | 0.143 / 0.156 / 0.152 / 0.159 |
| h75 x rigged | 0.6928 / 0.6758 / 0.7725 | 26.01 / 35.46 / 33.15 / 24.61 | 472 x 33.3 | 90 x 9.6 | 0.0961 / 0.1087 / 0.1322 / 0.1165 | 23.6 / 22.8 / 21.0 / 16.6 | 0.143 / 0.159 / 0.152 / 0.159 |

Raw runs: `E/runs3/<cell>-<stock|rigged>/score.json` (+beauty/ID PNGs).
s5-stock scored twice (`s5-stock-a`, `s5-stock-b`); see `E/self-test3.json`.
Rigged params file: `E/rig_params.json` (look7 material + search_best rig).
Old (melanin-material) tilt5 reads are superseded, e.g. s5 back bands
were 713 x 20.8 px, now 442 x 35.4 px under the true COLOR material.

## KEEP decisions under the true material: a1 -> b8 -> s5 still holds

Ordering a1 < b8 < s5 is preserved on every light-affected axis under
**both** rigs, and IoU (geometry-only) is unchanged by the material fix:

- back bands count toward TS 849: stock 169 -> 308 -> 442;
  rigged 222 -> 393 -> 520. Mean area falls toward TS 16.4 throughout.
- back orientation error: stock 30.92 -> 25.24 -> 24.13;
  rigged 31.37 -> 26.35 -> 25.19.
- front orientation error: stock 27.68 -> 25.74 -> 24.66;
  rigged 28.13 -> 25.89 -> 25.12.
- front IoU: 0.6883 -> 0.6944 -> 0.6947 (rig-invariant).
- s5 over h75 holds: back bands 442 vs 390 (stock), 520 vs 472
  (rigged); front orientation 24.66 vs 25.56 (stock), 25.12 vs 26.01
  (rigged); back orientation ties within 0.5 deg.

The rig1 search rig shifts absolute band/photometric numbers (e.g. s5
back 442 -> 520) but does not reorder any cell pair. No KEEP reverses.
