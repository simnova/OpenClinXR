# Room chain Metal-vs-CPU bake measurement (2026-09-28)

Measurement job, not a migration job. Question: is Blender's Metal GPU
backend worth adopting for the room pipeline's three bakes? Verdict:
**adopt Metal for the pre-export shell bake only**. Albedo and AO stay
on CPU (albedo fails run-to-run determinism on Metal; AO has no GPU
code path at all).

## Fixture (fixed)

- Seed 205, ward footprint 8.77 x 7.77 m, interior clear ceiling 2.42 m,
  door +y at x=+0.50, hinge +x, style default. Canonical constants:
  `WARD_CHAIN_DEFAULT_SEED = 205` (`room_chain/run.ts:36`),
  `WARD_CHAIN_FOOTPRINT` (`room_chain/run.ts:38`).
- Generation: `run_fixed_footprint` driver (`-s 205`, ward bindings,
  `-t coarse`) + `strip_room_shell_placeholders.py`, run fresh for this
  job into `/tmp/metal-measure/ward-s2.work-infinigen-s205/`.
  Extract: 8 parts, 24404 tris, ceiling 2.42 m, floor area 69.11 m2.
- Shell-bake input: strip `work.blend` (3.3 MB), same file for all 4 runs.
- Albedo input: `work-baked.glb` (9.0 MB, 6 shell_bake_* materials) =
  extract of the CPU shell-bake output. This matches production order
  (`generate.ts`: strip -> shell-bake -> extract -> albedo).
- AO input: `albedo-cpu1.glb` (fixed for all 4 AO runs; production order
  runs occlusion on the albedo output, and CPU albedo is byte-stable).

## Bake code under test

- Shell: `packages/openclinxr/factory-stations/src/room_generate/infinigen_generate/bake_shell_materials.py`
  (`setup_bake_scene`; NORMAL + ROUGHNESS + per-role DIFFUSE COLOR (+ GLOSSY for trim), 4 samples).
- Albedo: `packages/openclinxr/factory-stations/src/room_generate/room-albedo-ao-bake.py`
  (`setup_scene` + `bake_materials`; DIFFUSE direct+indirect+color, 32 samples, floor at 4096).
- AO: `packages/openclinxr/factory-stations/src/room_generate/room-occlusion-bake.py`
  (`paint_bounded_ao`; pure-Python bounded BVH raycast, 512 px, no Cycles bake ops).

CPU vs Metal differed ONLY in device selection (harness monkeypatched
`setup_bake_scene`/`setup_scene` to set `scene.cycles.device` + Cycles
prefs; all bake logic ran unmodified). One Blender process at a time;
every launch refused unless the machine-wide count was 0
(`ps aux | grep "Blender.app/Contents/MacOS/Blender" | grep -v grep`).
One launch was refused and retried after another agent's Blender cleared.

