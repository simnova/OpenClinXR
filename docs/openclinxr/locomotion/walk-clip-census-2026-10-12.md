# Walk-clip census (2026-10-12)

Gate: `packages/openclinxr/factory-stations/src/motion_retarget/walk_symmetry_gate.ts` (stage 1,
commit 7864e143a; instrument corrected twice, see below). Bars: stride and step-duration
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

## Instrument corrections

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
   past the last timestamp, normalised by the full cycle. A last frame duplicating the
   first is dropped before any metric runs: the Walk, Walk_Carry and Walk_Formal source
   clips and the Walk and Walk_Formal bound clips carry one (retarget smoothing
   re-duplicates the bound ends).

A second bug surfaced while symmetrising: the sampler double-filled any joint named
twice in the joint map (the source rig names pelvis as both hips and root), interleaving
two passes frame-by-frame and misaligning every pelvis-indexed metric. Joint names are
deduped and every track asserts alignment with its timestamps.

## Is the shipped Walk lopsided in the source?

No, except the thighs. After both fixes the source reads stride 0.753/0.752 m (asymmetry
0.1 %), steps 0.834/0.833 s (0.0 %), duty 0.599/0.599, drift 0.0071 m, lifts and arms
passing. Genuinely asymmetric: thigh sweep (3D segment-direction diameter 54.6 vs
65.4 deg, asymmetry 18.1 %) and a seam kink (4.34 deg worst calf_l). The bind then ADDS
stride asymmetry the source does not have (bound 0.563/0.517 m, 8.6 %).

## Thigh ROM reconciliation

The earlier attribution table (walk-playback-blend-2026-10-12.md) reports thigh rotation
range 37.01/68.94 deg with no recorded definition, and it is not reproducible: from the
same source bytes, world segment-direction diameter gives 54.6/65.4, pelvis-relative
diameter 57.4/68.7, angle-from-vertical range 49.1/45.5. The R side is close (68.9 vs
65.4); the L side (37.0) matches nothing, including the local-rotation hypothesis (the
pelvis is near-static, so local sweep equals world sweep by construction). The gate's
defined, phase-invariant, unit-tested diameter stands; both metrics agree the right thigh
sweeps more in 3D.

## Verdict table (no clip passes as is)

| clip | source | bound | source failing bars | bound failing bars |
|---|---|---|---|---|
| Walk | FAIL | FAIL | thigh 18.1 %, seam 4.34 deg | stride 8.6 %, thigh 16.7 %, duty R 0.5495, seam 4.34 deg |
| Walk_Carry | FAIL | FAIL | duty 0.68/0.68, seam 116.6 deg, drift 0.0159 m | step 189 %, duty 0.13/0.11, seam 130.3 deg |
| Walk_Formal | FAIL | FAIL | thigh 18.3 %, seam 6.44 deg, arm 6.2/6.6 deg | stride 8.5 %, thigh 16.8 %, duty L 0.666, seam 6.44 deg, arm 6.7/7.4 deg |
| Walk_Backwards | FAIL | FAIL | stride 75.3 %, step 20.2 %, duty 0.92/0.82, seam 122.7 deg | stride 48.4 %, step 25.3 %, duty 0.88/0.78, seam 6.46 deg |
| Walk_Female | FAIL | FAIL | step 13.9 %, thigh 14.7 %, duty R 0.663, seam 117.7 deg | stride 96.7 %, step 148 %, thigh 12.9 %, duty L 0.72, seam 11.96 deg |
| Walk_Large | FAIL | FAIL | stride 7.0 %, thigh 21.1 %, duty 0.72/0.73, seam 121.8 deg | thigh 17.9 %, duty 0.70/0.70, seam 3.53 deg |
| Walk_Stealth | FAIL | FAIL | stride 30.2 %, step 15.7 %, seam 10.4 deg | step 26.0 %, duty L 0.72, seam 10.4 deg |

No clip passes as is at either point.

## Full metrics

Source (native units, scale 1; measured without duplicated end frames where present):

