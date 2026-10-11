# Walk-phase slide on the real skeleton: per-contact metric + CCD stance-lock flag decision (2026-10-11)

Verdict: REJECT — keep the `ccdStanceLock` flag off (default). 1/4 bars pass.

## Why this slice exists

The CCD stance-lock slice (`ccd-stance-lock-2026-10-11.md`) ended inconclusive: the headless
SC-05 assay never runs the stance-lock IK (marker rigs take the no-chain fallback), so its
off/on rows were bit-identical by construction. A browser metric added in 732c305c9 scored
0.51 m walk slide flag-off while `computeTurnQuality`'s `plantedSlideM` read 0.058 m on an
earlier capture, and the runtime exposed no stance-lock heel-target miss. This slice fixes
the metric, exposes the miss, and re-measures off vs on in the browser with the stepping
turn at its default.

## What changed (no default changed, no behaviour change)

- Metric (`tools/openclinxr/evidence/foot-plant/ccd-stance-lock/ccd-browser-metrics.ts`,
  schema v2): one window per foot CONTACT. Maximal runs of one per-frame stance label
  within the walking phase, split on same-foot footfalls with the exact anchor/reset
  discipline of `computeTurnQuality`'s settling `plantedSlideM`
  (`PLANT_EPISODE_FOOTFALL_JUMP_METERS` 0.05, `PLANT_EPISODE_LIFT_METERS` 0.008 — imported
  from `turn-quality-metrics.ts`, which now exports them, so the constants cannot drift).
  A same-foot jump without a lift stays in the episode: that is a planted foot snapping,
  not a landing. Reports per-contact median/max/count for the walk phase; legacy
  maximal-run fields kept beside them.
- Heel miss (`packages/openclinxr/xr-humanoid-animation/src/`): `applyStanceLegSolve`
  already accepted a `recordHeelMiss` tap that no caller passed. The walking lock branch
  in `case-owned-approach-frame-mod.ts` now passes one into the existing
  `recordHeelMiss?` input (2 lines added, file 440 -> 442, within the 500 zone budget);
  the miss rides on a new `lastHeelMissM` field on the approach object
  (`case-owned-approach-runtime-mod.ts`, field + init with one comment reflow, file
  stays at exactly 500) and is published as per-frame `stanceLockHeelMissM` on the
  existing evidence ring (`station-bedside-approach-mod.ts`, field + push line with two
  comment reflows, file stays at exactly 500). Reset to null every lock call, so a
  frame with no leg solve reports null, never a stale miss. Read-only: the tap observes
  the solve result after the fact; slot/pose writes are untouched. No new package
  export, so no admission overlay was needed. The capture tool
  (`foot-plant-video-capture.ts`) copies the field into `foot-plant-video.json`
  (tools files carry no size budget).
- Test (`the-walk-contact-episodes-split-replants.test.ts`, 3 tests pass): replant
  splits into a second contact anchored at the reland; snap-without-lift stays one
  contact; settling episodes reproduce `plantedSlideM` exactly.

## Measurement (physician, browser, full-body, stepping turn default off)

`.openclinxr/evidence/walk-slide/{off,on}/` (107 frames each, walking -> settling ->
arrived, 28/47/32). Two captures were discarded first: the off-run recorded zero heel
misses because the package resolves to `dist/` and the dist predated the tap — rebuilt
(`tsgo --build`, gitignored artifact) and re-captured.

| run | walk contact median/max (n=4) | heel miss median/max | max toe step | arrival |
|---|---|---|---|---|
| off | 0.1207 / 0.5114 | 0.0617 / 0.3786 | 0.1364 | 0.0082 |
| on | 0.0050 / 0.4582 | 0.0258 / 0.2112 | 0.3425 | 0.1613 |

Metric validation: settling-phase contact episodes reproduce `computeTurnQuality`
`plantedSlideM` exactly on the same capture (`metricValidationDeltaM` 0.00000 off and
on). The old 0.51-vs-0.058 puzzle is resolved: the 0.51 was a walk-phase maximal run
(one 16-frame left contact drifting plus its landing snap, no median); the 0.058-class
numbers are settling-phase episodes. Different phases, different contacts — the metric
was not disagreeing with `plantedSlideM`, it was measuring a different part of the walk.

## Bars (1/4 pass)

1. Walk slide median -0.1157 (>= 0.01) and max -0.0532 (>= 0.02): PASS.
2. Heel miss median 0.0258 < 0.01 with flag on: FAIL. The hinge still leaves 2.6 cm
   median residual on live walk targets (max 0.21 m); the mirror probe's 0.0000 was a
   static no-op solve, not a walk. (Flag-off two-bone miss 0.0617 is far better than
   the probe's 0.176 for the same reason: live corrections are small.)
3. Max toe step 0.3425 <= 0.1564 (off + 0.02): FAIL. The on-run snaps the
   stance-labelled left foot 0.34 m in one frame at sample 21 (off: 0.086 m same
   frame) — a solve snap, not a stride. Sub-0.11 m steps in both runs are healthy
   swing motion.
4. Arrival 0.1613 <= 0.0182 (off + 0.01): FAIL. Flag-on ends 16 cm from the target;
   flag-off lands within 1 cm.

The on-run is not a silent fallback: the deterministic sim diverges from the first
stance frames, and heel-miss/walk-median distributions shift, so the flag engages —
it just loses on 3 of 4 bars.

## Limits

1. One route, one actor (scene_closure physician), one run per flag. Run-to-run noise
   is ~1 mm (off legacy max 0.5114 here vs 0.5108 on the earlier stepping-turn-on
   capture); all verdict deltas exceed it by 50x or more.
2. The settled-posture correction keeps its own two-bone call site (out of scope);
   heel miss covers the walking lock only.
3. Flipping the flag for production needs orchestrator review.

## Recommended next

Keep the flag off (default). The walk-phase slide needs a different lead: the hinge
pins the mid-walk contact to 5 mm median but snaps at the replant and loses arrival.
Do not spend another solver slice on it without one.
