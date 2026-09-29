# Room AO Cycles bake Metal-vs-CPU measurement (2026-09-29)

Re-measurement job. The AO bake (`room-occlusion-bake.py`) is now a real
Cycles EMIT+AO pass (was a pure-Python raycast at the last bake-off, when it
had no GPU code path and was left on CPU). Question: adopt `--device metal`
for the production occlusion spawn in `run.ts`? Verdict: **adopt**.
Mechanical rule, same as `report.md`: faster AND byte-identical run-to-run
on Metal AND within 1/255 mean abs of CPU. All three hold.

## Fixture (fixed)

- Seed 205 ward, `inpatient_ward_room_v1`, footprint 4.3 x 3.9 x 2.4 m,
  door +y at x=+0.25, hinge +x, style lite. Fresh GENERATE on this machine
  (stage-cache miss `86ee79b9`); Metal shell bake + extract + CPU albedo in
  production stage order.
- Extract (`ward-chain.work.glb` post-extract, pre-albedo): 6
  `shell_bake_*` materials, sha
  `e045e5620dda350d7acfacf2f6a3bf11a011ee5ac4187d75664b68723b439123`.
- Albedo (CPU-only script, run.ts defaults `--resolution 1024`) on a copy
  of the extract. 5 materials baked, skirting skipped as shell-flat, zero
  occlusion textures: exactly the pre-occlusion state.
- AO input `ao-input.glb`, sha
  `9f692d786375018f14774286697923c134c3000234cdc962cf87a311a8d0a509`,
  same file for all 4 runs. AO args = run.ts production defaults
  (`--resolution 512`; reach 0.5 m, 64 samples, fixed seed 20260929 are
  script constants).
- Blender 5.1.1, Apple M1 Max. One Blender process at a time; every launch
  required a machine-wide count < 2
  (`ps aux | grep "Blender.app/Contents/MacOS/Blender"`).
- Procedural note: the first chain attempt was killed by the tool
  foreground cap during the albedo pass, after extract completed. The
  fixture was rebuilt by running the identical albedo step (run.ts
  defaults) on the fresh extract bytes, so the AO input is
  production-faithful. No occlusion argv was captured (the kill landed
  before that pass); the AO args above are read directly from `run.ts`.

## Full table (integer wall-clock seconds via `date +%s`)

| run | device | seconds | blender start/end | output GLB sha256 (short) |
|---|---|---|---|---|
| cpu1 | CPU | 18 | 0 / 0 | `22792de3…6ab9f2f` |
| cpu2 | CPU | 18 | 0 / 0 | `22792de3…6ab9f2f` |
| metal1 | METAL | 8 | 0 / 0 | `161d348e…b7bf44c1` |
| metal2 | METAL | 8 | 0 / 0 | `161d348e…b7bf44c1` |

Means: CPU 18.0 s / Metal 8.0 s. No run overlapped another bake
(all counts 0/0, uncontaminated). Full shas in `ao-cycles-report.json`.

## Determinism (same device, two runs)

CPU: byte-identical output GLBs and all 12 extracted images. Metal:
byte-identical output GLBs and all 12 extracted images. No seed-fix
attempt was needed: Metal passed out of the box (the script already pins
`AO_SEED = 20260929`; no `use_animated_seed` anywhere in the bake path).

## CPU-vs-Metal difference per baked AO image (0-255 units)

| AO image | mean abs | max abs | fraction differing |
|---|---|---|---|
| ceiling | 0.0 | 0.0 | 0.0 |
| floor | 0.0 (~7.6e-06) | 1.0 | 8e-06 (~2 of 262144 texels) |
| other | 0.0 | 0.0 | 0.0 |
| trim | 0.0 | 0.0 | 0.0 |
| wall | 0.0 (~3.8e-06) | 1.0 | 4e-06 (~1 texel) |

3 of 5 AO images byte-identical; the other two differ on a total of ~3
texels at +/-1. Worst mean is four orders of magnitude inside the 1/255
limit. Carried-over albedo/shell images are untouched (0.0 throughout).

## Device-enablement proof (Metal was engaged, not silently CPU)

Both Metal logs print `[room-ao] device=metal (1 Metal device(s)
enabled)` with `scene.cycles.device=GPU`. A silent CPU fallback cannot
produce the 18 s to 8 s wall-time drop.

## Adoption verdicts (mechanical rule)

- (a) faster: PASS. Metal mean 8 s < CPU mean 18 s (~2.2x); both runs
  per device agree exactly.
- (b) Metal run-to-run determinism: PASS. Byte-identical GLBs and
  extracted AO images.
- (c) within 1/255 of CPU: PASS. Worst per-image mean rounds to 0.0.

**AO: ADOPT.** The script's fail-closed Metal path (errors when no METAL
device exists) carries the portability risk instead of a fallback.

## Code change

- `packages/openclinxr/factory-stations/src/room_generate/run.ts`:
  default `occlusionArgs` gains `--device metal` (same pattern as the
  shell-bake adoption in `generate.ts`, commit `2723b425c`). No script
  change: the bake already accepted `--device cpu|metal`.
- `occlusionExtraArgs` still overrides per call, so tests and fixtures
  keep working unchanged.

## Chain proof (real CLI, post-change)

`room_chain/cli.ts --seed 205 --out-dir
.openclinxr/evidence/ao-cycles-measure --no-cache` ran all stages for
real on 2026-09-29. `ward-chain.occlusion.stdout.log` prints
`[room-ao] device=metal (1 Metal device(s) enabled)` and
`materials=6 wired=5 skipped=1`; the final `ward-chain.work.glb`
carries 5 `occlusionTexture` wirings
(`openclinxr_room_ao_shell_bake_*`). The production spawn produces
the Metal AO.