| clip | frames/dur | stride L/R m | step L/R s | thigh L/R deg | duty L/R | toe L/R m | ankle L/R m | seam deg | drift m | arm L/R deg | nat m/s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Walk | 41/1.667 | 0.753/0.752 | 0.834/0.833 | 54.6/65.4 | 0.599/0.599 | 0.172/0.172 | 0.330/0.330 | 4.34 | 0.0071 | 35.2/36.6 | 0.903 |
| Walk_Carry | 49/2.000 | 0.770/0.776 | 1.000/1.000 | 52.5/57.6 | 0.682/0.680 | 0.124/0.130 | 0.282/0.287 | 116.60 | 0.0159 | 17.5/16.6 | 0.773 |
| Walk_Formal | 41/1.667 | 0.750/0.750 | 0.833/0.833 | 59.9/72.0 | 0.597/0.597 | 0.172/0.172 | 0.330/0.330 | 6.44 | 0.0021 | 6.2/6.6 | 0.900 |
| Walk_Backwards | 24/0.958 | 0.106/0.233 | 0.551/0.449 | 51.7/49.2 | 0.922/0.823 | 0.067/0.089 | 0.233/0.243 | 122.66 | 0.0015 | 34.7/34.7 | 0.339 |
| Walk_Female | 33/1.333 | 0.688/0.699 | 0.640/0.735 | 52.8/61.2 | 0.644/0.663 | 0.096/0.081 | 0.277/0.254 | 117.71 | 0.0079 | 48.4/51.4 | 1.008 |
| Walk_Large | 34/1.375 | 0.495/0.531 | 0.706/0.711 | 34.1/42.1 | 0.718/0.726 | 0.158/0.160 | 0.281/0.309 | 121.82 | 0.0015 | 49.6/48.0 | 0.724 |
| Walk_Stealth | 36/1.458 | 0.664/0.490 | 0.691/0.809 | 41.6/39.2 | 0.576/0.617 | 0.112/0.169 | 0.248/0.256 | 10.40 | 0.0000 | 17.3/19.3 | 0.769 |

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

"lead-drop" is the bind-time rest-frame drop ("raw" = no leading rest frame found; the
gate's own duplicated-end-frame drop is applied wherever present). sha256 (source /
bound): Walk f6b64391e01f / 9f4a5dd03560; Walk_Carry e7ee82873528 / 4e8576689d9d;
Walk_Formal 341957bdd74f / 6b8cba62d884; Walk_Backwards c8a0b0b09681 / f4ff7ad43176;
Walk_Female e53c19a4f573 / 384f6cb5dd89; Walk_Large c83cfc5cfc2c / 6bea9b3e9bf9;
Walk_Stealth 94a8e8ab9beb / 16f3b086b1d6. Full rows re-measured 2026-10-13 into
/tmp/walkclip-census/census-rows.json (uncommitted; 7/7 clips gated at both points,
0 frames excluded from any statistic).

## Readings

- The corrected source strides are symmetric for Walk, Walk_Carry, Walk_Formal, Walk_Female
  (all <= 2 %); the old 2:1 ratios were wrap-split contacts. Genuinely stride-asymmetric
  sources: Walk_Backwards (75 %, a backwards creep, not a donor), Walk_Large (7.0 %) and
  Walk_Stealth (30 %).
