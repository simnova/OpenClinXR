# Walk-clip census (2026-10-12)

Gate: `packages/openclinxr/factory-stations/src/motion_retarget/walk_symmetry_gate.ts` (stage 1,
commit 7864e143a; instrument corrected 2026-10-13, see below). Bars: stride and step-duration
asymmetry <= 5 %, thigh ROM asymmetry <= 10 %, duty 0.55-0.65 per foot, toe lift >= 0.06 m and
ankle lift >= 0.10 m per foot, seam error < 1 deg, root drift < 0.01 m, arm swing >= 10 deg
per side. Contact band 0.06 m (production constant); bound clips gated at physician actor
scale 0.86.

## Method

Seven Mesh2Motion Walk_* clips: Walk, Walk_Carry, Walk_Formal (human-base-animations.glb)
and Walk_Backwards, Walk_Female, Walk_Large, Walk_Stealth (human-addon-animations.glb).
Each clip extracted byte-isolated via extract-library-clip.ts, gated at source, bound
offline to a stripped physician copy through motion_bind_stage.py (shipped recipe:
mpfb2-default-no-toes map, mesh2motion-human-66 source map, "First person, Z up"),
dropLeadingRestFrame with raw-output fallback, gated bound. Driver:
tools/openclinxr/evidence/walk-clip/walk-clip-census.ts. GLBs uncommitted
(/tmp/walkclip-census, path + sha256 below). Timestamps verified uniform (Walk source:
dt 0.04167 exact), which the closure step assumes.

## Instrument correction (2026-10-13)

The first census run read shipped-Walk source stride as L/R 0.725/0.362 m (asymmetry
67 %). That was the instrument, not the clip. Three defects, all fixed and unit-tested
(walk-symmetry-gate.test.ts: wrap-spanning symmetric loop passes; 8-offset resampling
sweep reads identical numbers; 20 % asymmetric loop fails; duplicated-end-frame and
5-degree seam-jump cases):

1. Contact windows were linear. The right foot's contact wraps the seam (frames 26-40
   + 0-5); the detector split it in two and averaged the partial travels. Contacts are
   now merged on the loop circle; stride is foot travel relative to the root across the
   merged window, between interpolated plant/liftoff crossings.
2. Step duration was time-per-foot-cycle (a full loop for both feet, asymmetry 0 by
   construction). It is now the time between opposite-foot plants: all strikes ordered on
   the circle, L->R and R->L gaps averaged. Strikes are sub-frame interpolated band
   crossings (frame quantization alone reads 10 % gaps on symmetric 41-frame loops).
3. Duty summed linear window durations, dropping the seam-crossing interval for wrapping
   contacts. Durations now run crossing-to-crossing on the circle with one closure step
   past the last timestamp, normalized by the full cycle. A last frame duplicating the
   first is dropped before any metric runs (none of the seven source clips has one; two
   bound clips do, noted per row).

## Is the shipped Walk lopsided in the source?

Mostly no. After the fix the source reads stride 0.754/0.753 m (asymmetry 0.2 %),
duty 0.585/0.609, lifts and arms passing. What is genuinely asymmetric in the source:
thigh sweep (3D segment-direction diameter 57.7 vs 68.5 deg, asymmetry 17.1 %),
step timing (0.834 vs 0.875 s, asymmetry 4.8 % — inside the bar but not centered),
a seam kink (6.97 deg worst thigh_r), and root drift (0.045 m). The bind then ADDS
stride asymmetry the source does not have (bound 0.563/0.517 m, 8.6 %).

## Thigh ROM reconciliation

The earlier attribution table (walk-playback-blend-2026-10-12.md) reports thigh rotation
range 37.01/68.94 deg with no recorded definition, and it is not reproducible: from the
same source bytes, world segment-direction diameter gives 57.7/68.5, pelvis-relative
diameter 57.4/68.7, angle-from-vertical range 49.1/45.5. The R side coincides (68.9 vs
68.5); the L side (37.0) matches nothing, including the local-rotation hypothesis (the
pelvis is near-static, so local sweep equals world sweep by construction). The gate's
defined, phase-invariant, unit-tested diameter stands; both metrics agree the right thigh
sweeps more in 3D.

## Verdict table (no clip passes as is)

