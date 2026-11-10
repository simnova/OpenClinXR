# Round 3, inventive (Goldfish), raw findings, unresolved

- R3I1 Major [P2/P3, K5] per-strand ID/shift as a per-cell 1D function of u (one row per cell, ~1.5k x 32 px) or hashed in shader from u + per-vertex cell index; spec_streaks_png (transplant_donor.py:121-160) already sets columns from member root_u. Drops the 2048^2 data map, the 1-sample ID render, the resample gate, ~16 MB. Liability: only as accurate as root_u; drifting members misalign with albedo streaks.
- R3I2 Major [P2 gate] gate the albedo atlas with skin light-leak check tools/openclinxr/asset-pipeline/skin/families/leak_check.py (Pearson r of low-band albedo L vs Cycles irradiance at two key azimuths; driven by xr-scene/src/skin-shader/g1_light_follow.py). Liability: needs atlas-space irradiance bake; no hair baseline (use r10 lit atlas).
- R3I3 Major [P3 else] port Galacean two-lobe KK GLSL (MIT) into onBeforeCompile; copy skin-shade-loader.ts plugin/fail-closed/read-back test structure; register via generated-loaders. Directive D1. Liability: uniform and tangent conventions differ.
- R3I4 Major [P1 sweep] closed-form KK band row from cards.npz tangents per rig in numpy; render only the 2-3 best rigs in Cycles. Liability: ignores occlusion/TRT; ranks, does not gate.
- R3I5 Major [P1 rigs] place Cycles lights with load_lighting_rig / place_rig_probe_lights (factory-stations/src/room_generate/room-albedo-ao-bake.py). Liability: hemisphere/environment must be added there too.
- R3I6 Nit [metrics] noise floor per face-regression/src/calibrate.ts (max(two-render noise, seeded perturbation floor)); add regions.py CIEDE2000 + SSIM-L on hair masks as report metric.
- R3I7 Nit [P4 scalp] apply_scalp_hair_material_region (body_param/garment_ops.py:280) with melanin colour. Liability: scalp_placeholder_retired_for disables it when fitted hair is present.
- R3I8 Nit [P3 step 0] probe d: per-cell u-function into anisotropyTexture RG, no normal tilt.
