# Skin sheet experiment archive

This directory retains the 2026-09-28 generated skin-sheet experiment and its
front/back Blender comparison. It is evidence, not a factory station, runtime
asset replacement, or proof of improved realism.

The original manifest labels the image source `native image_gen`, driven by
`muse-spark-1-go`, session `04736267-58a9-4c54-a7da-7f409667d56f`. It does not
identify the image provider or model well enough to establish that this was
Grok Imagine. The original `images/1.jpg` and `images/2.jpg` labels refer to the
rejected and keeper attempts; the retained equivalents are
`output-quad-sheet-llm-rejected-face.jpg` and `output-quad-sheet-llm.png`.
Provider-specific rights and production approval are not established here.

Only the keeper's **albedo** was assigned to the existing MPFB skin material
and re-rendered. The generated normal, roughness, and cavity maps are retained
as candidates; they were not applied or physically validated. No runtime GLB
was exported. The before/after differences recorded in `realism-judgment.json`
measure changed pixels, not realism. The judgment reports no measured realism
delta and calls for a blind visual comparison.

The original probes depend on developer-local texture paths, temporary Blender
renders, and an exact MPFB material name. This archive does not establish a
portable generation recipe: the input GLB hash, complete provider prompt,
provider model/version and Blender version are not recorded. Hair was hidden
for the comparison. The retained whole-body images are insufficient for skin
pore, seam, physical PBR, or production-quality acceptance.

The baseline Toigo freckles source belongs to MakeHuman skins01. Current
project licensing authority is the 2026-09-17 more-permissive catalogue ruling
in `../third-party-asset-licence-ledger.md`; it permits that pack via catalogue
CC0. This source permission is distinct from the generated output's unresolved
provider provenance and from production approval.

`skin_llm_sheet_rebake_probe_baseline.py` is an older **procedural Pillow proxy**,
not the producer of these retained generated/captured images. Its outputs are
quarantined under `procedural-proxy/` by default and its judgment carries no
realism score. For diagnostic runs, pass `--out-dir` pointing to a separate
scratch directory. It refuses the retained evidence directory or an ancestor
as the destination. Do not replace these retained attempts with proxy output.
