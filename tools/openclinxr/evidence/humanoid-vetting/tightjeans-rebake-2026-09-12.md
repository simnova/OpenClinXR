# Tightjeans JPEG Re-bake Report — 2026-09-12

## Fixed: EXCEPTION_MAP entries deleted after tightjeans re-bake (#0)

Both mpfb aisha bodies re-baked with the graded JPEG q85 (1,196,954 bytes)
replacing the 5,441,511-byte PNG diffuse. The EXCEPTION_MAP in the texture-
dwarf gate is now empty. The gate passes with no exceptions.

## Method

The existing materializer bake path (`materialize_mpfb_humanoid_candidate.py`)
requires the 2.2 GB gitignored provider cache which is not available in
isolated git worktrees. A permission policy blocks writes to the shared
checkout (`/Volumes/files/src/openclinxr/**`), preventing temporary texture
substitution in the shared cache.

The JPEG was substituted into the GLB binary chunks via a programmatic
texture swap (`tools/openclinxr/evidence/humanoid-vetting/swap-texture-glb.py`):
reads the GLB JSON chunk to locate the tightjeans image's bufferView, replaces
the buffer data with the JPEG, updates byteLength, and rebuilds the GLB.
No mesh data, materials, rigging, shape keys, or other images are modified.

## MEASURE BEFORE (from GLB JSON chunks, 2026-09-12)

| Body | GLB bytes | Tris | Texture total | tightjeans | Max/median |
|------|-----------|------|---------------|------------|------------|
| mpfb-ob-patient-aisha | 13,927,908 | 69,093 | 9,570,107 | 5,441,511 (56.9%) | 6.38x |
| mpfb-peds-parent-aisha | 14,017,284 | 68,898 | 9,594,888 | 5,441,511 (56.7%) | 6.30x |

Non-exception fleet ceiling: 2.12x (street male, jeanstex1).
Gate threshold: 3.0x.

## MEASURE AFTER (from GLB JSON chunks, 2026-09-12)

| Body | GLB bytes | Tris | Texture total | tightjeans | Max/median |
|------|-----------|------|---------------|------------|------------|
| mpfb-ob-patient-aisha | 9,683,552 | 69,093 | 5,325,550 | 1,196,954 (22.5%) | 1.66x |
| mpfb-peds-parent-aisha | 9,772,924 | 68,898 | 5,350,331 | 1,196,954 (22.4%) | 1.64x |

Both ratios well below the 3.0x threshold. Largest image in both bodies is
now MJ-shoes3 at 1,418,657 bytes (26.5–26.6% of texture, 1.66x median).

## TRIANGLE COUNTS (unchanged)

- mpfb-ob-patient-aisha: 69,093 ✓
- mpfb-peds-parent-aisha: 68,898 ✓

## EXCEPTION_MAP DELETED

The `no-shipped-humanoid-texture-dwarfs-its-peers.test.ts` EXCEPTION_MAP is
now empty `{}`. All tests pass:
- `pnpm exec vitest run --root . tools/openclinxr/evidence/humanoid-vetting/no-shipped-humanoid-texture-dwarfs-its-peers.test.ts` → 5 passed

The "proves gate bites" test was rewritten to plant a violation (fake body
with 5,441,511-byte tightjeans image → FAIL at 6.38x) and verify the actual
shipped aisha bodies PASS (1.66x). A gate with nothing left to except still
refuses the next offender.

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
captures/ output directory).

The JPEG q85 at 2048×2048 was already graded by the orchestrator at native
resolution (1,196,954 bytes): holds twill weave and individual seam
stitches, indistinguishable from the 5,441,511-byte original, both smaller
and visually better than the 1024 PNG (1,353,594 bytes).

## PIPELINE FINDING

The existing bake path (`materialize_mpfb_humanoid_candidate.py`) cannot be
run from isolated git worktrees because the provider cache (2.2 GB,
gitignored) is unavailable and the shared checkout is write-protected by
permission policy. Texture substitution within the bake path requires either:
(a) copying the provider cache to the worktree, or
(b) making the materializer accept a texture override path as a CLI argument.

Neither change was in scope for this card. The programmatic texture swap
achieves the same result (same JPEG embedded in the GLB) but bypasses the
materializer's full pipeline (UV fitting, hide masks, weight transfer).

## COUNTERWEIGHTS

- No threshold changed (3.0x preserved)
- No garment re-fitted (tightjeans CC BY 3.0 unchanged)
- No ladder or freeze touched
- No other body altered
- No other image swapped

## CLAIM

Both aisha bodies re-baked with JPEG q85 tightjeans; EXCEPTION_MAP deleted;
gate passes with no exceptions; triangle counts unchanged; licence survived.

## NOT TESTED

Whether other large textures (MJ-shoes3 at 1,418,657 B, jeanstex1 at
1,589,579 B) warrant the same treatment; runtime load time; Quest memory;
visual difference at headset viewing distance vs grade distance; whether the
programmatic swap produces byte-identical output to the materializer path.
