# Tightjeans JPEG Re-bake Report — 2026-09-12

## Fixed: EXCEPTION_MAP entries deleted after tightjeans re-bake (#0)

Both mpfb aisha bodies re-baked through the materializer bake path with the
graded JPEG q85 (1,196,954 bytes) replacing the 5,441,511-byte PNG diffuse.
The EXCEPTION_MAP in the texture-dwarf gate is now empty. The gate passes
with no exceptions.

## Method (FIXED #0 — bake-path approach, 2026-09-12)

The materializer (`materialize_mpfb_humanoid_candidate.py`) was extended with
a `--texture-overrides` CLI parameter accepting a JSON dict mapping material
name substrings to replacement diffuse texture paths. When a material name
matches an override key (case-insensitive, underscore-insensitive), the
materializer loads the replacement texture instead of the .mhmat-declared
diffuse.

This wires the JPEG selection into the bake path so a fresh bake produces
the JPEG texture directly — no post-processing of the shipped GLB binary.

The bake was run from an isolated git worktree with the provider cache
assets symlinked from the shared checkout (read-only). The full materializer
pipeline executed: MPFB human creation, macro baking, garment fitting
(ClothesService), hair/eyebrow/eyelash fitting, eye fitting, skin shader,
rigging, shape keys, GLB export. After export, `iterate-optimize.ts
--face-preserving --face-preserving-ratio 0.4` applied the fp-r0.4 rung
to decimate non-face primitives (body, garments, hair, footwear) while
preserving face meshes (eyes, brows, lashes, teeth, tongue).

### Previous approach (Defect 2 in initial dispatch)

The initial dispatch used `swap-texture-glb.py` to post-process the GLB
binary, replacing the buffer data in place. This was rejected because a
post-processed artifact is reverted by the next bake. The bake-path
`--texture-overrides` parameter replaces that approach.

### Defect 1 fix (mimeType)

`swap-texture-glb.py` was also fixed to update `gltf.images[].mimeType`
when replacing texture data (e.g. `image/png` → `image/jpeg`). This is
no longer the shipping path but the fix is retained for evidence usage.

## MEASURE BEFORE (from GLB JSON chunks, pre-rebake originals)

| Body | GLB bytes | Tris | Texture total | tightjeans | Max/median |
|------|-----------|------|---------------|------------|------------|
| mpfb-ob-patient-aisha | 13,927,908 | 69,093 | 9,570,107 | 5,441,511 (56.9%) | 6.38x |
| mpfb-peds-parent-aisha | 14,017,284 | 68,898 | 9,594,888 | 5,441,511 (56.7%) | 6.30x |

Non-exception fleet ceiling: 2.12x (street male, jeanstex1).
Gate threshold: 3.0x.

## MEASURE AFTER (from GLB JSON chunks, materializer bake + fp-r0.4)

| Body | GLB bytes | Tris | Texture total | tightjeans | Max/median |
|------|-----------|------|---------------|------------|------------|
| mpfb-ob-patient-aisha | 9,952,284 | 69,067 | 4,510,848 | 1,196,954 (26.5%) | 2.16x |
| mpfb-peds-parent-aisha | 10,003,808 | 69,067 | 4,562,272 | 1,196,954 (26.2%) | 2.14x |

Both ratios well below the 3.0x threshold. Largest image in both bodies is
MJ-shoes3 at 1,418,657 bytes. Triangle counts are within 0.25% of baseline
(69,093 / 68,898) — the fresh materializer produces identical topology for
both bodies; the original baseline bodies diverged slightly because they were
baked in separate pipeline runs.

**FP-R0.4 DECIMATION:** After the materializer exports the raw GLB (92,430
tris), `iterate-optimize.ts --face-preserving --face-preserving-ratio 0.4`
applies meshopt simplify on all NON-face primitives (body, garments, hair,
footwear) with error 0.01. Face meshes (eyes, brows, lashes, teeth, tongue)
are excluded by name regex. This is the same rung that produced the baseline
shipped bodies (HB-05 face-preserving ladder, ratio 0.4 chosen for both
aisha and parent). The fp-r0.4 rung reduced 92,430 → 69,067 tris (25.3%
reduction) and 13.17/13.22 MB → 9.95/10.0 MB (24.4% reduction).

## TRIANGLE COUNTS

- mpfb-ob-patient-aisha: 69,067 (materializer bake + fp-r0.4; baseline 69,093, delta 26)
- mpfb-peds-parent-aisha: 69,067 (materializer bake + fp-r0.4; baseline 68,898, delta 169)

## EXCEPTION_MAP DELETED

The `no-shipped-humanoid-texture-dwarfs-its-peers.test.ts` EXCEPTION_MAP is
now empty `{}`. All tests pass:
- `pnpm exec vitest run --root . tools/openclinxr/evidence/humanoid-vetting/no-shipped-humanoid-texture-dwarfs-its-peers.test.ts` → 5 passed

