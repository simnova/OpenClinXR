# Chain baseline: exposure/tile-recal job outcome (2026-09-29)

Fresh-chain measurement pass for the exposure + tile-recal job. Both fix
steps came back BLOCKED with measured proof (below). Zero source churn:
the one exposure iteration (0.82) was reverted; the tree keeps the
committed rig + hemisphere state. Evidence commits the baseline, not a fix.

## Chain rebuild (one bake, zero Blender processes)

`pnpm --filter @openclinxr/factory-stations exec tsx
src/room_chain/cli.ts --seed 205 --out-dir
/tmp/light-balance-exposure-recal --pass-timeout-ms 3600000`

- Stage 1 room_generate: CACHE HIT
  (86ee79b9db895dc6bf85ab783bfc8c021cdfcb81a385d58d9946d2b7d29f79ab).
- Stage 2 room_clinic_finish: CACHE HIT
  (6617a03bac0b7790131b8c2cbe672288492aee10dc753503e72eefe1042fb799).
- Stage 3 lighting_design: CACHE HIT (JSON only; GLB untouched).
- Machine-wide Blender count 0 before launch; cache hits spawn none.
- Output
  `/tmp/light-balance-exposure-recal/infinigen-inpatient-ward.chain.glb`,
  sha256 `8264b94c9648dfcad22d44ff57341bb67adc6c29a3e5075b07a4e4db00358b8d`,
  6902800 bytes, byte-identical to the prior /tmp bake in this worktree.
- Every capture below logs this sha prefix (`8264b94c9648`) in its
  `[environment] served` line; six PNG shas reproduce the prior
  re-verification captures bit-for-bit (deterministic).

## Wall box (500,280,780,420 on pose-02): FAIL, valid box

- Chain render (226.8, 221.1, 215.9), stddev 3-4.6, R-B 10.9.
- Reference (203.6, 202.7, 197.1), spread 6.5. Deltas (+23.2, +18.4, +18.8).
- Vertical profile x600-680 y260-560 is smooth (224 down to 212, no bump):
  the sheen is uniform, the box mean is representative, no streak inflation.

## Step 1 (exposure-only): BLOCKED, proven infeasible, reverted

- Iteration: clinic_day exposure 0.90 -> 0.82 (rig regen from current code
  reproduced light positions bit-identically; only the exposure line moved),
  staged to the public rig path, re-captured pose-02 on the same GLB.
- Wall moved (226.8, 221.1, 215.9) -> (223.8, 217.6, 212.0): slope
  ~37/44/49 rendered units per 1.0 exposure. R-B gap WIDENED 10.9 -> 11.8.
- Validated three.js ACES filmic model predicts both points within 0.3
  (227.1/224.1 vs measured 226.8/223.8). The model requires exposure ~0.50
  for the wall means: below evening_calm (0.7), breaking the mood-ordering
  test and any sane mood ladder. Lowering exposure widens R-B monotonically
  (measured + model agree), so the spread bar (<= 6.5) is unreachable from
  any exposure in (0.7, 1.0). Reverted to 0.9; rig JSONs restored.
- Root cause (verified, not hypothesized): the stage-1 Cycles DIFFUSE bake
  blows the wall UV region to pure white (extracted
  `openclinxr_room_bake_surface_wall_shell_bake_wall`: white zone exactly
  255.0; pipeline's own log: wall meanL 177.83 incl. black gutters, floor
  241.18, ceiling 249.94, trim 232.74). The finish stage skips the flat wall
  repaint, so the chain ships `shell_bake_wall` (Infinigen lit bake) where
  the stale shipped asset carries flat `openclinxr_finish_wall` (~184).
  The runtime re-lights an already-lit wall. No exposure scalar fixes a
  clipped-white albedo while keeping the mood ladder and the spread bar.

## Step 2 (tile uniform-scale): BLOCKED, prescribed box is wall

- The prescribed tile box (970,315,1100,385) on the chain pose-03 capture
  is WALL with a small tile/T-bar corner triangle (crop-verified):
  rendered (205.5, 202.1, 197.6) with stddev 28.5 vs reference stddev 3.6.
  It is not a tile measurement. The "tile ~1.23x" figure in the job brief
  measures this wall-dominated box (205.5/166.7); it does not survive
  re-measurement on actual tile.
- Actual clean tile on the chain GLB renders DARK, ~0.85x, with a
  position-dependent warm cast R-B 13-26 (pose-05 patches 148.5/141.6/128.2
  and 148.8/142.0/128.6; pose-03 clean region 138.3/136.0/124.9) against
  the neutral reference anchor (166.7, 166.2, 159.8, R-B 6.9). The brief's
  implied direction (tile bright, scale down) is inverted against reality
  (tile dark, select patches need ~1.24x up); applying it would darken
  already-dark tiles.
- Uniform-scale feasibility is region-dependent: the least-warm patch
  admits s in [1.215, 1.263] (all three channels pass at s ~ 1.24), while
  warmer patches admit the empty set (R needs s <= 1.174, B needs
  s >= 1.180). A position-dependent cast is not correctable by any global
  albedo; it points at the 3000K fill point in the HELD rig. The PNG was
  therefore left untouched (also avoiding the seed-14 ceiling-grid hard
  cutoffs and the dedicated tile-brightness test's blast radius).

## Framing note (poses 03-06 on the chain GLB)

Only poses 01/02 (lens-refit) reproduce reference content on the chain
room. Poses 03-06 ("rescaled x/depth") do not: 03 puts the tile box on
wall, 06 is mostly wall + cove base with a floor strip (its 250,230,550,300
box reads wall 213.0 vs the reference daylight-wall 136.5). Box-grading
03-06 against chain GLBs needs a pose re-fit pass first (lens-refit
method, separate slice); no poses were changed here.

## What this evidence unblocks (recommended next, coordinator call)

1. Bake-level wall/floor fix: stage-1 DIFFUSE levels blow shell surfaces
   to 232-255 (wall/floor/trim; ceiling hidden under finish). Either tame
   the bake rig or restore the finish flat-wall repaint for shell walls.
   Needs a real Blender bake; outside this job's runtime-only fence.
2. Rig re-tune against the CHAIN GLB (not the stale shipped asset): the
   HELD rig + hemisphere PASS grades were all measured on the shipped
   asset's flat walls and do not transfer to the baked shell.
3. Pose 03-06 re-fit to the chain room before any further box-grading.

## Files

- `captures-chain-baseline/`: six runtime PNGs + stage2-multiview.json
  (GLB path + per-PNG shas).
- `chain-baseline-*-v2-side-by-side.png`: six sheets vs the v2 reference.
- `chain-baseline-measurements.json`: machine-readable numbers.
- `CHAIN-BASELINE.md`: this file.
- Prefix `chain-baseline` is distinct from this dir's `red`/`green`/
  `hemisphere-red`/`hemisphere-green` sets; nothing overwritten. The
  untracked `captures-hemisphere-green-chain/` dir from the prior
  re-verification was left in place untouched.