| clip | source | bound | source failing bars | bound failing bars |
|---|---|---|---|---|
| Walk | FAIL | FAIL | thigh 17.1 %, seam 6.97 deg, drift 0.045 m | stride 8.6 %, thigh 16.7 %, duty R 0.5495, seam 4.34 deg |
| Walk_Carry | FAIL | FAIL | duty 0.69/0.69, seam 125.4 deg, drift 0.042 m | step 189 %, duty 0.13/0.11, seam 130.3 deg |
| Walk_Formal | FAIL | FAIL | thigh 14.7 %, seam 12.0 deg, drift 0.031 m, arm 6.2/6.6 deg | stride 8.5 %, thigh 16.8 %, duty L 0.666, seam 6.44 deg, arm 6.7/7.4 deg |
| Walk_Backwards | FAIL | FAIL | stride 75.4 %, step 20.2 %, duty 0.92/0.82, seam 122.7 deg | stride 48.4 %, step 25.3 %, duty 0.88/0.78, seam 6.46 deg |
| Walk_Female | FAIL | FAIL | step 13.9 %, thigh 10.1 %, duty R 0.663, seam 117.7 deg, drift 0.124 m | stride 96.7 %, step 148 %, thigh 12.9 %, duty L 0.72, seam 11.96 deg |
| Walk_Large | FAIL | FAIL | thigh 23.2 %, duty 0.72/0.73, seam 121.8 deg, drift 0.025 m | thigh 17.9 %, duty 0.70/0.70, seam 3.53 deg |
| Walk_Stealth | FAIL | FAIL | stride 30.3 %, step 15.7 %, seam 10.4 deg | step 26.0 %, duty L 0.72, seam 10.4 deg |

No clip passes as is at either point. Census proceeds to the symmetrise step.

## Full metrics

Source (native units, scale 1):

| clip | frames/dur | stride L/R m | step L/R s | thigh L/R deg | duty L/R | toe L/R m | ankle L/R m | seam deg | drift m | arm L/R deg | nat m/s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Walk | 41/1.667 | 0.754/0.753 | 0.834/0.875 | 57.7/68.5 | 0.585/0.609 | 0.172/0.172 | 0.330/0.330 | 6.97 | 0.0449 | 35.2/36.6 | 0.882 |
| Walk_Carry | 49/2.000 | 0.771/0.776 | 1.042/1.000 | 57.5/62.5 | 0.688/0.687 | 0.124/0.130 | 0.282/0.287 | 125.37 | 0.0419 | 17.5/16.6 | 0.757 |
| Walk_Formal | 41/1.667 | 0.751/0.749 | 0.833/0.875 | 62.0/71.8 | 0.583/0.607 | 0.172/0.172 | 0.330/0.330 | 12.00 | 0.0311 | 6.2/6.6 | 0.878 |
| Walk_Backwards | 24/0.958 | 0.106/0.234 | 0.551/0.449 | 52.6/49.5 | 0.922/0.823 | 0.067/0.089 | 0.233/0.243 | 122.66 | 0.0034 | 34.7/34.7 | 0.339 |
| Walk_Female | 33/1.333 | 0.679/0.692 | 0.640/0.735 | 52.9/58.6 | 0.644/0.663 | 0.096/0.081 | 0.277/0.254 | 117.71 | 0.1238 | 48.4/51.4 | 0.997 |
| Walk_Large | 34/1.375 | 0.499/0.517 | 0.706/0.711 | 48.2/38.1 | 0.718/0.726 | 0.158/0.160 | 0.281/0.309 | 121.82 | 0.0248 | 49.6/48.0 | 0.717 |
| Walk_Stealth | 36/1.458 | 0.664/0.489 | 0.691/0.809 | 41.7/39.1 | 0.576/0.617 | 0.112/0.169 | 0.248/0.256 | 10.40 | 0.0009 | 17.3/19.3 | 0.769 |

Bound (physician rig, scale 0.86; clip names openclinxr_retarget_source_*):

