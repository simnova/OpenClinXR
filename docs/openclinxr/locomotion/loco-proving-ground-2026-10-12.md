# Locomotion proving ground (2026-10-12)

Browser per-writer tap over a 6 m physician walk: why the feet never stop moving, and the first fix it points to.

## Vehicle

`?locoGround=1` lengthens the case-owned bedside approach to a straight 6 m walk in the existing harness scene (no new scene; clearance of the added segment not re-vetted). Flat grid floor, one physician (`senior_resident_ward_v1`), full production frame loop (mixer, posture pass, claims, stance lock, settling), fake 30 fps clock. 12 contacts, 6 strides, 91 steady frames per row. Rows: `lockOff` (`noStanceLock=1`, observe-only lock: same code path, no writes), `twoBone` (shipped), `ccd` (`ccdStanceLock=1`). Render: side body-only follow-cam 0.5x clip per row, garments/hair hidden by name rule.

Tap: 15 leg bones (upperleg01/02, lowerleg01/02, foot, toe1-1 L/R, pelvisL/R, root) record local quats (a) after `mixer.update`, (b) after the posture pass, (c) at end of frame, plus toe world positions, action weight/timeScale/time, leg weight, stance label, lock state, posture tags. Join evidence-to-tap 130/130 by fake-clock tMs.

Numbers live in `.openclinxr/evidence/loco-ground/report.json` (contact band 0.06 m, production constant).

## Writer table (armed walking frames; max/median quat angle, deg)

(a)->(b), posture pass: 0.00–0.02 on every bone in every row. The posture pass touches no leg, pelvis, or root bone (posture tags all null; it writes arms only). The posture hypothesis is dead.

(b)->(c), stance lock and settling writers:

| bone | lockOff | twoBone | ccd |
|---|---|---|---|
| upperleg01 L/R | 0/0 | 7.0/0.0, 7.5/0.0 | 32.5/0.0, 32.8/0.0 |
| lowerleg01 L/R | 0/0 | 12.2/0.0, 14.6/0.0 | 12.5/0.0, 13.5/0.0 |
| upperleg02, lowerleg02, foot, toe1-1, pelvisL/R, root | 0/0 | ≤0.02 | ≤0.02 |

Medians ~0.01° everywhere: lock writes are spiky (stance-switch frames), not sustained. In lockOff (b)->(c) is exactly 0 — rendered equals mixer pose, the observe path writes nothing. No writer that should not touch the legs touches them; the lock owns upperleg01/lowerleg01.

## Metric table (steady frames; drop first/last gait cycle)

| metric | lockOff | twoBone | ccd |
|---|---|---|---|
| world-stationary fraction L / R | 0.000 / 0.000 | 0.088 / 0.033 | 0.319 / 0.396 |
| kinematic contact fraction L / R (mixer pose) | 0.571 / 0.549 | same take | same take |
| stance-foot world speed med, m/s (lockOff) | 0.824 / 0.818 | — | — |
| swing toe max, rendered L / R, m | 0.029 / 0.031 | 0.031 / 0.032 | 0.028 / 0.031 |
| swing toe max, mixer L / R, m | 0.029 / 0.031 | — | — |
| release-step max, m / transitions | 0.044 / 11 | 0.044 / 11 | 0.044 / 11 |
| root steady, m/s vs planned | 1.374 vs 1.374 | same | same |
| would-be/applied lock correction med, m | 0.1345 | 0.1345 | 0.1344 |
| heel-target miss max, m | null (no solve) | 0.392 | 0.216 |

Excluded: 80 non-walking tap, 1 unarmed first walking frame, 7 null-label walking frames, 0 dropped contacts, 19 start-transient + 13 stop-transient frames. Labels: duty L 0.469 / R 0.477. Actor scale 0.86. legWeight constant 1, timeScale 1.6255 all rows. Transients: stationary 0 except twoBone start L 0.16, ccd start L 0.53 / R 0.11, ccd stop R 0.92 (13 frames).

## Clip (mixer pose, lockOff steady)

Take `openclinxr_retarget_walk_source`, duration 1.7083 s, 411 tracks, played at timeScale 1.6255. Retarget: `packages/openclinxr/factory-stations/src/motion_retarget/motion_bind_from_positions_stage.py`; shipped in `mpfb-clinical-physician-adult.glb` (glTF-Transform v4.3.0). Source-take origin before the retarget not traced.

| | left | right |
|---|---|---|
| kinematic-contact frames | 52 | 50 |
| stance backward body speed med, m/s | 0.564 | 0.559 |
| CV | 0.107 | 0.113 |
| stationary root speed, m/s | 0.564 | 0.559 |
| stride, world m | 0.771 | 0.635 |
| cycle played / at timeScale 1, s | 0.561 / 0.912 | 0.462 / 0.751 |
| swing toe max, m @ cycle phase | 0.029 @ edge | 0.031 @ 0.79 |
| kinematic duty | 0.571 | 0.549 |

## Conclusion

The mixer pose itself has the low, non-stationary feet: swing toe max 0.031 m, world-stationary fraction 0.000, stance feet travelling backward in the body frame at 0.56 m/s (CV ~0.11) while the executor advances the root at 1.374 m/s. The root speed that would hold the stance foot still is 0.56 m/s — the Froude-derived target (leg-length scaled, actor scale 0.86) prescribes 2.4x the speed the take's own feet can cancel. TimeScale cannot fix the ratio: root advance and foot speed scale together. The cause is the clip (and the root speed it is played against), not a frame writer — `packages/openclinxr/xr-humanoid-animation/src/locomotion-clip-playback-mod.ts:407-414` claim patterns additionally miss `pelvisL/R` (GLB carries no `pelvis` bone; inert here since the posture pass writes arms only). Per the slice contract this is a valid stop: no stage-4 frame fix. The next slice belongs below the mixer: `measureStanceGroundAdvance` (`case-owned-approach-runtime-mod.ts:201`) claims 0.845 m/s at rate 1 against true foot speed ~0.35 m/s, or the retarget attenuates the take (headless decoded clip lifts 0.05–0.08 m vs mixer 0.031 m) — both unverified here.

## Not tested

Clearance of the extended route segment; stopping-phase labels; settling/arrived metrics; other actors, clips, or scenes; 60 fps vs 30 fps; worn-headset rendering; videos (2.2–3.4 MB, kept in the evidence dir, not committed).