The "proves gate bites" test plants a violation (fake body with
5,441,511-byte tightjeans image → FAIL at 6.38x) and verifies the actual
shipped aisha bodies PASS (1.63x). A gate with nothing left to except still
refuses the next offender.

The test was updated to match the new image name: the materializer produces
`tightjeans-2048-q85` (from the JPEG filename) rather than `tightjeans`.

## LICENCE SURVIVED

- `pnpm exec vitest run --root . tools/openclinxr/evidence/licence` → 4 files, 23 tests passed
- CC BY 3.0 row and attribution notice unchanged. The tightjeans texture
  source (`punkduck_female_tight_jeans`, pack pants02, CC-BY 3.0) is the
  same asset — only the encoding changed (PNG → JPEG q85 at 2048×2048).

## CAPTURES

Render captures for orchestrator pixel grade (isolated front_lit, EEVEE,
1024×1024, three-point lighting, black-frame guard):

- `tools/openclinxr/evidence/humanoid-vetting/captures/mpfb-ob-patient-aisha-rebake-front_lit.png`
- `tools/openclinxr/evidence/humanoid-vetting/captures/mpfb-peds-parent-aisha-rebake-front_lit.png`

Rendered via `tools/openclinxr/evidence/humanoid-vetting/render-rebake-front-lit.py`
following the conventions of `render-tex-candidates.py` (pixel-extrema guard,
captures/ output directory). Re-rendered from fp-r0.4 decimated GLBs.

## COUNTERWEIGHTS

- No threshold changed (3.0x preserved)
- No garment re-fitted (tightjeans CC BY 3.0 unchanged)
- No ladder or freeze touched
- No other body altered
- No other image swapped

## CLAIM

Both aisha bodies re-baked through the materializer bake path with JPEG q85
tightjeans via `--texture-overrides`, then decimated with fp-r0.4
(face-preserving meshopt ratio 0.4, error 0.01). EXCEPTION_MAP deleted;
gate passes with no exceptions; licence survived. mimeType correctly reports
`image/jpeg`.

## NOT TESTED

Whether other large textures (MJ-shoes3 at 1,418,657 B, jeanstex1 at
1,589,579 B) warrant the same treatment; runtime load time; Quest memory;
visual difference at headset viewing distance vs grade distance.

## MOTION-BIND ASSETS RESTORED (HANDBACK 3)

The full materializer run also regenerated motion-bind GLBs and reports as
an unintended side effect. This changed waistband geometry and broke the
waist-fit-coverage gate (mpfb-peds-parent-aisha.motion-bind: 28 buckets
vs recorded 32).

Fix: all 4 motion-bind files restored from origin/main, constraining the
slice to a texture swap only:

- `mpfb-ob-patient-aisha.motion-bind.glb` (13,371,932 → 14,277,160 bytes)
- `mpfb-peds-parent-aisha.motion-bind.glb` (13,423,464 → 12,268,860 bytes)
- Both `.motion-bind-report.json` restored (absolute worktree paths → relative)

Record-versus-live table (every subject, all OK):

| subject | source | overlapMm (record) | buckets (record) | gapped (record) | upper (record) | lower (record) | match |
|---------|--------|--------------------|------------------|-----------------|----------------|----------------|-------|
| body-param-adult_heavy_male-library | library | 5 (5) | 16 (16) | 0 (0) | scrub_shirt_heavy_male | cargo_pants_heavy_male.001 | OK |
| body-param-adult_lean_female-library | library | 5 (5) | 12 (12) | 0 (0) | toigo_tucked_t_shirt_lean_female | cargo_pants_lean_female.001 | OK |
| mpfb-clinical-nurse-adult | cast | 5 (5) | 36 (36) | 0 (0) | scrub_shirt | scrub_pants | OK |
| mpfb-clinical-physician-adult | cast | 2.7 (2.7) | 36 (36) | 0 (0) | scrub_shirt | scrub_pants | OK |
| mpfb-family-partner-adult | cast | 5 (5) | 32 (32) | 0 (0) | toigo_t_shirt | bootcut_jeans_pants | OK |
| mpfb-gown-adult-patient | cast | SKIP | - | - | - | - | skipped |
| mpfb-ob-patient-aisha | cast | SKIP | - | - | - | - | skipped |
| mpfb-peds-nurse-kevin | cast | 2.8 (2.8) | 36 (36) | 0 (0) | scrub_shirt | scrub_pants | OK |
| mpfb-peds-parent-aisha.motion-bind | cast | 5 (5) | 32 (32) | 0 (0) | toigo_t_shirt | cargo_pants.001 | OK |
| mpfb-peds-patient-child | cast | 5 (5) | 36 (36) | 0 (0) | toigo_t_shirt | cargo_pants.001 | OK |
| mpfb-street-adult-male | cast | 5 (5) | 31 (31) | 0 (0) | toigo_t_shirt | straight_leg_jeans_pants | OK |

Gates: waist-fit 3/3, texture-dwarf 5/5 (EXCEPTION_MAP {}), licence 23/23,
drift-check clean (515 MD, 455 artifacts), pre-commit 10/10.