Wall time = harness wall clock; `time_real`/`time_user`/`time_sys` and
peak RSS come from `/usr/bin/time -l` (macOS "maximum resident set
size", bytes). RSS 1 GiB = 1073741824 bytes.

## Full table

| bake | run | device | wall_s | real_s | user_s | sys_s | peak RSS (bytes) | peak RSS (GiB) |
|---|---|---|---|---|---|---|---|---|
| shell | cpu1 | CPU | 149.76 | 149.71 | 870.31 | 7.49 | 1878523904 | 1.75 |
| shell | cpu2 | CPU | 215.91 | 215.83 | 858.29 | 7.42 | 1987133440 | 1.85 |
| shell | metal1 | GPU/Metal | 129.44 | 129.38 | 18.65 | 5.37 | 2518286336 | 2.35 |
| shell | metal2 | GPU/Metal | 29.08 | 29.03 | 18.20 | 4.50 | 2483191808 | 2.31 |
| albedo | cpu1 | CPU | 584.84 | 584.79 | 4919.12 | 31.72 | 7185858560 | 6.69 |
| albedo | cpu2 | CPU | 571.60 | 571.55 | 4938.81 | 30.29 | 7244988416 | 6.75 |
| albedo | metal1 | GPU/Metal | 96.68 | 96.68 | 23.60 | 4.40 | 7575486464 | 7.06 |
| albedo | metal2 | GPU/Metal | 94.18 | 94.13 | 23.54 | 4.10 | 7576682496 | 7.06 |
| ao | cpu1 | CPU | 125.31 | 125.26 | 124.33 | 0.65 | 660258816 | 0.61 |
| ao | cpu2 | CPU | 126.05 | 126.00 | 124.63 | 0.63 | 657555456 | 0.61 |
| ao | metal1 | GPU/Metal | 124.93 | 124.88 | 123.97 | 0.65 | 662700032 | 0.62 |
| ao | metal2 | GPU/Metal | 125.43 | 125.38 | 124.26 | 0.73 | 660160512 | 0.61 |

Means: shell CPU 182.84 s / Metal 79.26 s; albedo CPU 578.22 s /
Metal 95.43 s; AO CPU 125.68 s / Metal 125.18 s.

## Determinism (same device, two runs)

| bake | CPU run-to-run | Metal run-to-run |
|---|---|---|
| shell | baked pixels byte-identical (7/7 images) | baked pixels byte-identical (7/7 images) |
| albedo | byte-identical incl. output GLB (`1b31aebd…50da` both) | DIFFER: a few texels +/-1/255 (floor/trim/wall images; GLB hashes differ) |
| ao | byte-identical incl. output GLB (`efe166a6…42d64` all four) | byte-identical; all four GLBs share that hash |

Shell `.blend` containers differ run-to-run on BOTH devices
(pre-existing container nondeterminism, device-independent). The
product-relevant bytes are deterministic: extracts of the two Metal
shell outputs are byte-identical GLBs (`82f29983…02b2b36` both).

## CPU-vs-Metal pixel difference (mean / max absolute, 0-255 units)

Shell (threshold: mean < 1.0): ceiling 0.0801 / 3.00; floor 0.0000 /
1.00; other 0.0000 / 0.00; trim 0.0004 / 1.00; wall 0.0051 / 1.00;
normal 0.0009 / 4.00; roughness 0.0000 / 0.00.

Albedo: ceiling 0.0175 / 63.00; floor 0.0475 / 46.00; other 0.0006 /
49.00; trim 0.4669 / 131.00; wall 0.3993 / 45.00.

AO: exactly 0.0 / 0.00 on all six images.

## Device-enablement proof (Metal was engaged, not silently CPU)

- prefs query: `Apple M1 Max (GPU - 32 cores)` type=METAL use=True;
  `scene.cycles.device=GPU` in every Metal run log.
- CPU-time collapse: shell user_s 870/858 s -> 19/18 s; albedo user_s
  4919/4939 s -> 24/24 s. A silent CPU fallback cannot produce that.
- AO user_s is ~124 s on all four runs: no GPU work exists there.

## Adoption verdicts (mechanical rule)

- **Shell: ADOPT.** (a) 79.26 < 182.84, and even the slower Metal run
  (129.44) beats the faster CPU run (149.76). (b) byte-identical baked
  pixels both devices. (c) worst mean 0.0801/255 < 1.0.
  First Metal run cost note: metal1 (129.44 s) vs metal2 (29.08 s).
  No kernel-compile line appears in the logs, so the gap is reported
  as observed-only, unattributed.
- **Albedo: NO CHANGE.** (a) holds (~6x), (c) holds (worst mean
  0.4669 < 1.0), but (b) fails: Metal's two runs differ by up to
  1/255 on a small texel fraction. Fails regardless of speed.
- **AO: NO CHANGE.** (b) and (c) hold trivially (identical bytes,
  0.0 diff), but (a) shows no real effect: the 0.53 s mean delta is
  smaller than the within-device spread (CPU runs span 0.74 s) and
  user times are identical across all four runs. The script performs
  no Cycles bake/render operations, so there is nothing to move to
  the GPU; a device-selection change would be performative.

## Code change (shell bake only)

- `.../room_generate/infinigen_generate/bake_shell_materials.py`:
  `setup_bake_scene(seed, device="cpu")` + `--device cpu|metal` CLI
  (default `cpu`, historical behaviour preserved); metal enables the
  Metal Cycles device and fails closed when none exists; the bake
  summary records `"device"`.
- `.../room_generate/generate.ts`: production shell-bake spawn passes
  `--device metal`.
- No change for albedo or AO. No new global switch (no per-stage
  device pattern existed; the flag follows the script's existing CLI).
- Verification: native `--device metal` run reproduces the measured
  Metal pixels exactly; flagless default run stays CPU (`"device":
  "cpu"`); extracts of both Metal shell outputs are identical GLBs.

## Side finding (out of scope, NOT fixed)

`room-albedo-ao-bake.py` `ensure_uv` crashes on a raw (non-shell-baked)
extract GLB: when every UV layer of a mesh is pruned as degenerate and
unreferenced, the layer collection ends up empty, the function falls
off its end returning `None`, and `agree_bake_layer_for_material`
dies at `mesh.uv_layers[None]`:

```
File ".../room_generate/room-albedo-ao-bake.py", line 726, in bake_materials
    agree_bake_layer_for_material(mat_name, mesh_names)
File ".../room_generate/room-albedo-ao-bake.py", line 434, in agree_bake_layer_for_material
    mesh.uv_layers.active = mesh.uv_layers[agreed]
TypeError: bpy_prop_collection[key]: invalid key, must be a string or an int, not NoneType
```

Repro: run the albedo script with `--input` = extract of the
un-shell-baked strip output (9 procedural materials, no UV Map nodes).
Production never hits this because the chain shell-bakes before
extract, which leaves referenced layers `ensure_uv` never deletes.
Two initial albedo measurement runs hit this (wrong fixture level),
were discarded from the table, and re-run on the production-faithful
input. Left unfixed: measurement jobs make no unrelated product
changes.

## Delivery state (no commit sha: commit blocked by pre-existing red gate)

- Gates on this job's scope: room_generate suite 17 files / 54 pass
  (3 skipped); `pnpm architecture` 242 pass; `pnpm agent:alignment`
  clean; `docs:drift-check` names zero files from this job.
- Pre-push profile and the shared pre-commit hook are red on three
  committed, untouched-by-this-job handoff files
  (`humanoid-motion-delegation-2026-09-14`,
  `humanoid-motion-reassessment-2026-09-13`,
  `psr-admission-overlay-2026-09-15` handoff.md: one-off
  status-style Markdown without registry entries). That drift exists
  at HEAD and fails the commit for anyone, not just this job.
- The normal `git commit` path was attempted and aborted on that
  hook; `--no-verify` / hook-skip env were not used (forbidden), and
  the unrelated handoff files were not converted (out of scope for a
  measurement job). Six paths are staged and ready to land verbatim
  once the pre-existing drift clears: the two code files, this
  report + report.json, and the two registry files (doc-authority
  diff also carries pre-existing worktree pruning of stale entries
  for files absent from disk, plus this job's one report.md entry).

## Machine-checkability limits

- Raw `.raw` pixel dumps, per-run Blender logs, and `/usr/bin/time -l`
  stderrs live in `/tmp/metal-measure/` (not committed; scratch).
  Committed: this report + `report.json` (same numbers, machine
  readable) + the code diff. GLB/pixel hashes above let anyone
  re-verify from a fresh bake-off.
- The metal1-vs-metal2 shell gap (~100 s) has no attributing log
  line; kernel-cache warmup is a hypothesis, not a claim.
- AO "no effect" rests on code reading (zero `bpy.ops.object.bake` /
  render calls in the AO path) plus identical bytes/times.
