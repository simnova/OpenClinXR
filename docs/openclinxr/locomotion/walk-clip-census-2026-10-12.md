# Walk-clip census (2026-10-12)

Gate: `packages/openclinxr/factory-stations/src/motion_retarget/walk_symmetry_gate.ts` (stage 1,
commit 7864e143a). Bars: stride and step-duration asymmetry <= 5 %, thigh ROM asymmetry
<= 10 %, duty 0.55-0.65 per foot, toe lift >= 0.06 m and ankle lift >= 0.10 m per foot,
seam error < 1 deg, root drift < 0.01 m, arm swing >= 10 deg per side. Contact band 0.06 m
(production constant); bound clips gated at physician actor scale 0.86.

## Method

Seven Mesh2Motion Walk_* clips: Walk, Walk_Carry, Walk_Formal (human-base-animations.glb)
and Walk_Backwards, Walk_Female, Walk_Large, Walk_Stealth (human-addon-animations.glb).
Each clip extracted byte-isolated via extract-library-clip.ts, gated at source, bound
offline to a stripped physician copy through motion_bind_stage.py (shipped recipe:
mpfb2-default-no-toes map, mesh2motion-human-66 source map, "First person, Z up"),
dropLeadingRestFrame with raw-output fallback, gated bound. Driver:
tools/openclinxr/evidence/walk-clip/walk-clip-census.ts. GLBs uncommitted
(/tmp/walkclip-census, path + sha256 below).

## Verdict table (no clip passes as is)

| clip | source | bound | source worst bars | bound worst bars |
|---|---|---|---|---|
| Walk | FAIL | FAIL | stride 67.0 %, thigh 17.1 %, seam 6.97 deg, drift 0.045 m | stride 43.3 %, thigh 16.7 %, duty R 0.52, seam 6.97 deg |
| Walk_Carry | FAIL | FAIL | stride 66.4 %, seam 125.4 deg, drift 0.042 m | stride 19.5 %, step 66.7 %, duty 0.10/0.08, seam 130.3 deg |
| Walk_Formal | FAIL | FAIL | stride 67.0 %, thigh 14.7 %, seam 12.0 deg, drift 0.031 m, arm 6.2/6.6 deg | stride 37.8 %, thigh 16.8 %, duty L 0.65000002, seam 12.0 deg, arm 6.7/7.4 deg |
| Walk_Backwards | FAIL | FAIL | stride 13.8 %, duty 0.91/0.74, seam 122.7 deg | stride 45.8 %, duty 0.83/0.74, seam 6.46 deg |
| Walk_Female | FAIL | FAIL | stride 75.8 %, thigh 10.1 %, seam 117.7 deg, drift 0.124 m | step 66.7 %, thigh 12.9 %, duty L 0.69, seam 11.96 deg |
| Walk_Large | FAIL | FAIL | stride 10.4 %, thigh 23.2 %, duty 0.70/0.70, seam 121.8 deg, drift 0.025 m | stride 15.1 %, thigh 17.9 %, seam 3.53 deg |
| Walk_Stealth | FAIL | FAIL | stride 62.5 %, duty L 0.54, seam 10.4 deg | stride 31.8 %, step 66.7 %, duty L 0.66, seam 10.4 deg |

Every clip fails stride asymmetry at source except Walk_Large (10.4 %); every clip fails
the seam bar at source and bound. No clip passes as is at either point. Census proceeds
to the symmetrise step.

Note: Walk_Formal bound duty L reads 0.65000002 (float32 time ratio), failing the 0.65 cap
by 2e-8. The bar stands as written; the verdict above is what the gate computed.

## Full metrics

Source (native units, scale 1):

| clip | frames/dur | stride L/R m | step L/R s | thigh L/R deg | duty L/R | toe L/R m | ankle L/R m | seam deg | drift m | arm L/R deg | cad/spm |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Walk | 41/1.667 | 0.725/0.362 | 1.667/1.667 | 57.7/68.5 | 0.57/0.57 | 0.172/0.172 | 0.330/0.330 | 6.97 | 0.0449 | 35.2/36.6 | 72 |
| Walk_Carry | 49/2.000 | 0.761/0.382 | 2.000/2.000 | 57.5/62.5 | 0.65/0.65 | 0.124/0.130 | 0.282/0.287 | 125.37 | 0.0419 | 17.5/16.6 | 60 |
| Walk_Formal | 41/1.667 | 0.724/0.361 | 1.667/1.667 | 62.0/71.8 | 0.57/0.57 | 0.172/0.172 | 0.330/0.330 | 12.00 | 0.0311 | 6.2/6.6 | 72 |
| Walk_Backwards | 24/0.958 | 0.235/0.204 | 0.958/0.958 | 52.6/49.5 | 0.91/0.74 | 0.067/0.089 | 0.233/0.243 | 122.66 | 0.0034 | 34.7/34.7 | 125 |
| Walk_Female | 33/1.333 | 0.322/0.716 | 1.333/1.333 | 52.9/58.6 | 0.59/0.62 | 0.096/0.081 | 0.277/0.254 | 117.71 | 0.1238 | 48.4/51.4 | 90 |
| Walk_Large | 34/1.375 | 0.284/0.256 | 1.375/1.375 | 48.2/38.1 | 0.70/0.70 | 0.158/0.160 | 0.281/0.309 | 121.82 | 0.0248 | 49.6/48.0 | 87 |
| Walk_Stealth | 36/1.458 | 0.652/0.341 | 1.458/1.458 | 41.7/39.1 | 0.54/0.57 | 0.112/0.169 | 0.248/0.256 | 10.40 | 0.0009 | 17.3/19.3 | 82 |

