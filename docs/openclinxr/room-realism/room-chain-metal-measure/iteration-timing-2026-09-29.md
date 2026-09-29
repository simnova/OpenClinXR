# Room iteration timing after GPU changes (2026-09-29) — Part 1: cold chain

Measurement job. Question: where does a room iteration's wall-clock go after
the shell-Metal adoption, the Cycles AO Metal adoption (09b43eaec), and the
textured-shell albedo skip (883ac55cf)? Method: `room_chain/cli.ts --seed 205
--no-cache` run TWICE with a `BLENDER` timing shim (no product code change).
Every pass logs start/end epoch, elapsed seconds, and the machine-wide
concurrent-Blender count at start and end. Fixture: ward footprint
4.3 x 3.9 x 2.4 m, door +y at x=+0.25, hinge +x, style lite.

## Part 1: cold chain timing (done)

Chain wall time: cold1 63 s, cold2 59 s. Pre-GPU baseline cold 887-954 s
(`room-chain-stage-cache/timing.json`: red1 954 s, red3 933 s, red4-fresh
887 s). All passes on both runs had concurrent-Blender count 0 at start and
0 at end (uncontaminated). Cache bypassed via `--no-cache` (reads skipped,
stores still written).

| stage / pass | before | cold1 (s) | cold2 (s) | note |
|---|---|---|---|---|
| chain total | 887-954 | 63 | 59 | ~15x vs baseline |
| Infinigen generate driver | (in generate) | 9.9 | 7.7 | `durationsMs.generateMs`; venv python, not Blender |
| shell strip | (in generate) | 1.2 | 1.1 | Blender, no device flag |
| shell bake (Metal) | 150-216 CPU | 30.0 | 29.7 | `--device metal`; prior Metal 129/29 |
| extract | (in generate) | 1.8 | 1.6 | Blender |
| door probe | (in generate) | 1.2 | 1.1 | Blender |
| lit albedo pass (CPU, skipped) | 572-585 CPU / 95 Metal | 3.2 | 3.1 | all 6 shell roles skipped (`shell-textured-albedo`); no bake op |
| AO (Metal) | 125 old raycast; 18 CPU / 8 new | 8.2 | 8.2 | `--device metal`; log `device=metal (1 Metal device(s) enabled)` |
| finish compose | ~1-3 | 1.6 | 1.6 | Blender compose.py |
| lighting rig | ~1 | 1.2 | 1.2 | Blender lighting-rig.py |

Albedo skip proof (cold1 `ward-chain.albedo.stdout.log`): all six shell
materials skipped, five textured + one flat, e.g. `skipped shell_bake_wall
(shell textured albedo shell_bake_albedo_wall, 1 mesh(es)) meanL=210.63`.
AO proof: `[room-ao] device=metal (1 Metal device(s) enabled)`,
`materials=6 wired=5 skipped=1`.

Where the time goes now: shell Metal bake (~30 s, ~50% of the chain) is the
remaining wall-clock center; AO (~8 s) is next; generate driver (~8-10 s) and
the skipped albedo (~3 s) follow; everything else is ~1-2 s each.

## Part 2: capture renderer (pending)

## Part 3: lit albedo on Metal (pending — cold-chain CPU time 3.2 s is below the 30 s threshold, so no determinism attempt per the job rule; full verdict after Part 2)
