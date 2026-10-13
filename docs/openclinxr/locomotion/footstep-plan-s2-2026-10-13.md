# Footstep-plan S2 (2026-10-13): stride-amplitude plan behind `?footstepPlan=1`

Default OFF. Vehicle SC-05 (`scene_closure_supine_bedside_v1`), 1.31 m physician route.
Meter: `tools/openclinxr/evidence/slide-phase/slide-phase-analyze.ts --dir=<dir> --vehicle=sc05`.
Arrival residual = |slot − target| XZ at the first `arrived` frame (reproduces the
orchestrator SC-05 cells: fix 0.033 m, control 0.049 m).

## Three-build table (fixedClock=1 cell)

| metric (mean, sd) | main control, flags off (`s2-g-control`, n=6) | A first runtime, O2 (`s2c-a`, n=3) | B per-leg rework, T2-T2f (`s2-g-fix6`, n=6, REJECTED) | M2 k-th-passing exit (`s2c-m2` + `s2d-fix`, n=6) |
|---|---|---|---|---|
| end-stance fore-aft (m) | −0.3551 (0.0002) | +0.2804 (0.0000) | −0.2380 (0.0001) | +0.0241 (0.0000) |
| arrival residual (m) | 0.0488 (0.0001) | 0.0432 (0.0000) | 0.0596 (0.0000) | 0.0329 (0.0000) |
| walking slide/m | 0.2063 (0.0043) | 0.0908 (0.0045) | 0.4025 (0.0107) | ≈0.1094 (s2c-m2 0.1070, s2d-fix 0.1117) |
| start left-toe (m) | 0.3038 (0.0152) | 0.0546 (0.0101) | 0.5193 (0.0084) | 0.0600 (s2c-m2 0.0599, s2d-fix 0.0601) |
| turn max (m) | 0.0008 | 0.0006 | 0.0012 | ≤0.0010 |
| end-stance lateral (m) | −0.1903 | −0.2305 | −0.3312 | −0.2239 |

Queries: control `steppingTurn=1&fixedClock=1`; all fix cells
`steppingTurn=1&footstepPlan=1&fixedClock=1`. A removed the 0.285 m control
snap but left the feet 0.28 m split fore-aft at end of settle. B reintroduced
a 0.52 m start transient and nearly doubled control slide; reverted to A
(`bff0f4c50`). M2 exits the walk at the k-th feet-passing phase instead of the
distance band: feet together (+0.024 m) with the best arrival (0.0329 m).

## D1-D3 trace finding

D1: one half-cycle measured 0.486 m against A's nominal scale maps to effective
scale 0.486 / 0.5935 = 0.8189, i.e. +11% travel excess over the committed table
on that half. Fresh-tree `s2c-a` (n=3) splits it by half type: odd halves
0.430 m match the table linear within 1.5%, even halves 0.481 m match D1 within
1%. The planner keeps the committed table (no per-route fit); the excess is
graded by the gates, not absorbed. Pinned by `footstep-plan-schedule.test.ts`
(D1 check) and `footstep-plan-amplitude-mod.test.ts` (capture scale 0.7357).

D2: the executor distance band fires 1-2 substeps early, so the walk left
≈0.083 s before the feet-passing: A (`s2c-a` run0) leaves walking at clip time
1.28 s against the R passing at 1.38 s. M2 arms a `footstepExit` (plan steps,
L/R passing phases, clip cycle, action clip time) and exits on the first
substep whose unwrapped clip time reaches the k-th passing, skipping the band
while armed; without the input the legacy band is byte-for-byte (unit-pinned
in `walk-exit-contact-window.test.ts`).

D3: the settle phase kept running the clip from the early-exit pose to a split
pose: end-stance fore-aft +0.2804 m (A) and +0.3567 m (`s2-lead2`, n=1) against
+0.0241 m (M2). M2 carries no settle change (settle runs on; the S2d slice
leaves the stashed settle module untouched).

## Per-window slide (run0)

- control: walkWindows=[left2-5:0.0800 right13-14:0.0247 right18-21:0.1346]
  deepWindows=[right13-14:0.0247] — one deep window carries the 0.2063 slide/m.
- M2 (`s2c-m2`): walkWindows=[left0-2:0.0020 right3-4:0.0102 left5-6:0.0035
  right8-18:0.0247 left20-21:0.0019 right22-23:0.0057 left24-34:0.0173
  right35-36:0.0103 left37-38:0.0062 right39-44:0.0355]
  deepWindows=[right39-40:0.0042] — the last window (exit stride) is the
  largest remaining contributor.
- A (`s2c-a`): same window shape as M2 through right35-36, then
  right39-42:0.0124 — smaller exit window, but the band exit pose leaves the
  settle split (see D3).
- B (`s2-g-fix6`): 19 walk windows into step 106 (walk runs 60+ frames long:
  rootM 1.258) with deep singles across the whole travel — the per-leg schedule
  never converges, which is why it was reverted.

## 1/30-clock cell without fixedClock (new in S2d)

| metric | fix `steppingTurn=1&footstepPlan=1` (`s2d-fix-noclock`, n=3) | control `steppingTurn=1` (`s2d-control-noclock`, n=3) |
|---|---|---|
| end-stance fore-aft (m) | 0.0173 (0.0002) | −0.0227 (0.0000) |
| arrival residual (m) | 0.0332 (0.0001) | 0.0278 (0.0000) |
| walking slide/m | 0.1339 (0.0294; runs 0.0999-0.1510) | 0.3266 (0.0000) |
| start left-toe (m) | 0.0686 (0.0001) | 0.2859 (0.0001) |
| turn max (m) | 0.0010 | 0.0002 |

