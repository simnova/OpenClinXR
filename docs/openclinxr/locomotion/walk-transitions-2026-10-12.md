# Walk START/STOP transitions (2026-10-12)

Physician walk transitions, now that the walk plays at full amplitude. Verdict: **reject** — no candidate becomes the default; all flags stay default-off. The start pop is fixed on the lock-free vehicle (B: 0.374 m / 35 deg to 0.161 m / 11 deg) but the shipped stance lock reads the ramp morph as foot travel and chases it (the 73 mm mechanism, re-tested as ordered: it still holds), and the SC-05 arrival gates fail.

## Clock-jump check (ordered first)

control.json recorded `start.clockJumpIntervals: 1`. The 0→1 tap interval spans dtMs=500 of fake clock but only 0.081 s of clip (actionT 0 → 0.081 at timeScale 1.6255 = 0.05 s sim ≈ 1.5 produced 1/30 s steps). Frame 0 is the idle pose — proven 0.000 deg drift across repeats AND across clip start times (A-run frame 0 identical to control frame 0 despite action starting at t=1.42 vs t=0). So the 35.01 deg / 0.374 m step is idle→clip over ~1.5 frames ≈ 23 deg / 0.25 m per-frame-equivalent vs steady 10.7 deg / 0.164 m. Without the interval the remainder peaks at 12.37 deg / 0.161 m. **The pop does not disappear.** Bars are judged WITH the interval (it IS the defect transition); both numbers are in report.json.

## Control (stage 1)

Proving ground 6 m (lockOff lock-off, twoBone shipped lock) + SC-05 full-body stepping-turn-1. Walk starts at clip time 0, mid-stride on the right leg (upperleg01R 13.4 deg, lowerleg01R 23.0 deg from standing; left ~0.5 deg). Start: 35.0 deg / 0.374 m both rows. Steady: thigh ~10.7 deg, foot 0.164 m (lockOff). Stop: end foot 0.161 m, settling foot ~0.033 m. SC-05 control: arrival 0.052 m (repeat 0.030; variance ±0.022), lateral 0.044 m (±0.022), settling slide 0.001 m.

## Candidates (stage 2, all default-off flags)

- **A** (`walkStartPhase=1`): start at nearest-standing clip phase. Toe-trajectory proxy tried first, rejected (picked a swing phase: 30/21 deg). Joint-space minimax rewrite picks t≈0.78, worst-leg 22 deg — still over the 16.0/23.9 limits. Fails by construction (2 attempts used, no more).
- **B** (`walkStartRamp=1`): leg weight 0→1 over 0.3 s, root advance scaled by the action's own leg weight (stateless follow; an earlier Date-clock design died in the capture's 500 ms probe gap, and marking the playback handle never reached the frame module's read — measured dead twice, then redesigned). lockOff: 10.8 deg / 0.161 m. twoBone: 12.4 deg / 0.298 m (marginal pass, lock-chasing inflates).
- **C** (A+B): lockOff clean (10.5/0.162); twoBone 18.0/0.441 — the A-phase morph feeds the lock more to chase. Worse than B.
- **D** (`walkStopRamp=1`): leg target + root ramp 1→0.4 over the last 0.45 m. PG: root 1.37→0.67 m/s tracking legW 0.75→0.49, end/settling steps ≤ control, settling arms better (3.1 vs 4.6). SC-05: arrival 0.310 m — the turn entry at legW~0.46 flips the chaotic turn outcome.
- **BD**: start of B + stop of D. PG bar 1 marginal-pass both rows; fails bar 3 (planted 0.293 vs 0.230 control twoBone) and SC-05 bar 6 (arrival +0.035, lateral +0.024).

## Bar table (per-row 1.5x limits; full table in evidence)

| label | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| control | F | P | F | P | P | P | P |
| A | F | P | F | F | P | – | P |
| B | P | P | F | P | P | – | P |
| C | F | P | F | F | P | – | P |
| D | F* | P | = | P | P | F | P |
| BD | P | P | F | F† | P | F | P |

\* D is stop-scoped; start untouched. † BD bar-4 stationary 0.38 vs 0.34 (window composition over the longer 218-frame walk).

Metric judgments, all stated: limits per-row (twoBone steady carries lock-correction steps); standing reference = frame 0 (arrived mean laundered ±28 deg of settling variance into amplitude ratios); stride = ramp-completion time (pose-deviation peaks are clip-phase-fragile: B reads 1.03 s although full motion holds from 0.27 s); arms +0.5 deg (walk-action upper-body contribution fades with leg weight, ~0.1 deg mechanism).

## Selection and stage 3

Selection rule (smallest start foot among all-bar passers) yields the empty set. No default flip: flags stay opt-in. Blocking bars: PG bar 3 (slide regression on shipped lock) and SC-05 bar 6 (BD arrival/lateral; D arrival). Unit tests through `./locomotion-clip-playback` (15 tests) stay green.

## Limits and follow-up

- Settling outcome is chaotic: identical walks diverge ≤0.2 deg on the first settling frame to ±0.26 m slot / ±28 deg plant. SC-05 arrival ±0.022 across control repeats — bar-6 ±0.01 gates need multi-run statistics.
- SC-05 recording starts at walking onset (travelled 0.069 m): it cannot see the walk-start pop; PG is the start vehicle.
- Follow-up (out of scope): disarm/cap lock correction while legW<1 in the start ramp; settling-entry robustness as its own slice.
- Renders and the candidate code (flags walkStartPhase, walkStartRamp, walkStopRamp) are on the local branch `wt/walk-transitions`, not on main: every candidate was rejected.
- Not tested: other actors/clips/scenes; 60 fps; worn headsets; CCD row; stop-take path; multi-run arrival distributions.