Bound (physician rig, scale 0.86; clip names openclinxr_retarget_source_*):

| clip | frames/dur | stride L/R m | thigh L/R deg | duty L/R | toe L/R m | ankle L/R m | seam deg | drift m | arm L/R deg | lead-drop |
|---|---|---|---|---|---|---|---|---|---|---|
| Walk | 41/1.667 | 0.318/0.494 | 54.2/64.0 | 0.62/0.52 | 0.159/0.159 | 0.271/0.271 | 6.97 | 0.0000 | 37.8/39.4 | dropped |
| Walk_Carry | 50/2.042 | 0.118/0.097 | 48.4/52.8 | 0.10/0.08 | 0.198/0.202 | 0.312/0.317 | 130.29 | 0.0000 | 65.1/65.4 | raw (refused) |
| Walk_Formal | 41/1.667 | 0.332/0.486 | 59.3/70.2 | 0.65/0.57 | 0.155/0.154 | 0.267/0.267 | 12.00 | 0.0000 | 6.7/7.4 | dropped |
| Walk_Backwards | 24/0.958 | 0.239/0.150 | 51.6/49.3 | 0.83/0.74 | 0.069/0.090 | 0.184/0.198 | 6.46 | 0.0013 | 34.8/34.8 | dropped |
| Walk_Female | 33/1.333 | 0.237/0.238 | 50.3/57.2 | 0.69/0.56 | 0.120/0.110 | 0.238/0.231 | 11.96 | 0.0069 | 48.5/51.5 | dropped |
| Walk_Large | 34/1.375 | 0.254/0.218 | 35.1/42.0 | 0.64/0.64 | 0.144/0.155 | 0.236/0.261 | 3.53 | 0.0013 | 49.3/48.0 | dropped |
| Walk_Stealth | 36/1.458 | 0.417/0.303 | 44.0/45.0 | 0.66/0.60 | 0.087/0.133 | 0.205/0.204 | 10.40 | 0.0000 | 16.1/19.7 | dropped |

sha256 (source / bound): Walk f6b64391e01f / 9f4a5dd03560; Walk_Carry e7ee82873528 /
4e8576689d9d; Walk_Formal 341957bdd74f / 6b8cba62d884; Walk_Backwards c8a0b0b09681 /
f4ff7ad43176; Walk_Female e53c19a4f573 / 384f6cb5dd89; Walk_Large c83cfc5cfc2c /
6bea9b3e9bf9; Walk_Stealth 94a8e8ab9beb / 16f3b086b1d6. Full rows (all bars, pelvis
lateral range, knee/ankle ROM, natural speed): /tmp/walkclip-census/census-rows.json
(uncommitted; 7/7 clips gated at both points, 0 frames excluded).

## Readings

- The bind preserves each clip's defects: seam error survives retargeting to 0.01 deg on
  Walk, Walk_Formal, Walk_Stealth (same worst joint class, thigh/upperleg), so the seam is
  authored in the source, not introduced by the bind.
- Walk_Carry collapses at bind (duty 0.65/0.65 to 0.10/0.08, stride 0.76/0.38 m to
  0.12/0.10 m): the carry pose (arms holding a load, short planted steps) does not survive
  the free-arm MPFB retarget. Reported, not re-bound; it was never a neutral-walk donor.
- Walk_Female is the only clip whose bound stride is symmetric (0.4 %), but it fails step
  duration, thigh ROM, duty, and seam there. Symmetry in one bar is not a pass.
- Walk_Large bound is the closest overall (fails stride 15.1 %, thigh 17.9 %, seam 3.53 deg)
  but its source seam (121.8 deg) and duty (0.70) are far from the bars.

## 100STYLE

No 100STYLE neutral-walk take was gated. The cache holds only Spin turn takes extracted
for the 2026-09-25 turn bake-off (ledger row-34 covers styled locomotion incl. turns);
Neutral_* takes exist inside the cache zip as BVH on a foreign skeleton with no ledger row
and no in-scope bind path. Per the brief condition (in repo/cache with a ledger row, no new
fetches), 100STYLE contributes no census rows.

## Donor selection

Walk (the shipped clip). Reasons: clean lift/duty/arm bars at source (only asymmetry, seam,
and drift fail — exactly what the symmetrise step reconstructs), smallest source seam of
the census (6.97 deg), and continuity with the runtime already playing this donor (D4
physician-first, D1 reuse).