- The bind preserves each clip's seam class and adds its own asymmetry: Walk gains stride
  asymmetry 0.1 % -> 8.6 % across the retarget; Walk_Female collapses (stride 1.6 % ->
  96.7 %, steps 0.64/0.74 s -> 0.10/0.64 s); Walk_Carry loses all contact (duty 0.68 ->
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

Walk (the shipped clip). It passes 7/9 bars at source (everything but thigh asymmetry and
seam); the symmetrise step reconstructs exactly those two. Continuity with the runtime
already playing this donor (D4 physician-first, D1 reuse).

## Symmetrised candidate (stage 3)

tools/openclinxr/evidence/walk-clip/symmetrise-walk-step.ts builds Walk_Symmetric
deterministically from one step of the Walk donor (L-plant 0.0558 s to R-plant 0.8893 s,
32 frames per half, 64-frame 1.667 s loop): mirror across the sagittal plane with L/R
swap computed in world space (FK the sampled locals, mirror, IK back — mirroring local
quaternions is wrong in rotated parent frames), both joints closed with cosine ramps plus
an exact end-frame set, net root travel removed. Verified in-tool: 29 pairs, rest residual
0.0003 mm, mirror asserts (identity, lateral flip, double-mirror roundtrip), plant gaps
11 mm / 8.8 deg before closing. No hand keyframes. Two blind alleys recorded: mirroring
local channels directly (destroys deep-chain offsets: 0.78 m for a 0.17 m toe bone), and
IK against the twin's own parent instead of the mirrored source parent (same symptom).

Source gate: 9/9 PASS (stride 0.0 %, steps 1.0 %, thigh 0.0 %, duty 0.61/0.60, lifts,
seam 0.74 deg, drift 0.0021 m, arms 35.1/35.1). Bound through the station
(openclinxr_retarget_source_walk_symmetric): 8/9, only seam fails (2.03 deg worst
upperleg01.R); stride 0.3 %, steps 2.2 %, thigh 0.1 %, duty 0.61/0.62, lifts, drift
0.0036 m, arms 37.7/37.7 all pass. A deterministic post-bind seam close improves seam to
1.17 deg but degrades stride 0.3 % -> 8.2 % (the ramp reshapes the stance window), so the
selected candidate is the raw bind: /tmp/walkclip-census/bound-symmetric.glb
(sha256 285e01e518ff766c); source /tmp/walkclip-census/source-Walk-symmetric.glb
(sha256 ddcfdab8c7c48ffa). Both uncommitted.

Bind asymmetry origin (one measurement): the MPFB physician rig is exactly L/R symmetric
at rest (bone lengths 0.00 %, rest directions 0.00 deg), so the Walk 0.1 % -> 8.6 % stride
change comes from the positions-to-rotations solve (per-frame, per-leg fitting that maps
the source's 4.8 % step-timing asymmetry into space), not the rig. Mirroring after the
bind would swap asymmetry, not remove it; the symmetric-source -> 0.3 % bound result is
the passing route.

## Browser check (stage 4)

The candidate grafted into a full physician copy under the runtime clip name, served
through a Playwright route override in loco-ground-capture.ts (--humanoid-glb,
--out-subdir; zero-hit override refuses the run). Three lockOff runs on the 6 m ground,
211 tap frames each, bit-identical vehicle: served sha256 f24002c7d64fb65f.

| metric | run 1 | run 2 | run 3 | bar |
|---|---|---|---|---|
| live amplitude vs clip (min, 6 leg joints) | 0.994 | 0.994 | 0.994 | >= 0.95 PASS |
| swing toe, rendered/mixer L/R m | 0.155/0.155 | 0.155/0.156 | 0.155/0.156 | brief 0.06 PASS |
| world-stationary fraction L/R | 0.528/0.361 | same | same | vs kinematic, reported |
| kinematic contact fraction L/R | 0.542/0.389 | same | same | reported |
| stride as played L/R m | 1.431/1.409 | same | same | asym 1.6 % <= 5 PASS |
| runtime timeScale | 1.6335 | same | same | target <= 1.1 FAIL |
| stance speed played m/s (natural @rate1) | 1.116 (0.683) | same | same | reported |
| root steady m/s (planned) | 1.377 (1.377) | same | same | reported |

Armed walking frames per run: 130 (filter: phase walking + lockArmed; counts printed, no
frames excluded from statistics). Amplitude = tap mixer-local ROM over bound-clip local
ROM per joint (upperleg01/lowerleg01/foot L/R; min 0.994). Feet are stationary in world
for roughly half the stance now (shipped control: 0.000). L sticks better than R
(0.53 vs 0.36). The runtime still plays at 1.63x: root 1.377 m/s against stance
1.116 m/s (ratio 1.23); the timeScale target (<= 1.1) is not met — same family as the
walk-playback finding (prescribed speed exceeds what the feet cancel), narrowed from
2.43x to 1.23x but still a runtime calibration question, out of scope here.
Renders (side view 0.5x, uncommitted, git-ignored beside the captures, none in HEAD — ci-w8).

## Verdict

Lane C cagematch decision with evidence: no library clip passes as is (table above);
the symmetrised Walk candidate passes the gate 9/9 at source and 8/9 bound (seam only),
and live it plays at full amplitude with symmetric strides — the runtime timeScale
(1.63 vs <= 1.1 target) remains a calibration question for the runtime lane. Machine
record was the clip-census report (machine-local, gitignored, never landed in HEAD — ci-w8). The shipped physician GLB and its
clip are untouched; GLBs and generated clips stay uncommitted with paths + sha256
recorded here.