Without the fixed clock the control shows the 0.286 m start snap and 0.327
slide/m; the plan removes the snap (0.069 m) and more than halves slide, but
run-to-run spread is wider than in the fixedClock cell (sd 0.029 vs 0.001-0.007).

## Render (X)

Side view, full-body, SC-05, 0.5x half-speed copy, both with `fixedClock=1`:

- control: `.openclinxr/evidence/footstep-plan/render/control/` —
  tool-recorded query `fixedClock=1` (`steppingTurn=1` from `--stepping-turn=1`).
  feet-side 3.4 s, 11→6 stance windows, max slide 0.2740 m, median 0.1647 m.
- fix: `.openclinxr/evidence/footstep-plan/render/fix/` — tool-recorded query
  `footstepPlan=1&fixedClock=1`. feet-side 4.1 s, 11 stance windows, max slide
  0.0356 m, median 0.0114 m.
- Each dir holds `feet-side.mp4`, `feet-side-half.mp4` (0.5x), `feet-side-slow.mp4`
  (0.25x), `three-quarter.mp4`, 6 stills, and `foot-plant-video.json` (records
  `extraQuery`, `steppingTurnEnabled`, `fullBodySideView`).
- Tool change (tools-only): `foot-plant-video-capture.ts` gained a `--query=`
  passthrough appended verbatim to the capture URL, a 0.5x `feet-side-half.mp4`
  copy, and the `extraQuery` manifest field.

## S2d slice record (this slice; NO product behaviour change)

- `pnpm architecture` refused the push: tests reached 3 internal modules
  (8 > ceiling 5) and `arch-index.json` was stale. Fix: new keep-only
  `./footstep-plan` subpath admits 6 runtime symbols tests pin
  (`footstep-plan-v1`, review `PENDING-ORCHESTRATOR-REVIEW`); the two table
  constants stay literal in tests; the route-extension twin is covered by parser
  composition in the query-flag test. Declared entrypoints 138 → 139 (one new
  subpath; no other `exports` map changed). Index regenerated (`pnpm arch:index`).
- Gates: `pnpm architecture` 26 files / 291 tests green with no ceiling raised;
  `xr-humanoid-animation` 138/138 and `xr-runtime-state` 102/102 vitest green;
  flags-off behaviour unchanged (fix stays behind `?footstepPlan=1`).
- Pre-existing debt, untouched: `xr-humanoid-animation` typecheck reports two
  arity errors (`applyCaseOwnedStanceLock(approach)` single-arg calls in
  `the-clip-labels-its-own-stance.test.ts:103` and
  `the-stance-lock-keeps-clip-speed.test.ts:163`); both files and the signature
  predate this slice.

## NOT TESTED

- Quest/worn-headset playback of either render; browser-perceived (non-fake-clock)
  cadence of the half-speed copies.
- 2.0 m second route (`footstepRouteM=2`) beyond the parser unit gates — no
  closed-loop capture at that route length.
- MPFB/physician GLB other than the SC-05 frozen walker; other scenarios, actors,
  or routes (planner refuses short routes needing a middle step under 0.7).
- Settle-phase follow-up (stashed M3 module): end-stance numbers above still
  include the legacy settle.
- The `footstep-plan-v1` admission rows are unsigned (`PENDING-ORCHESTRATOR-REVIEW`).

## M1 toe-crossing table (exit-phase-per-foot, 2026-10-13)

Run0 taps, `?footstepPlan=1&fixedClock=1`, dist 4c71742a/4429cda6 (current
build). R-L = (rightToe − leftToe) along the route unit, blend stage (==
post: the closed loop moves the slot, separation is slot-invariant). Exit
substep = first settling frame's `walkSimSubsteps` (one past the max tap
sub: the tap pushes only while the advance kept `walking`).

| route | k | final scale | end foot (swings) | crossing subs (blend R-L) | first post | exit sub | lag |
|---|---|---|---|---|---|---|---|
| 1.31 sc05 | 3 | 0.7038 | R (left) | 94 (+0.0302) → 95 (−0.0268) | 95 | 96 | 1 |
| 2.0 sc05 | 4 | 0.8036 | L (right) | 126 (−0.0503) → 127 (+0.0125) | 127 | 129 | 2 |
| 6.0 loco | 11 | 0.7833 | R (left) | 346 (+0.0509) → 347 (−0.0115) | 347 | 348 | 1 |

Phase-constant context (clip rate ≈0.0271 s/substep from the 2.0 m frame
join): L constant wrapped 0.55 vs true L crossing ≈0.5415 (~8.5 ms late);
R constant wrapped 1.38 vs true R crossings ≈1.3756 (1.31 m) and ≈1.377
(6.0 m) (~3–4 ms late). The action read is one substep stale (mixer
updates after the advance; `case-owned-approach-frame-mod.ts` comment).

CAUSE D2: fixed clip-phase exit on a one-substep-stale read. The stale
~27 ms plus the L constant's extra ~8 ms pushes the even exit a second
full substep past the first post-crossing substep; odd exits fire one
past. The extra substep carries the swinging right foot ~60 mm further
forward (exit separation +0.0765 at tap 128 vs +0.0125 at tap 127).

CAUSE D3: no bookkeeping mismatch — travelled == route exactly at settle
entry (1.30587/2.0/6.0). The 0.033 arrival is the settling-turn pivot
carry, route-independent: travelled 2.0 → 2.0307, 6.0 → 6.0252,
1.3059 → 1.3248 while the slot translates under settling. No change.

D4 read: `parseFootstepRouteMeters` honors only the literal 2
(`footstep-plan-query-flag-mod.ts:27-32`); anything else reads null.