| clip | frames/dur | stride L/R m | step L/R s | thigh L/R deg | duty L/R | toe L/R m | ankle L/R m | seam deg | drift m | arm L/R deg | lead-drop |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Walk | 41/1.667 | 0.563/0.517 | 0.832/0.835 | 54.2/64.0 | 0.631/0.550 | 0.159/0.159 | 0.271/0.271 | 4.34 | 0.0062 | 37.8/39.4 | dropped |
| Walk_Carry | 50/2.042 | 0.102/0.103 | 0.029/1.027 | 48.4/52.8 | 0.126/0.106 | 0.198/0.202 | 0.312/0.317 | 130.29 | 0.0000 | 65.1/65.4 | raw (refused) |
| Walk_Formal | 41/1.667 | 0.521/0.478 | 0.831/0.835 | 59.3/70.2 | 0.666/0.591 | 0.155/0.154 | 0.267/0.267 | 6.44 | 0.0018 | 6.7/7.4 | dropped |
| Walk_Backwards | 24/0.958 | 0.150/0.246 | 0.563/0.437 | 51.6/49.3 | 0.880/0.775 | 0.069/0.090 | 0.184/0.198 | 6.46 | 0.0013 | 34.8/34.8 | raw |
| Walk_Female | 33/1.333 | 0.466/0.162 | 0.095/0.640 | 50.3/57.2 | 0.723/0.614 | 0.120/0.110 | 0.238/0.231 | 11.96 | 0.0069 | 48.5/51.5 | raw |
| Walk_Large | 34/1.375 | 0.446/0.463 | 0.708/0.708 | 35.1/42.0 | 0.696/0.701 | 0.144/0.155 | 0.236/0.261 | 3.53 | 0.0013 | 49.3/48.0 | raw |
| Walk_Stealth | 36/1.458 | 0.464/0.447 | 0.542/0.417 | 44.0/45.0 | 0.723/0.642 | 0.087/0.133 | 0.205/0.204 | 10.40 | 0.0000 | 16.1/19.7 | raw |

Drop note: the bound Walk and Walk_Formal clips repeat their first frame at the end within
thresholds (retarget smoothing) and were measured without it; "raw" rows had no duplicated
end frame. sha256 (source / bound): Walk f6b64391e01f / 9f4a5dd03560; Walk_Carry
e7ee82873528 / 4e8576689d9d; Walk_Formal 341957bdd74f / 6b8cba62d884; Walk_Backwards
c8a0b0b09681 / f4ff7ad43176; Walk_Female e53c19a4f573 / 384f6cb5dd89; Walk_Large
c83cfc5cfc2c / 6bea9b3e9bf9; Walk_Stealth 94a8e8ab9beb / 16f3b086b1d6. Full rows:
re-measured 2026-10-13 into /tmp/walkclip-census/census-rows.json (uncommitted; 7/7 clips
gated at both points, 0 frames excluded).

## Readings

- The corrected source strides are symmetric for Walk, Walk_Carry, Walk_Formal, Walk_Female
  (all <= 2 %); the old 2:1 ratios were wrap-split contacts. Genuinely stride-asymmetric
  sources: Walk_Backwards (75 %, a backwards creep, not a donor) and Walk_Stealth (30 %).
- The bind preserves each clip's seam class and adds its own asymmetry: Walk gains stride
  asymmetry 0.2 % -> 8.6 % across the retarget; Walk_Female collapses (stride 1.9 % ->
  96.7 %, steps 0.64/0.74 s -> 0.10/0.64 s); Walk_Carry loses all contact (duty 0.69 ->
  0.13/0.11, one 0.03 s "step"). Carry/Female binds are broken outputs, reported as
  measured, not re-run.
- Walk_Large bound is the closest overall (stride 3.7 %, steps 0.0 %) but fails thigh
  (17.9 %), duty (0.70), and seam (3.53 deg). Walk_Formal fails the arm bar by design
  (formal carry, arms held at ~7 deg).

## 100STYLE

No 100STYLE neutral-walk take was gated. The cache holds only Spin turn takes extracted
for the 2026-09-25 turn bake-off (ledger row-34 covers styled locomotion incl. turns);
Neutral_* takes exist inside the cache zip as BVH on a foreign skeleton with no ledger row
and no in-scope bind path. Per the brief condition (in repo/cache with a ledger row, no new
fetches), 100STYLE contributes no census rows.

## Donor selection

Walk (the shipped clip). It passes 6/9 bars at source (stride, steps, duty, lifts, arms);
only thigh asymmetry, seam, and drift fail — exactly what the symmetrise step
reconstructs. Continuity with the runtime already playing this donor (D4 physician-first,
D1 reuse).
